package main

import (
	"path/filepath"
	"testing"
)

func TestFileStoreLoginRegisterSaveReload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db.json")
	s, err := newFileStore(path)
	if err != nil {
		t.Fatal(err)
	}

	// first login registers the account and returns a nil (fresh) character
	chars, err := s.Login("alice", "secret")
	if err != nil || chars != nil {
		t.Fatalf("first login should register with no characters (chars=%v err=%v)", chars, err)
	}
	// wrong password is rejected
	if _, err := s.Login("alice", "nope"); err != errBadPassword {
		t.Fatalf("wrong password should be rejected, got %v", err)
	}
	// save some progress
	want := &charState{Name: "AliceOne", Class: "Knight", MapID: "field", Tx: 12, Ty: 8, Lv: 3, Gold: 250, Bag: map[string]int{"potion": 2}}
	if err := s.Save("alice", want); err != nil {
		t.Fatal(err)
	}
	second := &charState{Name: "AliceTwo", Class: "Wizard", MapID: "city", Tx: 19, Ty: 16, Lv: 7, Gold: 99}
	if err := s.Save("alice", second); err != nil {
		t.Fatal(err)
	}
	// re-open the store (simulating a server restart) and log back in
	s2, err := newFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	gotChars, err := s2.Login("alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	got := findCharacter(gotChars, "AliceOne")
	if got == nil || got.Lv != 3 || got.Gold != 250 || got.Tx != 12 || got.Ty != 8 || got.Bag["potion"] != 2 {
		t.Fatalf("character did not persist across reload: %+v", got)
	}
	gotSecond := findCharacter(gotChars, "AliceTwo")
	if gotSecond == nil || gotSecond.Class != "Wizard" || gotSecond.Lv != 7 {
		t.Fatalf("second character did not persist across reload: %+v", gotSecond)
	}
	// a different user is independent and fresh
	if chars, err := s2.Login("bob", "pw"); err != nil || chars != nil {
		t.Fatalf("new user should register fresh (chars=%v err=%v)", chars, err)
	}
}

func TestFileStoreAccountAndCharacterBansPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db.json")
	s, err := newFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetAccountBan("blocked", true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Login("blocked", "pw"); err != errAccountBanned {
		t.Fatalf("banned account should be rejected, got %v", err)
	}
	if err := s.SetAccountBan("blocked", false); err != nil {
		t.Fatal(err)
	}
	if chars, err := s.Login("blocked", "pw"); err != nil || chars != nil {
		t.Fatalf("unbanned reserved account should register fresh, chars=%v err=%v", chars, err)
	}

	if _, err := s.Login("owner", "pw"); err != nil {
		t.Fatal(err)
	}
	ch := &charState{Name: "HeroOne", Class: "Knight", MapID: "city", Tx: 19, Ty: 16}
	if err := s.Save("owner", ch); err != nil {
		t.Fatal(err)
	}
	if err := s.SetCharacterBan("owner", "HeroOne", true); err != nil {
		t.Fatal(err)
	}

	s2, err := newFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if banned, err := s2.CharacterBanned("owner", "heroone"); err != nil || !banned {
		t.Fatalf("character ban should persist case-insensitively, banned=%v err=%v", banned, err)
	}
	if err := s2.SetCharacterBan("owner", "HeroOne", false); err != nil {
		t.Fatal(err)
	}
	if banned, err := s2.CharacterBanned("owner", "HeroOne"); err != nil || banned {
		t.Fatalf("character unban should persist, banned=%v err=%v", banned, err)
	}

	if err := s2.SetAccountBan("second", true); err != nil {
		t.Fatal(err)
	}
	if err := s2.SetCharacterBan("owner", "HeroTwo", true); err != nil {
		t.Fatal(err)
	}
	lists, err := s2.ListBans()
	if err != nil {
		t.Fatal(err)
	}
	if len(lists.Accounts) != 1 || lists.Accounts[0] != "second" {
		t.Fatalf("account ban list mismatch: %#v", lists.Accounts)
	}
	if len(lists.Characters) != 1 || lists.Characters[0].Account != "owner" || lists.Characters[0].Name != "HeroTwo" {
		t.Fatalf("character ban list mismatch: %#v", lists.Characters)
	}
}
