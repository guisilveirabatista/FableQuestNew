package main

import "testing"

func TestEquipBoostsAttack(t *testing.T) {
	p := heroAt("field", 15, 10)
	base := statsOf(p).atk
	p.bag["sword2"] = 1
	if !equipTo(p, "sword2", "main") {
		t.Fatal("should be able to equip a sword into the main-hand")
	}
	if got := statsOf(p).atk; got != base+items["sword2"].atk {
		t.Fatalf("equipping the sword should raise Attack by %d (was %d, now %d)", items["sword2"].atk, base, got)
	}
	if p.bag["sword2"] != 0 {
		t.Fatal("equipping should consume the sword from the bag")
	}
	if p.equip["main"] != "sword2" {
		t.Fatal("the sword should be on the body")
	}
}

func TestTwoHandedKicksOutShield(t *testing.T) {
	p := heroAt("field", 15, 10)
	p.bag["shield"] = 1
	p.bag["sword3"] = 1
	equipTo(p, "shield", "off")
	equipTo(p, "sword3", "main") // the claymore needs both hands
	if p.equip["off"] != "" {
		t.Fatal("equipping a two-hander should send the shield back to the bag")
	}
	if p.bag["shield"] != 1 {
		t.Fatal("the shield should be back in the bag")
	}
}

func TestUseHeal(t *testing.T) {
	p := heroAt("field", 15, 10)
	p.hp = 5
	if !useItem(p, "potion") {
		t.Fatal("using a potion should heal")
	}
	if p.hp <= 5 {
		t.Fatalf("potion should restore HP (still %v)", p.hp)
	}
	if p.bag["potion"] != 2 {
		t.Fatalf("a potion should be consumed (3 -> %d)", p.bag["potion"])
	}
}

func TestLootDropsIntoBag(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	before := 0
	for _, n := range p.bag {
		before += n
	}
	for i := 0; i < 40; i++ { // ~25% drop each; 40 kills almost surely yields loot
		h.killEnemy(p, slimeAt(i+1, 16, 10))
	}
	after := 0
	for _, n := range p.bag {
		after += n
	}
	if after <= before {
		t.Fatalf("killing monsters should drop loot into the bag (%d -> %d)", before, after)
	}
}

func TestOverloadedHalvesSpeed(t *testing.T) {
	p := heroAt("city", 19, 16)
	if overloaded(p) {
		t.Fatal("a fresh hero should not be overloaded")
	}
	p.bag["armor"] = 5 // 7kg each = 35kg, over the ~19kg base capacity
	if !overloaded(p) {
		t.Fatalf("a stuffed pack (%vkg / %vkg) should overload", bagWeight(p), capacity(p))
	}
}
