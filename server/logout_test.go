package main

import "testing"

type testConn struct {
	closed bool
	writes int
	last   []byte
}

func (c *testConn) WriteText(b []byte) error {
	c.writes++
	c.last = append(c.last[:0], b...)
	return nil
}

func (c *testConn) Close() error {
	c.closed = true
	return nil
}

func connectedHero(id, mapID string, tx, ty int, conn netConn) *Player {
	p := heroAt(mapID, tx, ty)
	p.id = id
	p.username = id
	p.conn = conn
	return p
}

func makeLogoutAdmin(t *testing.T, p *Player) {
	oldAdmins := adminUsers
	configureAdmins(p.username)
	p.admin = true
	t.Cleanup(func() { adminUsers = oldAdmins })
}

func TestDamageMarksCombatLogoutTimer(t *testing.T) {
	h := newHub()
	p := connectedHero("hero", "field", 15, 10, &testConn{})
	en := slimeAt(1, 16, 10)
	p.attr.Agi, p.attr.Luck = 0, 0 // dodge 0% so the hit lands
	recalcMax(p)
	h.attackHero(en, p)
	if p.combatLogoutT != combatLogoutSeconds {
		t.Fatalf("taking damage in the field should start combat logout timer, got %v", p.combatLogoutT)
	}
}

func TestAdminDamageDoesNotMarkCombatLogoutTimer(t *testing.T) {
	h := newHub()
	p := connectedHero("adminhero", "field", 15, 10, &testConn{})
	makeLogoutAdmin(t, p)
	en := slimeAt(1, 16, 10)
	p.attr.Agi, p.attr.Luck = 0, 0
	recalcMax(p)

	h.attackHero(en, p)

	if p.combatLogoutT != 0 {
		t.Fatalf("admin damage should not start combat logout timer, got %v", p.combatLogoutT)
	}
	if got := p.view().CombatLog; got != 0 {
		t.Fatalf("admin snapshot should hide combat logout timer, got %v", got)
	}
}

func TestCombatLogoutTimerFollowsPlayerAcrossMaps(t *testing.T) {
	h := newHub()
	c := &testConn{}
	p := connectedHero("hero", "field", 15, 10, c)
	p.combatLogoutT = combatLogoutSeconds
	h.players[p.id] = p

	p.mapID = "city"
	h.disconnect(p, c)
	if got := h.players[p.id]; got != p {
		t.Fatalf("combat logout should still linger after changing maps, got %#v", got)
	}
}

func TestPlayerViewIncludesCombatLogoutTimer(t *testing.T) {
	p := connectedHero("hero", "field", 15, 10, &testConn{})
	p.combatLogoutT = 42
	if got := p.view().CombatLog; got != 42 {
		t.Fatalf("snapshot should expose combat logout timer, got %v", got)
	}
}

func TestAdminCanLeaveCharacterDuringCombatLogout(t *testing.T) {
	h := newHub()
	c := &testConn{}
	p := connectedHero("adminhero", "field", 15, 10, c)
	makeLogoutAdmin(t, p)
	p.combatLogoutT = combatLogoutSeconds
	h.players[p.id] = p

	ch, errMsg, ok := h.leaveCharacter(p, c)
	if !ok || errMsg != "" || ch == nil {
		t.Fatalf("admin should bypass combat logout on character leave, ok=%v err=%q ch=%#v", ok, errMsg, ch)
	}
	if got := h.players[p.id]; got != nil {
		t.Fatalf("admin should leave the world immediately, got %#v", got)
	}
}

func TestAdminDisconnectDoesNotLingerDuringCombatLogout(t *testing.T) {
	h := newHub()
	c := &testConn{}
	p := connectedHero("adminhero", "field", 15, 10, c)
	makeLogoutAdmin(t, p)
	p.combatLogoutT = combatLogoutSeconds
	h.players[p.id] = p

	h.disconnect(p, c)
	if !c.closed {
		t.Fatal("admin disconnect should close the socket")
	}
	if got := h.players[p.id]; got != nil {
		t.Fatalf("admin disconnect should not linger in combat logout, got %#v", got)
	}
}

func TestCombatDisconnectLingersAndCanReconnect(t *testing.T) {
	h := newHub()
	c1 := &testConn{}
	p := connectedHero("hero", "field", 15, 10, c1)
	p.combatLogoutT = combatLogoutSeconds
	p.lockID = 7
	p.follow = true
	h.players[p.id] = p

	h.disconnect(p, c1)
	if !c1.closed {
		t.Fatal("disconnect should close the stale socket")
	}
	if got := h.players[p.id]; got != p {
		t.Fatalf("combat disconnect should leave the player instance in the world, got %#v", got)
	}
	if p.conn != nil || p.lockID != 0 || p.follow {
		t.Fatalf("lingering player should be offline and inert, conn=%v lock=%d follow=%v", p.conn, p.lockID, p.follow)
	}
	if h.online(p.id) {
		t.Fatal("offline lingering player should not block reconnect")
	}

	c2 := &testConn{}
	if got := h.addPlayer(c2, p.id, nil); got != p {
		t.Fatal("reconnect should reattach to the lingering player instead of creating a new one")
	}
	if p.conn != c2 || !h.online(p.id) {
		t.Fatalf("reconnected player should have the new socket and count online, conn=%v online=%v", p.conn, h.online(p.id))
	}
}

func TestZoneLeaveLingersDuringCombatLogout(t *testing.T) {
	h := newHub()
	c := &testConn{}
	p := connectedHero("hero", "field", 15, 10, c)
	p.combatLogoutT = combatLogoutSeconds
	h.players[p.id] = p

	if !h.beginZoneLeave(p, c) {
		t.Fatal("zone leave during combat should wait for the logout timer")
	}
	if c.closed || c.writes != 0 {
		t.Fatalf("zone leave should keep the final-save link open without sending state yet, closed=%v writes=%d", c.closed, c.writes)
	}
	if got := h.players[p.id]; got != p {
		t.Fatalf("zone leave should keep the player in the world, got %#v", got)
	}
	if !p.logoutPending || p.conn != c || h.online(p.id) {
		t.Fatalf("player should be logout-pending but not online, pending=%v conn=%v online=%v", p.logoutPending, p.conn, h.online(p.id))
	}

	c2 := &testConn{}
	if got := h.addPlayer(c2, p.id, nil); got != p {
		t.Fatal("reconnect should reattach to the logout-pending player")
	}
	if !c.closed || p.conn != c2 || p.logoutPending {
		t.Fatalf("reattach should close old final-save link and resume the player, oldClosed=%v conn=%v pending=%v", c.closed, p.conn, p.logoutPending)
	}
}

func TestAdminZoneLeaveDoesNotLingerDuringCombatLogout(t *testing.T) {
	h := newHub()
	c := &testConn{}
	p := connectedHero("adminhero", "field", 15, 10, c)
	makeLogoutAdmin(t, p)
	p.combatLogoutT = combatLogoutSeconds
	h.players[p.id] = p

	if h.beginZoneLeave(p, c) {
		t.Fatal("admin zone leave should not wait for the logout timer")
	}
	if !c.closed || c.writes != 1 {
		t.Fatalf("admin zone leave should send final state and close immediately, closed=%v writes=%d", c.closed, c.writes)
	}
	if got := h.players[p.id]; got != nil {
		t.Fatalf("admin zone leave should remove the player immediately, got %#v", got)
	}
}

func TestCombatDisconnectReapsAfterTimerExpires(t *testing.T) {
	h := newHub()
	c := &testConn{}
	p := connectedHero("hero", "field", 15, 10, c)
	p.combatLogoutT = combatLogoutSeconds
	h.players[p.id] = p

	h.disconnect(p, c)
	p.combatLogoutT = 0

	h.mu.Lock()
	saves := h.reapOfflineLocked()
	_, stillThere := h.players[p.id]
	h.mu.Unlock()

	if stillThere {
		t.Fatal("expired combat logout should remove the offline player from the world")
	}
	if len(saves) != 1 || saves[0].user != p.id || saves[0].ch == nil {
		t.Fatalf("expired combat logout should produce one final save, got %#v", saves)
	}
}

func TestZoneLogoutPendingSendsFinalStateAfterTimer(t *testing.T) {
	h := newHub()
	c := &testConn{}
	p := connectedHero("hero", "field", 15, 10, c)
	p.logoutPending = true
	p.combatLogoutT = 0
	h.players[p.id] = p

	h.mu.Lock()
	saves := h.reapOfflineLocked()
	_, stillThere := h.players[p.id]
	h.mu.Unlock()

	if stillThere {
		t.Fatal("expired zone combat logout should remove the player")
	}
	if len(saves) != 1 || !saves[0].sendState || saves[0].conn != c {
		t.Fatalf("expired zone logout should request one state write over the held link, got %#v", saves)
	}
}
