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
	ch, err := s.Login("alice", "secret")
	if err != nil || ch != nil {
		t.Fatalf("first login should register with a nil char (ch=%v err=%v)", ch, err)
	}
	// wrong password is rejected
	if _, err := s.Login("alice", "nope"); err != errBadPassword {
		t.Fatalf("wrong password should be rejected, got %v", err)
	}
	// save some progress
	want := &charState{MapID: "field", Tx: 12, Ty: 8, Lv: 3, Gold: 250, Bag: map[string]int{"potion": 2}}
	if err := s.Save("alice", want); err != nil {
		t.Fatal(err)
	}
	// re-open the store (simulating a server restart) and log back in
	s2, err := newFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s2.Login("alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Lv != 3 || got.Gold != 250 || got.Tx != 12 || got.Ty != 8 || got.Bag["potion"] != 2 {
		t.Fatalf("character did not persist across reload: %+v", got)
	}
	// a different user is independent and fresh
	if ch, err := s2.Login("bob", "pw"); err != nil || ch != nil {
		t.Fatalf("new user should register fresh (ch=%v err=%v)", ch, err)
	}
}
