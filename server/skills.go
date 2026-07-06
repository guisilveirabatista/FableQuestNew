package main

// Server-authoritative skills (Phase 2c), ported from sim.js: the four hotbar
// skills, homing fireballs, and lightning. MP costs and cooldowns are enforced
// here, and every hit is resolved server-side. Fireballs and bolts become shared
// world entities streamed in snapshots so everyone sees them.

import (
	"math"
	"math/rand"
)

var skillMP = map[string]float64{"fire": 4, "heal": 6, "spin": 3, "bolt": 6}

type projectile struct {
	ownerID  string
	x, y     float64
	dx, dy   float64
	targetID int
	dist, t  float64
	booming  bool
	boom     float64
}

type bolt struct {
	x, y, t float64
}

// castSlot fires the skill in hotbar slot i, spending MP only on success.
func (h *Hub) castSlot(p *Player, i int) {
	if i < 0 || i >= len(p.slots) {
		return
	}
	id := p.slots[i]
	if p.atkCool > 0 || id == "" || p.mp < skillMP[id] {
		return
	}
	ok := false
	switch id {
	case "fire":
		ok = h.castFire(p)
	case "heal":
		ok = h.castHeal(p)
	case "spin":
		ok = h.castSpin(p)
	case "bolt":
		ok = h.castBolt(p)
	}
	if ok {
		p.mp -= skillMP[id]
	}
}

func (h *Hub) castFire(p *Player) bool {
	p.atkCool = 0.4
	d := dirVec[p.dir]
	dx, dy := float64(d[0]), float64(d[1])
	targetID := 0
	if t := h.enemyByID(p.mapID, p.lockID); t != nil { // home in on the lock
		m := math.Hypot(t.px-p.px, t.py-p.py)
		if m == 0 {
			m = 1
		}
		dx, dy = (t.px-p.px)/m, (t.py-p.py)/m
		targetID = t.id
	}
	h.projectiles[p.mapID] = append(h.projectiles[p.mapID], &projectile{
		ownerID: p.id, x: p.px + 8 + dx*8, y: p.py + 8 + dy*8, dx: dx, dy: dy, targetID: targetID, boom: -1,
	})
	return true
}

func (h *Hub) castHeal(p *Player) bool {
	if p.hp >= float64(p.maxhp) {
		return false
	}
	p.hp = math.Min(float64(p.maxhp), p.hp+15)
	p.atkCool = 0.4
	return true
}

func (h *Hub) castSpin(p *Player) bool {
	p.atkCool = 1.3 / statsOf(p).aspd
	for _, en := range h.enemies[p.mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		if math.Abs(en.px-p.px) <= 24 && math.Abs(en.py-p.py) <= 24 {
			h.meleeHit(p, en)
		}
	}
	h.pvpMeleeSweep(p, true) // sweep hostile players around you too
	return true
}

func (h *Hub) castBolt(p *Player) bool {
	target := h.enemyByID(p.mapID, p.lockID)
	if target == nil || target.dead || target.dying > 0 { // no lock: nearest within 6 tiles
		best := float64(6 * TS)
		target = nil
		for _, en := range h.enemies[p.mapID] {
			if en.dead || en.dying > 0 {
				continue
			}
			if d := math.Hypot(en.px-p.px, en.py-p.py); d < best {
				best, target = d, en
			}
		}
	}
	if target == nil {
		return false
	}
	p.atkCool = 0.5
	h.bolts[p.mapID] = append(h.bolts[p.mapID], &bolt{x: target.px + 8, y: target.py + 4})
	h.hitEnemy(p, target, statsOf(p).matk*2+rand.Intn(6), false)
	return true
}

// updateProjectiles advances fireballs (homing on their target), resolves hits,
// and expires spent ones. Bolts are just decaying visuals.
func (h *Hub) updateProjectiles(dt float64) {
	for mapID, list := range h.projectiles {
		for _, pr := range list {
			pr.t += dt
			if pr.booming {
				pr.boom -= dt
				continue
			}
			if pr.targetID != 0 { // home in on the locked target while it lives
				if t := h.enemyByID(mapID, pr.targetID); t != nil && !t.dead && t.dying <= 0 {
					m := math.Hypot(t.px+8-pr.x, t.py+8-pr.y)
					if m == 0 {
						m = 1
					}
					pr.dx, pr.dy = (t.px+8-pr.x)/m, (t.py+8-pr.y)/m
				}
			}
			sp := 130 * dt
			pr.x += pr.dx * sp
			pr.y += pr.dy * sp
			pr.dist += sp
			hit := pr.dist > 5.5*TS || blocked(mapID, int(math.Floor(pr.x/TS)), int(math.Floor(pr.y/TS)))
			owner := h.players[pr.ownerID]
			for _, en := range h.enemies[mapID] {
				if en.dying > 0 || en.dead {
					continue
				}
				if math.Abs(en.px+8-pr.x) < 11 && math.Abs(en.py+8-pr.y) < 11 {
					if owner != nil {
						h.hitEnemy(owner, en, statsOf(owner).matk*2+rand.Intn(5), false)
					}
					hit = true
					break
				}
			}
			if !hit && owner != nil { // a fireball can also scorch a hostile player
				for _, o := range h.players {
					if o.mapID != mapID || !h.canPvp(owner, o) {
						continue
					}
					if math.Abs(o.px+8-pr.x) < 11 && math.Abs(o.py+8-pr.y) < 11 {
						h.pvpHit(owner, o, statsOf(owner).matk*2+rand.Intn(5), false, true)
						hit = true
						break
					}
				}
			}
			if hit {
				pr.booming = true
				pr.boom = 0.18
			}
		}
		kept := list[:0]
		for _, pr := range list {
			if !pr.booming || pr.boom > 0 {
				kept = append(kept, pr)
			}
		}
		h.projectiles[mapID] = kept
	}
	for mapID, list := range h.bolts {
		kept := list[:0]
		for _, b := range list {
			b.t += dt
			if b.t < 0.25 {
				kept = append(kept, b)
			}
		}
		h.bolts[mapID] = kept
	}
}
