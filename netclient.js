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
  game.login = { user: '', pass: '', field: 'user', error: '', busy: false }; // login screen until welcome
  // social (Phase 6)
  game.chat = []; game.chatOpen = true; game.chatInput = null; game.party = null; game.trade = null;
  game.socialPrompt = null; game.youPvp = false;

  const ws = new WebSocket(url);
  net.ws = ws;
  ws.onopen = () => { net.connected = true; net.status = 'connected'; };
  ws.onclose = () => { net.connected = false; net.status = 'disconnected'; if (game.login) { game.login.error = 'disconnected'; game.login.busy = false; } };
  ws.onerror = () => { net.status = 'connection error'; if (game.login) { game.login.error = 'connection error'; game.login.busy = false; } };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      net.id = m.id;
      game.hero.name = m.id;
      game.mapId = m.map;
      snapHero(m); // start at the server-assigned spawn
      game.login = null; // logged in — enter the world
      // report our area of interest (half-viewport in tiles + margin)
      netSend(net, { t: 'view', vw: Math.ceil(W / TS / 2) + 6, vh: Math.ceil(H / TS / 2) + 6 });
    } else if (m.t === 'loginError') {
      if (game.login) { game.login.error = m.msg; game.login.busy = false; }
    } else if (m.t === 'snap') {
      net.ack = m.ack;
      onSnapshot(m);
    }
  };
}

// ---- login screen ----------------------------------------------------------
function loginBox() {
  const w = 224, h = 134, x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  return {
    x, y, w, h,
    user: { x: x + 16, y: y + 42, w: w - 32, h: 16 },
    pass: { x: x + 16, y: y + 76, w: w - 32, h: 16 },
    btn: { x: x + w / 2 - 40, y: y + 100, w: 80, h: 18 },
  };
}

function submitLogin() {
  const L = game.login;
  if (L.busy || !L.user || !L.pass) return;
  L.error = ''; L.busy = true;
  netSend(game.net, { t: 'login', user: L.user, pass: L.pass });
}

function updateLoginScreen() {
  const L = game.login, b = loginBox();
  for (const c of clicks) {
    if (c.b !== 0) continue;
    if (hit(c, b.user.x, b.user.y, b.user.w, b.user.h)) { L.field = 'user'; sfx('Cursor1'); }
    else if (hit(c, b.pass.x, b.pass.y, b.pass.w, b.pass.h)) { L.field = 'pass'; sfx('Cursor1'); }
    else if (hit(c, b.btn.x, b.btn.y, b.btn.w, b.btn.h)) submitLogin();
  }
  for (const k of queue) { // typed characters
    if (k === 'Enter') submitLogin();
    else if (k === 'Tab') { L.field = L.field === 'user' ? 'pass' : 'user'; sfx('Cursor1'); }
    else if (k === 'Backspace') L[L.field] = L[L.field].slice(0, -1);
    else if (k === 'Escape') { location.href = location.pathname; }
    else if (k.length === 1) {
      if (L.field === 'user') { if (/[a-zA-Z0-9_]/.test(k) && L.user.length < 16) L.user += k; }
      else if (k.charCodeAt(0) >= 32 && k.charCodeAt(0) < 127 && L.pass.length < 64) L.pass += k;
    }
  }
}

function drawLoginField(f, val, active) {
  ctx.fillStyle = 'rgba(10,20,30,.6)';
  ctx.fillRect(f.x, f.y, f.w, f.h);
  ctx.strokeStyle = active ? '#ffe080' : '#56718a';
  ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
  text(val, f.x + 4, f.y + 4);
  if (active && Math.floor(performance.now() / 400) % 2) {
    ctx.font = 'bold 8px "Courier New", monospace';
    text('_', f.x + 4 + ctx.measureText(val).width, f.y + 4);
  }
}

function drawLoginScreen() {
  const L = game.login, b = loginBox();
  if (img.title) ctx.drawImage(img.title, (W - 320) / 2, -20, 320, 240);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H);
  drawWindow(b.x, b.y, b.w, b.h);
  text('FABLE QUEST', b.x + 16, b.y + 12, '#ffe080');
  text('Username', b.user.x, b.user.y - 11, '#bcd');
  drawLoginField(b.user, L.user, L.field === 'user');
  text('Password', b.pass.x, b.pass.y - 11, '#bcd');
  drawLoginField(b.pass, '*'.repeat(L.pass.length), L.field === 'pass');
  drawWindow(b.btn.x, b.btn.y, b.btn.w, b.btn.h);
  text(L.busy ? '...' : 'Login', b.btn.x + b.btn.w / 2 - (L.busy ? 6 : 14), b.btn.y + 5);
  text(L.error || 'New here? Just pick a name — you\'ll be registered.', b.x + 14, b.y + b.h - 14, L.error ? '#f76' : '#9cf');
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
  h.combatLogoutT = Math.max(0, you.combatLog || 0);
  h.dead = !!you.dead;
  if (h.dead) {
    if (!game.death || game.death.cause !== you.deathCause) {
      game.death = { cause: you.deathCause || 'unknown forces', cursor: 0 };
      game.menu = null; game.shop = null; game.itemPopup = null; game.corpseOpen = null;
    }
  } else if (game.death) game.death = null;
  if (you.slots) h.slots = you.slots;
  h.bag = m.bag || {};          // authoritative inventory drives the panel
  h.equip = m.equip || {};
  h.points = m.points || 0;
  if (m.attr) h.attr = m.attr;  // character sheet (Attribs/Status screens)
  game.autoloot = !!m.autoloot;
  game.youPvp = !!you.pvp;
  if (m.log) for (const s of m.log) logMsg(s);
  if (m.chat) for (const c of m.chat) { pushChatLine(c); if (c.scope !== 'reward' && c.scope !== 'system') sfx('Cursor1'); }
  // party / trade windows come straight from the server
  game.party = m.party || null;
  game.trade = m.trade || null;
  if (m.trade) game.socialPrompt = null;          // trade window supersedes the prompt
  else if (m.tradeReq) game.socialPrompt = { kind: 'trade', from: m.tradeReq };
  else if (m.invite) game.socialPrompt = { kind: 'party' };
  else game.socialPrompt = null;

  // remote players
  const seen = {};
  for (const v of m.players) {
    seen[v.id] = true;
    let p = net.byId[v.id];
    if (!p) p = net.byId[v.id] = {
      id: v.id, name: v.id, px: v.px, py: v.py, tpx: v.px, tpy: v.py,
      dir: v.dir, moving: v.moving, anim: v.anim, hp: v.hp, maxhp: v.maxhp,
    };
    p.tpx = v.px; p.tpy = v.py; p.dir = v.dir; p.moving = v.moving; p.anim = v.anim;
    p.hp = v.hp; p.maxhp = v.maxhp; p.name = v.name || v.id;
    p.dead = !!v.dead; p.pvp = !!v.pvp;
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
  game.follow = !!you.follow;                          // blue follow marker

  // fireballs and lightning are shared world entities; render them straight from
  // the server (boom < 0 means still flying, >= 0 means the impact burst)
  game.projectiles = (m.projectiles || []).map(v =>
    v.boom >= 0 ? { x: v.x, y: v.y, t: v.t, boom: v.boom } : { x: v.x, y: v.y, t: v.t });
  game.bolts = (m.bolts || []).map(v => ({ x: v.x, y: v.y, t: v.t }));

  // floor loot and corpses are shared world entities on the current map; tag them
  // with the map id so the existing renderer/queries (drawMap, floorAt, corpseAt) work
  game.floor = (m.floor || []).map(v => ({ map: game.mapId, id: v.id, n: v.n, tx: v.tx, ty: v.ty }));
  const openCorpse = game.corpseOpen;
  game.corpses = (m.corpses || []).map(v => ({
    map: game.mapId, tx: v.tx, ty: v.ty, items: v.items || {}, decayed: !!v.decayed,
  }));
  if (openCorpse) {
    const fresh = game.corpses.find(c => c.tx === openCorpse.tx && c.ty === openCorpse.ty && !c.decayed);
    game.corpseOpen = fresh && nearHero(fresh.tx, fresh.ty) ? fresh : null;
  }
}

// One render frame in netplay mode (called from the main loop instead of the
// single-player processInput/stepWorld path).
function netFrame(frameDt) {
  const net = game.net, h = game.hero;
  if (game.login) { updateLoginScreen(); drawLoginScreen(); return; } // not in the world yet
  let uiCaptured = false;
  const hadBlockingUi = !!(game.death || game.mapOpen || game.menu || game.shop || game.invFocus || game.itemPopup || game.chatInput || game.trade);

  // 1) input -> intents. The menu and inventory panels reuse the single-player
  //    UI code: their pushIntent() calls forward to the server (sim.js pushIntent).
  if (game.death) {
    updateDeathPopup();
    uiCaptured = true;
  } else if (game.chatInput) {
    updateChatInput(); // typing a chat line / slash command captures the keyboard
    uiCaptured = true;
  } else if (game.trade) {
    updateTradeWindow(); // the trade window owns clicks while it's open
    uiCaptured = true;
  } else if (typeof toggleChatWindow === 'function' && keyTapped(CHAT_TOGGLE_KEYS)) {
    toggleChatWindow();
    uiCaptured = true;
  } else if (handleWindowShortcuts()) {
    uiCaptured = true;
  } else if (keyTapped(MAP_KEYS)) {
    toggleMapWindow();
    uiCaptured = true;
  } else if (game.mapOpen) {
    updateMapWindow();
    uiCaptured = true;
  } else if (game.menu) {
    uiCaptured = true;
    updateMenu(frameDt); // navigate; spend attrs / reassign skills -> server
  } else if (game.shop) {
    uiCaptured = true;
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
    if (game.corpseOpen && (game.corpseOpen.map !== game.mapId ||
      game.corpseOpen.decayed || !nearHero(game.corpseOpen.tx, game.corpseOpen.ty))) game.corpseOpen = null;
    if (game.corpseOpen) {
      const co = game.corpseOpen;
      if (pressed(CANCEL)) { game.corpseOpen = null; sfx('Cancel1'); }
      if (pressed(CONFIRM)) { netSend(net, { t: 'takeCorpse', tx: co.tx, ty: co.ty, id: '*' }); queue = []; }
      clicks = clicks.filter(cl => {
        if (cl.b !== 0 || !inCorpseWin(cl)) return true;
        const ids = Object.keys(co.items);
        const i = corpseCellAt(cl.x, cl.y);
        if (cl.dbl && i >= 0 && i < ids.length) netSend(net, { t: 'takeCorpse', tx: co.tx, ty: co.ty, id: ids[i] });
        return false;
      });
    }
    if (game.invOpen && !game.itemPopup) updateInvPanel(); // mouse drag/click -> item intents
  }

  // movement is blocked while a panel owns the keyboard
  const captured = uiCaptured || hadBlockingUi || game.death || game.mapOpen || game.menu || game.shop ||
    game.invFocus || game.itemPopup || game.chatInput || game.trade;
  const dir = captured ? '' : (dirHeld() || '');
  if (dir !== net.lastDir) {
    net.lastDir = dir;
    net.seq++;
    netSend(net, { t: 'move', seq: net.seq, dir });
  }

  if (captured) {
    if (game.invFocus && keyTapped(MENU_KEYS)) { game.invFocus = null; openRootMenu(); }
    else if (game.invFocus && pressed(CANCEL)) { game.invFocus = null; sfx('Cancel1'); }
    else if (game.invFocus) updateInvKeys(); // arrows/Enter/Q drive the focused panel
  } else {
    updateSocialPrompt(); // Accept/Decline an incoming party invite or trade request
    if (pressed(['Enter'])) openChat();
    if (pressed([' ', 'z', 'Z'])) netInteract();
    if (pressed(['Tab'])) netSend(net, { t: 'cycleLock' });
    if (pressed(['f', 'F'])) netSend(net, { t: 'toggleFollow' }); // toggle Follow on the lock
    for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) { // cast hotbar skill
      const sk = h.slots && h.slots[i];
      const skill = sk && SKILLS[sk];
      if (!skill || h.mp < skill.mp || (sk !== 'heal' && !liveEnemyLock())) { sfx('Buzzer1'); continue; }
      netSend(net, { t: 'cast', slot: i });
      // optimistic local effect; damage and MP spending remain server-side
      if (sk === 'spin') { game.atkCool = 1.3 / stats().aspd; game.slashFx = { t: 0, spin: true, dur: 0.3 }; sfx('Sword1'); }
      else if (sk === 'heal') { game.atkCool = 0.4; game.healFx = 0.5; sfx('Recovery1'); }
      else if (sk === 'fire') { game.atkCool = 0.4; sfx('Flame1'); }
      else if (sk === 'bolt') { game.atkCool = 0.5; sfx('Thunder4'); }
    }
    const cam = camPos();
    for (const c of clicks) {
      if (game.invOpen && inPanel(c)) continue; // the panel owns its own clicks
      if (game.corpseOpen && inCorpseWin(c)) continue;
      const wxp = c.x + cam.x, wyp = c.y + cam.y;
      const wx = Math.floor(wxp / TS), wy = Math.floor(wyp / TS);
      if (c.b === 2) { // right-click: open your corpse if next to it, else lock a target
        const shopNpc = shopNpcAtPoint(wxp, wyp);
        const co = corpseAt(wx, wy);
        if (shopNpc && nearHero(shopNpc.tx, shopNpc.ty)) openShopChoice(shopForNpc(shopNpc));
        else if (co && !co.decayed && nearHero(wx, wy)) { game.corpseOpen = co; sfx('Decision1'); }
        else netSend(net, { t: 'lockAt', x: c.x + cam.x, y: c.y + cam.y });
      } else if (c.b === 0 && c.alt) { // Alt+left-click: lock the enemy AND follow it
        netSend(net, { t: 'followAt', x: c.x + cam.x, y: c.y + cam.y });
        const en = enemyAtPoint(c.x + cam.x, c.y + cam.y);
        if (en) { game.lock = en; game.follow = true; game.path = null; sfx('Decision1'); }
      } else if (c.b === 0 && !game.invDrag) {
        const co = corpseAt(wx, wy);
        if (co && !co.decayed && nearHero(wx, wy) && c.dbl) {
          game.corpseOpen = co; sfx('Decision1');
        } else if (floorAt(wx, wy).length && nearHero(wx, wy)) {
          if (c.dbl) netSend(net, { t: 'takeLoot', tx: wx, ty: wy }); // double-click floor loot in reach
          else game.lootDrag = { tx: wx, ty: wy };
        } else {
          netSend(net, { t: 'moveTo', tx: wx, ty: wy });
          game.follow = false;
          startPathTo(wx, wy);
        }
      }
    }
    for (const r of releases) { // floor loot dragged into the backpack window
      if (r.b !== 0 || !game.lootDrag) continue;
      const d = game.lootDrag;
      if (inPanel(r) && nearHero(d.tx, d.ty)) netSend(net, { t: 'takeLoot', tx: d.tx, ty: d.ty });
      game.lootDrag = null;
    }
    if (game.lootDrag && !mouse.down) game.lootDrag = null;
  }

  // 2) predict our own hero at the fixed 20 Hz tick, using the server's rules.
  //    Keep game.follow/game.lock (set from the snapshot) so the chase is
  //    predicted locally AND the blue follow marker renders.
  game.moveDir = dir || null;
  if (dir) game.path = null;
  net.acc += frameDt;
  let ticks = 0;
  while (net.acc >= FIXED && ticks < 5) { snapshotPrev(); stepHero(FIXED); net.acc -= FIXED; ticks++; }
  if (ticks === 5) net.acc = 0;
  predictNetMeleeFx();

  // 3) ease remote players and enemies toward their snapshot positions
  const k = Math.min(1, frameDt * 14);
  for (const p of game.players) { p.px += (p.tpx - p.px) * k; p.py += (p.tpy - p.py) * k; }
  for (const e of game.enemies) { e.px += (e.tpx - e.px) * k; e.py += (e.tpy - e.py) * k; }

  // 3.5) advance the client-only visual timers advanceWorld() would normally run
  for (const p of game.pops) p.t += frameDt;
  game.pops = game.pops.filter(p => p.t < 0.8);
  game.iframes = Math.max(0, game.iframes - frameDt);
  game.atkCool = Math.max(0, game.atkCool - frameDt);
  game.healFx = Math.max(0, game.healFx - frameDt);
  h.combatLogoutT = Math.max(0, (h.combatLogoutT || 0) - frameDt);
  if (game.slashFx && (game.slashFx.t += frameDt) >= (game.slashFx.dur || 0.18)) game.slashFx = null;
  for (const e of game.enemies) { e.flash = Math.max(0, e.flash - frameDt); e.hurtT += frameDt; }
  faceFollowTargetIfInReach();

  // 4) draw the world (hero interpolated by the leftover accumulator)
  const a = Math.max(0, Math.min(1, net.acc / FIXED));
  applyInterp(a);
  drawMap();
  clearInterp();
  drawNetSocial(); // chat feed, party frames, name tags, trade window, prompts
}

function predictNetMeleeFx() {
  const h = game.hero, en = game.lock;
  if (!en || h.dead || game.death || game.atkCool > 0 || en.dead || en.dying > 0) return;
  const dir = faceToward(en);
  if (!slashReaches(dir, en)) return;
  game.atkCool = 1.0 / stats().aspd;
  beginMeleeFx(dir);
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
  if (shopForNpc(npc)) { openShopChoice(shopForNpc(npc)); return true; }
  return false;
}

// tiny connection/roster banner so the demo is legible
function drawNetOverlay() {
  const net = game.net;
  const online = 1 + game.players.length;
  drawWindow(W / 2 - 70, 4, 140, 24);
  text(`ONLINE  ${net.id || '?'}  (${online} here)`, W / 2 - 60, 12, net.connected ? '#9f9' : '#f76');
}
