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
  game.invOpen = false; // hidden by default; press I to open (bag comes from the server)
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
  const h = game.hero, you = m.you, net = game.net;
  // reconcile own hero position: trust local prediction unless it has drifted
  // from the server's truth (different tile or noticeable sub-tile error).
  if (game.mapId !== m.map) {
    game.mapId = m.map;
    snapHero(you);
  } else if (you.tx !== h.tx || you.ty !== h.ty ||
    Math.abs(you.px - h.px) > 8 || Math.abs(you.py - h.py) > 8) {
    snapHero(you);
  }
  // authoritative hero stats drive the HUD; a drop means we took a hit
  if (net.prevHP === undefined) net.prevHP = you.hp;
  if (you.hp < net.prevHP - 0.01) {
    game.iframes = 0.6; // flash the hero red
    addPop('-' + Math.max(1, Math.round(net.prevHP - you.hp)), h.px + 8, h.py - 12, '#f76');
    sfx('Damege1');
  }
  net.prevHP = you.hp;
  h.hp = you.hp; h.maxhp = you.maxhp; h.mp = you.mp; h.maxmp = you.maxmp;
  h.lv = you.lv; h.exp = you.exp; h.gold = you.gold; h.kills = you.kills;
  if (you.slots) h.slots = you.slots;
  h.bag = m.bag || {};          // authoritative inventory drives the panel
  h.equip = m.equip || {};
  h.points = m.points || 0;
  if (m.attr) h.attr = m.attr;  // character sheet (Attribs/Status screens)
  game.autoloot = !!m.autoloot;

  // remote players
  const seen = {};
  for (const v of m.players) {
    seen[v.id] = true;
    let p = net.byId[v.id];
    if (!p) p = net.byId[v.id] = { id: v.id, px: v.px, py: v.py, tpx: v.px, tpy: v.py, dir: v.dir, moving: v.moving, anim: v.anim };
    p.tpx = v.px; p.tpy = v.py; p.dir = v.dir; p.moving = v.moving; p.anim = v.anim;
  }
  for (const id in net.byId) if (!seen[id]) delete net.byId[id];
  game.players = Object.values(net.byId);

  // shared enemies: interpolate positions, derive hit-flash + damage pops from
  // HP drops, and take the death fade (dying) straight from the server.
  const eSeen = {};
  for (const v of m.enemies || []) {
    eSeen[v.id] = true;
    let e = net.eById[v.id];
    if (!e) e = net.eById[v.id] = { px: v.px, py: v.py, dying: 0, flash: 0, hurtT: 9, lunge: 0, hp: v.hp };
    else if (v.hp < e.hp) { // took damage since last snapshot
      e.flash = 0.3; e.hurtT = 0;
      addPop('' + (e.hp - v.hp), v.px + 8, v.py - 10, '#ffe080');
    }
    e.kind = v.kind; e.tx = v.tx; e.ty = v.ty; e.tpx = v.px; e.tpy = v.py;
    e.dir = v.dir; e.moving = v.moving; e.anim = v.anim; e.hp = v.hp; e.maxhp = v.maxhp; e.dying = v.dying;
  }
  for (const id in net.eById) if (!eSeen[id]) delete net.eById[id];
  game.enemies = Object.values(net.eById);
  game.lock = you.lock ? net.eById[you.lock] : null; // yellow lock marker

  // fireballs and lightning are shared world entities; render them straight from
  // the server (boom < 0 means still flying, >= 0 means the impact burst)
  game.projectiles = (m.projectiles || []).map(v =>
    v.boom >= 0 ? { x: v.x, y: v.y, t: v.t, boom: v.boom } : { x: v.x, y: v.y, t: v.t });
  game.bolts = (m.bolts || []).map(v => ({ x: v.x, y: v.y, t: v.t }));

  // floor loot and corpses are shared world entities on the current map; tag them
  // with the map id so the existing renderer/queries (drawMap, floorAt, corpseAt) work
  game.floor = (m.floor || []).map(v => ({ map: game.mapId, id: v.id, n: v.n, tx: v.tx, ty: v.ty }));
  game.corpses = (m.corpses || []).map(v => ({ map: game.mapId, tx: v.tx, ty: v.ty, items: v.items }));
}

// One render frame in netplay mode (called from the main loop instead of the
// single-player processInput/stepWorld path).
function netFrame(frameDt) {
  const net = game.net, h = game.hero;

  // 1) input -> intents. The menu and inventory panels reuse the single-player
  //    UI code: their pushIntent() calls forward to the server (sim.js pushIntent).
  if (game.menu) {
    updateMenu(frameDt); // navigate; spend attrs / reassign skills -> server
  } else if (game.shop) {
    updateShop(); // browse the shop; buys are validated by the server
  } else {
    if (pressed(['i', 'I'])) {
      game.invOpen = !game.invOpen;
      if (!game.invOpen) { game.invFocus = null; game.invDrag = null; }
      sfx('Decision1');
    }
    if (game.invOpen && pressed(['e', 'E'])) {
      game.invFocus = game.invFocus === null ? 'bag' : game.invFocus === 'bag' ? 'body' : null;
      sfx('Cursor1');
    }
    if (game.itemPopup && (pressed(CANCEL) || pressed(CONFIRM) || clicked(0))) { game.itemPopup = null; sfx('Cancel1'); }
    if (game.invOpen && !game.itemPopup) updateInvPanel(); // mouse drag/click -> item intents
    if (!game.invOpen && !game.invFocus && !game.itemPopup && pressed(CANCEL)) {
      game.menu = { mode: 'root', cursor: 0 }; sfx('Decision1'); // Esc opens the menu
    }
  }

  // movement is blocked while a panel owns the keyboard
  const captured = game.menu || game.shop || game.invFocus || game.itemPopup;
  const dir = captured ? '' : (dirHeld() || '');
  if (dir !== net.lastDir) {
    net.lastDir = dir;
    net.seq++;
    netSend(net, { t: 'move', seq: net.seq, dir });
  }

  if (captured) {
    if (game.invFocus) updateInvKeys(); // arrows/Enter/Q drive the focused panel
  } else {
    if (pressed(CONFIRM)) { // talk to a shopkeeper if facing one, else swing
      if (!netInteract()) {
        netSend(net, { t: 'attack' });
        game.slashFx = { t: 0, dir: h.dir, punch: true, dur: 0.24 };
        sfx('Blow1');
      }
    }
    if (pressed(['Tab'])) netSend(net, { t: 'cycleLock' });
    for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) { // cast hotbar skill
      netSend(net, { t: 'cast', slot: i });
      const sk = h.slots && h.slots[i]; // optimistic local effect; damage is server-side
      if (sk === 'spin') { game.slashFx = { t: 0, spin: true, dur: 0.3 }; sfx('Sword1'); }
      else if (sk === 'heal') { game.healFx = 0.5; sfx('Recovery1'); }
      else if (sk === 'fire') sfx('Flame1');
      else if (sk === 'bolt') sfx('Thunder4');
    }
    const cam = camPos();
    for (const c of clicks) {
      if (game.invOpen && inPanel(c)) continue; // the panel owns its own clicks
      const wx = Math.floor((c.x + cam.x) / TS), wy = Math.floor((c.y + cam.y) / TS);
      if (c.b === 2) { // right-click: loot your corpse if next to it, else lock a target
        if (corpseAt(wx, wy) && nearHero(wx, wy)) netSend(net, { t: 'takeCorpse', tx: wx, ty: wy });
        else netSend(net, { t: 'lockAt', x: c.x + cam.x, y: c.y + cam.y });
      } else if (c.b === 0 && c.dbl && floorAt(wx, wy).length && nearHero(wx, wy)) {
        netSend(net, { t: 'takeLoot', tx: wx, ty: wy }); // double-click floor loot in reach
      }
    }
  }

  // 2) predict our own hero at the fixed 20 Hz tick, using the server's rules
  game.moveDir = dir || null;
  game.path = null; game.follow = false;
  net.acc += frameDt;
  let ticks = 0;
  while (net.acc >= FIXED && ticks < 5) { snapshotPrev(); stepHero(FIXED); net.acc -= FIXED; ticks++; }
  if (ticks === 5) net.acc = 0;

  // 3) ease remote players and enemies toward their snapshot positions
  const k = Math.min(1, frameDt * 14);
  for (const p of game.players) { p.px += (p.tpx - p.px) * k; p.py += (p.tpy - p.py) * k; }
  for (const e of game.enemies) { e.px += (e.tpx - e.px) * k; e.py += (e.tpy - e.py) * k; }

  // 3.5) advance the client-only visual timers advanceWorld() would normally run
  for (const p of game.pops) p.t += frameDt;
  game.pops = game.pops.filter(p => p.t < 0.8);
  game.iframes = Math.max(0, game.iframes - frameDt);
  game.healFx = Math.max(0, game.healFx - frameDt);
  if (game.slashFx && (game.slashFx.t += frameDt) >= (game.slashFx.dur || 0.18)) game.slashFx = null;
  for (const e of game.enemies) { e.flash = Math.max(0, e.flash - frameDt); e.hurtT += frameDt; }

  // 4) draw the world (hero interpolated by the leftover accumulator)
  const a = Math.max(0, Math.min(1, net.acc / FIXED));
  applyInterp(a);
  drawMap();
  clearInterp();
  drawNetOverlay();
}

function netSend(net, obj) {
  if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(obj));
}

// Facing a shopkeeper opens their shop locally (the shop UI is cosmetic; the
// server validates each purchase). Returns true if it handled the interaction.
function netInteract() {
  const h = game.hero, d = DIRV[h.dir];
  const fx = h.tx + d[0], fy = h.ty + d[1];
  const npc = npcs.find(n => n.map === game.mapId && n.tx === fx && n.ty === fy);
  if (npc && (npc.id === 'smith' || npc.id === 'grocer')) { openShop(npc.id); return true; }
  return false;
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
