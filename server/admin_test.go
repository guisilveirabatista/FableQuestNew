package main

import (
	"path/filepath"
	"testing"
)

func intp(v int) *int           { return &v }
func floatp(v float64) *float64 { return &v }
func makeAdmin(h *Hub, name string) *Player {
	configureAdmins(name)
	p := mkPlayer(h, name, "city", 19, 16)
	p.admin = true
	return p
}

func TestAdminOnlyCommands(t *testing.T) {
	h := newHub()
	p := mkPlayer(h, "plain", "city", 19, 16)

	h.adminGrantItem(p, "potion", 3)

	if p.bag["potion"] != 3 { // starting potion stack from initHero
		t.Fatalf("non-admin should not receive created items, bag=%v", p.bag)
	}
	if got := p.drainChat(); len(got) != 1 || got[0].Text != "Admin only." {
		t.Fatalf("non-admin should get an admin-only message, got %#v", got)
	}
}

func TestAdminAnnouncementAndGrant(t *testing.T) {
	h := newHub()
	admin := makeAdmin(h, "admin")
	other := mkPlayer(h, "other", "field", 5, 5)

	h.adminAnnounce(admin, "server restart soon")
	for _, p := range []*Player{admin, other} {
		got := p.drainChat()
		if len(got) != 1 || got[0].Scope != "announcement" || got[0].Text != "server restart soon" {
			t.Fatalf("announcement should reach %s, got %#v", p.username, got)
		}
	}

	h.adminGrantItem(admin, "sword3", 2)
	if admin.bag["sword3"] != 2 {
		t.Fatalf("admin grant should add items without shop/carry checks, bag=%v", admin.bag)
	}
}

func TestAdminEditSelfTeleportAndSummon(t *testing.T) {
	h := newHub()
	admin := makeAdmin(h, "admin")

	h.adminEditSelf(admin, inMsg{
		Class: "Wizard", Level: intp(12), GoldSet: intp(500), PointsSet: intp(9), SkillPointsSet: intp(4),
		HPSet: floatp(20), MPSet: floatp(12),
		Attr:    &AttrSet{Agi: 3, Int: 8, Vit: 4, Str: 2, Dex: 5, Mag: 9, Luck: 6},
		SkillLv: map[string]int{"fire": 5, "bolt": 4, "heal": 3},
	})
	if admin.class != "Wizard" || admin.lv != 12 || admin.gold != 500 || admin.attr.Mag != 9 || admin.skillLevels["fire"] != 5 {
		t.Fatalf("admin edit did not apply: class=%s lv=%d gold=%d attr=%+v skills=%v", admin.class, admin.lv, admin.gold, admin.attr, admin.skillLevels)
	}
	if admin.hp != 20 || admin.mp != 12 {
		t.Fatalf("admin edit should set clamped hp/mp, hp=%v mp=%v", admin.hp, admin.mp)
	}

	h.adminTeleport(admin, inMsg{Map: "field", Tx: 15, Ty: 10})
	if admin.mapID != "field" || admin.tx != 15 || admin.ty != 10 {
		t.Fatalf("admin teleport failed: %s (%d,%d)", admin.mapID, admin.tx, admin.ty)
	}

	h.adminSummon(admin, inMsg{Id: "ghost", N: 2, Map: "city", Tx: 19, Ty: 16})
	if got := len(h.enemies["city"]); got != 2 {
		t.Fatalf("summon should create monsters in city, got %d", got)
	}
	if !h.enemies["city"][0].summoned {
		t.Fatal("summoned monster should be marked for non-natural movement rules")
	}
}

func TestAdminCheats(t *testing.T) {
	h := newHub()
	admin := makeAdmin(h, "admin")

	fullHP := admin.hp
	h.adminSetCheat(admin, "invulnerable", true)
	h.attackHero(slimeAt(1, admin.tx+1, admin.ty), admin)
	if admin.hp != fullHP {
		t.Fatalf("invulnerable cheat should block monster damage, hp=%v want %v", admin.hp, fullHP)
	}
	h.adminSetCheat(admin, "invulnerable", false)

	admin.hp = 1
	admin.mp = 0
	h.adminSetCheat(admin, "infiniteVitals", true)
	if admin.hp != float64(admin.maxhp) || admin.mp != float64(admin.maxmp) {
		t.Fatalf("infinite HP/MP should refill meters, hp=%v/%d mp=%v/%d", admin.hp, admin.maxhp, admin.mp, admin.maxmp)
	}
	admin.hp = 1
	admin.mp = 0
	h.attackHero(slimeAt(2, admin.tx+1, admin.ty), admin)
	if admin.hp != float64(admin.maxhp) || admin.mp != float64(admin.maxmp) {
		t.Fatalf("infinite HP/MP should absorb damage and keep meters full, hp=%v/%d mp=%v/%d", admin.hp, admin.maxhp, admin.mp, admin.maxmp)
	}
	admin.slots[0] = "fire"
	admin.lockID = 3
	admin.mp = 0
	h.enemies[admin.mapID] = []*enemy{slimeAt(3, admin.tx+1, admin.ty)}
	h.castSlot(admin, 0)
	if admin.mp != float64(admin.maxmp) || len(h.projectiles[admin.mapID]) != 1 {
		t.Fatalf("infinite HP/MP should allow free casts, mp=%v/%d projectiles=%d", admin.mp, admin.maxmp, len(h.projectiles[admin.mapID]))
	}

	admin.bag["armor"] = 20
	if !overloaded(admin) {
		t.Fatal("test setup should overload the admin before the weight cheat")
	}
	h.adminSetCheat(admin, "infinite weight capacity", true)
	if overloaded(admin) || !canCarryItem(admin, "armor", 1000) {
		t.Fatalf("infinite weight cheat should bypass carry limits, weight=%v cap=%v", bagWeight(admin), capacity(admin))
	}

	h.adminSetCheat(admin, "max attributes", true)
	if !admin.cheats.MaxAttributes || effectiveAttr(admin).Agi != 99 || effectiveAttr(admin).Luck != 99 {
		t.Fatalf("max attributes cheat did not apply, cheats=%+v attr=%+v", admin.cheats, effectiveAttr(admin))
	}
	h.adminSetCheat(admin, "max attributes", false)

	h.adminSetCheat(admin, "maxed out stats", true)
	if effectiveAttr(admin).Str != 99 || admin.maxhp < 400 || statsOf(admin).atk < 200 {
		t.Fatalf("max stats cheat did not apply, attr=%+v maxhp=%d stats=%+v", effectiveAttr(admin), admin.maxhp, statsOf(admin))
	}

	if hotbarEntryAllowed(admin, "heal") {
		t.Fatal("test setup expects a Knight admin to start without Heal access")
	}
	h.adminSetCheat(admin, "all skills available", true)
	if !hotbarEntryAllowed(admin, "heal") {
		t.Fatal("all skills cheat should unlock Heal for non-Holy classes")
	}

	admin.mapID = "field"
	admin.tx, admin.ty = 16, 10
	admin.px, admin.py = float64(15*TS), float64(10*TS)
	admin.moving = true
	h.adminSetCheat(admin, "super speed", true)
	h.stepPlayer(admin, "", 1.0/tickHz)
	if got := admin.px - float64(15*TS); got < 6.5 {
		t.Fatalf("super speed cheat should move faster than the normal 3.5 px/tick, got %.2f", got)
	}
}

func TestAdminBanAccountAndCharacter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db.json")
	fs, err := newFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	oldStore := store
	store = fs
	defer func() { store = oldStore }()

	h := newHub()
	admin := makeAdmin(h, "admin")
	target := mkPlayer(h, "target", "city", 18, 16)
	target.name = "TargetOne"

	h.adminBanAccount(admin, "target")
	if banned, err := fs.AccountBanned("target"); err != nil || !banned {
		t.Fatalf("account ban should persist, banned=%v err=%v", banned, err)
	}

	h.adminUnbanAccount(admin, "target")
	if banned, err := fs.AccountBanned("target"); err != nil || banned {
		t.Fatalf("account unban should persist, banned=%v err=%v", banned, err)
	}

	h.adminBanCharacter(admin, "target", "TargetOne")
	if banned, err := fs.CharacterBanned("target", "targetone"); err != nil || !banned {
		t.Fatalf("character ban should persist, banned=%v err=%v", banned, err)
	}

	h.adminUnbanCharacter(admin, "target", "TargetOne")
	if banned, err := fs.CharacterBanned("target", "TargetOne"); err != nil || banned {
		t.Fatalf("character unban should persist, banned=%v err=%v", banned, err)
	}
}
