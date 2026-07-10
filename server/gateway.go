package main

// Gateway mode (Phase 5): the single client-facing process. Browsers connect
// here over WebSocket exactly as before; the gateway authenticates them, owns the
// persistence store, and proxies each player to the zone-server that currently
// owns their map. When a player crosses a border the owning zone sends a handoff;
// the gateway saves the character and reconnects the player to the destination
// zone. To the browser nothing changes — snapshots keep flowing and carry the new
// map, which is all the client needs to switch.
//
//   ./server -mode gateway -addr :8080 -zone city=:9101 -zone field=:9102
//
// A gateway with a single zone that owns every map behaves just like solo mode
// (minus the local combat-loop coupling), so you can grow into sharding.

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

var errNoZone = errors.New("no zone owns the requested map")

type Gateway struct {
	zones map[string]string // map id -> zone TCP address

	mu          sync.Mutex
	online      map[string]int // one live client session per account
	sessions    map[string]*gwSession
	nextSession int
}

func newGateway(zones map[string]string) *Gateway {
	return &Gateway{zones: zones, online: map[string]int{}, sessions: map[string]*gwSession{}}
}

func (gw *Gateway) zoneFor(mapID string) string { return gw.zones[mapID] }

// tryOnline atomically claims a session for user, or reports it already taken.
func (gw *Gateway) tryOnline(user string) (int, bool) {
	gw.mu.Lock()
	defer gw.mu.Unlock()
	if gw.online[user] != 0 {
		return 0, false
	}
	gw.nextSession++
	token := gw.nextSession
	gw.online[user] = token
	return token, true
}

func (gw *Gateway) setOffline(user string, token int) {
	gw.mu.Lock()
	if gw.online[user] == token {
		delete(gw.online, user)
	}
	gw.mu.Unlock()
}

func (gw *Gateway) registerSession(s *gwSession) {
	gw.mu.Lock()
	gw.sessions[s.user] = s
	gw.mu.Unlock()
}

func (gw *Gateway) unregisterSession(s *gwSession) {
	gw.mu.Lock()
	if gw.sessions[s.user] == s {
		delete(gw.sessions, s.user)
	}
	gw.mu.Unlock()
}

func (gw *Gateway) broadcastChat(line chatLine) {
	gw.mu.Lock()
	sessions := make([]*gwSession, 0, len(gw.sessions))
	for _, s := range gw.sessions {
		sessions = append(sessions, s)
	}
	gw.mu.Unlock()
	for _, s := range sessions {
		s.systemLine(line)
	}
}

func (gw *Gateway) kickUser(user, msg string) {
	gw.mu.Lock()
	s := gw.sessions[user]
	gw.mu.Unlock()
	if s == nil {
		return
	}
	s.system(msg)
	s.beginLeave()
	s.client.Close()
}

// initialCharState builds a brand-new character (fresh account) at the spawn.
func initialCharState() *charState {
	p := &Player{dir: "down"}
	p.mapID, p.tx, p.ty = spawn.mapID, spawn.tx, spawn.ty
	p.px, p.py = float64(p.tx*TS), float64(p.ty*TS)
	initHero(p)
	return charStateOf(p)
}

// serveWS handles a browser connection: login (same rules as solo), then proxy.
func (gw *Gateway) serveWS(w http.ResponseWriter, r *http.Request) {
	c, err := wsUpgrade(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	loginErr := func(msg string) { b, _ := json.Marshal(loginErrMsg{T: "loginError", Msg: msg}); c.WriteText(b) }

	var (
		user  string
		char  *charState
		chars []*charState
		token int
	)
	defer func() {
		if user != "" {
			gw.setOffline(user, token)
		}
	}()
selectCharacter:
	for {
		op, data, err := c.ReadMessage()
		if err != nil {
			c.Close()
			return
		}
		switch op {
		case opClose:
			c.writeFrame(opClose, nil)
			c.Close()
			return
		case opPing:
			c.writeFrame(opPong, data)
		case opText:
			var m inMsg
			if json.Unmarshal(data, &m) != nil {
				continue
			}
			if user == "" && m.T != "login" {
				continue
			}
			switch m.T {
			case "login":
				if !validName(m.User) {
					loginErr("invalid username (1-16 letters, digits, _)")
					continue
				}
				if len(m.Pass) < 1 || len(m.Pass) > 64 {
					loginErr("invalid password")
					continue
				}
				loaded, err := store.Login(m.User, m.Pass)
				if err == errBadPassword {
					loginErr("wrong password")
					continue
				}
				if err == errAccountBanned {
					loginErr("account banned")
					continue
				}
				if err != nil {
					loginErr("login failed")
					continue
				}
				tok, ok := gw.tryOnline(m.User)
				if !ok {
					loginErr("already logged in")
					continue
				}
				user, chars, token = m.User, loaded, tok
				writeWelcome(c, user, nil, chars, true)
			case "createCharacter":
				if !validName(m.Name) || !validClass(m.Class) {
					writeCharacterList(c, chars, "", "Choose a 1-16 name and a valid class.")
					continue
				}
				if findCharacter(chars, m.Name) != nil {
					writeCharacterList(c, chars, m.Name, "That character already exists.")
					continue
				}
				ch := newCharacterState(m.Name, m.Class, m.Hair, m.Cloth)
				if err := store.Save(user, ch); err != nil {
					writeCharacterList(c, chars, "", "Could not save character.")
					continue
				}
				chars = upsertCharacter(chars, ch)
				writeCharacterList(c, chars, ch.Name, "")
			case "deleteCharacter":
				ch := findCharacter(chars, m.Name)
				if ch == nil {
					writeCharacterList(c, chars, "", "Character not found.")
					continue
				}
				if err := store.DeleteCharacter(user, m.Name); err != nil {
					writeCharacterList(c, chars, "", "Could not delete character.")
					continue
				}
				// Remove from chars slice
				for i, existing := range chars {
					if existing != nil && strings.EqualFold(existing.Name, m.Name) {
						chars = append(chars[:i], chars[i+1:]...)
						break
					}
				}
				writeCharacterList(c, chars, "", "")
			case "enterCharacter":
				ch := findCharacter(chars, m.Name)
				if ch == nil {
					writeCharacterList(c, chars, "", "Select a character.")
					continue
				}
				banned, err := store.CharacterBanned(user, ch.Name)
				if err != nil {
					writeCharacterList(c, chars, ch.Name, "Could not check character access.")
					continue
				}
				if banned {
					writeCharacterList(c, chars, ch.Name, "That character is banned.")
					continue
				}
				char = ch
				break selectCharacter
			}
		}
	}

	s := &gwSession{gw: gw, user: user, token: token, admin: isAdminUser(user), client: c, char: char}
	gw.registerSession(s)
	defer gw.unregisterSession(s)
	if err := s.connect(char); err != nil { // dial the zone owning the starting map
		log.Printf("gateway: connect %s: %v", user, err)
		loginErr("world unavailable, try again")
		c.Close()
		return
	}
	// welcome only after a zone link is up, so the client never leaves the roster
	// screen into a world with nothing behind it.
	writeWelcome(c, user, char, chars, false)
	log.Printf("+ %s logged in via gateway", user)
	s.serve()
	log.Printf("- %s left gateway", user)
}

// ---- per-player proxy session ----------------------------------------------

type gwSession struct {
	gw     *Gateway
	user   string
	token  int
	admin  bool
	client *wsConn

	mu      sync.Mutex
	char    *charState  // latest persisted state (updated on handoff/state)
	link    *framedConn // current zone link
	vw, vh  int         // client's last reported area of interest (for re-enters)
	closing bool        // client gone: draining a final save from the zone
	done    chan struct{}
}

// connect dials the zone owning ch's map (falling back to the spawn zone) and
// sends the enter handshake.
func (s *gwSession) connect(ch *charState) error {
	addr := s.gw.zoneFor(ch.MapID)
	if addr == "" { // no zone owns this map — send them to the spawn zone
		ch.MapID, ch.Tx, ch.Ty = spawn.mapID, spawn.tx, spawn.ty
		addr = s.gw.zoneFor(ch.MapID)
	}
	if addr == "" {
		return errNoZone
	}
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return err
	}
	fc := newFramedConn(conn)
	s.mu.Lock()
	vw, vh := s.vw, s.vh
	s.mu.Unlock()
	if err := fc.WriteJSON(enterMsg{T: "enter", ID: s.user, Admin: s.admin, Char: ch, Vw: vw, Vh: vh}); err != nil {
		fc.Close()
		return err
	}
	s.mu.Lock()
	s.link, s.char = fc, ch
	s.mu.Unlock()
	return nil
}

func (s *gwSession) serve() {
	s.done = make(chan struct{})
	go s.autosaveLoop()
	go s.clientPump()
	s.zoneLoop() // blocks until the zone link ends (leave/handoff-fail/zone down)
	close(s.done)
	s.mu.Lock()
	link := s.link
	s.mu.Unlock()
	if link != nil {
		link.Close()
	}
	s.client.Close() // unblock clientPump if it's still reading
}

// clientPump forwards browser intents to the current zone link.
func (s *gwSession) clientPump() {
	for {
		op, data, err := s.client.ReadMessage()
		if err != nil {
			s.beginLeave() // client gone: ask the zone for a final save
			return
		}
		switch op {
		case opClose:
			s.client.writeFrame(opClose, nil)
			s.beginLeave()
			return
		case opPing:
			s.client.writeFrame(opPong, data)
		case opText:
			var m inMsg // sniff the viewport so re-enters keep the area of interest
			if json.Unmarshal(data, &m) == nil {
				if m.T == "view" {
					s.mu.Lock()
					s.vw, s.vh = m.Vw, m.Vh
					s.mu.Unlock()
				}
				if s.handleGatewayAdmin(m) {
					continue
				}
			}
			s.sendToZone(data)
		}
	}
}

// zoneLoop reads the current zone link: snapshots go to the browser, handoffs
// reconnect to the next zone, state messages persist.
func (s *gwSession) zoneLoop() {
	for {
		s.mu.Lock()
		link := s.link
		s.mu.Unlock()
		if link == nil {
			return
		}
		data, err := link.ReadMessage()
		if err != nil {
			s.mu.Lock()
			cur := s.link
			s.mu.Unlock()
			if cur != link && cur != nil { // a handoff already swapped the link
				continue
			}
			return
		}
		var hdr struct {
			T string `json:"t"`
		}
		json.Unmarshal(data, &hdr)
		switch hdr.T {
		case "handoff":
			var hm handoffMsg
			json.Unmarshal(data, &hm)
			ch := hm.Char
			if ch == nil {
				ch = s.char
			}
			ch.MapID, ch.Tx, ch.Ty = hm.To, hm.Tx, hm.Ty
			s.save(ch)
			old := link
			if err := s.connect(ch); err != nil {
				log.Printf("gateway: handoff dial %s for %s: %v", hm.To, s.user, err)
				old.Close()
				return
			}
			old.Close() // done with the previous zone
			log.Printf("~ %s handed off to %s", s.user, hm.To)
		case "state":
			var sm stateMsg
			json.Unmarshal(data, &sm)
			if sm.Char != nil {
				s.save(sm.Char)
			}
		default: // a snapshot — forward straight to the browser
			if s.isClosing() {
				continue // client gone; keep draining until the final save/EOF
			}
			if s.admin {
				data = s.withAdminBanLists(data)
			}
			if err := s.client.WriteText(data); err != nil {
				s.beginLeave()
			}
		}
	}
}

func (s *gwSession) withAdminBanLists(data []byte) []byte {
	var sm snapMsg
	if json.Unmarshal(data, &sm) != nil || sm.T != "snap" {
		return data
	}
	sm.BanLists = currentBanLists()
	next, err := json.Marshal(sm)
	if err != nil {
		return data
	}
	return next
}

func (s *gwSession) sendToZone(b []byte) {
	s.mu.Lock()
	link := s.link
	s.mu.Unlock()
	if link != nil {
		link.WriteText(b)
	}
}

// beginLeave (once) tells the current zone the client is gone so it emits a final
// state snapshot once combat logout allows it. The account is released
// immediately so a reconnect can reattach to the lingering zone character.
func (s *gwSession) beginLeave() {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return
	}
	s.closing = true
	link := s.link
	s.mu.Unlock()
	s.gw.setOffline(s.user, s.token)
	if link != nil {
		link.WriteJSON(ctrlMsg{T: "leave"})
	}
}

func (s *gwSession) isClosing() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closing
}

// autosaveLoop periodically asks the zone for the live character state so a
// crash between border crossings still keeps recent progress.
func (s *gwSession) autosaveLoop() {
	t := time.NewTicker(20 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-t.C:
			s.mu.Lock()
			link, closing := s.link, s.closing
			s.mu.Unlock()
			if link != nil && !closing {
				link.WriteJSON(ctrlMsg{T: "getState"})
			}
		}
	}
}

func (s *gwSession) save(ch *charState) {
	s.mu.Lock()
	s.char = ch
	s.mu.Unlock()
	if store == nil {
		return
	}
	if err := store.Save(s.user, ch); err != nil {
		log.Printf("gateway: save %s: %v", s.user, err)
	}
}

func (s *gwSession) system(text string) {
	s.systemLine(adminSystemLine(text))
}

func (s *gwSession) systemLine(line chatLine) {
	if s != nil && s.client != nil && !s.isClosing() {
		writeChat(s.client, line)
	}
}

func (s *gwSession) handleGatewayAdmin(m inMsg) bool {
	switch m.T {
	case "adminAnnounce", "adminBanAccount", "adminUnbanAccount", "adminBanCharacter", "adminUnbanCharacter":
	default:
		return false
	}
	if !s.admin || !isAdminUser(s.user) {
		s.system("Admin only.")
		return true
	}
	switch m.T {
	case "adminAnnounce":
		text := sanitizeChat(m.Text)
		if text == "" {
			s.system("Announcement text is empty.")
			return true
		}
		s.gw.broadcastChat(announcementLine(text))
	case "adminBanAccount":
		target := strings.TrimSpace(m.Target)
		if !validName(target) {
			s.system("Choose a valid account name.")
			return true
		}
		if strings.EqualFold(target, s.user) {
			s.system("You cannot ban your own account.")
			return true
		}
		if err := store.SetAccountBan(target, true); err != nil {
			s.system("Could not ban account.")
			return true
		}
		s.gw.kickUser(target, "Your account has been banned.")
		s.system("Banned account " + target + ".")
	case "adminUnbanAccount":
		target := strings.TrimSpace(m.Target)
		if !validName(target) {
			s.system("Choose a valid account name.")
			return true
		}
		if err := store.SetAccountBan(target, false); err != nil {
			s.system("Could not unban account.")
			return true
		}
		s.system("Unbanned account " + target + ".")
	case "adminBanCharacter":
		target, name := strings.TrimSpace(m.Target), strings.TrimSpace(m.Name)
		if !validName(target) || !validName(name) {
			s.system("Choose a valid account and character name.")
			return true
		}
		if strings.EqualFold(target, s.user) && s.char != nil && strings.EqualFold(name, s.char.Name) {
			s.system("You cannot ban the character you are using.")
			return true
		}
		if err := store.SetCharacterBan(target, name, true); err != nil {
			s.system("Could not ban character.")
			return true
		}
		s.gw.mu.Lock()
		targetSession := s.gw.sessions[target]
		s.gw.mu.Unlock()
		if targetSession != nil && targetSession.char != nil && strings.EqualFold(targetSession.char.Name, name) {
			s.gw.kickUser(target, "This character has been banned.")
		}
		s.system("Banned character " + target + "/" + name + ".")
	case "adminUnbanCharacter":
		target, name := strings.TrimSpace(m.Target), strings.TrimSpace(m.Name)
		if !validName(target) || !validName(name) {
			s.system("Choose a valid account and character name.")
			return true
		}
		if err := store.SetCharacterBan(target, name, false); err != nil {
			s.system("Could not unban character.")
			return true
		}
		s.system("Unbanned character " + target + "/" + name + ".")
	}
	return true
}

type ctrlMsg struct {
	T string `json:"t"`
}
