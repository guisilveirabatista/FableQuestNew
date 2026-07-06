//go:build postgres

package main

// PostgreSQL persistence, compiled in with `-tags postgres`. It stores each
// account's salt/hash and the character as JSONB. Build & run, e.g.:
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
  char     JSONB
)`)
	if err != nil {
		pool.Close()
		return nil, err
	}
	return &pgStore{pool: pool}, nil
}

func (s *pgStore) Login(user, pass string) (*charState, error) {
	ctx := context.Background()
	var salt, hash string
	var charJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT salt, hash, char FROM accounts WHERE username=$1`, user).
		Scan(&salt, &hash, &charJSON)
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
	if len(charJSON) == 0 {
		return nil, nil
	}
	var ch charState
	if err := json.Unmarshal(charJSON, &ch); err != nil {
		return nil, err
	}
	return &ch, nil
}

func (s *pgStore) Save(user string, ch *charState) error {
	data, err := json.Marshal(ch)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(context.Background(), `UPDATE accounts SET char=$2 WHERE username=$1`, user, data)
	return err
}

func (s *pgStore) Close() error { s.pool.Close(); return nil }
