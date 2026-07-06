package main

// Phase 1 authoritative server: many players share one world, movement only.
// Each client sends its desired direction (an intent); the server owns every
// position and streams snapshots back at a fixed 20 Hz. Enemies/combat/items
// stay client-side for now — they move server-side in Phase 2.

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
	T    string  `json:"t"`   // "move" | "attack" | "lockAt" | "cycleLock" | "unlock"
	Seq  int     `json:"seq"` // client input sequence, echoed back for reconciliation
	Dir string  `json:"dir"` // "up"|"down"|"left"|"right"|"" (stop)
	X   float64 `json:"x"`   // world point for lockAt
	Y   float64 `json:"y"`
}

// server -> client
type playerView struct {
	ID     string  `json:"id"`
	Tx     int     `json:"tx"`
	Ty     int     `json:"ty"`
	Px     float64 `json:"px"`
	Py     float64 `json:"py"`
	Dir    string  `json:"dir"`
	Moving bool    `json:"moving"`
	Anim   float64 `json:"anim"`
	HP     float64 `json:"hp"`
	MaxHP  int     `json:"maxhp"`
	MP     float64 `json:"mp"`
	MaxMP  int     `json:"maxmp"`
	Lv     int     `json:"lv"`
	Exp    int     `json:"exp"`
	Gold   int     `json:"gold"`
	Kills  int     `json:"kills"`
	Lock   int     `json:"lock"`
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
	T       string       `json:"t"`
	Map     string       `json:"map"`
	Ack     int          `json:"ack"`
	You     playerView   `json:"you"`
	Players []playerView `json:"players"`
	Enemies []enemyView  `json:"enemies"`
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
	moveDir string
	ackSeq  int
	mapID   string
	tx, ty  int
	px, py  float64
	dir     string
	moving  bool
	anim    float64

	// combat state
	hp, mp           float64
	maxhp, maxmp     int
	lv, exp, gold    int
	kills, points    int
	attr             AttrSet
	atkCool, iframes float64
	lockID           int
}

func (p *Player) view() playerView {
	return playerView{p.id, p.tx, p.ty, p.px, p.py, p.dir, p.moving, p.anim,
		p.hp, p.maxhp, p.mp, p.maxmp, p.lv, p.exp, p.gold, p.kills, p.lockID}
}

// ---- hub -------------------------------------------------------------------

type Hub struct {
	mu      sync.Mutex
	players map[string]*Player
	nextID  int

	// shared world entities, keyed by map
	enemies map[string][]*enemy
	spawnT  map[string]float64
	nextEID int
}

func newHub() *Hub {
	return &Hub{
		players: map[string]*Player{},
		enemies: map[string][]*enemy{},
		spawnT:  map[string]float64{},
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
			p.atkCool = max(0, p.atkCool-dt)
			p.iframes = max(0, p.iframes-dt)
			p.mp = math.Min(float64(p.maxmp), p.mp+dt*0.35)
			p.hp = math.Min(float64(p.maxhp), p.hp+dt*0.4)
			stepPlayer(p, p.moveDir, dt)
		}
		// 3) advance shared enemies against post-move player positions
		playersByMap := map[string][]*Player{}
		for _, p := range h.players {
			playersByMap[p.mapID] = append(playersByMap[p.mapID], p)
		}
		h.updateEnemies(playersByMap, dt)
		// 4) locked-on players auto-swing when a target is in reach
		for _, p := range h.players {
			if p.lockID != 0 {
				h.autoMelee(p)
			}
		}
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
	switch m.T {
	case "move":
		p.moveDir = m.Dir
		p.ackSeq = m.Seq
	case "attack":
		if p.atkCool <= 0 {
			h.doSlash(p)
		}
	case "lockAt":
		p.lockID = h.enemyAtPoint(p.mapID, m.X, m.Y)
	case "cycleLock":
		h.cycleLock(p)
	case "unlock":
		p.lockID = 0
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
