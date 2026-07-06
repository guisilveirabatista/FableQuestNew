package main

// Phase 1 authoritative server: many players share one world, movement only.
// Each client sends its desired direction (an intent); the server owns every
// position and streams snapshots back at a fixed 20 Hz. Enemies/combat/items
// stay client-side for now — they move server-side in Phase 2.

import (
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const tickHz = 20

// ---- wire protocol (JSON) --------------------------------------------------

// client -> server
type inMsg struct {
	T   string `json:"t"`
	Seq int    `json:"seq"` // client input sequence, echoed back for reconciliation
	Dir string `json:"dir"` // "up"|"down"|"left"|"right"|"" (stop)
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
}
type welcomeMsg struct {
	T    string `json:"t"`
	ID   string `json:"id"`
	Map  string `json:"map"`
	Tick int    `json:"tick"`
}
type snapMsg struct {
	T       string       `json:"t"`
	Map     string       `json:"map"`
	Ack     int          `json:"ack"`
	You     playerView   `json:"you"`
	Players []playerView `json:"players"`
}

// ---- player ----------------------------------------------------------------

type Player struct {
	id   string
	conn *wsConn

	mu      sync.Mutex // guards the input fields below (read goroutine writes, tick reads)
	moveDir string
	ackSeq  int

	// authoritative state — only the tick goroutine touches these
	mapID  string
	tx, ty int
	px, py float64
	dir    string
	moving bool
	anim   float64
}

func (p *Player) view() playerView {
	return playerView{p.id, p.tx, p.ty, p.px, p.py, p.dir, p.moving, p.anim}
}

// ---- hub -------------------------------------------------------------------

type Hub struct {
	mu      sync.Mutex
	players map[string]*Player
	nextID  int
}

func newHub() *Hub { return &Hub{players: map[string]*Player{}} }

func (h *Hub) add(c *wsConn) *Player {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.nextID++
	p := &Player{
		id: "p" + strconv.Itoa(h.nextID), conn: c,
		mapID: spawn.mapID, tx: spawn.tx, ty: spawn.ty,
		px: float64(spawn.tx * TS), py: float64(spawn.ty * TS), dir: "down",
	}
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
		for _, p := range h.players {
			p.mu.Lock()
			dir := p.moveDir
			p.mu.Unlock()
			stepPlayer(p, dir, dt)
		}
		byMap := map[string][]playerView{}
		for _, p := range h.players {
			byMap[p.mapID] = append(byMap[p.mapID], p.view())
		}
		for _, p := range h.players {
			others := make([]playerView, 0, len(byMap[p.mapID]))
			for _, v := range byMap[p.mapID] {
				if v.ID != p.id {
					others = append(others, v)
				}
			}
			p.mu.Lock()
			ack := p.ackSeq
			p.mu.Unlock()
			data, _ := json.Marshal(snapMsg{T: "snap", Map: p.mapID, Ack: ack, You: p.view(), Players: others})
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
			if json.Unmarshal(data, &m) == nil && m.T == "move" {
				p.mu.Lock()
				p.moveDir = m.Dir
				p.ackSeq = m.Seq
				p.mu.Unlock()
			}
		}
	}
	h.remove(p)
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	webRoot := flag.String("web", "..", "directory to serve the game client from")
	flag.Parse()

	buildMaps()
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
