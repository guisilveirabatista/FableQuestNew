package main

// Server-authoritative social systems (Phase 6): chat, parties, trading and PvP.
// Like everything else, the server is the sole authority — it validates every
// invite, offer and hit, so nothing (item dupes, forged trades, chat spoofing,
// hitting a non-consenting player) can be driven from the client. All of these
// run inside the tick under the hub lock, so h.players access is safe.

import (
	"math"
	"math/rand"
	"strings"
	"unicode"
)

// ---- chat ------------------------------------------------------------------

type chatLine struct {
	From  string `json:"from"`
	Scope string `json:"scope"` // "say" (same map) | "party" | "world" | "dm"
	Text  string `json:"text"`
}

const chatMax = 120

// sanitizeChat trims, strips control characters, and caps the length.
func sanitizeChat(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if r == '\n' || r == '\t' {
			r = ' '
		}
		if unicode.IsControl(r) {
			continue
		}
		b.WriteRune(r)
		if b.Len() >= chatMax {
			break
		}
	}
	return strings.TrimSpace(b.String())
}

func (p *Player) pushChat(line chatLine) {
	p.chatOut = append(p.chatOut, line)
	if len(p.chatOut) > 40 {
		p.chatOut = p.chatOut[len(p.chatOut)-40:]
	}
}

func (p *Player) drainChat() []chatLine {
	if len(p.chatOut) == 0 {
		return nil
	}
	out := append([]chatLine(nil), p.chatOut...)
	p.chatOut = nil
	return out
}

// chat routes one message to its recipients (spam-limited by p.chatCool).
func (h *Hub) chat(p *Player, scope, text, target string) {
	text = sanitizeChat(text)
	if text == "" || p.chatCool > 0 {
		return
	}
	p.chatCool = 0.5
	line := chatLine{From: p.displayName(), Scope: scope, Text: text}
	switch scope {
	case "dm":
		o := h.findPlayerByName(target)
		if o == nil {
			p.pushChat(chatLine{Scope: "system", Text: "Player not found."})
			return
		}
		o.pushChat(line)
		if o != p {
			p.pushChat(chatLine{From: "To " + o.displayName(), Scope: "dm", Text: text})
		}
	case "party":
		if p.partyID == 0 {
			p.pushChat(chatLine{From: "", Scope: "system", Text: "You are not in a party."})
			return
		}
		for _, name := range h.parties[p.partyID].members {
			if o := h.players[name]; o != nil {
				o.pushChat(line)
			}
		}
	case "world":
		for _, o := range h.players {
			o.pushChat(line)
		}
	default: // "say": everyone on the same map
		for _, o := range h.players {
			if o.mapID == p.mapID {
				o.pushChat(line)
			}
		}
	}
}

func (h *Hub) systemTo(p *Player, text string) {
	p.pushChat(chatLine{Scope: "system", Text: text})
}

func (h *Hub) findPlayerByName(name string) *Player {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	if p := h.players[name]; p != nil {
		return p
	}
	for _, p := range h.players {
		if strings.EqualFold(p.displayName(), name) || strings.EqualFold(p.username, name) {
			return p
		}
	}
	return nil
}

func (h *Hub) playerLabel(username string) string {
	if p := h.players[username]; p != nil {
		return p.displayName()
	}
	return username
}

// ---- parties ---------------------------------------------------------------

const maxParty = 4

type party struct {
	id      int
	leader  string
	members []string // usernames, leader included
}

type partyMemberView struct {
	Name   string  `json:"name"`
	Lv     int     `json:"lv"`
	HP     float64 `json:"hp"`
	MaxHP  int     `json:"maxhp"`
	Map    string  `json:"map"`
	Leader bool    `json:"leader"`
}

type partyView struct {
	Members []partyMemberView `json:"members"`
}

func (h *Hub) partyOf(p *Player) *party {
	if p.partyID == 0 {
		return nil
	}
	return h.parties[p.partyID]
}

// partyInvite: any member invites an online target that isn't already grouped.
func (h *Hub) partyInvite(p *Player, target string) {
	o := h.findPlayerByName(target)
	if o == nil || o == p {
		h.systemTo(p, "No such player here.")
		return
	}
	if o.partyID != 0 {
		h.systemTo(p, o.username+" is already in a party.")
		return
	}
	pt := h.partyOf(p)
	if pt == nil { // form a new party led by the inviter
		h.nextPartyID++
		pt = &party{id: h.nextPartyID, leader: p.username, members: []string{p.username}}
		h.parties[pt.id] = pt
		p.partyID = pt.id
	}
	if len(pt.members) >= maxParty {
		h.systemTo(p, "Party is full.")
		return
	}
	o.partyInvite = pt.id
	h.systemTo(o, p.displayName()+" invites you to a party. (accept the prompt or type /join)")
	h.systemTo(p, "Invited "+o.displayName()+".")
}

func (h *Hub) partyAccept(p *Player) {
	if p.partyID != 0 {
		return
	}
	pt := h.parties[p.partyInvite]
	p.partyInvite = 0
	if pt == nil || len(pt.members) >= maxParty {
		h.systemTo(p, "That party is no longer available.")
		return
	}
	pt.members = append(pt.members, p.username)
	p.partyID = pt.id
	for _, name := range pt.members {
		if o := h.players[name]; o != nil {
			h.systemTo(o, p.username+" joined the party.")
		}
	}
}

func (h *Hub) partyDecline(p *Player) { p.partyInvite = 0 }

// leaveParty removes p from its party, disbanding or reassigning leadership.
func (h *Hub) leaveParty(p *Player) {
	pt := h.partyOf(p)
	if pt == nil {
		return
	}
	kept := pt.members[:0]
	for _, name := range pt.members {
		if name != p.username {
			kept = append(kept, name)
		}
	}
	pt.members = kept
	p.partyID = 0
	for _, name := range pt.members {
		if o := h.players[name]; o != nil {
			h.systemTo(o, p.username+" left the party.")
		}
	}
	if len(pt.members) <= 1 { // a party of one is no party
		for _, name := range pt.members {
			if o := h.players[name]; o != nil {
				o.partyID = 0
				h.systemTo(o, "Party disbanded.")
			}
		}
		delete(h.parties, pt.id)
		return
	}
	if pt.leader == p.username {
		pt.leader = pt.members[0]
		if o := h.players[pt.leader]; o != nil {
			h.systemTo(o, "You are now the party leader.")
		}
	}
}

func (h *Hub) partyKick(p *Player, target string) {
	pt := h.partyOf(p)
	if pt == nil || pt.leader != p.username || target == p.username {
		return
	}
	if o := h.findPlayerByName(target); o != nil && o.partyID == pt.id {
		h.systemTo(o, "You were removed from the party.")
		h.leaveParty(o)
	}
}

func (h *Hub) buildPartyView(p *Player) *partyView {
	pt := h.partyOf(p)
	if pt == nil {
		return nil
	}
	v := &partyView{}
	for _, name := range pt.members {
		o := h.players[name]
		m := partyMemberView{Name: name, Leader: name == pt.leader}
		if o != nil {
			m.Name = o.displayName()
			m.Lv, m.HP, m.MaxHP, m.Map = o.lv, o.hp, o.maxhp, o.mapID
		}
		v.Members = append(v.Members, m)
	}
	return v
}

// sharePartyExp splits a small bonus to same-map party members on a kill, so
// grouping up to fight is worthwhile (the killer already got the full reward).
func (h *Hub) sharePartyExp(killer *Player, exp int) {
	pt := h.partyOf(killer)
	if pt == nil || exp <= 0 {
		return
	}
	share := exp/2 + 1
	for _, name := range pt.members {
		o := h.players[name]
		if o == nil || o == killer || o.dead || o.mapID != killer.mapID {
			continue
		}
		grantExp(o, share)
		o.logMsg("Party share: +" + itoa(share) + " EXP")
	}
}

// ---- trading ---------------------------------------------------------------

type trade struct {
	id           int
	a, b         string
	aGold, bGold int
	aItems       map[string]int
	bItems       map[string]int
	aLock, bLock bool
	aOK, bOK     bool
}

type tradeSideView struct {
	Name  string         `json:"name"`
	Gold  int            `json:"gold"`
	Items map[string]int `json:"items"`
	Lock  bool           `json:"lock"`
	OK    bool           `json:"ok"`
}

type tradeView struct {
	You  tradeSideView `json:"you"`
	With tradeSideView `json:"with"`
}

func (h *Hub) tradeOf(p *Player) *trade {
	if p.tradeID == 0 {
		return nil
	}
	return h.trades[p.tradeID]
}

// near reports whether two players are close enough to trade / duel face to face.
func nearPlayers(a, b *Player) bool {
	return a.mapID == b.mapID && abs(a.tx-b.tx) <= 2 && abs(a.ty-b.ty) <= 2
}

func (h *Hub) tradeRequest(p *Player, target string) {
	o := h.findPlayerByName(target)
	if o == nil || o == p || !nearPlayers(p, o) {
		h.systemTo(p, "Stand next to someone to trade.")
		return
	}
	if p.tradeID != 0 || o.tradeID != 0 {
		h.systemTo(p, "Someone is already trading.")
		return
	}
	o.tradeReq = p.username
	h.systemTo(o, p.displayName()+" wants to trade. (accept the prompt)")
	h.systemTo(p, "Trade request sent to "+o.displayName()+".")
}

func (h *Hub) tradeAccept(p *Player) {
	other := h.players[p.tradeReq]
	p.tradeReq = ""
	if other == nil || !nearPlayers(p, other) || p.tradeID != 0 || other.tradeID != 0 {
		h.systemTo(p, "Trade unavailable.")
		return
	}
	h.nextTradeID++
	t := &trade{id: h.nextTradeID, a: other.username, b: p.username,
		aItems: map[string]int{}, bItems: map[string]int{}}
	h.trades[t.id] = t
	other.tradeID, p.tradeID = t.id, t.id
	h.systemTo(other, "Trading with "+p.displayName()+".")
	h.systemTo(p, "Trading with "+other.displayName()+".")
}

func (h *Hub) tradeDecline(p *Player) {
	if req := p.tradeReq; req != "" {
		if o := h.findPlayerByName(req); o != nil {
			h.systemTo(o, p.displayName()+" declined the trade.")
		}
	}
	p.tradeReq = ""
}

// tradeSide returns the offer maps for p (self) within trade t.
func tradeSide(t *trade, p *Player) (items map[string]int, gold *int, lock *bool, ok *bool) {
	if t.a == p.username {
		return t.aItems, &t.aGold, &t.aLock, &t.aOK
	}
	return t.bItems, &t.bGold, &t.bLock, &t.bOK
}

// resetLocks: any change to an offer un-readies both sides (standard trade UX).
func (t *trade) resetLocks() { t.aLock, t.bLock, t.aOK, t.bOK = false, false, false, false }

func (h *Hub) tradeOffer(p *Player, id string, n int) {
	t := h.tradeOf(p)
	if t == nil || p.dead {
		return
	}
	items, _, _, _ := tradeSide(t, p)
	cur := items[id]
	want := clampInt(cur+n, 0, p.bag[id]) // can't offer more than you carry
	if want == 0 {
		delete(items, id)
	} else {
		items[id] = want
	}
	t.resetLocks()
}

func (h *Hub) tradeGold(p *Player, n int) {
	t := h.tradeOf(p)
	if t == nil {
		return
	}
	_, gold, _, _ := tradeSide(t, p)
	*gold = clampInt(n, 0, p.gold)
	t.resetLocks()
}

func (h *Hub) tradeLock(p *Player, v bool) {
	t := h.tradeOf(p)
	if t == nil {
		return
	}
	_, _, lock, ok := tradeSide(t, p)
	*lock = v
	if !v {
		*ok = false
	}
}

func (h *Hub) tradeConfirm(p *Player) {
	t := h.tradeOf(p)
	if t == nil || !t.aLock || !t.bLock {
		return
	}
	_, _, _, ok := tradeSide(t, p)
	*ok = true
	if t.aOK && t.bOK {
		h.executeTrade(t)
	}
}

func (h *Hub) executeTrade(t *trade) {
	a, b := h.players[t.a], h.players[t.b]
	if a == nil || b == nil {
		h.closeTrade(t, "Trade failed.")
		return
	}
	// re-validate both sides still have what they offered
	if a.gold < t.aGold || b.gold < t.bGold {
		h.closeTrade(t, "Trade failed (not enough gold).")
		return
	}
	for id, n := range t.aItems {
		if a.bag[id] < n {
			h.closeTrade(t, "Trade failed (items changed).")
			return
		}
	}
	for id, n := range t.bItems {
		if b.bag[id] < n {
			h.closeTrade(t, "Trade failed (items changed).")
			return
		}
	}
	a.gold -= t.aGold
	b.gold += t.aGold
	b.gold -= t.bGold
	a.gold += t.bGold
	for id, n := range t.aItems {
		removeItem(a, id, n)
		addItem(b, id, n)
	}
	for id, n := range t.bItems {
		removeItem(b, id, n)
		addItem(a, id, n)
	}
	h.closeTrade(t, "Trade complete!")
}

func (h *Hub) closeTrade(t *trade, msg string) {
	for _, name := range []string{t.a, t.b} {
		if o := h.players[name]; o != nil && o.tradeID == t.id {
			o.tradeID = 0
			h.systemTo(o, msg)
		}
	}
	delete(h.trades, t.id)
}

func (h *Hub) cancelTrade(p *Player) {
	if t := h.tradeOf(p); t != nil {
		h.closeTrade(t, "Trade cancelled.")
	}
	p.tradeReq = ""
}

// updateTrades drops trades whose partners have wandered apart or gone dark.
func (h *Hub) updateTrades() {
	for _, t := range h.trades {
		a, b := h.players[t.a], h.players[t.b]
		if a == nil || b == nil || a.dead || b.dead || !nearPlayers(a, b) {
			h.closeTrade(t, "Trade cancelled.")
		}
	}
}

func (h *Hub) buildTradeView(p *Player) *tradeView {
	t := h.tradeOf(p)
	if t == nil {
		return nil
	}
	other := t.a
	if other == p.username {
		other = t.b
	}
	side := func(name string) tradeSideView {
		items, gold, lock, ok := tradeSideByName(t, name)
		cp := map[string]int{}
		for k, v := range items {
			cp[k] = v
		}
		label := name
		if p := h.players[name]; p != nil {
			label = p.displayName()
		}
		return tradeSideView{Name: label, Gold: *gold, Items: cp, Lock: *lock, OK: *ok}
	}
	return &tradeView{You: side(p.username), With: side(other)}
}

func tradeSideByName(t *trade, name string) (map[string]int, *int, *bool, *bool) {
	if t.a == name {
		return t.aItems, &t.aGold, &t.aLock, &t.aOK
	}
	return t.bItems, &t.bGold, &t.bLock, &t.bOK
}

// ---- PvP -------------------------------------------------------------------

// pvpMaps marks whole maps as free-for-all arenas (empty by default — the demo
// world keeps the city safe and the field for leveling). Elsewhere two players
// can only hurt each other if BOTH have opted in with the PvP flag, so nobody is
// ganked against their will.
var pvpMaps = map[string]bool{"field": true}

func (h *Hub) canPvp(a, b *Player) bool {
	if a == b || a.dead || b.dead || a.mapID != b.mapID {
		return false
	}
	return pvpMaps[a.mapID] || (a.pvp && b.pvp)
}

func (h *Hub) playerAtPoint(mapID string, x, y float64, self *Player) *Player {
	for _, p := range h.players {
		if p == self || p.dead || p.mapID != mapID {
			continue
		}
		if x >= p.px-4 && x < p.px+20 && y >= p.py-16 && y < p.py+16 {
			return p
		}
	}
	return nil
}

func faceTowardPlayer(p, o *Player) string {
	dx, dy := o.px-p.px, o.py-p.py
	if math.Abs(dx) > math.Abs(dy) {
		if dx > 0 {
			return "right"
		}
		return "left"
	}
	if dy > 0 {
		return "down"
	}
	return "up"
}

// slashReachesXY: is world point (px,py) inside the player's ~1-tile swing arc?
func slashReachesXY(p *Player, dir string, px, py float64) bool {
	d := dirVec[dir]
	cx := float64((p.tx+d[0])*TS) + 8
	cy := float64((p.ty+d[1])*TS) + 8
	return math.Abs(px+8-cx) <= 13 && math.Abs(py+8-cy) <= 13
}

func (h *Hub) autoPvpAttack(p *Player) {
	o := h.players[p.pvpTarget]
	if o == nil || !h.canPvp(p, o) {
		p.pvpTarget = ""
		if p.lockID == 0 && p.followTarget == "" {
			p.follow, p.followEngaged = false, false
		}
		return
	}
	if p.atkCool <= 0 {
		dir := faceTowardPlayer(p, o)
		it := items[p.equip["main"]]
		if it.weaponType == "bow" {
			dist := math.Hypot(o.px+8-(p.px+8), o.py+8-(p.py+8))
			if dist <= 7.5*TS {
				p.dir = dir
				h.doShoot(p, 0, o.id, o.px, o.py)
			}
		} else {
			if slashReachesXY(p, dir, o.px, o.py) {
				p.dir = dir
				h.doSlash(p)
			}
		}
	}
}

// pvpMeleeSweep applies a melee/spin hit to every hostile player in range.
func (h *Hub) pvpMeleeSweep(p *Player, spin bool) {
	if !p.pvp && !pvpMaps[p.mapID] {
		return
	}
	st := statsOf(p)
	for _, o := range h.players {
		if !h.canPvp(p, o) {
			continue
		}
		hit := spin && math.Abs(o.px-p.px) <= 24 && math.Abs(o.py-p.py) <= 24
		if !spin {
			hit = slashReachesXY(p, p.dir, o.px, o.py)
		}
		if !hit || rand.Intn(100) >= st.prec {
			continue
		}
		dmg := st.atk + rand.Intn(4)
		h.pvpHit(p, o, dmg, rand.Intn(100) < st.crit, false)
	}
}

// pvpHit resolves one hit on a player (dodge/endurance mirror the PvE math).
func (h *Hub) pvpHit(attacker, target *Player, dmg int, crit, magic bool) {
	if !h.canPvp(attacker, target) || target.iframes > 0 {
		return
	}
	if adminCheatEnabled(target, "invulnerable") {
		return
	}
	if adminCheatEnabled(target, "infiniteVitals") {
		target.hp = float64(target.maxhp)
		target.mp = float64(target.maxmp)
		return
	}
	st := statsOf(target)
	if rand.Intn(100) < st.dodge {
		return
	}
	if crit {
		dmg *= 2
	}
	guard := st.end
	if magic {
		guard = st.mend
	}
	dmg -= guard / 2
	if dmg < 1 {
		dmg = 1
	}
	target.hp -= float64(dmg)
	h.markCombat(attacker)
	h.markCombat(target)
	target.iframes = 0.5
	if target.hp <= 0 {
		attacker.gold += target.gold / 10 // a small bounty (from thin air, not the victim)
		attacker.logMsg("You defeated " + target.displayName() + "!")
		h.playerDie(target, attacker.displayName())
	}
}

// ---- friends ---------------------------------------------------------------

func (h *Hub) friendAdd(p *Player, target string) {
	target = strings.TrimSpace(target)
	if p.friends == nil {
		p.friends = map[string]bool{}
	}
	if o := h.findPlayerByName(target); o != nil && o != p {
		target = o.displayName()
	}
	if !validName(target) || strings.EqualFold(target, p.displayName()) || strings.EqualFold(target, p.username) {
		h.systemTo(p, "Choose a valid player name.")
		return
	}
	p.friends[target] = true
	h.systemTo(p, target+" added as a friend.")
}

func (h *Hub) friendRemove(p *Player, target string) {
	if p.friends == nil {
		return
	}
	for name := range p.friends {
		if strings.EqualFold(name, target) {
			delete(p.friends, name)
			h.systemTo(p, name+" removed from friends.")
			return
		}
	}
	h.systemTo(p, "That player is not in your friends.")
}

func (h *Hub) friendList(p *Player) {
	if len(p.friends) == 0 {
		h.systemTo(p, "Friends: none yet.")
		return
	}
	names := make([]string, 0, len(p.friends))
	for name := range p.friends {
		names = append(names, name)
	}
	h.systemTo(p, "Friends: "+strings.Join(names, ", "))
}

// ---- small helpers ---------------------------------------------------------

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
