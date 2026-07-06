package main

// Server-authoritative combat (Phase 2b), ported from sim.js: derived stats from
// attributes, melee resolution (precision/crit), enemies biting players
// (dodge/endurance), enemy death + XP/level-up, and player death/respawn. Every
// roll happens here on the server, so damage, crits, and kills can't be forged.
// Loot drops and corpses arrive in 2d; skills/projectiles in 2c.

import (
	"math"
	"math/rand"
)

// AttrSet holds the 7 primary attributes a player raises on level-up.
type AttrSet struct{ Agi, Int, Vit, Str, Dex, Mag, Luck int }

var baseAttr = AttrSet{Agi: 1, Int: 1, Vit: 2, Str: 2, Dex: 1, Mag: 1, Luck: 1}

// derived is everything the combat math reads, computed from AttrSet (equipment
// bonuses fold in here from Phase 2d). Go int division floors, matching sim.js.
type derived struct {
	atk, matk, prec, crit, end, mend, dodge int
	aspd                                    float64
}

func statsOf(p *Player) derived {
	a := p.attr
	return derived{
		atk:   1 + a.Str*2 + a.Dex/2,
		matk:  2 + a.Mag*2 + a.Int,
		prec:  min(100, 80+a.Dex+a.Luck/2),
		crit:  min(80, 2+a.Luck+a.Dex/2),
		end:   a.Vit + a.Str/4,
		mend:  a.Int + a.Vit/2,
		dodge: min(60, a.Agi+a.Luck/2),
		aspd:  1 + float64(a.Agi-1)*0.06,
	}
}

func recalcMax(p *Player) {
	p.maxhp = 18 + p.lv*4 + p.attr.Vit*4
	p.maxmp = 6 + p.lv*2 + p.attr.Int*2
	p.hp = math.Min(p.hp, float64(p.maxhp))
	p.mp = math.Min(p.mp, float64(p.maxmp))
}

func initHero(p *Player) {
	p.lv = 1
	p.attr = baseAttr
	p.slots = []string{"fire", "heal", "spin", "bolt", ""} // skill hotbar (keys 1-5)
	recalcMax(p)
	p.hp = float64(p.maxhp)
	p.mp = float64(p.maxmp)
}

// ---- melee (player -> enemy) ----------------------------------------------

// slashReaches: is the enemy inside the ~1-tile arc in front of the player?
func slashReaches(p *Player, dir string, en *enemy) bool {
	d := dirVec[dir]
	cx := float64((p.tx+d[0])*TS) + 8
	cy := float64((p.ty+d[1])*TS) + 8
	return math.Abs(en.px+8-cx) <= 13 && math.Abs(en.py+8-cy) <= 13
}

func faceToward(p *Player, en *enemy) string {
	dx, dy := en.px-p.px, en.py-p.py
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

// doSlash swings the sword: sets the attack cooldown and hits every enemy in the
// arc in front of the player.
func (h *Hub) doSlash(p *Player) {
	st := statsOf(p)
	p.atkCool = 1.0 / st.aspd
	for _, en := range h.enemies[p.mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		if slashReaches(p, p.dir, en) {
			h.meleeHit(p, en)
		}
	}
}

func (h *Hub) meleeHit(p *Player, en *enemy) {
	st := statsOf(p)
	if rand.Intn(100) >= st.prec {
		return // miss
	}
	dmg := st.atk + rand.Intn(4) - enemyKinds[en.kind].def
	if dmg < 1 {
		dmg = 1
	}
	h.hitEnemy(p, en, dmg, rand.Intn(100) < st.crit)
}

func (h *Hub) hitEnemy(p *Player, en *enemy, dmg int, crit bool) {
	if crit {
		dmg *= 2
	}
	en.hp -= dmg
	en.flash = 0.3
	en.stun = 0.45
	en.hurtT = 0
	if en.hp <= 0 {
		h.killEnemy(p, en)
	}
}

func (h *Hub) killEnemy(p *Player, en *enemy) {
	en.dying = 0.45
	k := enemyKinds[en.kind]
	p.kills++
	p.exp += k.exp
	p.gold += k.gold
	// loot drops arrive in Phase 2d
	if p.exp >= p.lv*10 { // level up
		p.exp -= p.lv * 10
		p.lv++
		p.points += 3
		recalcMax(p)
		p.hp = float64(p.maxhp)
		p.mp = float64(p.maxmp)
	}
}

// ---- enemy -> player -------------------------------------------------------

func (h *Hub) attackHero(en *enemy, p *Player) {
	en.lunge = 0.22
	en.wait = 0.8 + rand.Float64()*0.4
	if p.iframes > 0 {
		return
	}
	st := statsOf(p)
	if rand.Intn(100) < st.dodge {
		return // dodged
	}
	guard := st.end
	if en.kind == "ghost" { // ghosts strike with magic
		guard = st.mend
	}
	dmg := enemyKinds[en.kind].atk + rand.Intn(3) - 1 - guard/2
	if dmg < 1 {
		dmg = 1
	}
	p.hp -= float64(dmg)
	p.iframes = 1
	if p.hp <= 0 {
		playerDie(p)
	}
}

// no game-over: respawn at the plaza with gear intact (corpses land in 2d).
func playerDie(p *Player) {
	p.mapID = spawn.mapID
	p.tx, p.ty = spawn.tx, spawn.ty
	p.px, p.py = float64(p.tx*TS), float64(p.ty*TS)
	p.moving = false
	p.hp = float64(p.maxhp)
	p.mp = float64(p.maxmp)
	p.dir = "down"
	p.iframes = 2
	p.lockID = 0
}

// ---- lock-on ---------------------------------------------------------------

func (h *Hub) enemyByID(mapID string, id int) *enemy {
	if id == 0 {
		return nil
	}
	for _, en := range h.enemies[mapID] {
		if en.id == id {
			return en
		}
	}
	return nil
}

// enemyAtPoint: the enemy whose 24x32 sprite box contains a world point.
func (h *Hub) enemyAtPoint(mapID string, x, y float64) int {
	for _, en := range h.enemies[mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		if x >= en.px-4 && x < en.px+20 && y >= en.py-16 && y < en.py+16 {
			return en.id
		}
	}
	return 0
}

// cycleLock targets the nearest living enemy, then the next-nearest on repeat.
func (h *Hub) cycleLock(p *Player) {
	list := h.enemies[p.mapID]
	best, bestD := 0, math.Inf(1)
	var second int
	secondD := math.Inf(1)
	for _, en := range list {
		if en.dying > 0 || en.dead {
			continue
		}
		d := math.Hypot(en.px-p.px, en.py-p.py)
		if d < bestD {
			secondD, second = bestD, best
			bestD, best = d, en.id
		} else if d < secondD {
			secondD, second = d, en.id
		}
	}
	if p.lockID == best && second != 0 {
		p.lockID = second
	} else {
		p.lockID = best
	}
}

// autoMelee: while locked on and off cooldown, the sword strikes by itself when
// the target is in reach (ported from advanceWorld's auto-melee).
func (h *Hub) autoMelee(p *Player) {
	en := h.enemyByID(p.mapID, p.lockID)
	if en == nil || en.dead || en.dying > 0 {
		p.lockID = 0
		return
	}
	if p.atkCool <= 0 {
		dir := faceToward(p, en)
		if slashReaches(p, dir, en) {
			p.dir = dir
			h.doSlash(p)
		}
	}
}
