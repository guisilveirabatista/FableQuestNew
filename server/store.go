package main

// Persistence (Phase 4): accounts + per-character state that survives logout and
// server restarts. The default is a zero-setup JSON file store (stdlib only). A
// PostgreSQL store lives behind the `postgres` build tag (see store_postgres.go);
// build with `-tags postgres` and pass -db postgres://... to use it.

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
)

var errBadPassword = errors.New("wrong password")

const (
	defaultHair  = "#6b3f22"
	defaultCloth = "#2f7fd1"
)

func sanitizeColor(s, fallback string) string {
	s = strings.TrimSpace(s)
	if len(s) != 7 || s[0] != '#' {
		return fallback
	}
	for _, r := range s[1:] {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return fallback
		}
	}
	return s
}

func cloneSkillLevels(src map[string]int) map[string]int {
	out := map[string]int{}
	for k, v := range src {
		out[k] = v
	}
	return out
}

// charState is the persistent slice of a character — everything that must
// survive a restart. Transient combat state (lock, iframes, path) is not saved.
type charState struct {
	Name        string            `json:"name,omitempty"`
	Class       string            `json:"class,omitempty"`
	Hair        string            `json:"hair,omitempty"`
	Cloth       string            `json:"cloth,omitempty"`
	MapID       string            `json:"map"`
	Tx          int               `json:"tx"`
	Ty          int               `json:"ty"`
	Dir         string            `json:"dir"`
	HP          float64           `json:"hp"`
	MP          float64           `json:"mp"`
	Lv          int               `json:"lv"`
	Exp         int               `json:"exp"`
	Gold        int               `json:"gold"`
	Kills       int               `json:"kills"`
	Points      int               `json:"points"`
	SkillPoints int               `json:"skillPoints,omitempty"`
	SkillLevels map[string]int    `json:"skillLevels,omitempty"`
	Attr        AttrSet           `json:"attr"`
	Slots       []string          `json:"slots"`
	Bag         map[string]int    `json:"bag"`
	Equip       map[string]string `json:"equip"`
	Autoloot    bool              `json:"autoloot"`
	Friends     []string          `json:"friends,omitempty"`
}

// Store is the persistence backend. Login authenticates a user, auto-registering
// a new account on first use (fine for a demo; production would separate them).
// It returns every character on the account, or nil for a brand-new account, or
// errBadPassword.
type Store interface {
	Login(user, pass string) (chars []*charState, err error)
	Save(user string, ch *charState) error
	Close() error
}

// newPostgresStore is wired up by store_postgres.go when built with -tags postgres.
var newPostgresStore func(dsn string) (Store, error)

// openStore picks a backend from the DSN: postgres://... uses Postgres (if built
// in), anything else (incl. "" and file:PATH) uses the JSON file store.
func openStore(dsn string) (Store, error) {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		if newPostgresStore == nil {
			return nil, errors.New("Postgres support not built in — rebuild with `-tags postgres`")
		}
		return newPostgresStore(dsn)
	}
	path := strings.TrimPrefix(dsn, "file:")
	if path == "" {
		path = "fablequest.db.json"
	}
	return newFileStore(path)
}

// ---- file store ------------------------------------------------------------

type account struct {
	Salt       string       `json:"salt"`
	Hash       string       `json:"hash"`
	Char       *charState   `json:"char,omitempty"`       // legacy single-character save
	Characters []*charState `json:"characters,omitempty"` // current multi-character roster
}

type fileStore struct {
	path     string
	mu       sync.Mutex
	accounts map[string]*account
}

func newFileStore(path string) (*fileStore, error) {
	s := &fileStore{path: path, accounts: map[string]*account{}}
	data, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(data, &s.accounts); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func hashPass(pass, saltHex string) string {
	salt, _ := hex.DecodeString(saltHex)
	sum := sha256.Sum256(append(salt, []byte(pass)...))
	return hex.EncodeToString(sum[:])
}

func (s *fileStore) Login(user, pass string) ([]*charState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.accounts[user]
	if a == nil { // first login: register the account
		saltBytes := make([]byte, 16)
		rand.Read(saltBytes)
		salt := hex.EncodeToString(saltBytes)
		s.accounts[user] = &account{Salt: salt, Hash: hashPass(pass, salt)}
		if err := s.persistLocked(); err != nil {
			return nil, err
		}
		return nil, nil // brand-new character
	}
	// constant-time compare to avoid leaking timing info
	if subtle.ConstantTimeCompare([]byte(hashPass(pass, a.Salt)), []byte(a.Hash)) != 1 {
		return nil, errBadPassword
	}
	chars, migrated := normalizeAccountCharacters(a)
	if migrated {
		if err := s.persistLocked(); err != nil {
			return nil, err
		}
	}
	return cloneChars(chars), nil
}

func (s *fileStore) Save(user string, ch *charState) error {
	if ch == nil || !validName(ch.Name) {
		return errors.New("character needs a valid name")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.accounts[user]
	if a == nil {
		return errors.New("no such account")
	}
	normalizeAccountCharacters(a)
	next := cloneChar(ch)
	replaced := false
	for i, existing := range a.Characters {
		if existing != nil && strings.EqualFold(existing.Name, next.Name) {
			a.Characters[i] = next
			replaced = true
			break
		}
	}
	if !replaced {
		a.Characters = append(a.Characters, next)
	}
	return s.persistLocked()
}

func (s *fileStore) persistLocked() error {
	data, err := json.MarshalIndent(s.accounts, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path) // atomic replace
}

func (s *fileStore) Close() error { return nil }

func normalizeAccountCharacters(a *account) ([]*charState, bool) {
	migrated := false
	if len(a.Characters) == 0 && a.Char != nil {
		a.Characters = []*charState{a.Char}
		a.Char = nil
		migrated = true
	}
	return a.Characters, migrated
}

func cloneChar(ch *charState) *charState {
	if ch == nil {
		return nil
	}
	cp := *ch
	if ch.Slots != nil {
		cp.Slots = append([]string(nil), ch.Slots...)
	}
	if ch.Bag != nil {
		cp.Bag = map[string]int{}
		for k, v := range ch.Bag {
			cp.Bag[k] = v
		}
	}
	if ch.Equip != nil {
		cp.Equip = map[string]string{}
		for k, v := range ch.Equip {
			cp.Equip[k] = v
		}
	}
	if ch.SkillLevels != nil {
		cp.SkillLevels = cloneSkillLevels(ch.SkillLevels)
	}
	if ch.Friends != nil {
		cp.Friends = append([]string(nil), ch.Friends...)
	}
	return &cp
}

func cloneChars(chars []*charState) []*charState {
	if len(chars) == 0 {
		return nil
	}
	out := make([]*charState, 0, len(chars))
	for _, ch := range chars {
		if ch != nil && validName(ch.Name) {
			out = append(out, cloneChar(ch))
		}
	}
	return out
}

// ---- character <-> player mapping ------------------------------------------

// charStateOf snapshots a player's persistent state, deep-copying maps/slices so
// the result is safe to write to the store off the tick goroutine.
func charStateOf(p *Player) *charState {
	normalizeSkillProgress(p)
	bag := map[string]int{}
	for k, v := range p.bag {
		bag[k] = v
	}
	equip := map[string]string{}
	for k, v := range p.equip {
		equip[k] = v
	}
	friends := make([]string, 0, len(p.friends))
	for name := range p.friends {
		friends = append(friends, name)
	}
	mapID, tx, ty := p.mapID, p.tx, p.ty
	if p.dead { // come back at the plaza, not where you fell
		mapID, tx, ty = spawn.mapID, spawn.tx, spawn.ty
	}
	return &charState{
		Name: p.name, Class: p.class, Hair: p.hair, Cloth: p.cloth,
		MapID: mapID, Tx: tx, Ty: ty, Dir: p.dir,
		HP: p.hp, MP: p.mp, Lv: p.lv, Exp: p.exp, Gold: p.gold, Kills: p.kills, Points: p.points,
		SkillPoints: p.skillPoints, SkillLevels: cloneSkillLevels(p.skillLevels),
		Attr: p.attr, Slots: append([]string(nil), p.slots...), Bag: bag, Equip: equip, Autoloot: p.autoloot,
		Friends: friends,
	}
}

// applyCharState loads a persisted character onto a player (with sane fallbacks).
func applyCharState(p *Player, ch *charState) {
	p.name, p.class = ch.Name, ch.Class
	if p.class == "" {
		p.class = "Knight"
	}
	p.hair, p.cloth = sanitizeColor(ch.Hair, defaultHair), sanitizeColor(ch.Cloth, defaultCloth)
	p.mapID, p.tx, p.ty, p.dir = ch.MapID, ch.Tx, ch.Ty, ch.Dir
	p.lv, p.exp, p.gold, p.kills, p.points = ch.Lv, ch.Exp, ch.Gold, ch.Kills, ch.Points
	p.skillPoints, p.skillLevels = ch.SkillPoints, cloneSkillLevels(ch.SkillLevels)
	p.attr = ch.Attr
	p.slots, p.bag, p.equip, p.autoloot = ch.Slots, ch.Bag, ch.Equip, ch.Autoloot
	if p.bag == nil {
		p.bag = map[string]int{}
	}
	if p.equip == nil {
		p.equip = map[string]string{}
	}
	p.friends = map[string]bool{}
	for _, name := range ch.Friends {
		if validName(name) {
			p.friends[name] = true
		}
	}
	if len(p.slots) == 0 {
		p.slots = []string{"fire", "heal", "spin", "bolt", ""}
	}
	if p.dir == "" {
		p.dir = "down"
	}
	normalizeSkillProgress(p)
	if maps[p.mapID] == nil || blocked(p.mapID, p.tx, p.ty) { // stale/invalid save
		p.mapID, p.tx, p.ty = spawn.mapID, spawn.tx, spawn.ty
	}
	normalizeEquipment(p)
	recalcMax(p)
	p.hp, p.mp = ch.HP, ch.MP
	if p.hp <= 0 || p.hp > float64(p.maxhp) {
		p.hp = float64(p.maxhp)
	}
	if p.mp <= 0 || p.mp > float64(p.maxmp) {
		p.mp = float64(p.maxmp)
	}
	p.px, p.py = float64(p.tx*TS), float64(p.ty*TS)
}

// validName keeps usernames to 1-16 letters/digits/underscore.
func validName(s string) bool {
	if len(s) < 1 || len(s) > 16 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}
