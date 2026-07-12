//go:build postgres

package main

// PostgreSQL persistence, compiled in with `-tags postgres`. It stores each
// account's salt/hash and character roster as JSONB. Build & run, e.g.:
//   go build -tags postgres && ./server -db postgres://user:pass@localhost/fablequest
// (Untested against a live DB in this environment — no Postgres available here.)

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func init() { newPostgresStore = openPostgres }

type pgStore struct{ pool *pgxpool.Pool }

func openPostgres(dsn string) (Store, error) {
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return nil, err
	}
	_, err = pool.Exec(context.Background(), `
CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  salt     TEXT NOT NULL,
  hash     TEXT NOT NULL,
  characters JSONB
)`)
	if err == nil {
		_, err = pool.Exec(context.Background(), `
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned_characters JSONB`)
	}
	if err != nil {
		pool.Close()
		return nil, err
	}
	return &pgStore{pool: pool}, nil
}

func (s *pgStore) Login(user, pass string) ([]*charState, error) {
	ctx := context.Background()
	var salt, hash string
	var charsJSON []byte
	var banned bool
	err := s.pool.QueryRow(ctx, `SELECT salt, hash, characters, banned FROM accounts WHERE username=$1`, user).
		Scan(&salt, &hash, &charsJSON, &banned)
	if errors.Is(err, pgx.ErrNoRows) { // first login: register
		saltBytes := make([]byte, 16)
		rand.Read(saltBytes)
		salt = hex.EncodeToString(saltBytes)
		hash = hashPass(pass, salt)
		if _, e := s.pool.Exec(ctx, `INSERT INTO accounts(username,salt,hash) VALUES($1,$2,$3)`, user, salt, hash); e != nil {
			return nil, e
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if banned {
		return nil, errAccountBanned
	}
	if salt == "" && hash == "" { // reserved moderation row; finish registration
		saltBytes := make([]byte, 16)
		rand.Read(saltBytes)
		salt = hex.EncodeToString(saltBytes)
		hash = hashPass(pass, salt)
		if _, err := s.pool.Exec(ctx, `UPDATE accounts SET salt=$2, hash=$3 WHERE username=$1`, user, salt, hash); err != nil {
			return nil, err
		}
		return nil, nil
	}
	if subtle.ConstantTimeCompare([]byte(hashPass(pass, salt)), []byte(hash)) != 1 {
		return nil, errBadPassword
	}
	if len(charsJSON) == 0 {
		return nil, nil
	}
	var chars []*charState
	if err := json.Unmarshal(charsJSON, &chars); err != nil {
		return nil, err
	}
	return cloneChars(chars), nil
}

func (s *pgStore) Save(user string, ch *charState) error {
	if ch == nil || !validName(ch.Name) {
		return errors.New("character needs a valid name")
	}
	var nameTaken bool
	err := s.pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM accounts, jsonb_array_elements(COALESCE(characters, '[]'::jsonb)) AS elem
			WHERE username <> $1 AND LOWER(elem->>'name') = LOWER($2)
		)
	`, user, ch.Name).Scan(&nameTaken)
	if err != nil {
		return err
	}
	if nameTaken {
		return errors.New("character name already taken by another account")
	}

	var charsJSON []byte
	err = s.pool.QueryRow(context.Background(), `SELECT characters FROM accounts WHERE username=$1`, user).Scan(&charsJSON)
	if err != nil {
		return err
	}
	var chars []*charState
	if len(charsJSON) > 0 {
		if err = json.Unmarshal(charsJSON, &chars); err != nil {
			return err
		}
	}
	chars = upsertCharacter(chars, ch)
	data, err := json.Marshal(chars)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(context.Background(), `UPDATE accounts SET characters=$2 WHERE username=$1`, user, data)
	return err
}

func (s *pgStore) DeleteCharacter(user, name string) error {
	var charsJSON []byte
	err := s.pool.QueryRow(context.Background(), `SELECT characters FROM accounts WHERE username=$1`, user).Scan(&charsJSON)
	if err != nil {
		return err
	}
	var chars []*charState
	if len(charsJSON) > 0 {
		if err := json.Unmarshal(charsJSON, &chars); err != nil {
			return err
		}
	}
	found := false
	for i, ch := range chars {
		if ch != nil && strings.EqualFold(ch.Name, name) {
			chars = append(chars[:i], chars[i+1:]...)
			found = true
			break
		}
	}
	if !found {
		return errors.New("character not found")
	}
	data, err := json.Marshal(chars)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(context.Background(), `UPDATE accounts SET characters=$2 WHERE username=$1`, user, data)
	return err
}

func (s *pgStore) CharacterExists(name string) (bool, error) {
	ctx := context.Background()
	var exists bool
	query := `
		SELECT EXISTS (
			SELECT 1 FROM accounts, jsonb_array_elements(COALESCE(characters, '[]'::jsonb)) AS elem
			WHERE LOWER(elem->>'name') = LOWER($1)
		)
	`
	err := s.pool.QueryRow(ctx, query, name).Scan(&exists)
	return exists, err
}

func (s *pgStore) SetAccountBan(user string, banned bool) error {
	if !validName(user) {
		return errors.New("invalid account name")
	}
	_, err := s.pool.Exec(context.Background(), `
INSERT INTO accounts(username, salt, hash, banned) VALUES($1, '', '', $2)
ON CONFLICT(username) DO UPDATE SET banned=$2`, user, banned)
	return err
}

func (s *pgStore) AccountBanned(user string) (bool, error) {
	var banned bool
	err := s.pool.QueryRow(context.Background(), `SELECT banned FROM accounts WHERE username=$1`, user).Scan(&banned)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return banned, err
}

func (s *pgStore) SetCharacterBan(user, name string, banned bool) error {
	if !validName(user) || !validName(name) {
		return errors.New("invalid account or character name")
	}
	ctx := context.Background()
	var raw []byte
	err := s.pool.QueryRow(ctx, `SELECT banned_characters FROM accounts WHERE username=$1`, user).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		raw = nil
		if _, err := s.pool.Exec(ctx, `INSERT INTO accounts(username, salt, hash) VALUES($1, '', '')`, user); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	var names []string
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &names); err != nil {
			return err
		}
	}
	names = setNameInList(names, name, banned)
	data, err := json.Marshal(names)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE accounts SET banned_characters=$2 WHERE username=$1`, user, data)
	return err
}

func (s *pgStore) CharacterBanned(user, name string) (bool, error) {
	var raw []byte
	err := s.pool.QueryRow(context.Background(), `SELECT banned_characters FROM accounts WHERE username=$1`, user).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) || len(raw) == 0 {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var names []string
	if err := json.Unmarshal(raw, &names); err != nil {
		return false, err
	}
	return nameInList(names, name), nil
}

func (s *pgStore) ListBans() (banListView, error) {
	rows, err := s.pool.Query(context.Background(), `
SELECT username, banned, COALESCE(banned_characters, '[]'::jsonb)
FROM accounts
WHERE banned OR jsonb_array_length(COALESCE(banned_characters, '[]'::jsonb)) > 0`)
	if err != nil {
		return banListView{}, err
	}
	defer rows.Close()

	out := banListView{}
	for rows.Next() {
		var user string
		var banned bool
		var raw []byte
		if err := rows.Scan(&user, &banned, &raw); err != nil {
			return banListView{}, err
		}
		if banned {
			out.Accounts = append(out.Accounts, user)
		}
		var names []string
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &names); err != nil {
				return banListView{}, err
			}
		}
		for _, name := range names {
			if validName(name) {
				out.Characters = append(out.Characters, bannedCharacterView{Account: user, Name: name})
			}
		}
	}
	if err := rows.Err(); err != nil {
		return banListView{}, err
	}
	sort.Strings(out.Accounts)
	sort.Slice(out.Characters, func(i, j int) bool {
		if !strings.EqualFold(out.Characters[i].Account, out.Characters[j].Account) {
			return strings.ToLower(out.Characters[i].Account) < strings.ToLower(out.Characters[j].Account)
		}
		return strings.ToLower(out.Characters[i].Name) < strings.ToLower(out.Characters[j].Name)
	})
	return out, nil
}

func (s *pgStore) Close() error { s.pool.Close(); return nil }
