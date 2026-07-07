package main

import "testing"

func heroAt(mapID string, tx, ty int) *Player {
	p := &Player{mapID: mapID, tx: tx, ty: ty, px: float64(tx * TS), py: float64(ty * TS), dir: "right"}
	initHero(p)
	return p
}

func slimeAt(id, tx, ty int) *enemy {
	return &enemy{id: id, kind: "slime", tx: tx, ty: ty, px: float64(tx * TS), py: float64(ty * TS), dir: "left", anim: 1, hp: 10, maxhp: 10, hurtT: 9}
}

func hasLog(logs []string, want string) bool {
	for _, got := range logs {
		if got == want {
			return true
		}
	}
	return false
}

func TestSlashKillsAdjacentEnemy(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.attr.Dex = 20 // precision 100, and enough Attack to one-shot a slime
	en := slimeAt(1, 16, 10)
	h.enemies["field"] = []*enemy{en}
	p.atkCool = 0
	h.doSlash(p)
	if en.dying <= 0 {
		t.Fatalf("slash should have killed the adjacent slime (hp left %d)", en.hp)
	}
	if p.kills != 1 || p.gold != 6 || p.exp != 4 {
		t.Fatalf("kill rewards wrong: kills=%d gold=%d exp=%d", p.kills, p.gold, p.exp)
	}
	if !hasLog(p.log, "Defeated Slime: +4 EXP, +6 gold") {
		t.Fatalf("kill should log rewards, got %#v", p.log)
	}
	if p.atkCool <= 0 {
		t.Fatal("slash should have put attack on cooldown")
	}
}

func TestSlashMissesOutOfReach(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.attr.Dex = 20
	en := slimeAt(1, 18, 10) // two tiles away, not in the arc
	h.enemies["field"] = []*enemy{en}
	p.atkCool = 0
	h.doSlash(p)
	if en.hp != 10 || en.dying > 0 {
		t.Fatalf("slash should not reach a slime two tiles away (hp %d)", en.hp)
	}
}

func TestEnemyDamagesPlayer(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	en := slimeAt(1, 16, 10)
	full := p.hp
	for i := 0; i < 6 && p.hp == full; i++ {
		p.iframes = 0 // clear i-frames between hits for the test
		h.attackHero(en, p)
	}
	if p.hp >= full {
		t.Fatalf("enemy should have damaged the player (hp still %v)", p.hp)
	}
}

func TestLevelUp(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.exp = 9 // one slime kill (4 exp) tips over lv1's 10-exp threshold
	en := slimeAt(1, 16, 10)
	h.killEnemy(p, en)
	if p.lv != 2 || p.points != 3 {
		t.Fatalf("expected level 2 with 3 attribute points, got lv=%d points=%d", p.lv, p.points)
	}
	if int(p.hp) != p.maxhp {
		t.Fatalf("level-up should have fully healed (hp %v / %d)", p.hp, p.maxhp)
	}
	if !hasLog(p.log, "LEVEL UP! Now Lv.2  (+3 attribute points)") {
		t.Fatalf("level-up should log, got %#v", p.log)
	}
}

func TestDeathWaitsForRespawn(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.attr.Agi, p.attr.Luck = 0, 0 // dodge 0% so the hit lands
	recalcMax(p)
	p.hp = 1
	p.iframes = 0
	en := slimeAt(1, 16, 10)
	h.attackHero(en, p)
	if !p.dead || p.deathCause != "Slime" {
		t.Fatalf("death should mark the player dead with cause, dead=%v cause=%q", p.dead, p.deathCause)
	}
	if p.mapID != "field" || p.tx != 15 || p.ty != 10 || p.hp != 0 {
		t.Fatalf("death should leave the player at the fall site at 0 HP, got %s (%d,%d) hp=%v", p.mapID, p.tx, p.ty, p.hp)
	}
	h.applyIntent(p, inMsg{T: "respawn"})
	if p.dead || p.mapID != "city" || p.tx != spawn.tx || p.ty != spawn.ty {
		t.Fatalf("respawn intent should move to city plaza alive, dead=%v at %s (%d,%d)", p.dead, p.mapID, p.tx, p.ty)
	}
	if int(p.hp) != p.maxhp || p.deathCause != "" {
		t.Fatalf("respawn should restore HP and clear cause, hp=%v cause=%q", p.hp, p.deathCause)
	}
}

func TestFollowChasesLockedEnemy(t *testing.T) {
	h := newHub()
	p := heroAt("field", 10, 12)
	en := &enemy{id: 1, kind: "slime", tx: 16, ty: 12, px: 16 * TS, py: 12 * TS, dir: "left", anim: 1, hp: 10, maxhp: 10, hurtT: 9}
	h.enemies["field"] = []*enemy{en}
	h.players[p.id] = p
	// Alt+click far enough to the right to sit over the slime's sprite box
	h.applyIntent(p, inMsg{T: "followAt", X: en.px + 8, Y: en.py + 4})
	if p.lockID != en.id || !p.follow {
		t.Fatalf("followAt should lock the enemy and turn on follow (lock=%d follow=%v)", p.lockID, p.follow)
	}
	start := abs(p.tx - en.tx)
	for i := 0; i < 400; i++ { // no manual input: the follow logic should close in
		dir := p.moveDir
		if dir == "" && p.follow {
			dir = h.followDir(p)
		}
		h.stepPlayer(p, dir, 1.0/tickHz)
	}
	if d := abs(p.tx-en.tx) + abs(p.ty-en.ty); d > 1 {
		t.Fatalf("follow should have chased the enemy to within reach (start %d, ended %d away)", start, d)
	}
}

func TestFollowFacesAdjacentLockedEnemy(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.dir = "left"
	p.follow = true
	en := slimeAt(1, 16, 10)
	h.enemies["field"] = []*enemy{en}
	p.lockID = en.id
	if dir := h.followDir(p); dir != "" {
		t.Fatalf("adjacent follow target should not require movement, got %q", dir)
	}
	if p.dir != "right" {
		t.Fatalf("adjacent follow target should turn the player right, got %q", p.dir)
	}
}
