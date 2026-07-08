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
	err := s.pool.QueryRow(ctx, `SELECT salt, hash, characters FROM accounts WHERE username=$1`, user).
		Scan(&salt, &hash, &charsJSON)
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
	chars = upsertCharacter(chars, ch)
	data, err := json.Marshal(chars)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(context.Background(), `UPDATE accounts SET characters=$2 WHERE username=$1`, user, data)
	return err
}

func (s *pgStore) Close() error { s.pool.Close(); return nil }
