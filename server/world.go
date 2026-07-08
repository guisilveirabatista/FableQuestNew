package main

// The authoritative world for Phase 1: the two maps and the tile-movement rules,
// ported straight from sim.js so the server reaches the exact same walkable
// tiles the client's local sim did. Movement is server-owned — clients send a
// desired direction, never a position — so there is nothing to spoof.

import "math"

const (
	TS = 16 // tile size in px
	MW = 40 // map width in tiles
	MH = 25 // map height in tiles
)

// where everyone (re)spawns: the city plaza, by the well
var spawn = struct {
	mapID  string
	tx, ty int
}{"city", 19, 16}

var dirVec = map[string][2]int{
	"up": {0, -1}, "down": {0, 1}, "left": {-1, 0}, "right": {1, 0},
}

var dirOrder = []string{"up", "down", "left", "right"}

type exit struct {
	to     string
	tx, ty int
}

type tile struct {
	x, y int
}

type gameMap struct {
	blocked [MH][MW]bool
	ground  [MH][MW]byte // ground char (G grass, D dirt, ...) — enemies roam grass only
	exits   map[[2]int]exit
}

var maps = map[string]*gameMap{}

// NPCs are static obstacles on the server (the client renders them at these same
// fixed spots in netplay, so both agree). Ported from sim.js's npcs list.
var npcTiles = map[string][][2]int{
	"field": {{7, 20}, {29, 9}, {14, 7}, {20, 10}},
	"city":  {{7, 6}, {27, 6}, {15, 16}, {3, 12}},
}

// buildMaps reproduces the procedural ground + props from sim.js and bakes the
// per-tile blocked grid. Ground chars: G grass, D dirt, W water(blocked),
// P pavement, X wall, R/U/O shop (all blocked). SOLID = "WXRUO".
func buildMaps() {
	solid := func(c byte) bool {
		return c == 'W' || c == 'X' || c == 'R' || c == 'U' || c == 'O'
	}

	// ---- field: grass with a pond; path east to the city gate ----
	field := &gameMap{exits: map[[2]int]exit{{39, 12}: {"city", 1, 12}}}
	for y := 0; y < MH; y++ {
		for x := 0; x < MW; x++ {
			var c byte = 'G'
			switch {
			case y >= 4 && y <= 8 && x >= 28 && x <= 33:
				c = 'W'
			case y == 12 && x >= 2:
				c = 'D'
			case x == 6 && y >= 13 && y <= 20:
				c = 'D'
			}
			field.ground[y][x] = c
			if solid(c) {
				field.blocked[y][x] = true
			}
		}
	}
	// hedge border (except the exit tile)
	for y := 0; y < MH; y++ {
		for x := 0; x < MW; x++ {
			if (x == 0 || y == 0 || x == MW-1 || y == MH-1) && !isExit(field, x, y) {
				field.blocked[y][x] = true
			}
		}
	}
	fieldTrees := [][2]int{{3, 4}, {8, 3}, {14, 5}, {20, 3}, {25, 6}, {34, 4}, {3, 16},
		{12, 17}, {18, 15}, {24, 18}, {31, 16}, {36, 18}, {10, 21}, {27, 21}, {16, 9}}
	for _, t := range fieldTrees { // trees are 2x2, base row at the bottom
		for _, d := range [][2]int{{0, 0}, {1, 0}, {0, -1}, {1, -1}} {
			block(field, t[0]+d[0], t[1]+d[1])
		}
	}
	fieldProps := [][2]int{{4, 9}, {22, 14}, {33, 10}, {15, 19}, {5, 20}, {11, 11}, {30, 10}, {35, 9}, {9, 18}}
	for _, p := range fieldProps {
		block(field, p[0], p[1])
	}
	maps["field"] = field

	// ---- city: walled plaza with two shops and a west gate ----
	city := &gameMap{exits: map[[2]int]exit{{0, 12}: {"field", 38, 12}}}
	for y := 0; y < MH; y++ {
		for x := 0; x < MW; x++ {
			shopL := x >= 4 && x <= 10
			shopR := x >= 24 && x <= 30
			var c byte
			switch {
			case y == 0 || y == MH-1 || ((x == 0 || x == MW-1) && !(x == 0 && y == 12)):
				c = 'X'
			case x == 0 && y == 12:
				c = 'D' // the gate
			case y == 4 && (shopL || shopR):
				c = 'R'
			case y == 5 && (x == 7 || x == 27):
				c = 'O' // shop doors
			case y == 5 && (shopL || shopR):
				c = 'U'
			default:
				c = 'P'
			}
			city.ground[y][x] = c
			if solid(c) {
				city.blocked[y][x] = true
			}
		}
	}
	block(city, 19, 14) // well
	// solid deco: torches and barrels
	for _, p := range [][2]int{{2, 6}, {37, 6}, {2, 22}, {3, 22}, {36, 22}, {37, 22}} {
		block(city, p[0], p[1])
	}
	maps["city"] = city

	for mapID, tiles := range npcTiles {
		m := maps[mapID]
		if m == nil {
			continue
		}
		for _, t := range tiles {
			block(m, t[0], t[1])
		}
	}
}

func isExit(m *gameMap, x, y int) bool {
	_, ok := m.exits[[2]int{x, y}]
	return ok
}

func block(m *gameMap, x, y int) {
	if x >= 0 && y >= 0 && x < MW && y < MH {
		m.blocked[y][x] = true
	}
}

func blocked(mapID string, x, y int) bool {
	if x < 0 || y < 0 || x >= MW || y >= MH {
		return true
	}
	m := maps[mapID]
	return m == nil || m.blocked[y][x]
}

// enemies keep to the grass — the dirt path and town are safe ground.
func isGrass(mapID string, x, y int) bool {
	if x < 0 || y < 0 || x >= MW || y >= MH {
		return false
	}
	m := maps[mapID]
	return m != nil && m.ground[y][x] == 'G'
}

func sign(v float64) float64 {
	if v > 0 {
		return 1
	}
	if v < 0 {
		return -1
	}
	return 0
}

// followDir returns the step the player should take to chase its locked target,
// or "" when it's already within one square (just face, no chase) or has no clear step.
// The within-1 stop (to avoid blocking) is bypassed on the *first* follow click (followEngaged=false);
// it only activates after we've closed distance once. Then resume only if >1 away.
// (ported from sim.js stepHero's follow branch). Follow mode is set by Ctrl+Alt+click / F (or Alt for follow-only).
func (h *Hub) followDir(p *Player) string {
	if p.followTarget != "" {
		o := h.players[p.followTarget]
		if o == nil || o.dead || o.mapID != p.mapID {
			p.followTarget = ""
			if p.lockID == 0 && p.pvpTarget == "" {
				p.follow, p.followEngaged = false, false
			}
			return ""
		}
		dx, dy := o.tx-p.tx, o.ty-p.ty
		if abs(dx) <= 1 && abs(dy) <= 1 && p.followEngaged {
			p.dir = faceTowardPlayer(p, o)
			return "" // one square around: just face (don't chase...); rule activates only after first close
		}
		hd, vd := "left", "up"
		if dx > 0 {
			hd = "right"
		}
		if dy > 0 {
			vd = "down"
		}
		dirs := []string{vd, hd}
		if abs(dx) > abs(dy) {
			dirs = []string{hd, vd}
		}
		for _, fd := range dirs {
			if dx == 0 && (fd == "left" || fd == "right") {
				continue
			}
			if dy == 0 && (fd == "up" || fd == "down") {
				continue
			}
			d := dirVec[fd]
			nx, ny := p.tx+d[0], p.ty+d[1]
			if blocked(p.mapID, nx, ny) || h.occupied(p.mapID, nx, ny, p) {
				continue
			}
			return fd
		}
		if abs(dx) <= 1 && abs(dy) <= 1 {
			p.followEngaged = true
			p.dir = faceTowardPlayer(p, o)
		}
		return ""
	}
	if p.pvpTarget != "" {
		o := h.players[p.pvpTarget]
		if o == nil || !h.canPvp(p, o) {
			return ""
		}
		dx, dy := o.tx-p.tx, o.ty-p.ty
		if abs(dx) <= 1 && abs(dy) <= 1 && p.followEngaged {
			p.dir = faceTowardPlayer(p, o)
			return "" // one square around: just face (don't chase...); rule activates only after first close
		}
		hd, vd := "left", "up"
		if dx > 0 {
			hd = "right"
		}
		if dy > 0 {
			vd = "down"
		}
		dirs := []string{vd, hd}
		if abs(dx) > abs(dy) {
			dirs = []string{hd, vd}
		}
		for _, fd := range dirs {
			if dx == 0 && (fd == "left" || fd == "right") {
				continue
			}
			if dy == 0 && (fd == "up" || fd == "down") {
				continue
			}
			d := dirVec[fd]
			nx, ny := p.tx+d[0], p.ty+d[1]
			if blocked(p.mapID, nx, ny) || h.occupied(p.mapID, nx, ny, p) {
				continue
			}
			return fd
		}
		if abs(dx) <= 1 && abs(dy) <= 1 {
			p.followEngaged = true
			p.dir = faceTowardPlayer(p, o)
		}
		return ""
	}
	en := h.enemyByID(p.mapID, p.lockID)
	if en == nil || en.dead || en.dying > 0 {
		return ""
	}
	dx, dy := en.tx-p.tx, en.ty-p.ty
	if abs(dx) <= 1 && abs(dy) <= 1 && p.followEngaged {
		p.dir = faceToward(p, en)
		return "" // one square around: just face (don't chase...); rule activates only after first close
	}
	hd, vd := "left", "up"
	if dx > 0 {
		hd = "right"
	}
	if dy > 0 {
		vd = "down"
	}
	dirs := []string{vd, hd}
	if abs(dx) > abs(dy) {
		dirs = []string{hd, vd}
	}
	for _, fd := range dirs {
		if dx == 0 && (fd == "left" || fd == "right") {
			continue
		}
		if dy == 0 && (fd == "up" || fd == "down") {
			continue
		}
		d := dirVec[fd]
		nx, ny := p.tx+d[0], p.ty+d[1]
		if blocked(p.mapID, nx, ny) || h.occupied(p.mapID, nx, ny, p) {
			continue
		}
		return fd
	}
	if abs(dx) <= 1 && abs(dy) <= 1 {
		p.followEngaged = true
		p.dir = faceToward(p, en)
	}
	return ""
}

// playerAt reports whether another player occupies tile (x,y) on mapID.
func (h *Hub) playerAt(mapID string, x, y int, self *Player) bool {
	for _, o := range h.players {
		ox, oy := o.tx, o.ty
		if h.frozenPlayerPos != nil {
			if pos, ok := h.frozenPlayerPos[o]; ok {
				ox, oy = pos[0], pos[1]
			}
		}
		if o != self && !o.dead && o.mapID == mapID && ox == x && oy == y {
			return true
		}
	}
	return false
}

// occupied: is tile (x,y) held by another player or a living enemy? Characters
// are solid — nobody may step onto an occupied tile.
func (h *Hub) occupied(mapID string, x, y int, self *Player) bool {
	return h.playerAt(mapID, x, y, self) || enemyAt(h.enemies[mapID], x, y, nil)
}

func (h *Hub) walkable(mapID string, x, y int, self *Player) bool {
	return !blocked(mapID, x, y) && !h.occupied(mapID, x, y, self)
}

// findPath is the server port of sim.js findPath: breadth-first tile pathing
// over walkable tiles, with dynamic actors treated as walls.
func (h *Hub) findPath(mapID string, sx, sy, tx, ty int, self *Player) []tile {
	if sx == tx && sy == ty {
		return []tile{}
	}
	key := func(x, y int) [2]int { return [2]int{x, y} }
	start := key(sx, sy)
	prev := map[[2]int][2]int{start: start}
	q := []tile{{sx, sy}}
	for len(q) > 0 {
		cur := q[0]
		q = q[1:]
		for _, dir := range dirOrder {
			d := dirVec[dir]
			nx, ny := cur.x+d[0], cur.y+d[1]
			k := key(nx, ny)
			if _, seen := prev[k]; seen || !h.walkable(mapID, nx, ny, self) {
				continue
			}
			prev[k] = key(cur.x, cur.y)
			if nx == tx && ny == ty {
				path := []tile{}
				for c := k; c != start; c = prev[c] {
					path = append(path, tile{c[0], c[1]})
				}
				for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
					path[i], path[j] = path[j], path[i]
				}
				return path
			}
			q = append(q, tile{nx, ny})
		}
	}
	return nil
}

func (h *Hub) startPathTo(p *Player, tx, ty int) {
	var best []tile
	goal := tile{tx, ty}
	if h.walkable(p.mapID, tx, ty, p) {
		best = h.findPath(p.mapID, p.tx, p.ty, tx, ty, p)
	}
	if best == nil {
		for _, dir := range dirOrder {
			d := dirVec[dir]
			nx, ny := tx+d[0], ty+d[1]
			if !h.walkable(p.mapID, nx, ny, p) {
				continue
			}
			path := h.findPath(p.mapID, p.tx, p.ty, nx, ny, p)
			if path != nil && (best == nil || len(path) < len(best)) {
				best = path
				goal = tile{nx, ny}
			}
		}
	}
	if len(best) == 0 {
		p.path = nil
		p.hasPathGoal = false
		return
	}
	p.path = best
	p.pathGoal = goal
	p.hasPathGoal = true
}

func (h *Hub) replanPath(p *Player) {
	if !p.hasPathGoal {
		p.path = nil
		return
	}
	path := h.findPath(p.mapID, p.tx, p.ty, p.pathGoal.x, p.pathGoal.y, p)
	if len(path) == 0 {
		p.path = nil
		p.hasPathGoal = false
		return
	}
	p.path = path
}

func clearPath(p *Player) {
	p.path = nil
	p.hasPathGoal = false
}

func dirBetween(fromX, fromY, toX, toY int) string {
	switch {
	case toX > fromX:
		return "right"
	case toX < fromX:
		return "left"
	case toY > fromY:
		return "down"
	default:
		return "up"
	}
}

// stepPlayer advances one player by dt, matching sim.js advanceWorld()'s hero
// block: integrate toward the target tile while moving, else step to the next
// tile in the desired direction if it isn't blocked or occupied (honoring exits).
func (h *Hub) stepPlayer(p *Player, moveDir string, dt float64) {
	base := 70.0
	if overloaded(p) { // an over-stuffed pack halves your pace
		base = 32
	}
	speed := base * dt
	switch {
	case p.moving:
		gx, gy := float64(p.tx*TS), float64(p.ty*TS)
		p.px += sign(gx-p.px) * math.Min(speed, math.Abs(gx-p.px))
		p.py += sign(gy-p.py) * math.Min(speed, math.Abs(gy-p.py))
		p.anim += dt * 8.75
		if p.px == gx && p.py == gy {
			p.moving = false
			p.anim = 1
			if ex, ok := maps[p.mapID].exits[[2]int{p.tx, p.ty}]; ok {
				if h.ownsMap(ex.to) {
					p.mapID = ex.to
					p.tx, p.ty = ex.tx, ex.ty
					p.px, p.py = float64(p.tx*TS), float64(p.ty*TS)
					clearPath(p)
				} else { // zone mode: hand this player off to the owning zone
					e := ex
					p.pendingHandoff = &e
					clearPath(p)
				}
			}
		}
	case moveDir != "":
		clearPath(p)
		p.dir = moveDir
		d := dirVec[moveDir]
		nx, ny := p.tx+d[0], p.ty+d[1]
		if !blocked(p.mapID, nx, ny) && !h.occupied(p.mapID, nx, ny, p) {
			p.tx, p.ty = nx, ny
			p.moving = true
			p.anim += dt * 8.75
		} else {
			p.anim = 1
		}
	case len(p.path) > 0:
		next := p.path[0]
		p.dir = dirBetween(p.tx, p.ty, next.x, next.y)
		if h.walkable(p.mapID, next.x, next.y, p) {
			p.path = p.path[1:]
			p.tx, p.ty = next.x, next.y
			p.moving = true
			p.anim += dt * 8.75
			if len(p.path) == 0 {
				clearPath(p)
			}
		} else {
			h.replanPath(p)
			if len(p.path) == 0 {
				p.anim = 1
			}
		}
	default:
		p.anim = 1
	}
}
