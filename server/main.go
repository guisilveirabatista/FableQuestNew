package main

// Authoritative server: many players share one world. Clients send intents; the
// server owns positions, combat, loot, and streams snapshots back at a fixed 20 Hz.

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"
)

var spawnSpread bool // dev: scatter players across the field (load-testing AoI)
var store Store      // persistence backend (file or Postgres)

const tickHz = 20

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ---- wire protocol (JSON) --------------------------------------------------

// client -> server
type inMsg struct {
	T     string  `json:"t"`   // "move" | "moveTo" | "attack" | "lockAt" | ...
	Seq   int     `json:"seq"` // client input sequence, echoed back for reconciliation
	Dir   string  `json:"dir"` // "up"|"down"|"left"|"right"|"" (stop)
	X     float64 `json:"x"`   // world point for lockAt
	Y     float64 `json:"y"`
	Slot  int     `json:"slot"`  // hotbar slot for cast
	Id    string  `json:"id"`    // item id for useItem/equip/dropItem
	Bslot string  `json:"bslot"` // body slot for equip/unequip
	V     bool    `json:"v"`     // toggle value (e.g. autoloot)
	Tx    int     `json:"tx"`    // tile for takeLoot/takeCorpse
	Ty    int     `json:"ty"`
	Key   string  `json:"key"` // attribute key for spendAttr
	Who   string  `json:"who"` // shop id for buy
	N     int     `json:"n"`   // item quantity for buy/sell
	Vw    int     `json:"vw"`  // viewport half-extents in tiles (area-of-interest)
	Vh    int     `json:"vh"`
	User  string  `json:"user"` // login
	Pass  string  `json:"pass"`
	Text  string  `json:"text"`  // chat message
	Scope string  `json:"scope"` // chat scope: say | party | world
}

type loginErrMsg struct {
	T   string `json:"t"`
	Msg string `json:"msg"`
}

// server -> client
type playerView struct {
	ID         string   `json:"id"`
	Tx         int      `json:"tx"`
	Ty         int      `json:"ty"`
	Px         float64  `json:"px"`
	Py         float64  `json:"py"`
	Dir        string   `json:"dir"`
	Moving     bool     `json:"moving"`
	Anim       float64  `json:"anim"`
	HP         float64  `json:"hp"`
	MaxHP      int      `json:"maxhp"`
	MP         float64  `json:"mp"`
	MaxMP      int      `json:"maxmp"`
	Lv         int      `json:"lv"`
	Exp        int      `json:"exp"`
	Gold       int      `json:"gold"`
	Kills      int      `json:"kills"`
	Lock       int      `json:"lock"`
	Slots      []string `json:"slots"`
	Follow     bool     `json:"follow"`
	Dead       bool     `json:"dead"`
	DeathCause string   `json:"deathCause"`
	Pvp        bool     `json:"pvp"`
}
type projView struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	T    float64 `json:"t"`
	Boom float64 `json:"boom"` // -1 = flying, >=0 = impact burst remaining
}
type boltView struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	T float64 `json:"t"`
}
type welcomeMsg struct {
	T    string `json:"t"`
	ID   string `json:"id"`
	Map  string `json:"map"`
	Tick int    `json:"tick"`
}
type enemyView struct {
	ID     int     `json:"id"`
	Kind   string  `json:"kind"`
	Tx     int     `json:"tx"`
	Ty     int     `json:"ty"`
	Px     float64 `json:"px"`
	Py     float64 `json:"py"`
	Dir    string  `json:"dir"`
	Moving bool    `json:"moving"`
	Anim   float64 `json:"anim"`
	HP     int     `json:"hp"`
	MaxHP  int     `json:"maxhp"`
	Dying  float64 `json:"dying"`
}
type snapMsg struct {
	T           string       `json:"t"`
	Map         string       `json:"map"`
	Ack         int          `json:"ack"`
	You         playerView   `json:"you"`
	Players     []playerView `json:"players"`
	Enemies     []enemyView  `json:"enemies"`
	Projectiles []projView   `json:"projectiles"`
	Bolts       []boltView   `json:"bolts"`
	Floor       []floorView  `json:"floor"`
	Corpses     []corpseView `json:"corpses"`
	// the receiving player's own private inventory + character sheet
	Bag      map[string]int    `json:"bag"`
	Equip    map[string]string `json:"equip"`
	Points   int               `json:"points"`
	Autoloot bool              `json:"autoloot"`
	Attr     AttrSet           `json:"attr"`
	Log      []string          `json:"log,omitempty"`
	// social (Phase 6): private to the receiving player
	Chat     []chatLine `json:"chat,omitempty"`
	Party    *partyView `json:"party,omitempty"`
	Trade    *tradeView `json:"trade,omitempty"`
	Invite   bool       `json:"invite,omitempty"`   // has a pending party invite
	TradeReq string     `json:"tradeReq,omitempty"` // username asking to trade
}
type floorView struct {
	Id string `json:"id"`
	N  int    `json:"n"`
	Tx int    `json:"tx"`
	Ty int    `json:"ty"`
}
type corpseView struct {
	Tx      int            `json:"tx"`
	Ty      int            `json:"ty"`
	Items   map[string]int `json:"items"`
	Decayed bool           `json:"decayed"`
}

func (e *enemy) view() enemyView {
	return enemyView{e.id, e.kind, e.tx, e.ty, e.px, e.py, e.dir, e.moving, e.anim, e.hp, e.maxhp, e.dying}
}

// ---- player ----------------------------------------------------------------

type Player struct {
	id       string
	username string
	conn     netConn

	mu    sync.Mutex // guards inbox (read goroutine appends, tick drains)
	inbox []inMsg

	// authoritative state — only the tick goroutine touches these
	moveDir     string
	ackSeq      int
	mapID       string
	tx, ty      int
	px, py      float64
	dir         string
	moving      bool
	anim        float64
	path        []tile
	pathGoal    tile
	hasPathGoal bool

	// combat state
	hp, mp           float64
	maxhp, maxmp     int
	lv, exp, gold    int
	kills, points    int
	attr             AttrSet
	slots            []string
	bag              map[string]int
	equip            map[string]string
	autoloot         bool
	atkCool, iframes float64
	lockID           int
	follow           bool // Alt+click / F: chase the locked target
	log              []string
	dead             bool
	deathCause       string
	aoiW, aoiH       int   // area-of-interest half-extents in tiles (from the client viewport)
	pendingHandoff   *exit // zone mode: stepped onto an exit to a map this zone doesn't own

	// social (Phase 6)
	pvp         bool // opted in to player-vs-player
	chatCool    float64
	chatOut     []chatLine
	partyID     int    // 0 = solo
	partyInvite int    // pending invite to this party id
	tradeID     int    // 0 = not trading
	tradeReq    string // username of a pending trade requester
}

func (p *Player) view() playerView {
	return playerView{p.id, p.tx, p.ty, p.px, p.py, p.dir, p.moving, p.anim,
		p.hp, p.maxhp, p.mp, p.maxmp, p.lv, p.exp, p.gold, p.kills, p.lockID, p.slots, p.follow, p.dead, p.deathCause, p.pvp}
}

func (p *Player) logMsg(msg string) {
	p.log = append(p.log, msg)
	if len(p.log) > 40 {
		p.log = p.log[len(p.log)-40:]
	}
}

func (p *Player) drainLog() []string {
	if len(p.log) == 0 {
		return nil
	}
	out := append([]string(nil), p.log...)
	p.log = nil
	return out
}

// ---- hub -------------------------------------------------------------------

type Hub struct {
	mu      sync.Mutex
	players map[string]*Player
	nextID  int

	// ownedMaps limits which maps this hub simulates. nil (solo mode) owns
	// everything and switches maps locally at exits; in zone mode it holds just
	// this zone's maps, and stepping onto an exit to a map we don't own hands the
	// player back to the gateway instead of switching locally.
	ownedMaps map[string]bool

	// shared world entities, keyed by map
	enemies     map[string][]*enemy
	spawnT      map[string]float64
	nextEID     int
	projectiles map[string][]*projectile
	bolts       map[string][]*bolt
	floor       map[string][]*floorItem
	corpses     map[string][]*corpse

	// social (Phase 6)
	parties     map[int]*party
	nextPartyID int
	trades      map[int]*trade
	nextTradeID int
}

func newHub() *Hub {
	return &Hub{
		players:     map[string]*Player{},
		enemies:     map[string][]*enemy{},
		spawnT:      map[string]float64{},
		projectiles: map[string][]*projectile{},
		bolts:       map[string][]*bolt{},
		floor:       map[string][]*floorItem{},
		corpses:     map[string][]*corpse{},
		parties:     map[int]*party{},
		trades:      map[int]*trade{},
	}
}

// ownsMap reports whether this hub simulates mapID (always true in solo mode).
func (h *Hub) ownsMap(mapID string) bool {
	return h.ownedMaps == nil || h.ownedMaps[mapID]
}

// online reports whether an account is already connected (one session each).
func (h *Hub) online(user string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.players[user]
	return ok
}

// addPlayer brings an authenticated account into the world, loading its saved
// character (ch) or making a fresh one (ch == nil). The player id is the username.
func (h *Hub) addPlayer(c netConn, user string, ch *charState) *Player {
	h.mu.Lock()
	defer h.mu.Unlock()
	p := &Player{id: user, username: user, conn: c, dir: "down", aoiW: 22, aoiH: 16}
	if ch != nil {
		applyCharState(p, ch)
	} else {
		p.mapID, p.tx, p.ty = spawn.mapID, spawn.tx, spawn.ty
		if spawnSpread { // dev/load-test: scatter across the field so AoI has an effect
			for tries := 0; tries < 60; tries++ {
				x, y := 1+rand.Intn(MW-2), 1+rand.Intn(MH-2)
				if !blocked("field", x, y) {
					p.mapID, p.tx, p.ty = "field", x, y
					break
				}
			}
		}
		p.px, p.py = float64(p.tx*TS), float64(p.ty*TS)
		initHero(p)
	}
	h.players[p.id] = p
	log.Printf("+ %s logged in (%d online)", p.id, len(h.players))
	return p
}

// savePlayer persists a player's character (copying state under the lock so it's
// safe against the tick), then writes to the store off-lock.
func (h *Hub) savePlayer(p *Player) {
	if store == nil {
		return
	}
	h.mu.Lock()
	ch := charStateOf(p)
	h.mu.Unlock()
	if err := store.Save(p.username, ch); err != nil {
		log.Printf("save %s: %v", p.username, err)
	}
}

func (h *Hub) remove(p *Player) {
	h.mu.Lock()
	// identity check: a handoff may already have dropped p and a new session for
	// the same id could have joined (another zone link) — don't evict that one.
	if cur, ok := h.players[p.id]; ok && cur == p {
		h.cancelTrade(p)
		h.leaveParty(p)
		delete(h.players, p.id)
		log.Printf("- %s left (%d online)", p.id, len(h.players))
	}
	h.mu.Unlock()
	p.conn.Close()
}

// run is the authoritative loop: advance every player, then push each a snapshot
// of the players sharing its map.
func (h *Hub) run() {
	dt := 1.0 / float64(tickHz)
	ticker := time.NewTicker(time.Second / tickHz)
	defer ticker.Stop()
	var mSum, mMax time.Duration // tick-time metrics
	var mBytes, mCount int
	lastLog := time.Now()
	lastSave := time.Now()
	for range ticker.C {
		tickStart := time.Now()
		type outbound struct {
			p    *Player
			data []byte
		}
		var outs []outbound
		var handoffOuts []outbound

		h.mu.Lock()
		// 1) drain each player's intent inbox (move / attack / lock)
		for _, p := range h.players {
			p.mu.Lock()
			inbox := p.inbox
			p.inbox = nil
			p.mu.Unlock()
			for _, m := range inbox {
				h.applyIntent(p, m)
			}
		}
		// 2) per-player timers + regen, then advance from the latest move
		for _, p := range h.players {
			if p.dead {
				p.moveDir = ""
				continue
			}
			p.atkCool = max(0, p.atkCool-dt)
			p.iframes = max(0, p.iframes-dt)
			p.chatCool = max(0, p.chatCool-dt)
			p.mp = math.Min(float64(p.maxmp), p.mp+dt*0.35)
			p.hp = math.Min(float64(p.maxhp), p.hp+dt*0.4)
			// drop a stale lock/follow (target died or left the map)
			if p.lockID != 0 {
				if en := h.enemyByID(p.mapID, p.lockID); en == nil || en.dead || en.dying > 0 {
					p.lockID, p.follow = 0, false
				}
			}
			dir := p.moveDir
			if dir == "" && len(p.path) == 0 && p.follow { // no manual input/path: chase the locked target
				dir = h.followDir(p)
			}
			h.stepPlayer(p, dir, dt)
		}
		// 2b) zone mode: players who stepped onto an exit to a map this zone does
		//     not own are handed back to the gateway (which reconnects them to the
		//     owning zone). Drop them from the sim now so they leave this tick's
		//     snapshots and stop being simulated here.
		if h.ownedMaps != nil {
			for id, p := range h.players {
				if p.pendingHandoff == nil {
					continue
				}
				ex := p.pendingHandoff
				ch := charStateOf(p)
				ch.MapID, ch.Tx, ch.Ty = ex.to, ex.tx, ex.ty
				b, _ := json.Marshal(handoffMsg{T: "handoff", To: ex.to, Tx: ex.tx, Ty: ex.ty, Char: ch})
				handoffOuts = append(handoffOuts, outbound{p, b})
				h.cancelTrade(p) // trade partners are left behind on the old map
				h.leaveParty(p)  // cross-zone parties aren't supported yet
				delete(h.players, id)
				log.Printf("-> handoff %s to %s (%d here)", p.id, ex.to, len(h.players))
			}
		}
		// 3) advance shared enemies against post-move player positions
		playersByMap := map[string][]*Player{}
		for _, p := range h.players {
			if !p.dead {
				playersByMap[p.mapID] = append(playersByMap[p.mapID], p)
			}
		}
		h.updateEnemies(playersByMap, dt)
		// 4) locked-on players auto-swing when a target is in reach
		for _, p := range h.players {
			if p.lockID != 0 {
				h.autoMelee(p)
			}
		}
		// 5) advance fireballs (homing + hits) and decay bolts
		h.updateProjectiles(dt)
		h.updateCorpses(dt)
		h.updateTrades() // drop trades whose partners drifted apart or died
		// 3) build per-map views
		pViews := map[string][]playerView{}
		for _, p := range h.players {
			pViews[p.mapID] = append(pViews[p.mapID], p.view())
		}
		eViews := map[string][]enemyView{}
		for mapID, list := range h.enemies {
			for _, e := range list {
				eViews[mapID] = append(eViews[mapID], e.view())
			}
		}
		prViews := map[string][]projView{}
		for mapID, list := range h.projectiles {
			for _, pr := range list {
				b := -1.0
				if pr.booming {
					b = pr.boom
				}
				prViews[mapID] = append(prViews[mapID], projView{pr.x, pr.y, pr.t, b})
			}
		}
		blViews := map[string][]boltView{}
		for mapID, list := range h.bolts {
			for _, b := range list {
				blViews[mapID] = append(blViews[mapID], boltView{b.x, b.y, b.t})
			}
		}
		fViews := map[string][]floorView{}
		for mapID, list := range h.floor {
			for _, f := range list {
				fViews[mapID] = append(fViews[mapID], floorView{f.id, f.n, f.tx, f.ty})
			}
		}
		cViews := map[string][]corpseView{}
		for mapID, list := range h.corpses {
			for _, c := range list {
				cViews[mapID] = append(cViews[mapID], corpseView{c.tx, c.ty, c.items, c.decayed})
			}
		}
		// 4) snapshot each player — only the entities inside its area of interest
		//    (its viewport + a margin), so bandwidth scales with what you can see
		//    rather than with the whole map's population.
		for _, p := range h.players {
			aw, ah := float64(p.aoiW*TS), float64(p.aoiH*TS)
			near := func(ex, ey float64) bool { return math.Abs(p.px-ex) <= aw && math.Abs(p.py-ey) <= ah }
			nearT := func(tx, ty int) bool { return abs(p.tx-tx) <= p.aoiW && abs(p.ty-ty) <= p.aoiH }

			others := make([]playerView, 0)
			for _, v := range pViews[p.mapID] {
				if v.ID != p.id && near(v.Px, v.Py) {
					others = append(others, v)
				}
			}
			enemies := make([]enemyView, 0)
			for _, v := range eViews[p.mapID] {
				if near(v.Px, v.Py) {
					enemies = append(enemies, v)
				}
			}
			proj := make([]projView, 0)
			for _, v := range prViews[p.mapID] {
				if near(v.X, v.Y) {
					proj = append(proj, v)
				}
			}
			bolts := make([]boltView, 0)
			for _, v := range blViews[p.mapID] {
				if near(v.X, v.Y) {
					bolts = append(bolts, v)
				}
			}
			fl := make([]floorView, 0)
			for _, v := range fViews[p.mapID] {
				if nearT(v.Tx, v.Ty) {
					fl = append(fl, v)
				}
			}
			cp := make([]corpseView, 0)
			for _, v := range cViews[p.mapID] {
				if nearT(v.Tx, v.Ty) {
					cp = append(cp, v)
				}
			}
			p.mu.Lock()
			ack := p.ackSeq
			p.mu.Unlock()
			data, _ := json.Marshal(snapMsg{
				T: "snap", Map: p.mapID, Ack: ack, You: p.view(),
				Players: others, Enemies: enemies, Projectiles: proj, Bolts: bolts,
				Floor: fl, Corpses: cp,
				Bag: p.bag, Equip: p.equip, Points: p.points, Autoloot: p.autoloot, Attr: p.attr,
				Log:      p.drainLog(),
				Chat:     p.drainChat(),
				Party:    h.buildPartyView(p),
				Trade:    h.buildTradeView(p),
				Invite:   p.partyID == 0 && p.partyInvite != 0 && h.parties[p.partyInvite] != nil,
				TradeReq: p.tradeReq,
			})
			outs = append(outs, outbound{p, data})
		}
		h.mu.Unlock()

		for _, o := range outs {
			mBytes += len(o.data)
			if err := o.p.conn.WriteText(o.data); err != nil {
				h.remove(o.p)
			}
		}
		// deliver handoffs (the gateway closes the old link once it reconnects the
		// player to the destination zone).
		for _, o := range handoffOuts {
			o.p.conn.WriteText(o.data)
			o.p.pendingHandoff = nil
		}

		// tick-time / bandwidth metrics, logged every 5s while anyone is online
		d := time.Since(tickStart)
		mSum += d
		mCount++
		if d > mMax {
			mMax = d
		}
		if now := time.Now(); now.Sub(lastLog) >= 5*time.Second {
			h.mu.Lock()
			n := len(h.players)
			h.mu.Unlock()
			if n > 0 && mCount > 0 {
				log.Printf("load: %d players | tick avg %.2fms max %.2fms | %.0f KB/s out",
					n, float64(mSum.Microseconds())/float64(mCount)/1000,
					float64(mMax.Microseconds())/1000,
					float64(mBytes)/now.Sub(lastLog).Seconds()/1024)
			}
			mSum, mMax, mBytes, mCount = 0, 0, 0, 0
			lastLog = now
		}

		// autosave every 20s so progress survives a crash (copies under the lock,
		// writes to the store off the tick)
		if store != nil && time.Since(lastSave) >= 20*time.Second {
			h.mu.Lock()
			type sv struct {
				user string
				ch   *charState
			}
			saves := make([]sv, 0, len(h.players))
			for _, p := range h.players {
				saves = append(saves, sv{p.username, charStateOf(p)})
			}
			h.mu.Unlock()
			go func() {
				for _, s := range saves {
					store.Save(s.user, s.ch)
				}
			}()
			lastSave = time.Now()
		}
	}
}

// applyIntent dispatches one validated player action (the server's sole entry
// point for player-driven world changes — mirrors sim.js applyIntent).
func (h *Hub) applyIntent(p *Player, m inMsg) {
	if p.dead && m.T != "respawn" && m.T != "chat" && m.T != "view" && m.T != "partyLeave" {
		if m.T == "move" {
			p.moveDir = ""
			p.ackSeq = m.Seq
		}
		return
	}
	switch m.T {
	case "respawn":
		h.respawnPlayer(p)
	case "move":
		p.moveDir = m.Dir
		p.ackSeq = m.Seq
		if m.Dir != "" {
			clearPath(p)
		}
	case "moveTo":
		p.follow = false
		h.startPathTo(p, m.Tx, m.Ty)
	case "attack":
		if p.atkCool <= 0 {
			h.doSlash(p)
		}
	case "lockAt":
		p.lockID = h.enemyAtPoint(p.mapID, m.X, m.Y)
		p.follow = false // right-click locks for attack only, no chasing
	case "followAt":
		if en := h.enemyAtPoint(p.mapID, m.X, m.Y); en != 0 { // Alt+click: lock AND follow
			p.lockID = en
			p.follow = true
		}
	case "toggleFollow":
		if p.lockID != 0 {
			p.follow = !p.follow
		}
	case "cycleLock":
		h.cycleLock(p)
	case "unlock":
		p.lockID = 0
		p.follow = false
	case "cast":
		h.castSlot(p, m.Slot)
	case "useItem":
		useItem(p, m.Id)
	case "equip":
		equipTo(p, m.Id, m.Bslot)
	case "unequip":
		unequipSlot(p, m.Bslot)
	case "dropItem":
		if p.bag[m.Id] > 0 {
			removeItem(p, m.Id, 1)
			h.dropFloor(p.mapID, m.Id, 1, p.tx, p.ty)
		}
	case "takeLoot":
		h.pickupAt(p, m.Tx, m.Ty)
	case "takeCorpse":
		h.takeCorpse(p, m.Tx, m.Ty, m.Id)
	case "spendAttr":
		spendAttr(p, m.Key)
	case "assignSkill":
		assignSkill(p, m.Id, m.Slot)
	case "buy":
		shopBuy(p, m.Who, m.Id, m.N)
	case "sell":
		shopSell(p, m.Id, m.N)
	case "setAutoloot":
		p.autoloot = m.V
	case "view": // client reports its viewport; clamp to a sane area of interest
		p.aoiW = clampInt(m.Vw, 8, 60)
		p.aoiH = clampInt(m.Vh, 6, 40)
	// ---- social (Phase 6) ----
	case "chat":
		h.chat(p, m.Scope, m.Text)
	case "setPvp":
		p.pvp = m.V
	case "partyInvite":
		h.partyInvite(p, m.Id)
	case "partyAccept":
		h.partyAccept(p)
	case "partyDecline":
		h.partyDecline(p)
	case "partyLeave":
		h.leaveParty(p)
	case "partyKick":
		h.partyKick(p, m.Id)
	case "tradeRequest":
		h.tradeRequest(p, m.Id)
	case "tradeAccept":
		h.tradeAccept(p)
	case "tradeDecline":
		h.tradeDecline(p)
	case "tradeOffer":
		h.tradeOffer(p, m.Id, m.N)
	case "tradeGold":
		h.tradeGold(p, m.N)
	case "tradeLock":
		h.tradeLock(p, m.V)
	case "tradeConfirm":
		h.tradeConfirm(p)
	case "tradeCancel":
		h.cancelTrade(p)
	}
}

// serveWS upgrades the connection and pumps client messages until it closes.
func (h *Hub) serveWS(w http.ResponseWriter, r *http.Request) {
	c, err := wsUpgrade(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	loginErr := func(msg string) { b, _ := json.Marshal(loginErrMsg{T: "loginError", Msg: msg}); c.WriteText(b) }

	var p *Player // nil until the client logs in
readloop:
	for {
		op, data, err := c.ReadMessage()
		if err != nil {
			break
		}
		switch op {
		case opClose:
			c.writeFrame(opClose, nil)
			break readloop
		case opPing:
			c.writeFrame(opPong, data)
		case opText:
			var m inMsg
			if json.Unmarshal(data, &m) != nil {
				continue
			}
			if p == nil { // must authenticate before joining the world
				if m.T != "login" {
					continue
				}
				if !validName(m.User) {
					loginErr("invalid username (1-16 letters, digits, _)")
					continue
				}
				if len(m.Pass) < 1 || len(m.Pass) > 64 {
					loginErr("invalid password")
					continue
				}
				ch, err := store.Login(m.User, m.Pass)
				if err == errBadPassword {
					loginErr("wrong password")
					continue
				}
				if err != nil {
					loginErr("login failed")
					continue
				}
				if h.online(m.User) {
					loginErr("already logged in")
					continue
				}
				p = h.addPlayer(c, m.User, ch)
				welcome, _ := json.Marshal(welcomeMsg{T: "welcome", ID: p.id, Map: p.mapID, Tick: tickHz})
				c.WriteText(welcome)
				continue
			}
			p.mu.Lock()
			if len(p.inbox) < 256 { // drop floods
				p.inbox = append(p.inbox, m)
			}
			p.mu.Unlock()
		}
	}
	if p != nil {
		h.savePlayer(p) // persist on disconnect
		h.remove(p)
	}
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	webRoot := flag.String("web", "..", "directory to serve the game client from")
	spawnAt := flag.String("spawn", "city", "player spawn map: city (safe plaza) or field (among monsters, for testing)")
	spread := flag.Bool("spread", false, "scatter players across the field (for load-testing area-of-interest)")
	db := flag.String("db", "file:fablequest.db.json", "persistence: file:PATH (default) or postgres://... (needs -tags postgres)")
	mode := flag.String("mode", "solo", "solo (all-in-one) | zone (simulate some maps) | gateway (client-facing proxy)")
	zoneMaps := flag.String("maps", "", "zone mode: comma-separated maps this zone owns, e.g. city,field")
	zaddr := flag.String("zaddr", ":9101", "zone mode: internal TCP address the gateway links to")
	var zoneRoutes zoneRoutes
	flag.Var(&zoneRoutes, "zone", "gateway mode: map=addr route, repeatable, e.g. -zone city=:9101 -zone field=:9102")
	flag.Parse()
	spawnSpread = *spread

	buildMaps()
	if *spawnAt == "field" { // dev/testing: drop players straight into monster territory
		spawn.mapID, spawn.tx, spawn.ty = "field", 15, 10
	}

	switch *mode {
	case "solo":
		var err error
		if store, err = openStore(*db); err != nil {
			log.Fatalf("store: %v", err)
		}
		defer store.Close()
		hub := newHub()
		go hub.run()
		mux := http.NewServeMux()
		mux.HandleFunc("/ws", hub.serveWS)
		mux.Handle("/", http.FileServer(http.Dir(*webRoot)))
		log.Printf("Fable Quest server (solo) on %s (web root %q), tick %d Hz", *addr, *webRoot, tickHz)
		if err := http.ListenAndServe(*addr, mux); err != nil {
			log.Fatal(err)
		}

	case "zone":
		owned := splitMaps(*zoneMaps)
		if len(owned) == 0 {
			log.Fatal("zone mode needs -maps (e.g. -maps city)")
		}
		hub := newHub()
		hub.ownedMaps = map[string]bool{}
		for _, m := range owned {
			hub.ownedMaps[m] = true
		}
		go hub.run()
		runZone(hub, owned, *zaddr) // blocks

	case "gateway":
		if len(zoneRoutes) == 0 {
			log.Fatal("gateway mode needs at least one -zone map=addr route")
		}
		var err error
		if store, err = openStore(*db); err != nil {
			log.Fatalf("store: %v", err)
		}
		defer store.Close()
		gw := newGateway(zoneRoutes)
		mux := http.NewServeMux()
		mux.HandleFunc("/ws", gw.serveWS)
		mux.Handle("/", http.FileServer(http.Dir(*webRoot)))
		log.Printf("Fable Quest gateway on %s (web root %q), zones %v", *addr, *webRoot, map[string]string(zoneRoutes))
		if err := http.ListenAndServe(*addr, mux); err != nil {
			log.Fatal(err)
		}

	default:
		log.Fatalf("unknown -mode %q (want solo, zone, or gateway)", *mode)
	}
}

// splitMaps parses a comma-separated map list ("city,field") into a slice.
func splitMaps(s string) []string {
	var out []string
	for _, m := range strings.Split(s, ",") {
		if m = strings.TrimSpace(m); m != "" {
			out = append(out, m)
		}
	}
	return out
}

// zoneRoutes is a repeatable -zone map=addr flag collected into a map.
type zoneRoutes map[string]string

func (z zoneRoutes) String() string { return fmt.Sprintf("%v", map[string]string(z)) }
func (z *zoneRoutes) Set(s string) error {
	i := strings.IndexByte(s, '=')
	if i <= 0 {
		return fmt.Errorf("want map=addr, got %q", s)
	}
	if *z == nil {
		*z = zoneRoutes{}
	}
	(*z)[s[:i]] = s[i+1:]
	return nil
}
