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
