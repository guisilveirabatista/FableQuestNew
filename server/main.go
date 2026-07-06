package main

// Authoritative server: many players share one world. Clients send intents; the
// server owns positions, combat, loot, and streams snapshots back at a fixed 20 Hz.

import (
	"encoding/json"
	"flag"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const tickHz = 20

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
	id   string
	conn *wsConn

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
}

func (p *Player) view() playerView {
	return playerView{p.id, p.tx, p.ty, p.px, p.py, p.dir, p.moving, p.anim,
		p.hp, p.maxhp, p.mp, p.maxmp, p.lv, p.exp, p.gold, p.kills, p.lockID, p.slots, p.follow, p.dead, p.deathCause}
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

	// shared world entities, keyed by map
	enemies     map[string][]*enemy
	spawnT      map[string]float64
	nextEID     int
	projectiles map[string][]*projectile
	bolts       map[string][]*bolt
	floor       map[string][]*floorItem
	corpses     map[string][]*corpse
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
	}
}

func (h *Hub) add(c *wsConn) *Player {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.nextID++
	p := &Player{
		id: "p" + strconv.Itoa(h.nextID), conn: c,
		mapID: spawn.mapID, tx: spawn.tx, ty: spawn.ty,
		px: float64(spawn.tx * TS), py: float64(spawn.ty * TS), dir: "down",
	}
	initHero(p)
	h.players[p.id] = p
	log.Printf("+ %s joined (%d online)", p.id, len(h.players))
	return p
}

func (h *Hub) remove(p *Player) {
	h.mu.Lock()
	if _, ok := h.players[p.id]; ok {
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
	for range ticker.C {
		type outbound struct {
			p    *Player
			data []byte
		}
		var outs []outbound

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
		// 4) snapshot each player its own map
		for _, p := range h.players {
			others := make([]playerView, 0, len(pViews[p.mapID]))
			for _, v := range pViews[p.mapID] {
				if v.ID != p.id {
					others = append(others, v)
				}
			}
			p.mu.Lock()
			ack := p.ackSeq
			p.mu.Unlock()
			data, _ := json.Marshal(snapMsg{
				T: "snap", Map: p.mapID, Ack: ack, You: p.view(),
				Players: others, Enemies: eViews[p.mapID],
				Projectiles: prViews[p.mapID], Bolts: blViews[p.mapID],
				Floor: fViews[p.mapID], Corpses: cViews[p.mapID],
				Bag: p.bag, Equip: p.equip, Points: p.points, Autoloot: p.autoloot, Attr: p.attr,
				Log: p.drainLog(),
			})
			outs = append(outs, outbound{p, data})
		}
		h.mu.Unlock()

		for _, o := range outs {
			if err := o.p.conn.WriteText(o.data); err != nil {
				h.remove(o.p)
			}
		}
	}
}

// applyIntent dispatches one validated player action (the server's sole entry
// point for player-driven world changes — mirrors sim.js applyIntent).
func (h *Hub) applyIntent(p *Player, m inMsg) {
	if p.dead && m.T != "respawn" {
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
		shopBuy(p, m.Who, m.Id)
	case "setAutoloot":
		p.autoloot = m.V
	}
}

// serveWS upgrades the connection and pumps client messages until it closes.
func (h *Hub) serveWS(w http.ResponseWriter, r *http.Request) {
	c, err := wsUpgrade(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	p := h.add(c)
	welcome, _ := json.Marshal(welcomeMsg{T: "welcome", ID: p.id, Map: p.mapID, Tick: tickHz})
	if err := c.WriteText(welcome); err != nil {
		h.remove(p)
		return
	}
	for {
		op, data, err := c.ReadMessage()
		if err != nil {
			break
		}
		switch op {
		case opClose:
			c.writeFrame(opClose, nil)
			h.remove(p)
			return
		case opPing:
			c.writeFrame(opPong, data)
		case opText:
			var m inMsg
			if json.Unmarshal(data, &m) == nil {
				p.mu.Lock()
				if len(p.inbox) < 256 { // drop floods
					p.inbox = append(p.inbox, m)
				}
				p.mu.Unlock()
			}
		}
	}
	h.remove(p)
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	webRoot := flag.String("web", "..", "directory to serve the game client from")
	spawnAt := flag.String("spawn", "city", "player spawn map: city (safe plaza) or field (among monsters, for testing)")
	flag.Parse()

	buildMaps()
	if *spawnAt == "field" { // dev/testing: drop players straight into monster territory
		spawn.mapID, spawn.tx, spawn.ty = "field", 15, 10
	}
	hub := newHub()
	go hub.run()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.serveWS)
	mux.Handle("/", http.FileServer(http.Dir(*webRoot)))

	log.Printf("Fable Quest server on %s (web root %q), tick %d Hz", *addr, *webRoot, tickHz)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}
