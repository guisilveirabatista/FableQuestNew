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

func TestCastBoltNoTargetIsFree(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10) // no enemies at all
	mp0 := p.mp
	h.castSlot(p, 3)
	if p.mp != mp0 {
		t.Fatalf("bolt with no target should not spend MP (had %v, now %v)", mp0, p.mp)
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
