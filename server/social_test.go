package main

// Unit tests for the Phase 6 social systems: chat routing, party lifecycle +
// shared EXP, trade offer/lock/confirm/execute, and PvP consent + damage. These
// drive the hub methods directly (no network), which is exactly where the
// server-authoritative rules live.

import "testing"

// mkPlayer adds a bare player straight into the hub for a test.
func mkPlayer(h *Hub, name, mapID string, tx, ty int) *Player {
	p := &Player{id: name, username: name, mapID: mapID, tx: tx, ty: ty, dir: "down"}
	p.px, p.py = float64(tx*TS), float64(ty*TS)
	initHero(p)
	h.players[name] = p
	return p
}

func TestChatScopes(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 5, 5)
	b := mkPlayer(h, "b", "city", 6, 5)  // same map
	c := mkPlayer(h, "c", "field", 5, 5) // different map

	h.chat(a, "say", "hi map", "")
	if len(a.drainChat()) != 1 || len(b.drainChat()) != 1 {
		t.Fatal("say should reach both players on the same map")
	}
	if len(c.drainChat()) != 0 {
		t.Fatal("say must not reach another map")
	}

	a.chatCool = 0 // clear the anti-spam cooldown for the next line
	h.chat(a, "world", "hello everyone", "")
	if len(a.drainChat()) != 1 || len(b.drainChat()) != 1 || len(c.drainChat()) != 1 {
		t.Fatal("world chat should reach everyone")
	}

	// spam guard: a second immediate line is dropped
	a.chatCool = 0
	h.chat(a, "say", "one", "")
	h.chat(a, "say", "two (dropped)", "")
	if got := len(b.drainChat()); got != 1 {
		t.Fatalf("chat cooldown should drop the second line, got %d", got)
	}
}

func TestDirectMessageRoutesOnlyToTargetAndSender(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 5, 5)
	b := mkPlayer(h, "b", "city", 6, 5)
	c := mkPlayer(h, "c", "city", 7, 5)

	h.chat(a, "tell", "secret", "b")

	if got := b.drainChat(); len(got) != 1 || got[0].Scope != "tell" || got[0].Text != "secret" {
		t.Fatalf("target should receive the direct message, got %#v", got)
	}
	if got := a.drainChat(); len(got) != 1 || got[0].Scope != "tell" {
		t.Fatalf("sender should receive a direct-message echo, got %#v", got)
	}
	if got := c.drainChat(); len(got) != 0 {
		t.Fatalf("other players should not receive direct messages, got %#v", got)
	}
}

func TestPartyLifecycleAndSharedExp(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 5, 5)
	b := mkPlayer(h, "b", "city", 6, 5)

	h.partyInvite(a, "b")
	if b.partyInvite == 0 {
		t.Fatal("invite should mark the target")
	}
	h.partyAccept(b)
	if a.partyID == 0 || a.partyID != b.partyID {
		t.Fatal("both should share a party after accept")
	}
	pt := h.partyOf(a)
	if len(pt.members) != 2 || pt.leader != "a" {
		t.Fatalf("party should have 2 members led by a: %+v", pt)
	}

	// shared EXP: a's kill gives b a same-map share
	b.exp = 0
	h.sharePartyExp(a, 10)
	if b.exp == 0 {
		t.Fatal("same-map party member should get a share of EXP")
	}

	// leader leaves -> b inherits, party of one disbands
	h.leaveParty(a)
	if a.partyID != 0 {
		t.Fatal("a should be partyless after leaving")
	}
	if b.partyID != 0 {
		t.Fatal("a party of one should disband")
	}
}

func TestFieldMapAllowsPvp(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "field", 5, 5)
	b := mkPlayer(h, "b", "field", 6, 5)
	b.attr = AttrSet{}
	recalcMax(b)
	b.hp = float64(b.maxhp)
	before := b.hp
	h.pvpHit(a, b, 10, false, false)
	if b.hp >= before {
		t.Fatal("field combat zone should allow PvP without manual opt-in")
	}
}

func TestFollowAtChasesPlayerOutsideCombatWithoutPvpTarget(t *testing.T) {
	h := newHub()
	fieldWasPvp := pvpMaps["field"]
	delete(pvpMaps, "field")
	defer func() {
		if fieldWasPvp {
			pvpMaps["field"] = true
		}
	}()
	a := mkPlayer(h, "a", "field", 5, 5)
	b := mkPlayer(h, "b", "field", 9, 5)
	a.dir = "left"

	h.applyIntent(a, inMsg{T: "followAt", X: b.px + 8, Y: b.py + 4})
	if a.followTarget != "b" || a.pvpTarget != "" || a.lockID != 0 || !a.follow {
		t.Fatalf("followAt should follow without creating a PvP target (followTarget=%q pvpTarget=%q lock=%d follow=%v)",
			a.followTarget, a.pvpTarget, a.lockID, a.follow)
	}
	for i := 0; i < 160; i++ {
		dir := h.followDir(a)
		h.stepPlayer(a, dir, 1.0/tickHz)
	}
	if d := abs(a.tx-b.tx) + abs(a.ty-b.ty); d > 1 {
		t.Fatalf("follow should chase the player target to melee reach, ended %d tiles away", d)
	}
	if dir := h.followDir(a); dir != "" || a.dir != "right" {
		t.Fatalf("adjacent player follow should stop and face right, dir=%q facing=%q", dir, a.dir)
	}
}

func TestLockPlayerAtStillRequiresPvp(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 5, 5)
	b := mkPlayer(h, "b", "city", 6, 5)

	h.applyIntent(a, inMsg{T: "lockPlayerAt", X: b.px + 8, Y: b.py + 4})

	if a.pvpTarget != "" || a.followTarget != "" || a.follow {
		t.Fatalf("safe-zone player lock should not create a target (pvp=%q followTarget=%q follow=%v)",
			a.pvpTarget, a.followTarget, a.follow)
	}
}

func TestTradeExecutes(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 5, 5)
	b := mkPlayer(h, "b", "city", 6, 5)
	a.bag = map[string]int{"potion": 5}
	a.gold = 100
	b.bag = map[string]int{"bread": 2}
	b.gold = 0

	h.tradeRequest(a, "b")
	h.tradeAccept(b)
	if a.tradeID == 0 || a.tradeID != b.tradeID {
		t.Fatal("both should be in the same trade")
	}

	h.tradeOffer(a, "potion", 2) // a offers 2 potions + 50 gold
	h.tradeGold(a, 50)
	h.tradeOffer(b, "bread", 1) // b offers 1 bread

	// can't confirm before both locked
	h.tradeConfirm(a)
	if _, ok := h.trades[a.tradeID]; !ok {
		t.Fatal("trade should not execute before both sides lock")
	}
	h.tradeLock(a, true)
	h.tradeLock(b, true)
	h.tradeConfirm(a)
	h.tradeConfirm(b) // both confirmed -> executes

	if a.tradeID != 0 || b.tradeID != 0 {
		t.Fatal("trade should be closed after execution")
	}
	if a.bag["potion"] != 3 || a.bag["bread"] != 1 || a.gold != 50 {
		t.Fatalf("a's inventory wrong after trade: bag=%v gold=%d", a.bag, a.gold)
	}
	if b.bag["bread"] != 1 || b.bag["potion"] != 2 || b.gold != 50 {
		t.Fatalf("b's inventory wrong after trade: bag=%v gold=%d", b.bag, b.gold)
	}
}

func TestTradeCannotOfferMoreThanOwned(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 5, 5)
	b := mkPlayer(h, "b", "city", 6, 5)
	a.bag = map[string]int{"potion": 1}
	h.tradeRequest(a, "b")
	h.tradeAccept(b)
	h.tradeOffer(a, "potion", 9) // asks to offer 9, only has 1
	t2 := h.tradeOf(a)
	if t2.aItems["potion"] != 1 {
		t.Fatalf("offer should clamp to owned quantity, got %d", t2.aItems["potion"])
	}
}

func TestPvpRequiresConsent(t *testing.T) {
	h := newHub()
	a := mkPlayer(h, "a", "city", 5, 5)
	b := mkPlayer(h, "b", "city", 6, 5)
	b.attr = AttrSet{} // no dodge/endurance so the hit lands deterministically
	recalcMax(b)
	b.hp = float64(b.maxhp)

	// neither flagged: no damage
	before := b.hp
	h.pvpHit(a, b, 10, false, false)
	if b.hp != before {
		t.Fatal("must not damage a non-consenting player")
	}

	// both flagged: damage applies
	a.pvp, b.pvp = true, true
	b.iframes = 0
	h.pvpHit(a, b, 10, false, false)
	if b.hp >= before {
		t.Fatalf("consenting PvP hit should deal damage (hp %v -> %v)", before, b.hp)
	}
}

func TestPvpArenaMapIgnoresFlag(t *testing.T) {
	pvpMaps["arena"] = true
	defer delete(pvpMaps, "arena")
	h := newHub()
	a := mkPlayer(h, "a", "arena", 5, 5)
	b := mkPlayer(h, "b", "arena", 6, 5)
	b.attr = AttrSet{}
	recalcMax(b)
	b.hp = float64(b.maxhp)
	before := b.hp
	h.pvpHit(a, b, 10, false, false) // unflagged, but the whole map is PvP
	if b.hp >= before {
		t.Fatal("arena map should allow PvP without the opt-in flag")
	}
}
