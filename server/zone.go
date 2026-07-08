package main

// Zone mode (Phase 5): this process simulates a subset of the world's maps and
// accepts players from a gateway over an internal framed-JSON link. One link ==
// one player. The gateway has already authenticated the account and carries the
// character state across, so the zone does no login and owns no store; it just
// runs the same authoritative hub tick over its maps.
//
//   ./server -mode zone -maps city -zaddr :9101
//   ./server -mode zone -maps field -zaddr :9102

import (
	"encoding/json"
	"log"
	"net"
)

// enterMsg: gateway -> zone. Brings an authenticated player (with full character
// state) into this zone. Sent as the first frame on a fresh link.
type enterMsg struct {
	T    string     `json:"t"`
	ID   string     `json:"id"`
	Char *charState `json:"char"`
	Vw   int        `json:"vw"`
	Vh   int        `json:"vh"`
}

// handoffMsg: zone -> gateway. The player stepped onto an exit to a map this
// zone doesn't own; the gateway saves the character and reconnects them to the
// zone that owns `to`.
type handoffMsg struct {
	T    string     `json:"t"`
	To   string     `json:"to"`
	Tx   int        `json:"tx"`
	Ty   int        `json:"ty"`
	Char *charState `json:"char"`
}

// stateMsg: zone -> gateway. A character-state snapshot for persistence, sent in
// reply to getState (periodic autosave) or leave (clean disconnect).
type stateMsg struct {
	T    string     `json:"t"`
	Char *charState `json:"char"`
}

// runZone listens for gateway links and serves each as one player. The hub's
// ownedMaps must already be set (before its tick started) so map ownership is
// race-free.
func runZone(hub *Hub, owned []string, zaddr string) {
	ln, err := net.Listen("tcp", zaddr)
	if err != nil {
		log.Fatalf("zone listen %s: %v", zaddr, err)
	}
	log.Printf("zone owns %v, internal link addr %s, tick %d Hz", owned, zaddr, tickHz)
	for {
		c, err := ln.Accept()
		if err != nil {
			log.Printf("zone accept: %v", err)
			continue
		}
		go hub.serveLink(newFramedConn(c))
	}
}

// serveLink handles one gateway<->zone link: an enter handshake, then a stream of
// forwarded client intents plus link-level control messages (getState/leave).
func (h *Hub) serveLink(link *framedConn) {
	data, err := link.ReadMessage()
	if err != nil {
		link.Close()
		return
	}
	var em enterMsg
	if json.Unmarshal(data, &em) != nil || em.T != "enter" || em.Char == nil || !validName(em.ID) {
		link.Close()
		return
	}
	p := h.addFromEnter(link, em)

	for {
		data, err := link.ReadMessage()
		if err != nil {
			break
		}
		var m inMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.T {
		case "getState": // gateway autosave: report current state
			h.mu.Lock()
			ch := charStateOf(p)
			h.mu.Unlock()
			link.WriteJSON(stateMsg{T: "state", Char: ch})
		case "leave": // client disconnected on the gateway: wait out combat logout if needed
			if h.beginZoneLeave(p, link) {
				return // the tick loop will send final state and close this link
			}
			return
		default: // a forwarded client intent
			p.mu.Lock()
			if len(p.inbox) < 256 {
				p.inbox = append(p.inbox, m)
			}
			p.mu.Unlock()
		}
	}
	h.disconnect(p, link) // link died (gateway closed it, e.g. after a handoff)
}

// addFromEnter creates the player from a gateway enter and joins it to the hub.
func (h *Hub) addFromEnter(link *framedConn, em enterMsg) *Player {
	h.mu.Lock()
	if p := h.players[em.ID]; p != nil && (p.conn == nil || p.logoutPending) {
		old := p.conn
		p.conn = link
		p.logoutPending = false
		p.moveDir = ""
		p.logMsg("Reconnected.")
		if em.Vw > 0 {
			p.aoiW = clampInt(em.Vw, 8, 60)
		}
		if em.Vh > 0 {
			p.aoiH = clampInt(em.Vh, 6, 40)
		}
		log.Printf("~ %s reattached to zone on %s (%d online)", p.id, p.mapID, h.connectedCountLocked())
		h.mu.Unlock()
		if old != nil && old != link {
			old.Close()
		}
		return p
	}
	defer h.mu.Unlock()
	p := &Player{id: em.ID, username: em.ID, conn: link, dir: "down", aoiW: 22, aoiH: 16, friends: map[string]bool{}}
	applyCharState(p, em.Char)
	if em.Vw > 0 {
		p.aoiW = clampInt(em.Vw, 8, 60)
	}
	if em.Vh > 0 {
		p.aoiH = clampInt(em.Vh, 6, 40)
	}
	h.players[p.id] = p
	log.Printf("+ %s entered zone on %s (%d here)", p.id, p.mapID, len(h.players))
	return p
}

func (h *Hub) beginZoneLeave(p *Player, link netConn) bool {
	h.mu.Lock()
	if cur, ok := h.players[p.id]; !ok || cur != p || p.conn != link {
		h.mu.Unlock()
		link.Close()
		return false
	}
	h.cancelTrade(p)
	h.leaveParty(p)
	p.moveDir = ""
	p.lockID = 0
	p.pvpTarget = ""
	p.followTarget = ""
	p.follow = false
	clearPath(p)
	if h.shouldLingerAfterDisconnect(p) {
		p.logoutPending = true
		log.Printf("~ %s disconnected in combat; lingering %.0fs (%d online)", p.id, p.combatLogoutT, h.connectedCountLocked())
		h.mu.Unlock()
		return true
	}
	ch := charStateOf(p)
	delete(h.players, p.id)
	log.Printf("- %s left zone (%d online)", p.id, h.connectedCountLocked())
	h.mu.Unlock()
	b, _ := json.Marshal(stateMsg{T: "state", Char: ch})
	link.WriteText(b)
	link.Close()
	return false
}
