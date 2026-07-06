package main

// End-to-end test for zone sharding (Phase 5): two zone processes (city, field)
// behind a gateway, a browser-style WebSocket client that logs in on the city
// zone, walks west onto the gate, and is handed off to the field zone with its
// character state intact and persisted. Everything runs in one process here (the
// hubs each carry their own ownedMaps), which is exactly what the per-Hub
// ownership refactor makes possible.

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// startZone spins up a hub that owns `owned`, ticking and accepting gateway
// links, and returns its internal TCP address.
func startZone(t *testing.T, owned ...string) string {
	t.Helper()
	hub := newHub()
	hub.ownedMaps = map[string]bool{}
	for _, m := range owned {
		hub.ownedMaps[m] = true
	}
	go hub.run()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go hub.serveLink(newFramedConn(c))
		}
	}()
	return ln.Addr().String()
}

// ---- a minimal browser-style WebSocket client ------------------------------

type wsClient struct {
	conn net.Conn
	br   *bufio.Reader
}

func dialWS(t *testing.T, httpURL string) *wsClient {
	t.Helper()
	host := strings.TrimPrefix(httpURL, "http://")
	conn, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef"))
	req := "GET / HTTP/1.1\r\nHost: " + host + "\r\nUpgrade: websocket\r\n" +
		"Connection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatal(err)
	}
	br := bufio.NewReader(conn)
	for { // consume the 101 response headers
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("ws handshake: %v", err)
		}
		if line == "\r\n" || line == "\n" {
			break
		}
	}
	return &wsClient{conn: conn, br: br}
}

func (c *wsClient) send(v any) error {
	b, _ := json.Marshal(v)
	n := len(b)
	hdr := []byte{0x81} // FIN + text
	switch {
	case n < 126:
		hdr = append(hdr, byte(0x80|n))
	default:
		hdr = append(hdr, 0x80|126, byte(n>>8), byte(n))
	}
	mask := []byte{0x11, 0x22, 0x33, 0x44}
	hdr = append(hdr, mask...)
	payload := make([]byte, n)
	for i := 0; i < n; i++ {
		payload[i] = b[i] ^ mask[i&3]
	}
	if _, err := c.conn.Write(hdr); err != nil {
		return err
	}
	_, err := c.conn.Write(payload)
	return err
}

func (c *wsClient) read() (map[string]any, error) {
	b0, err := c.br.ReadByte()
	if err != nil {
		return nil, err
	}
	_ = b0
	b1, err := c.br.ReadByte()
	if err != nil {
		return nil, err
	}
	n := int(b1 & 0x7f)
	switch n {
	case 126:
		var l [2]byte
		if _, err := io.ReadFull(c.br, l[:]); err != nil {
			return nil, err
		}
		n = int(binary.BigEndian.Uint16(l[:]))
	case 127:
		var l [8]byte
		if _, err := io.ReadFull(c.br, l[:]); err != nil {
			return nil, err
		}
		n = int(binary.BigEndian.Uint64(l[:]))
	}
	buf := make([]byte, n) // server -> client frames are never masked
	if _, err := io.ReadFull(c.br, buf); err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(buf, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (c *wsClient) Close() { c.conn.Close() }

// readUntil reads frames until pred is satisfied or the deadline passes.
func (c *wsClient) readUntil(t *testing.T, timeout time.Duration, pred func(map[string]any) bool) map[string]any {
	t.Helper()
	c.conn.SetReadDeadline(time.Now().Add(timeout))
	defer c.conn.SetReadDeadline(time.Time{})
	for {
		m, err := c.read()
		if err != nil {
			t.Fatalf("readUntil: %v", err)
		}
		if pred(m) {
			return m
		}
	}
}

func TestZoneHandoffCityToField(t *testing.T) {
	buildMaps()

	// pre-seed an account whose character stands next to the city west gate with a
	// recognisable gold sentinel, so the walk (and the persistence check) are quick.
	path := filepath.Join(t.TempDir(), "db.json")
	fs, err := newFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fs.Login("hero", "pw"); err != nil { // registers the account
		t.Fatal(err)
	}
	if err := fs.Save("hero", &charState{MapID: "city", Tx: 2, Ty: 12, Dir: "left", Lv: 3, Gold: 777}); err != nil {
		t.Fatal(err)
	}
	store = fs // the gateway persists through the global store

	cityAddr := startZone(t, "city")
	fieldAddr := startZone(t, "field")

	gw := newGateway(map[string]string{"city": cityAddr, "field": fieldAddr})
	srv := httptest.NewServer(http.HandlerFunc(gw.serveWS))
	defer srv.Close()

	c := dialWS(t, srv.URL)
	// close and let the session drain (final save) before the test's store/tmp
	// dir go away, so no late goroutine writes into a torn-down world.
	defer func() { c.Close(); time.Sleep(150 * time.Millisecond) }()

	if err := c.send(map[string]any{"t": "login", "user": "hero", "pass": "pw"}); err != nil {
		t.Fatal(err)
	}
	welcome := c.readUntil(t, 3*time.Second, func(m map[string]any) bool { return m["t"] == "welcome" })
	if welcome["map"] != "city" {
		t.Fatalf("expected to spawn on city, got %v", welcome["map"])
	}
	c.send(map[string]any{"t": "view", "vw": 20, "vh": 15})

	// snapshots should show us on city with the persisted gold before we move
	snap := c.readUntil(t, 3*time.Second, func(m map[string]any) bool { return m["t"] == "snap" })
	if you := snap["you"].(map[string]any); you["gold"].(float64) != 777 {
		t.Fatalf("gold not loaded: %v", you["gold"])
	}

	// walk onto the gate (0,12); the city zone hands us off to the field zone
	c.send(map[string]any{"t": "moveTo", "tx": 0, "ty": 12})

	field := c.readUntil(t, 8*time.Second, func(m map[string]any) bool {
		return m["t"] == "snap" && m["map"] == "field"
	})
	you := field["you"].(map[string]any)
	if you["tx"].(float64) != 38 || you["ty"].(float64) != 12 {
		t.Fatalf("handoff landed at wrong tile: tx=%v ty=%v (want 38,12)", you["tx"], you["ty"])
	}
	if you["gold"].(float64) != 777 || you["lv"].(float64) != 3 {
		t.Fatalf("character state not preserved across handoff: gold=%v lv=%v", you["gold"], you["lv"])
	}

	// the gateway persists on handoff — a fresh store should read us on the field
	deadline := time.Now().Add(3 * time.Second)
	for {
		fs2, err := newFileStore(path)
		if err != nil {
			t.Fatal(err)
		}
		ch, err := fs2.Login("hero", "pw")
		if err != nil {
			t.Fatal(err)
		}
		if ch != nil && ch.MapID == "field" {
			if ch.Gold != 777 || ch.Lv != 3 {
				t.Fatalf("persisted state wrong: %+v", ch)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("handoff was not persisted (still %v)", ch.MapID)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
