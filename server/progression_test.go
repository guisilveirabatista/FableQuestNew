package main

import "testing"

func TestSpendAttr(t *testing.T) {
	p := heroAt("city", 19, 16)
	p.points = 1
	str0, hp0 := p.attr.Str, p.maxhp
	spendAttr(p, "vit") // Vitality also raises max HP
	if p.attr.Vit != baseAttr.Vit+1 || p.points != 0 {
		t.Fatalf("spending should raise Vit and use the point (vit=%d points=%d)", p.attr.Vit, p.points)
	}
	if p.maxhp <= hp0 {
		t.Fatalf("raising Vitality should raise max HP (%d -> %d)", hp0, p.maxhp)
	}
	spendAttr(p, "str") // no points left — must be refused
	if p.attr.Str != str0 {
		t.Fatal("spending with no points should do nothing")
	}
}

func TestAssignSkill(t *testing.T) {
	p := heroAt("city", 19, 16) // slots: fire,heal,spin,bolt,""
	assignSkill(p, "fire", 4)   // move Fire from slot 0 to slot 4
	if p.slots[0] != "" || p.slots[4] != "fire" {
		t.Fatalf("Fire should have moved to slot 4, got %v", p.slots)
	}
	assignSkill(p, "fire", 4) // assigning to its own slot again clears it
	if p.slots[4] != "" {
		t.Fatalf("re-assigning to the same slot should unequip, got %v", p.slots)
	}
}

func TestUpgradeSkillUsesPointAndPrereq(t *testing.T) {
	p := heroAt("city", 19, 16)
	p.skillPoints = 2

	if upgradeSkill(p, "bolt") {
		t.Fatal("bolt upgrade should require Fire level 2 first")
	}
	if !upgradeSkill(p, "fire") {
		t.Fatal("fire should upgrade with a skill point")
	}
	if p.skillLevels["fire"] != 2 || p.skillPoints != 1 {
		t.Fatalf("fire upgrade wrong: levels=%v points=%d", p.skillLevels, p.skillPoints)
	}
	if !upgradeSkill(p, "bolt") {
		t.Fatal("bolt should upgrade after Fire reaches level 2")
	}
	if p.skillLevels["bolt"] != 2 || p.skillPoints != 0 {
		t.Fatalf("bolt upgrade wrong: levels=%v points=%d", p.skillLevels, p.skillPoints)
	}
}
