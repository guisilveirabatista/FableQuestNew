package main

// Server-authoritative monsters (Phase 2a): they spawn on the field grass, roam,
// and chase the nearest player — shared by everyone on the map. AI and movement
// are ported from sim.js updateEnemies/spawnEnemy. Combat (attacking, damage,
// death, loot) lands in Phase 2b; for now they crowd the player without biting.

import (
	"math"
	"math/rand"
)

type enemyKind struct {
	name    string
	cx, cy  int
	hp, atk int
	def     int
	exp     int
	gold    int
	speed   float64
	waitLo  float64
	waitHi  float64
	rng     int     // tiles at which it notices and chases a player
	flee    float64 // below this HP fraction it runs (used in 2b)
}

var enemyKinds = map[string]enemyKind{
	"slime": {"Slime", 0, 0, 10, 4, 1, 4, 6, 30, 0.5, 1.1, 4, 0},
	"imp":   {"Imp", 1, 0, 16, 6, 2, 7, 12, 45, 0.25, 0.6, 5, 0.2},
	"ghost": {"Ghost", 3, 0, 24, 8, 2, 12, 20, 55, 0.1, 0.4, 6, 0.25},
}

const maxEnemies = 10

// maps monsters live on (the city is a safe zone)
var spawnMaps = []string{"field"}

type enemy struct {
	id     int
	kind   string
	tx, ty int
	px, py float64
	dir    string
	moving bool
	anim   float64
	wait   float64
	hp     int
	maxhp  int
	// combat fields
	flash, dying, stun, hurtT, lunge float64
	dead                             bool
}

func pickKind() string {
	switch r := rand.Intn(10); {
	case r < 6:
		return "slime"
	case r < 9:
		return "imp"
	default:
		return "ghost"
	}
}

// nearestPlayer returns the closest player (by tile Manhattan distance) on mapID.
func nearestPlayer(players []*Player, tx, ty int) (*Player, int) {
	var best *Player
	bestD := 1 << 30
	for _, p := range players {
		if p.dead {
			continue
		}
		d := abs(p.tx-tx) + abs(p.ty-ty)
		if d < bestD {
			bestD = d
			best = p
		}
	}
	return best, bestD
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// spawnEnemy drops a monster on an empty grass tile away from every player.
func (h *Hub) spawnEnemy(mapID string, players []*Player) {
	for tries := 0; tries < 30; tries++ {
		x, y := 1+rand.Intn(MW-2), 1+rand.Intn(MH-2)
		if !isGrass(mapID, x, y) || blocked(mapID, x, y) {
			continue
		}
		tooClose := false
		for _, p := range players {
			if p.dead {
				continue
			}
			if abs(x-p.tx)+abs(y-p.ty) < 5 {
				tooClose = true
				break
			}
		}
		if tooClose || enemyAt(h.enemies[mapID], x, y, nil) {
			continue
		}
		k := pickKind()
		h.nextEID++
		h.enemies[mapID] = append(h.enemies[mapID], &enemy{
			id: h.nextEID, kind: k, tx: x, ty: y, px: float64(x * TS), py: float64(y * TS),
			dir: "down", anim: 1, wait: 0.5 + rand.Float64(),
			hp: enemyKinds[k].hp, maxhp: enemyKinds[k].hp, hurtT: 9,
		})
		return
	}
}

func enemyAt(list []*enemy, x, y int, except *enemy) bool {
	for _, e := range list {
		if e != except && e.dying <= 0 && e.tx == x && e.ty == y {
			return true
		}
	}
	return false
}

// updateEnemies advances every monster on every spawn map for one tick.
func (h *Hub) updateEnemies(playersByMap map[string][]*Player, dt float64) {
	for _, mapID := range spawnMaps {
		players := playersByMap[mapID]
		// spawn only while at least one player is around to see it
		h.spawnT[mapID] -= dt
		if len(players) > 0 && len(h.enemies[mapID]) < maxEnemies && h.spawnT[mapID] <= 0 {
			h.spawnEnemy(mapID, players)
			h.spawnT[mapID] = 2
		}
		for _, en := range h.enemies[mapID] {
			h.stepEnemy(mapID, en, players, dt)
		}
		// reap the dead (their fade-out finished)
		list := h.enemies[mapID]
		kept := list[:0]
		for _, en := range list {
			if !en.dead {
				kept = append(kept, en)
			}
		}
		h.enemies[mapID] = kept
	}
}

func (h *Hub) stepEnemy(mapID string, en *enemy, players []*Player, dt float64) {
	k := enemyKinds[en.kind]
	en.flash = max(0, en.flash-dt)
	en.lunge = max(0, en.lunge-dt)
	en.hurtT += dt
	if en.dying > 0 { // fading out after a kill
		en.dying -= dt
		if en.dying <= 0 {
			en.dead = true
		}
		return
	}
	en.stun = max(0, en.stun-dt)
	if en.stun > 0 { // briefly staggered by a hit
		return
	}
	if en.moving {
		gx, gy := float64(en.tx*TS), float64(en.ty*TS)
		sp := k.speed * dt
		en.px += sign(gx-en.px) * min(sp, math.Abs(gx-en.px))
		en.py += sign(gy-en.py) * min(sp, math.Abs(gy-en.py))
		en.anim += dt * 5
		if en.px == gx && en.py == gy {
			en.moving = false
			en.anim = 1
		}
		return
	}
	en.wait -= dt
	if en.wait > 0 {
		return
	}
	en.wait = k.waitLo + rand.Float64()*(k.waitHi-k.waitLo)

	target, dist := nearestPlayer(players, en.tx, en.ty)
	fleeing := k.flee > 0 && float64(en.hp)/float64(en.maxhp) <= k.flee
	var dirs []string
	if target != nil && dist <= k.rng && rand.Float64() > 0.2 {
		// chase — or flee (same pathing, away from the player)
		dx, dy := target.tx-en.tx, target.ty-en.ty
		hd, vd := "left", "up"
		if (fleeing && dx < 0) || (!fleeing && dx > 0) {
			hd = "right"
		}
		if (fleeing && dy < 0) || (!fleeing && dy > 0) {
			vd = "down"
		}
		if abs(dx) > abs(dy) {
			dirs = []string{hd, vd}
		} else {
			dirs = []string{vd, hd}
		}
		if dx == 0 || dy == 0 {
			dirs = []string{dirs[0], randDir()}
		}
	} else {
		dirs = []string{randDir()}
	}

	for _, dir := range dirs {
		d := dirVec[dir]
		nx, ny := en.tx+d[0], en.ty+d[1]
		if target != nil && nx == target.tx && ny == target.ty {
			en.dir = dir // bump into a player = attack (unless running for its life)
			if !fleeing {
				h.attackHero(en, target)
			}
			break
		}
		if !isGrass(mapID, nx, ny) || blocked(mapID, nx, ny) ||
			enemyAt(h.enemies[mapID], nx, ny, en) || h.playerAt(mapID, nx, ny, nil) {
			continue // grass only; don't stack on walls, other monsters, or players
		}
		en.dir = dir
		en.tx, en.ty = nx, ny
		en.moving = true
		break
	}
}

func randDir() string {
	return []string{"up", "down", "left", "right"}[rand.Intn(4)]
}
