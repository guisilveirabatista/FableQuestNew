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
// Holds dir until the step actually begins so squeeze wind-ups can finish.
func hop(p *Player, dir string) {
	h := newHub()
	for i := 0; i < 40 && !p.moving; i++ {
		h.stepPlayer(p, dir, 1.0/tickHz)
	}
	for i := 0; i < 40 && p.moving; i++ {
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

// Field wells sit on a diagonal at (5,20) and (6,21). With only 4-way movement
// those two solids form a virtual wall between (5,21) and (6,20). Tibia-style
// 8-way walking lets the player squeeze through in a single diagonal step.
func TestDiagonalSqueezeBetweenFieldWells(t *testing.T) {
	if !blocked("field", 5, 20) || !blocked("field", 6, 21) {
		t.Fatal("expected both field wells to be solid")
	}
	p := &Player{mapID: "field", tx: 5, ty: 21, px: 5 * TS, py: 21 * TS, dir: "down"}
	hop(p, "upright") // step between the wells onto (6,20)
	if p.tx != 6 || p.ty != 20 || p.moving {
		t.Fatalf("expected diagonal squeeze to (6,20), got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
	// reverse direction still works
	hop(p, "downleft")
	if p.tx != 5 || p.ty != 21 || p.moving {
		t.Fatalf("expected reverse diagonal squeeze to (5,21), got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
}

func TestDiagonalSqueezeHasEffortDelay(t *testing.T) {
	h := newHub()
	p := &Player{mapID: "field", tx: 5, ty: 21, px: 5 * TS, py: 21 * TS, dir: "down"}
	// First tick only starts the wind-up — player must not have moved yet.
	h.stepPlayer(p, "upright", 1.0/tickHz)
	if p.tx != 5 || p.ty != 21 || p.moving {
		t.Fatalf("squeeze should not move on the first tick, got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
	if p.squeezeT <= 0 {
		t.Fatal("expected squeeze wind-up timer to be running")
	}
	// Hold through half a second of effort (plus one tick of slack).
	ticks := int(squeezeDelay*tickHz) + 2
	for i := 0; i < ticks && !p.moving; i++ {
		h.stepPlayer(p, "upright", 1.0/tickHz)
	}
	if !p.moving && (p.tx != 6 || p.ty != 20) {
		t.Fatalf("after %.1fs effort delay, expected to start stepping to (6,20); at (%d,%d) squeezeT=%v",
			squeezeDelay, p.tx, p.ty, p.squeezeT)
	}
	// Ordinary diagonal (not a squeeze) must not incur the delay.
	p2 := &Player{mapID: "city", tx: 19, ty: 16, px: 19 * TS, py: 16 * TS, dir: "down"}
	h.stepPlayer(p2, "upright", 1.0/tickHz)
	if p2.squeezeT > 0 {
		t.Fatal("open diagonal step should not start a squeeze wind-up")
	}
	if !p2.moving || p2.tx != 20 || p2.ty != 15 {
		t.Fatalf("open diagonal should step immediately to (20,15), got (%d,%d) moving=%v", p2.tx, p2.ty, p2.moving)
	}
}

func TestDiagonalStepOntoSolidRejected(t *testing.T) {
	// From south of the city well, upright would land on the well tile.
	p := &Player{mapID: "city", tx: 18, ty: 15, px: 18 * TS, py: 15 * TS, dir: "down"}
	hop(p, "upright") // (19,14) is the well
	if p.tx != 18 || p.ty != 15 || p.moving {
		t.Fatalf("diagonal into a solid must fail, got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
}

func TestClickPathUsesDiagonalBetweenWells(t *testing.T) {
	h := newHub()
	p := &Player{mapID: "field", tx: 5, ty: 21, px: 5 * TS, py: 21 * TS, dir: "down"}
	h.applyIntent(p, inMsg{T: "moveTo", Tx: 6, Ty: 20})
	// Allow for the 0.5s squeeze wind-up plus the tile slide.
	for i := 0; i < 80 && (p.tx != 6 || p.ty != 20 || p.moving); i++ {
		h.stepPlayer(p, "", 1.0/tickHz)
	}
	if p.tx != 6 || p.ty != 20 || p.moving {
		t.Fatalf("click path should squeeze between wells to (6,20), got (%d,%d) moving=%v", p.tx, p.ty, p.moving)
	}
	// The short path is a single diagonal hop — not a long walk around.
	if len(p.path) != 0 {
		t.Fatalf("expected path to be fully consumed after one diagonal step, leftover=%v", p.path)
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
