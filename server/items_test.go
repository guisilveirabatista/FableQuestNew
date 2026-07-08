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

func TestOneHandedWeaponCanEquipOffHand(t *testing.T) {
	p := heroAt("field", 15, 10)
	p.bag["sword1"] = 2
	if !equipTo(p, "sword1", "main") {
		t.Fatal("should be able to equip a one-handed sword into the main hand")
	}
	if !equipTo(p, "sword1", "off") {
		t.Fatal("should be able to equip a one-handed sword into the off hand")
	}
	if p.equip["main"] != "sword1" || p.equip["off"] != "sword1" {
		t.Fatalf("expected swords in both hands, got main=%q off=%q", p.equip["main"], p.equip["off"])
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

func TestUseHealRequiresBackpackItem(t *testing.T) {
	p := heroAt("field", 15, 10)
	p.hp = 5
	p.bag["potion"] = 0
	if useItem(p, "potion") {
		t.Fatal("using a potion should be refused when none are in the backpack")
	}
	if p.hp != 5 {
		t.Fatalf("missing potion should not heal (hp %v)", p.hp)
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

func TestShopBuy(t *testing.T) {
	p := heroAt("city", 19, 16)
	p.gold = 100
	shopBuy(p, "smith", "sword1", 1) // 60g
	if p.gold != 40 || p.bag["sword1"] != 1 {
		t.Fatalf("buying a sword should cost 60g and add it (gold=%d, sword=%d)", p.gold, p.bag["sword1"])
	}
	shopBuy(p, "smith", "sword2", 1) // 150g - can't afford
	if p.gold != 40 || p.bag["sword2"] != 0 {
		t.Fatalf("should not be able to buy what you can't afford (gold=%d)", p.gold)
	}
	shopBuy(p, "grocer", "sword1", 1) // not in the grocer's stock
	if p.gold != 40 {
		t.Fatal("should not be able to buy an item a shop doesn't stock")
	}
}

func TestShopBuyBulk(t *testing.T) {
	p := heroAt("city", 19, 16)
	p.gold = 120
	shopBuy(p, "smith", "sword1", 2)
	if p.gold != 0 || p.bag["sword1"] != 2 {
		t.Fatalf("bulk buying should charge and add the requested quantity (gold=%d, sword=%d)", p.gold, p.bag["sword1"])
	}
	shopBuy(p, "smith", "sword1", 1)
	if p.gold != 0 || p.bag["sword1"] != 2 {
		t.Fatal("bulk buying should still reject purchases without enough gold")
	}
}

func TestShopSellBulk(t *testing.T) {
	p := heroAt("city", 19, 16)
	p.bag["potion"] = 3
	shopSell(p, "potion", 2)
	if p.gold != 50 || p.bag["potion"] != 1 {
		t.Fatalf("selling should remove backpack items and pay their value (gold=%d, potion=%d)", p.gold, p.bag["potion"])
	}
	shopSell(p, "potion", 2)
	if p.gold != 50 || p.bag["potion"] != 1 {
		t.Fatal("selling should reject quantities the backpack does not contain")
	}
}
