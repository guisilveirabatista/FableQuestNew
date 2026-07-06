package main

import "testing"

// a stationary player on the field, used as a chase target
func fieldPlayer(tx, ty int) *Player {
	return &Player{id: "p1", mapID: "field", tx: tx, ty: ty, px: float64(tx * TS), py: float64(ty * TS), dir: "down"}
}

func TestEnemiesSpawnOnGrass(t *testing.T) {
	h := newHub()
	p := fieldPlayer(15, 15)
	pbm := map[string][]*Player{"field": {p}}
	for i := 0; i < 400; i++ {
		h.updateEnemies(pbm, 1.0/tickHz)
	}
	list := h.enemies["field"]
	if len(list) == 0 {
		t.Fatal("expected monsters to spawn on the field with a player present")
	}
	for _, e := range list {
		if !isGrass("field", e.tx, e.ty) {
			t.Errorf("enemy %d at (%d,%d) is not on grass", e.id, e.tx, e.ty)
		}
		if e.hp <= 0 || e.maxhp <= 0 {
			t.Errorf("enemy %d spawned with no HP", e.id)
		}
	}
}

func TestCityIsSafe(t *testing.T) {
	h := newHub()
	p := &Player{id: "p1", mapID: "city", tx: 19, ty: 16}
	pbm := map[string][]*Player{"city": {p}}
	for i := 0; i < 200; i++ {
		h.updateEnemies(pbm, 1.0/tickHz)
	}
	if len(h.enemies["city"]) != 0 {
		t.Fatalf("the city must stay monster-free, found %d", len(h.enemies["city"]))
	}
}

func TestEnemiesChaseNearestPlayer(t *testing.T) {
	h := newHub()
	p := fieldPlayer(15, 15)
	pbm := map[string][]*Player{"field": {p}}
	// one slime within notice range (3 tiles) that should close on the player
	slime := &enemy{id: 1, kind: "slime", tx: 18, ty: 15, px: 18 * TS, py: 15 * TS, dir: "left", anim: 1, hp: 10, maxhp: 10, hurtT: 9}
	h.enemies["field"] = []*enemy{slime}
	h.nextEID = 1
	start := abs(slime.tx-p.tx) + abs(slime.ty-p.ty)
	best := start
	for i := 0; i < 400; i++ {
		h.updateEnemies(pbm, 1.0/tickHz)
		if d := abs(slime.tx-p.tx) + abs(slime.ty-p.ty); d < best {
			best = d
		}
	}
	if best > 1 {
		t.Fatalf("chasing slime never got adjacent to the player (start dist %d, closest %d)", start, best)
	}
}
