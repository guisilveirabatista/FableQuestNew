package main

import "testing"

func TestCastFireCreatesHomingProjectile(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	en := slimeAt(1, 18, 10)
	h.enemies["field"] = []*enemy{en}
	p.lockID = en.id
	mp0 := p.mp
	h.castSlot(p, 0) // slot 0 = fire
	if len(h.projectiles["field"]) != 1 {
		t.Fatalf("fire should spawn one projectile, got %d", len(h.projectiles["field"]))
	}
	if h.projectiles["field"][0].targetID != en.id {
		t.Fatal("fireball should home in on the locked target")
	}
	if p.mp != mp0-skillMP["fire"] {
		t.Fatalf("fire should cost %v MP (had %v, now %v)", skillMP["fire"], mp0, p.mp)
	}
}

func TestCastBoltDamagesLockedTarget(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	en := slimeAt(1, 25, 10) // far away — bolt hits the lock at any range
	h.enemies["field"] = []*enemy{en}
	p.lockID = en.id
	mp0 := p.mp
	h.castSlot(p, 3) // slot 3 = bolt
	if en.hp >= en.maxhp {
		t.Fatalf("bolt should damage the locked target (hp %d/%d)", en.hp, en.maxhp)
	}
	if p.mp != mp0-skillMP["bolt"] {
		t.Fatalf("bolt should cost %v MP (now %v)", skillMP["bolt"], p.mp)
	}
}

func TestCastFireTargetsPvpPlayer(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "field", 15, 10)
	b := mkPlayer(h, "b", "field", 20, 10)
	a.pvpTarget = b.id
	mp0 := a.mp

	h.castSlot(a, 0) // slot 0 = fire

	if len(h.projectiles["field"]) != 1 {
		t.Fatalf("fire should spawn one projectile, got %d", len(h.projectiles["field"]))
	}
	pr := h.projectiles["field"][0]
	if pr.targetPlayer != b.id || pr.targetID != 0 {
		t.Fatalf("fireball should home on the PvP target, got player=%q enemy=%d", pr.targetPlayer, pr.targetID)
	}
	if a.mp != mp0-skillMP["fire"] {
		t.Fatalf("fire should cost %v MP (had %v, now %v)", skillMP["fire"], mp0, a.mp)
	}
}

func TestCastBoltDamagesPvpTarget(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "field", 15, 10)
	b := mkPlayer(h, "b", "field", 25, 10)
	b.attr = AttrSet{}
	recalcMax(b)
	b.hp = float64(b.maxhp)
	a.pvpTarget = b.id
	mp0, hp0 := a.mp, b.hp

	h.castSlot(a, 3) // slot 3 = bolt

	if b.hp >= hp0 {
		t.Fatalf("bolt should damage the PvP target (hp %v -> %v)", hp0, b.hp)
	}
	if a.mp != mp0-skillMP["bolt"] {
		t.Fatalf("bolt should cost %v MP (had %v, now %v)", skillMP["bolt"], mp0, a.mp)
	}
	if len(h.bolts["field"]) != 1 {
		t.Fatalf("bolt should spawn one shared lightning visual, got %d", len(h.bolts["field"]))
	}
}

func TestCastBoltNoTargetIsFree(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10) // no enemies at all
	mp0 := p.mp
	h.castSlot(p, 3)
	if p.mp != mp0 {
		t.Fatalf("bolt with no target should not spend MP (had %v, now %v)", mp0, p.mp)
	}
}

func TestCastNovaDoesNotRequireLock(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.slots[4] = "nova"
	near := slimeAt(1, 16, 10)
	far := slimeAt(2, 20, 10)
	h.enemies["field"] = []*enemy{near, far}
	mp0 := p.mp

	h.castSlot(p, 4)

	if near.hp >= near.maxhp {
		t.Fatalf("nova should damage nearby enemies without a lock (hp %d/%d)", near.hp, near.maxhp)
	}
	if far.hp != far.maxhp {
		t.Fatalf("nova should not damage enemies outside the area (hp %d/%d)", far.hp, far.maxhp)
	}
	if p.mp != mp0-skillMP["nova"] {
		t.Fatalf("nova should cost %v MP (had %v, now %v)", skillMP["nova"], mp0, p.mp)
	}
	if len(h.bolts["field"]) != 9 {
		t.Fatalf("level 1 nova should spawn a 3x3 visual area, got %d bolts", len(h.bolts["field"]))
	}
}

func TestCastNovaExpandsAtHigherLevel(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.slots[4] = "nova"
	p.skillLevels["nova"] = 3
	edge := slimeAt(1, 17, 10)
	h.enemies["field"] = []*enemy{edge}

	h.castSlot(p, 4)

	if edge.hp >= edge.maxhp {
		t.Fatalf("leveled nova should reach the expanded 4x4 area (hp %d/%d)", edge.hp, edge.maxhp)
	}
	if len(h.bolts["field"]) != 16 {
		t.Fatalf("level 3 nova should spawn a 4x4 visual area, got %d bolts", len(h.bolts["field"]))
	}
}

func TestCastSpellRequiresCombatTarget(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	en := slimeAt(1, 16, 10)
	h.enemies["field"] = []*enemy{en}
	mp0 := p.mp
	h.castSlot(p, 3) // slot 3 = bolt
	if p.mp != mp0 || en.hp != en.maxhp {
		t.Fatalf("bolt without a lock should do nothing (mp %v -> %v, hp %d/%d)", mp0, p.mp, en.hp, en.maxhp)
	}
}

func TestCastSpellRejectsNonPvpPlayerTarget(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 15, 10)
	b := mkPlayer(h, "b", "city", 16, 10)
	a.pvpTarget = b.id
	mp0, hp0 := a.mp, b.hp

	h.castSlot(a, 3) // slot 3 = bolt

	if a.mp != mp0 || b.hp != hp0 {
		t.Fatalf("bolt against a non-PvP target should do nothing (mp %v -> %v, hp %v -> %v)", mp0, a.mp, hp0, b.hp)
	}
	if len(h.bolts["city"]) != 0 {
		t.Fatalf("rejected PvP bolt should not spawn visuals, got %d", len(h.bolts["city"]))
	}
}

func TestManaGating(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	en := slimeAt(1, 20, 10)
	h.enemies["field"] = []*enemy{en}
	p.lockID = en.id
	p.mp = 3 // bolt costs 6 — must be refused
	h.castSlot(p, 3)
	if p.mp != 3 || en.hp != en.maxhp {
		t.Fatalf("bolt should be refused with too little MP (mp %v, enemy hp %d)", p.mp, en.hp)
	}
}

func TestCastHeal(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.class = "Holy"
	p.slots[1] = "heal"
	p.hp = 5
	mp0 := p.mp
	h.castSlot(p, 1) // slot 1 = heal
	if p.hp <= 5 {
		t.Fatalf("heal should restore HP (still %v)", p.hp)
	}
	if p.mp != mp0-skillMP["heal"] {
		t.Fatalf("heal should cost %v MP (now %v)", skillMP["heal"], p.mp)
	}
}

func TestCastHealAtFullHealthStillCostsMP(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.class = "Holy"
	p.slots[1] = "heal"
	p.hp = float64(p.maxhp)
	mp0 := p.mp
	h.castSlot(p, 1) // slot 1 = heal
	if p.hp != float64(p.maxhp) {
		t.Fatalf("full-health heal should not over-heal (hp %v/%d)", p.hp, p.maxhp)
	}
	if p.mp != mp0-skillMP["heal"] {
		t.Fatalf("full-health heal should still cost %v MP (had %v, now %v)", skillMP["heal"], mp0, p.mp)
	}
}

func TestNonHolyCannotCastHeal(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.slots[1] = "heal"
	p.hp = 5
	mp0 := p.mp

	h.castSlot(p, 1)

	if p.hp != 5 || p.mp != mp0 {
		t.Fatalf("non-Holy heal should be refused (hp %v mp %v -> %v)", p.hp, mp0, p.mp)
	}
}

func TestHotbarPotionUsesBackpackItem(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.slots[4] = "potion"
	p.hp = 5

	h.castSlot(p, 4)

	if p.hp <= 5 {
		t.Fatalf("hotbar potion should restore HP (still %v)", p.hp)
	}
	if p.bag["potion"] != 2 {
		t.Fatalf("hotbar potion should consume one item (3 -> %d)", p.bag["potion"])
	}
}

func TestProjectileHitsEnemyOnUpdate(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	en := slimeAt(1, 16, 10)
	h.enemies["field"] = []*enemy{en}
	// a fireball sitting right on the enemy should hit on the next update
	h.projectiles["field"] = []*projectile{{
		ownerID: p.id, x: en.px + 8, y: en.py + 8, dx: 1, dy: 0, boom: -1,
	}}
	h.players[p.id] = p
	h.updateProjectiles(1.0 / tickHz)
	if en.hp >= en.maxhp {
		t.Fatalf("projectile should have damaged the enemy it overlaps (hp %d)", en.hp)
	}
}

func TestProjectileHitsPvpPlayerOnUpdate(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "field", 15, 10)
	b := mkPlayer(h, "b", "field", 16, 10)
	b.attr = AttrSet{}
	recalcMax(b)
	b.hp = float64(b.maxhp)
	before := b.hp
	h.projectiles["field"] = []*projectile{{
		ownerID: a.id, x: b.px + 8, y: b.py + 8, dx: 1, dy: 0, targetPlayer: b.id, boom: -1,
	}}

	h.updateProjectiles(1.0 / tickHz)

	if b.hp >= before {
		t.Fatalf("projectile should have damaged the PvP target (hp %v -> %v)", before, b.hp)
	}
}
