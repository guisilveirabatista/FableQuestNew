package main

// Server-authoritative skills (Phase 2c), ported from sim.js: hotbar magic
// skills, homing fireballs, and lightning. MP costs and cooldowns are enforced
// here, and every hit is resolved server-side. Fireballs and bolts become shared
// world entities streamed in snapshots so everyone sees them.

import (
	"math"
	"math/rand"
)

var skillMP = map[string]float64{"fire": 4, "heal": 6, "spin": 3, "bolt": 6, "nova": 8, "supernova": 0}
var adminOnlySkills = map[string]bool{"supernova": true}

func skillCost(p *Player, id string) float64 {
	base, ok := skillMP[id]
	if !ok {
		return 0
	}
	if adminOnlySkills[id] {
		return base
	}
	return base + float64(skillLevel(p, id)-1)
}

func skillMagicDamage(p *Player, id string, roll int) int {
	return statsOf(p).matk*2 + roll + (skillLevel(p, id)-1)*4
}

func skillAreaDamage(p *Player, id string, roll int) int {
	return statsOf(p).matk + roll + (skillLevel(p, id)-1)*3
}

func skillRequiresTarget(id string) bool {
	return id != "heal" && id != "nova" && id != "supernova"
}

var nextProjID int

type projectile struct {
	id           int
	kind         string
	ownerID      string
	x, y         float64
	dx, dy       float64
	targetID     int
	targetPlayer string
	dist, t      float64
	booming      bool
	boom         float64
}

type bolt struct {
	x, y, t float64
	kind    string
}

// castSlot fires the skill in hotbar slot i, spending MP only on success.
// Heal counts as a success even at full HP, matching classic RPG behavior where
// the spell is cast and paid for even if there is nothing to restore.
func (h *Hub) castSlot(p *Player, i int) {
	if i < 0 || i >= len(p.slots) {
		return
	}
	id := p.slots[i]
	if id == "" {
		return
	}
	if hotbarItem(id) {
		useItem(p, id)
		return
	}
	if _, ok := skillMP[id]; !ok {
		return
	}
	cost := skillCost(p, id)
	freeCast := adminCheatEnabled(p, "infiniteVitals")
	if p.atkCool > 0 || !playerSkillAllowed(p, id) || (!freeCast && p.mp < cost) {
		return
	}
	if skillRequiresTarget(id) && h.liveEnemyLock(p) == nil && h.livePvpTarget(p) == nil {
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
	case "nova":
		ok = h.castNova(p)
	case "supernova":
		ok = h.castSuperNova(p)
	}
	if ok && !freeCast {
		p.mp -= cost
	} else if ok {
		p.mp = float64(p.maxmp)
	}
}

func (h *Hub) liveEnemyLock(p *Player) *enemy {
	en := h.enemyByID(p.mapID, p.lockID)
	if en == nil || en.dead || en.dying > 0 {
		return nil
	}
	return en
}

func (h *Hub) livePvpTarget(p *Player) *Player {
	if p.pvpTarget == "" {
		return nil
	}
	o := h.players[p.pvpTarget]
	if o == nil || !h.canPvp(p, o) {
		return nil
	}
	return o
}

func (h *Hub) castFire(p *Player) bool {
	var targetID int
	var targetPlayer string
	tx, ty := 0.0, 0.0
	if t := h.liveEnemyLock(p); t != nil {
		targetID, tx, ty = t.id, t.px, t.py
	} else if o := h.livePvpTarget(p); o != nil {
		targetPlayer, tx, ty = o.id, o.px, o.py
	} else {
		return false
	}
	p.atkCool = 0.4
	m := math.Hypot(tx-p.px, ty-p.py)
	if m == 0 {
		m = 1
	}
	dx, dy := (tx-p.px)/m, (ty-p.py)/m
	nextProjID++
	h.projectiles[p.mapID] = append(h.projectiles[p.mapID], &projectile{
		id: nextProjID, kind: "fire", ownerID: p.id, x: p.px + 8 + dx*8, y: p.py + 8 + dy*8, dx: dx, dy: dy,
		targetID: targetID, targetPlayer: targetPlayer, boom: -1,
	})
	return true
}

func (h *Hub) castHeal(p *Player) bool {
	p.hp = math.Min(float64(p.maxhp), p.hp+float64(15+(skillLevel(p, "heal")-1)*5))
	p.atkCool = 0.4
	return true
}

func (h *Hub) castSpin(p *Player) bool {
	if h.liveEnemyLock(p) == nil && h.livePvpTarget(p) == nil {
		return false
	}
	p.atkCool = math.Max(0.9, 1.3-float64(skillLevel(p, "spin")-1)*0.08) / statsOf(p).aspd
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
	if target := h.liveEnemyLock(p); target != nil {
		p.atkCool = 0.5
		h.bolts[p.mapID] = append(h.bolts[p.mapID], &bolt{x: target.px + 8, y: target.py + 4})
		h.hitEnemy(p, target, skillMagicDamage(p, "bolt", rand.Intn(6)), false)
		return true
	}
	target := h.livePvpTarget(p)
	if target == nil {
		return false
	}
	p.atkCool = 0.5
	h.bolts[p.mapID] = append(h.bolts[p.mapID], &bolt{x: target.px + 8, y: target.py + 4})
	h.pvpHit(p, target, skillMagicDamage(p, "bolt", rand.Intn(6)), false, true)
	return true
}

func novaSpan(p *Player) int {
	if skillLevel(p, "nova") >= 3 {
		return 4
	}
	return 3
}

func novaBounds(p *Player) (minTx, maxTx, minTy, maxTy int) {
	span := novaSpan(p)
	left := (span - 1) / 2
	right := span - 1 - left
	up, down := left, right
	if span%2 == 0 {
		switch p.dir {
		case "left":
			left, right = 2, 1
		case "right":
			left, right = 1, 2
		}
		switch p.dir {
		case "up":
			up, down = 2, 1
		case "down":
			up, down = 1, 2
		}
	}
	return p.tx - left, p.tx + right, p.ty - up, p.ty + down
}

func inNovaBounds(p *Player, tx, ty int) bool {
	minTx, maxTx, minTy, maxTy := novaBounds(p)
	return tx >= minTx && tx <= maxTx && ty >= minTy && ty <= maxTy
}

func (h *Hub) addNovaBolts(p *Player) {
	minTx, maxTx, minTy, maxTy := novaBounds(p)
	for ty := minTy; ty <= maxTy; ty++ {
		for tx := minTx; tx <= maxTx; tx++ {
			if tx >= 0 && ty >= 0 && tx < MW && ty < MH {
				h.bolts[p.mapID] = append(h.bolts[p.mapID], &bolt{x: float64(tx*TS) + 8, y: float64(ty*TS) + 8})
			}
		}
	}
}

func (h *Hub) addSuperNovaBolts(p *Player) {
	for y := 0; y < MH; y += 2 {
		for x := 0; x < MW; x += 2 {
			if (x+y)%4 == 0 || rand.Intn(3) == 0 {
				delay := -rand.Float64() * 0.35
				h.bolts[p.mapID] = append(h.bolts[p.mapID], &bolt{
					x:    float64(x*TS) + 8 + rand.Float64()*6 - 3,
					y:    float64(y*TS) + 8 + rand.Float64()*6 - 3,
					t:    delay,
					kind: "supernova",
				})
			}
		}
	}
	for _, en := range h.enemies[p.mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		h.bolts[p.mapID] = append(h.bolts[p.mapID], &bolt{
			x: float64(en.tx*TS) + 8, y: float64(en.ty*TS) + 8,
			t: -rand.Float64() * 0.2, kind: "supernova",
		})
	}
}

func (h *Hub) castNova(p *Player) bool {
	p.atkCool = 0.8
	h.addNovaBolts(p)
	for _, en := range h.enemies[p.mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		tx := int(math.Floor((en.px + 8) / TS))
		ty := int(math.Floor((en.py + 8) / TS))
		if inNovaBounds(p, tx, ty) {
			h.hitEnemy(p, en, skillAreaDamage(p, "nova", rand.Intn(5)), false)
		}
	}
	for _, o := range h.players {
		if o.mapID != p.mapID || !h.canPvp(p, o) {
			continue
		}
		tx := int(math.Floor((o.px + 8) / TS))
		ty := int(math.Floor((o.py + 8) / TS))
		if inNovaBounds(p, tx, ty) {
			h.pvpHit(p, o, skillAreaDamage(p, "nova", rand.Intn(5)), false, true)
		}
	}
	return true
}

func (h *Hub) castSuperNova(p *Player) bool {
	if p == nil || !p.isAdmin() {
		return false
	}
	p.atkCool = 1.0
	h.addSuperNovaBolts(p)
	kills := 0
	for _, en := range h.enemies[p.mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		h.hitEnemy(p, en, en.hp, false)
		kills++
	}
	if kills > 0 {
		p.logMsg("Super Nova cleared the map.")
	}
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
			owner := h.players[pr.ownerID]
			if pr.targetID != 0 && pr.kind == "fire" { // home in on the locked target while it lives
				if t := h.enemyByID(mapID, pr.targetID); t != nil && !t.dead && t.dying <= 0 {
					m := math.Hypot(t.px+8-pr.x, t.py+8-pr.y)
					if m == 0 {
						m = 1
					}
					pr.dx, pr.dy = (t.px+8-pr.x)/m, (t.py+8-pr.y)/m
				}
			} else if pr.targetPlayer != "" && owner != nil && pr.kind == "fire" {
				if t := h.players[pr.targetPlayer]; t != nil && h.canPvp(owner, t) {
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
			for _, en := range h.enemies[mapID] {
				if en.dying > 0 || en.dead {
					continue
				}
				if math.Abs(en.px+8-pr.x) < 11 && math.Abs(en.py+8-pr.y) < 11 {
					if owner != nil {
						if pr.kind == "arrow" {
							h.arrowHit(owner, en)
						} else {
							h.hitEnemy(owner, en, skillMagicDamage(owner, "fire", rand.Intn(5)), false)
						}
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
						if pr.kind == "arrow" {
							h.arrowPvpHit(owner, o)
						} else {
							h.pvpHit(owner, o, skillMagicDamage(owner, "fire", rand.Intn(5)), false, true)
						}
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
			life := 0.25
			if b.kind == "supernova" {
				life = 0.85
			}
			if b.t < life {
				kept = append(kept, b)
			}
		}
		h.bolts[mapID] = kept
	}
}
