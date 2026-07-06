package main

import "testing"

func TestDropGoesToFloorAndBack(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	h.players[p.id] = p
	h.applyIntent(p, inMsg{T: "dropItem", Id: "potion"})
	if len(h.floor["field"]) != 1 || h.floor["field"][0].id != "potion" {
		t.Fatalf("dropping should leave a potion on the floor, got %+v", h.floor["field"])
	}
	if p.bag["potion"] != 2 {
		t.Fatalf("dropping should remove one potion from the bag (3 -> %d)", p.bag["potion"])
	}
	h.applyIntent(p, inMsg{T: "takeLoot", Tx: 15, Ty: 10})
	if p.bag["potion"] != 3 || len(h.floor["field"]) != 0 {
		t.Fatalf("picking up should return it to the bag (bag %d, floor %d)", p.bag["potion"], len(h.floor["field"]))
	}
}

func TestPickupNeedsReach(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	h.dropFloor("field", "bread", 1, 20, 10) // five tiles away
	if h.pickupAt(p, 20, 10) {
		t.Fatal("should not be able to pick up loot out of reach")
	}
	if len(h.floor["field"]) != 1 {
		t.Fatal("the out-of-reach loot should still be on the floor")
	}
}

func TestDeathDropsCorpseAndWaitsForRespawn(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{"potion": 3, "bread": 2}
	h.playerDie(p, "Slime")
	cs := h.corpses["field"]
	if len(cs) != 1 || cs[0].tx != 15 || cs[0].ty != 10 {
		t.Fatalf("death should leave a corpse where you fell, got %+v", cs)
	}
	if cs[0].items["potion"] != 3 || cs[0].items["bread"] != 2 {
		t.Fatalf("the corpse should hold your whole pack, got %+v", cs[0].items)
	}
	if len(p.bag) != 0 {
		t.Fatalf("your bag should be empty after death, got %+v", p.bag)
	}
	if !p.dead || p.mapID != "field" || p.hp != 0 {
		t.Fatalf("death should wait for respawn at the fall site, dead=%v map=%s hp=%v", p.dead, p.mapID, p.hp)
	}
}

func TestDeathWithEmptyPackStillLeavesCorpse(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{}
	h.playerDie(p, "Slime")
	cs := h.corpses["field"]
	if len(cs) != 1 || cs[0].tx != 15 || cs[0].ty != 10 {
		t.Fatalf("death should leave an openable empty corpse, got %+v", cs)
	}
	if len(cs[0].items) != 0 {
		t.Fatalf("empty-pack corpse should have no loot, got %+v", cs[0].items)
	}
}

func TestTakeCorpseReturnsPack(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{}
	h.corpses["field"] = []*corpse{{tx: 15, ty: 10, items: map[string]int{"potion": 3}}}
	if !h.takeCorpse(p, 15, 10, "*") {
		t.Fatal("should be able to loot your own corpse when standing on it")
	}
	if p.bag["potion"] != 3 || len(h.corpses["field"]) != 1 || len(h.corpses["field"][0].items) != 0 {
		t.Fatalf("looting the corpse should refill the bag and leave an empty body (bag %d, corpses %+v)", p.bag["potion"], h.corpses["field"])
	}
}

func TestTakeSingleCorpseItem(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{}
	h.corpses["field"] = []*corpse{{tx: 15, ty: 10, items: map[string]int{"potion": 3, "bread": 2}}}
	if !h.takeCorpse(p, 15, 10, "bread") {
		t.Fatal("should be able to take one item stack from your corpse")
	}
	if p.bag["bread"] != 2 || p.bag["potion"] != 0 {
		t.Fatalf("single-item loot should take only bread, got bag %+v", p.bag)
	}
	if len(h.corpses["field"]) != 1 || h.corpses["field"][0].items["potion"] != 3 {
		t.Fatalf("corpse should keep remaining items, got %+v", h.corpses["field"])
	}
}

func TestTakingLastCorpseItemLeavesEmptyBody(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{}
	h.corpses["field"] = []*corpse{{tx: 15, ty: 10, items: map[string]int{"bread": 2}}}
	if !h.takeCorpse(p, 15, 10, "bread") {
		t.Fatal("should be able to take the last corpse item")
	}
	if p.bag["bread"] != 2 || len(h.corpses["field"]) != 1 || len(h.corpses["field"][0].items) != 0 {
		t.Fatalf("taking the last item should leave an empty body, bag %+v corpses %+v", p.bag, h.corpses["field"])
	}
}

func TestCorpseDecaysAfterTenMinutes(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{}
	h.corpses["field"] = []*corpse{{tx: 15, ty: 10, items: map[string]int{"potion": 3}}}
	h.updateCorpses(corpseDecaySeconds - 1)
	if h.corpses["field"][0].decayed {
		t.Fatal("corpse should still be lootable before ten minutes")
	}
	if !h.takeCorpse(p, 15, 10, "potion") {
		t.Fatal("corpse should be lootable before decay")
	}
	h.corpses["field"] = []*corpse{{tx: 15, ty: 10, items: map[string]int{"potion": 3}, age: corpseDecaySeconds - 1}}
	h.updateCorpses(1)
	c := h.corpses["field"][0]
	if !c.decayed || len(c.items) != 0 {
		t.Fatalf("corpse should decay and lose loot after ten minutes, got %+v", c)
	}
	if h.takeCorpse(p, 15, 10, "*") {
		t.Fatal("decayed corpse should no longer be lootable")
	}
}

func TestAutolootOffDropsToFloor(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.autoloot = false
	for i := 0; i < 60; i++ {
		h.killEnemy(p, slimeAt(i+1, 16, 10))
	}
	if len(h.floor["field"]) == 0 {
		t.Fatal("with autoloot off, monster drops should land on the floor")
	}
}
