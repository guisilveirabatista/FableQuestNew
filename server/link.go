package main

// Internal transport for zone sharding (Phase 5). Browsers talk WebSocket to the
// gateway; the gateway talks to each zone-server process over a plain TCP
// connection framed with a 4-byte big-endian length prefix per JSON message.
// This link is never exposed to clients, so it needs no handshake or masking —
// just enough to carry the same JSON envelopes back and forth.

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"sync"
)

// netConn is the write side of a player's connection: a browser WebSocket
// (*wsConn) in solo mode, or an internal gateway<->zone link (*framedConn) in
// sharded mode. The hub only ever writes snapshots through this, so both work.
type netConn interface {
	WriteText(b []byte) error
	Close() error
}

// framedConn carries length-prefixed JSON messages over a TCP connection.
type framedConn struct {
	conn net.Conn
	br   *bufio.Reader
	wmu  sync.Mutex // serialize writes (tick goroutine + link reader replies)
}

func newFramedConn(c net.Conn) *framedConn {
	return &framedConn{conn: c, br: bufio.NewReader(c)}
}

func (f *framedConn) WriteText(b []byte) error {
	f.wmu.Lock()
	defer f.wmu.Unlock()
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], uint32(len(b)))
	if _, err := f.conn.Write(hdr[:]); err != nil {
		return err
	}
	_, err := f.conn.Write(b)
	return err
}

// WriteJSON marshals v and sends it as one frame.
func (f *framedConn) WriteJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return f.WriteText(b)
}

// ReadMessage returns the next whole JSON frame's payload.
func (f *framedConn) ReadMessage() ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(f.br, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > 1<<20 {
		return nil, errors.New("frame too large")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(f.br, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func (f *framedConn) Close() error { return f.conn.Close() }
