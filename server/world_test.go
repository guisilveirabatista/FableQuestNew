package main

import "testing"

func TestMain(m *testing.M) {
	buildMaps()
	m.Run()
}

func TestBlocked(t *testing.T) {
	cases := []struct {
		mapID  string
		x, y   int
		want   bool
		reason string
	}{
		{"city", 19, 14, true, "the well is solid"},
		{"city", 19, 15, false, "plaza tile just south of the well is open"},
		{"city", 0, 0, true, "city wall corner is solid"},
		{"city", 0, 12, false, "west gate is walkable"},
		{"field", 0, 0, true, "field hedge border is solid"},
		{"field", 39, 12, false, "field east exit tile is walkable"},
		{"field", 30, 6, true, "pond tile is solid"},
		{"city", 15, 16, true, "NPCs are solid"},
		{"field", 15, 15, false, "open grass is walkable"},
	}
	for _, c := range cases {
		if got := blocked(c.mapID, c.x, c.y); got != c.want {
			t.Errorf("blocked(%q,%d,%d)=%v, want %v — %s", c.mapID, c.x, c.y, got, c.want, c.reason)
		}
	}
}

// hop steps one tile in dir, then coasts (no input) until the player settles —
// a single deliberate tile move, the way the client walks when you tap a key.
func hop(p *Player, dir string) {
	h := newHub()
	h.stepPlayer(p, dir, 1.0/tickHz) // the step that begins the hop
	for i := 0; i < 20 && p.moving; i++ {
		h.stepPlayer(p, "", 1.0/tickHz) // coast to the tile boundary
	}
}

// hold walks continuously in dir for n ticks (a held key).
func hold(p *Player, dir string, n int) {
	h := newHub()
	for i := 0; i < n; i++ {
		h.stepPlayer(p, dir, 1.0/tickHz)
	}
}

func TestWalkOneTile(t *testing.T) {
	p := &Player{mapID: "city", tx: 19, ty: 16, px: 19 * TS, py: 16 * TS, dir: "down"}
	hop(p, "right")
	if p.tx != 20 || p.moving {
		t.Fatalf("expected to settle on tile (20,16) not moving, got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
	if p.px != float64(20*TS) {
		t.Fatalf("expected px to land exactly on the tile, got %v", p.px)
	}
}

func TestHeldWalkChainsTiles(t *testing.T) {
	p := &Player{mapID: "city", tx: 19, ty: 16, px: 19 * TS, py: 16 * TS, dir: "down"}
	hold(p, "right", 20) // ~1s of held input at 70px/s ~= 4 tiles
	if p.tx <= 21 {
		t.Fatalf("held walk should have chained several tiles east, only reached tx=%d", p.tx)
	}
}

func TestCollisionStopsAtWell(t *testing.T) {
	p := &Player{mapID: "city", tx: 19, ty: 15, px: 19 * TS, py: 15 * TS, dir: "down"}
	hold(p, "up", 10) // (19,14) is the well — must not enter it
	if p.ty != 15 || p.moving {
		t.Fatalf("expected to stay put at (19,15), got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
	if p.dir != "up" {
		t.Fatalf("expected to still be facing up after bumping the well, got %q", p.dir)
	}
}

func TestPlayersAreSolid(t *testing.T) {
	h := newHub()
	a := &Player{id: "a", mapID: "city", tx: 19, ty: 16, px: 19 * TS, py: 16 * TS, dir: "down"}
	b := &Player{id: "b", mapID: "city", tx: 20, ty: 16, px: 20 * TS, py: 16 * TS, dir: "down"}
	h.players["a"], h.players["b"] = a, b
	h.stepPlayer(a, "right", 1.0/tickHz) // (20,16) is occupied by player B
	if a.moving || a.tx != 19 {
		t.Fatalf("a player should not walk through another player (tx=%d moving=%v)", a.tx, a.moving)
	}
}

func TestEnemiesAreSolid(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	h.players[p.id] = p
	h.enemies["field"] = []*enemy{{id: 1, kind: "slime", tx: 16, ty: 10, px: 16 * TS, py: 10 * TS, hp: 10, maxhp: 10, hurtT: 9}}
	h.stepPlayer(p, "right", 1.0/tickHz) // (16,10) is occupied by a slime
	if p.moving || p.tx != 15 {
		t.Fatalf("a player should not walk through an enemy (tx=%d moving=%v)", p.tx, p.moving)
	}
}

func TestClickPathMovesPlayer(t *testing.T) {
	h := newHub()
	p := &Player{mapID: "city", tx: 19, ty: 16, px: 19 * TS, py: 16 * TS, dir: "down"}
	h.applyIntent(p, inMsg{T: "moveTo", Tx: 22, Ty: 16})
	for i := 0; i < 80 && (p.tx != 22 || p.moving); i++ {
		h.stepPlayer(p, "", 1.0/tickHz)
	}
	if p.tx != 22 || p.ty != 16 || p.moving {
		t.Fatalf("click path should reach (22,16), got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
}

func TestClickingNPCWalksAdjacent(t *testing.T) {
	h := newHub()
	p := &Player{mapID: "city", tx: 13, ty: 16, px: 13 * TS, py: 16 * TS, dir: "right"}
	h.applyIntent(p, inMsg{T: "moveTo", Tx: 15, Ty: 16}) // kid NPC
	for i := 0; i < 80 && (p.tx != 14 || p.moving); i++ {
		h.stepPlayer(p, "", 1.0/tickHz)
	}
	if p.tx != 14 || p.ty != 16 || p.moving {
		t.Fatalf("clicking an NPC should stop adjacent at (14,16), got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
}

func TestClickPathAvoidsEnemies(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	h.players[p.id] = p
	h.enemies["field"] = []*enemy{{id: 1, kind: "slime", tx: 16, ty: 10, px: 16 * TS, py: 10 * TS, hp: 10, maxhp: 10, hurtT: 9}}
	h.applyIntent(p, inMsg{T: "moveTo", Tx: 17, Ty: 10})
	for i := 0; i < 120 && (p.tx != 17 || p.ty != 10 || p.moving); i++ {
		if p.tx == 16 && p.ty == 10 {
			t.Fatal("click path walked through the enemy tile")
		}
		h.stepPlayer(p, "", 1.0/tickHz)
	}
	if p.tx != 17 || p.ty != 10 || p.moving {
		t.Fatalf("click path should route around enemy to (17,10), got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
}

func TestExitSwitchesMap(t *testing.T) {
	p := &Player{mapID: "city", tx: 1, ty: 12, px: 1 * TS, py: 12 * TS, dir: "left"}
	hop(p, "left") // step onto the gate (0,12) and cross to the field
	if p.mapID != "field" {
		t.Fatalf("expected to cross into the field, still on %q", p.mapID)
	}
	if p.tx != 38 || p.ty != 12 {
		t.Fatalf("expected to arrive at field (38,12), got (%d,%d)", p.tx, p.ty)
	}
}

func TestAreaOfInterestFiltersFarEntities(t *testing.T) {
	p := &Player{tx: 4, ty: 4, aoiW: 10, aoiH: 10}
	inAoI := func(tx, ty int) bool { return abs(p.tx-tx) <= p.aoiW && abs(p.ty-ty) <= p.aoiH }
	if !inAoI(8, 6) {
		t.Fatal("a nearby entity should be inside the area of interest")
	}
	if inAoI(30, 20) {
		t.Fatal("a far entity should be filtered out of the area of interest")
	}
}
