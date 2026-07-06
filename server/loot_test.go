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

func TestDeathDropsCorpseAndRespawns(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{"potion": 3, "bread": 2}
	h.playerDie(p)
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
	if p.mapID != "city" || int(p.hp) != p.maxhp {
		t.Fatalf("you should respawn full-HP in the city, got %s hp=%v", p.mapID, p.hp)
	}
}

func TestTakeCorpseReturnsPack(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.bag = map[string]int{}
	h.corpses["field"] = []*corpse{{15, 10, map[string]int{"potion": 3}}}
	if !h.takeCorpse(p, 15, 10) {
		t.Fatal("should be able to loot your own corpse when standing on it")
	}
	if p.bag["potion"] != 3 || len(h.corpses["field"]) != 0 {
		t.Fatalf("looting the corpse should refill the bag and clear it (bag %d, corpses %d)", p.bag["potion"], len(h.corpses["field"]))
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
