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

type exit struct {
	to     string
	tx, ty int
}

type gameMap struct {
	blocked [MH][MW]bool
	ground  [MH][MW]byte // ground char (G grass, D dirt, ...) — enemies roam grass only
	exits   map[[2]int]exit
}

var maps = map[string]*gameMap{}

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

// stepPlayer advances one player by dt, matching sim.js advanceWorld()'s hero
// block: integrate toward the target tile while moving, else step to the next
// tile in the desired direction if it isn't blocked (and honor map exits).
func stepPlayer(p *Player, moveDir string, dt float64) {
	speed := 70.0 * dt
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
				p.mapID = ex.to
				p.tx, p.ty = ex.tx, ex.ty
				p.px, p.py = float64(p.tx*TS), float64(p.ty*TS)
			}
		}
	case moveDir != "":
		p.dir = moveDir
		d := dirVec[moveDir]
		nx, ny := p.tx+d[0], p.ty+d[1]
		if !blocked(p.mapID, nx, ny) {
			p.tx, p.ty = nx, ny
			p.moving = true
			p.anim += dt * 8.75
		} else {
			p.anim = 1
		}
	default:
		p.anim = 1
	}
}
