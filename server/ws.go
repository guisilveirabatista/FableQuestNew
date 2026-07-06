package main

// A minimal RFC 6455 WebSocket server, stdlib-only, sized for this project:
// single-frame JSON text messages over localhost. It handles the HTTP upgrade,
// client-masked frames, and ping/close control frames. It deliberately does not
// support fragmented frames or per-message compression — browsers send neither
// for the small messages we exchange. Good enough for Phase 1; a production
// build would swap in a hardened library.

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// opcodes
const (
	opText  = 0x1
	opClose = 0x8
	opPing  = 0x9
	opPong  = 0xA
)

type wsConn struct {
	conn net.Conn
	br   *bufio.Reader
	wmu  sync.Mutex // serializes writes (tick goroutine + pong replies)
}

// wsUpgrade performs the handshake and hijacks the TCP connection.
func wsUpgrade(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if !strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") ||
		!strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return nil, errors.New("not a websocket handshake")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing Sec-WebSocket-Key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("response writer does not support hijack")
	}
	conn, buf, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	sum := sha1.Sum([]byte(key + wsGUID))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	_, err = buf.WriteString("HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n")
	if err == nil {
		err = buf.Flush()
	}
	if err != nil {
		conn.Close()
		return nil, err
	}
	return &wsConn{conn: conn, br: buf.Reader}, nil
}

// ReadMessage returns the next frame's opcode and (unmasked) payload.
func (c *wsConn) ReadMessage() (opcode byte, payload []byte, err error) {
	b0, err := c.br.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	opcode = b0 & 0x0f
	b1, err := c.br.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	masked := b1&0x80 != 0
	length := uint64(b1 & 0x7f)
	switch length {
	case 126:
		var l [2]byte
		if _, err = io.ReadFull(c.br, l[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(l[:]))
	case 127:
		var l [8]byte
		if _, err = io.ReadFull(c.br, l[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(l[:])
	}
	if length > 1<<20 {
		return 0, nil, errors.New("frame too large")
	}
	var mask [4]byte
	if masked {
		if _, err = io.ReadFull(c.br, mask[:]); err != nil {
			return 0, nil, err
		}
	}
	payload = make([]byte, length)
	if _, err = io.ReadFull(c.br, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i&3]
		}
	}
	return opcode, payload, nil
}

// writeFrame writes a single unmasked (server->client) frame.
func (c *wsConn) writeFrame(opcode byte, payload []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	n := len(payload)
	hdr := make([]byte, 0, 10)
	hdr = append(hdr, 0x80|opcode) // FIN + opcode
	switch {
	case n < 126:
		hdr = append(hdr, byte(n))
	case n < 65536:
		hdr = append(hdr, 126, byte(n>>8), byte(n))
	default:
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(n))
		hdr = append(hdr, 127)
		hdr = append(hdr, b[:]...)
	}
	if _, err := c.conn.Write(hdr); err != nil {
		return err
	}
	_, err := c.conn.Write(payload)
	return err
}

func (c *wsConn) WriteText(payload []byte) error { return c.writeFrame(opText, payload) }
func (c *wsConn) Close() error                   { return c.conn.Close() }
