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
}

func TestDeathRespawnsInCity(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.attr.Agi, p.attr.Luck = 0, 0 // dodge 0% so the hit lands
	recalcMax(p)
	p.hp = 1
	p.iframes = 0
	en := slimeAt(1, 16, 10)
	h.attackHero(en, p)
	if p.mapID != "city" || p.tx != spawn.tx || p.ty != spawn.ty {
		t.Fatalf("death should respawn in the city plaza, got %s (%d,%d)", p.mapID, p.tx, p.ty)
	}
	if int(p.hp) != p.maxhp {
		t.Fatalf("should respawn at full HP, got %v", p.hp)
	}
}
