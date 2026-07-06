'use strict';
// Phase 1 netplay: a thin client for the Go authoritative movement server.
// Opt in with ?net=1 (connects to ws://<host>/ws) or ?net=ws://host:port/ws.
//
// The client sends only its desired direction (an intent) and never a position.
// It PREDICTS its own hero locally with the very same movement rules the server
// runs (sim.js stepHero — world.go's stepPlayer is its port), so walking feels
// instant, and gently reconciles to the server's authoritative position when the
// two diverge. Other players are INTERPOLATED toward the latest snapshot. Enemies
// and combat stay out of Phase 1 (the server is movement-only for now).

function netStart(url) {
  const net = {
    ws: null, url, id: null, seq: 0, ack: 0, lastDir: '',
    acc: 0, byId: {}, eById: {}, connected: false, status: 'connecting…',
  };
  game.net = net;
  game.players = [];
  game.enemies = [];
  game.invOpen = false; // declutter: no inventory panel in the movement demo
  game.logOpen = false;
  game.menu = null;
  game.scene = 'map';

  const ws = new WebSocket(url);
  net.ws = ws;
  ws.onopen = () => { net.connected = true; net.status = 'connected'; };
  ws.onclose = () => { net.connected = false; net.status = 'disconnected'; };
  ws.onerror = () => { net.status = 'connection error'; };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      net.id = m.id;
      game.mapId = m.map;
      snapHero(m); // start at the server-assigned spawn
    } else if (m.t === 'snap') {
      net.ack = m.ack;
      onSnapshot(m);
    }
  };
}

// hard-set the local hero from an authoritative server state
function snapHero(s) {
  const h = game.hero;
  if (s.tx !== undefined) { h.tx = s.tx; h.ty = s.ty; }
  if (s.px !== undefined) { h.px = s.px; h.py = s.py; }
  else { h.px = h.tx * TS; h.py = h.ty * TS; }
  if (s.dir) h.dir = s.dir;
  if (s.moving !== undefined) h.moving = s.moving;
  if (s.anim !== undefined) h.anim = s.anim;
}

function onSnapshot(m) {
  const h = game.hero, you = m.you;
  // reconcile own hero: trust local prediction unless it has drifted from the
  // server's truth (a different tile, or noticeable sub-tile error). On localhost
  // this almost never fires; over real latency it keeps us honest.
  if (game.mapId !== m.map) {
    game.mapId = m.map;
    snapHero(you);
  } else if (you.tx !== h.tx || you.ty !== h.ty ||
    Math.abs(you.px - h.px) > 8 || Math.abs(you.py - h.py) > 8) {
    snapHero(you);
  }
  // remote players: update interpolation targets, keyed by id for continuity
  const net = game.net, seen = {};
  for (const v of m.players) {
    seen[v.id] = true;
    let p = net.byId[v.id];
    if (!p) p = net.byId[v.id] = { id: v.id, px: v.px, py: v.py, tpx: v.px, tpy: v.py, dir: v.dir, moving: v.moving, anim: v.anim };
    p.tpx = v.px; p.tpy = v.py; p.dir = v.dir; p.moving = v.moving; p.anim = v.anim;
  }
  for (const id in net.byId) if (!seen[id]) delete net.byId[id];
  game.players = Object.values(net.byId);

  // shared enemies: track by id for smooth interpolation; fill the extra fields
  // drawEnemy() expects (they carry combat meaning from Phase 2b on)
  const eSeen = {};
  for (const v of m.enemies || []) {
    eSeen[v.id] = true;
    let e = net.eById[v.id];
    if (!e) e = net.eById[v.id] = { px: v.px, py: v.py, dying: 0, flash: 0, hurtT: 9, lunge: 0 };
    e.kind = v.kind; e.tx = v.tx; e.ty = v.ty; e.tpx = v.px; e.tpy = v.py;
    e.dir = v.dir; e.moving = v.moving; e.anim = v.anim; e.hp = v.hp; e.maxhp = v.maxhp;
  }
  for (const id in net.eById) if (!eSeen[id]) delete net.eById[id];
  game.enemies = Object.values(net.eById);
}

// One render frame in netplay mode (called from the main loop instead of the
// single-player processInput/stepWorld path).
function netFrame(frameDt) {
  const net = game.net, h = game.hero;

  // 1) input -> intent: send our desired direction whenever it changes
  const dir = dirHeld() || '';
  if (dir !== net.lastDir) {
    net.lastDir = dir;
    net.seq++;
    if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify({ t: 'move', seq: net.seq, dir }));
  }

  // 2) predict our own hero at the fixed 20 Hz tick, using the server's rules
  game.moveDir = dir || null;
  game.path = null; game.follow = false; game.lock = null;
  net.acc += frameDt;
  let ticks = 0;
  while (net.acc >= FIXED && ticks < 5) { snapshotPrev(); stepHero(FIXED); net.acc -= FIXED; ticks++; }
  if (ticks === 5) net.acc = 0;

  // 3) ease remote players and shared enemies toward their snapshot positions
  const k = Math.min(1, frameDt * 14);
  for (const p of game.players) { p.px += (p.tpx - p.px) * k; p.py += (p.tpy - p.py) * k; }
  for (const e of game.enemies) { e.px += (e.tpx - e.px) * k; e.py += (e.tpy - e.py) * k; }

  // 4) draw the world (hero interpolated by the leftover accumulator)
  const a = Math.max(0, Math.min(1, net.acc / FIXED));
  applyInterp(a);
  drawMap();
  clearInterp();
  drawNetOverlay();
}

// tiny connection/roster banner so the demo is legible
function drawNetOverlay() {
  const net = game.net;
  const online = 1 + game.players.length;
  drawWindow(W / 2 - 70, 4, 140, 24);
  text(`ONLINE  ${net.id || '?'}  (${online} here)`, W / 2 - 60, 12, net.connected ? '#9f9' : '#f76');
  // float each other player's id above their head
  for (const p of game.players) {
    const cam = camPos();
    text(p.id, Math.round(p.px + 8 - cam.x - 4), Math.round(p.py - 18 - cam.y), '#9cf');
  }
}
