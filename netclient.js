'use strict';
// Server client for the Go authoritative game server.
// By default it connects to ws://<host>/ws; ?net=ws://host:port/ws overrides it.
//
// The client sends only its desired direction (an intent) and never a position.
// It PREDICTS its own hero locally with the very same movement rules the server
// runs (sim.js stepHero — world.go's stepPlayer is its port), so walking feels
// instant, and gently reconciles to the server's authoritative position when the
// two diverge. Other players are INTERPOLATED toward the latest snapshot. Enemies
// and combat stay out of Phase 1 (the server is movement-only for now).

const CHARACTER_CLASSES = ['Knight', 'Lancer', 'Wizard', 'Archer', 'Vampire', 'Holy'];

function netStart(url) {
  const net = {
    ws: null, url, id: null, seq: 0, ack: 0, lastDir: '',
    acc: 0, byId: {}, eById: {}, connected: false, status: 'connecting…',
    characters: [], ping: null, pingPending: false, pingNext: 0, pingSentAt: 0,
  };
  game.net = net;
  game.players = [];
  game.enemies = [];
  game.invOpen = false; // hidden by default; press I to open (bag comes from the server)
  game.logOpen = false;
  if (game.netOverlayOpen === undefined) game.netOverlayOpen = true;
  game.menu = null;
  game.scene = 'map';
  game.login = { user: '', pass: '', field: 'user', error: '', busy: false }; // login screen until welcome
  game.charSelect = null;
  // social (Phase 6)
  game.chat = []; game.chatOpen = true; game.chatInput = null; game.party = null; game.trade = null;
  game.socialPrompt = null; game.youPvp = false; game.pvpTarget = null; game.followPlayer = null;
  game.followEngaged = false;

  const ws = new WebSocket(url);
  net.ws = ws;
  ws.onopen = () => { net.connected = true; net.status = 'connected'; };
  ws.onclose = () => { 
    net.connected = false; net.status = 'disconnected'; 
    if (game.login) { game.login.error = 'disconnected'; game.login.busy = false; }
    if (game.charSelect) { game.charSelect.error = 'disconnected'; }
  };
  ws.onerror = () => { 
    net.status = 'connection error'; 
    if (game.login) { game.login.error = 'connection error'; game.login.busy = false; }
    if (game.charSelect) { game.charSelect.error = 'connection error'; }
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      net.id = m.id;
      game.isAdmin = !!m.admin;
      net.characters = m.characters || net.characters || [];
      game.hero.name = m.name || m.id;
      game.hero.class = m.class || '';
      game.mapId = m.map;
      snapHero(m); // start at the server-assigned spawn
      game.login = null; // account is authenticated
      if (m.needChar) {
        openCharacterScreen(m);
      } else {
        game.charSelect = null;
        reportView();
      }
    } else if (m.t === 'loginError') {
      if (game.login) { game.login.error = m.msg; game.login.busy = false; }
    } else if (m.t === 'characters') {
      net.characters = m.characters || [];
      updateCharacterRoster(m);
    } else if (m.t === 'snap') {
      net.ack = m.ack;
      onSnapshot(m);
    } else if (m.t === 'chat') {
      if (m.chat) for (const c of m.chat) pushChatLine(c);
    } else if (m.t === 'pong') {
      net.ping = Math.max(0, Math.round(performance.now() - (m.ts || performance.now())));
      net.pingPending = false;
    }
  };
}

function reportView() {
  netSend(game.net, { t: 'view', vw: Math.ceil(W / TS / 2) + 6, vh: Math.ceil(H / TS / 2) + 6 });
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
    else if (k === 'Escape') { L.user = ''; L.pass = ''; L.error = ''; sfx('Cancel1'); }
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
  text('Account', b.user.x, b.user.y - 11, '#bcd');
  drawLoginField(b.user, L.user, L.field === 'user');
  text('Password', b.pass.x, b.pass.y - 11, '#bcd');
  drawLoginField(b.pass, '*'.repeat(L.pass.length), L.field === 'pass');
  drawWindow(b.btn.x, b.btn.y, b.btn.w, b.btn.h);
  text(L.busy ? '...' : 'Login', b.btn.x + b.btn.w / 2 - (L.busy ? 6 : 14), b.btn.y + 5);
  text(L.error || 'New account? Choose a login name.', b.x + 14, b.y + b.h - 14, L.error ? '#f76' : '#9cf');
}

// ---- character creation / selection ---------------------------------------
function openCharacterScreen(m) {
  const roster = (m.characters || (game.net && game.net.characters) || []).slice();
  const classes = (m.classes && m.classes.length ? m.classes : CHARACTER_CLASSES).slice();
  const cls = m.class && classes.includes(m.class) ? m.class : classes[0];
  let selected = roster.findIndex(ch => ch && ch.name === (m.selected || m.name));
  if (selected < 0) selected = roster.length ? 0 : -1;
  game.charSelect = {
    mode: roster.length ? 'select' : 'create',
    characters: roster,
    selected,
    scroll: Math.max(0, selected - 3),
    name: '',
    class: cls,
    classes,
    classCursor: Math.max(0, classes.indexOf(cls)),
    field: roster.length ? 'list' : 'name',
    error: m.error || '',
  };
}

function updateCharacterRoster(m) {
  if (!game.charSelect) {
    openCharacterScreen(m);
    return;
  }
  const s = game.charSelect;
  s.characters = (m.characters || []).slice();
  s.classes = (m.classes && m.classes.length ? m.classes : s.classes || CHARACTER_CLASSES).slice();
  const selectedName = m.selected || (s.characters[s.selected] && s.characters[s.selected].name);
  let selected = s.characters.findIndex(ch => ch && ch.name === selectedName);
  if (selected < 0) selected = s.characters.length ? 0 : -1;
  s.selected = selected;
  s.scroll = Math.max(0, Math.min(s.scroll || 0, Math.max(0, s.characters.length - charBox().visible)));
  s.mode = s.mode === 'create' && !m.selected ? 'create' : (s.characters.length ? 'select' : 'create');
  s.field = s.mode === 'create' ? 'name' : 'list';
  s.error = m.error || '';
}

function charBox() {
  const w = Math.min(372, W - 16), h = Math.min(256, H - 16);
  const x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  const listW = Math.min(138, Math.floor(w * 0.42));
  const detailX = x + listW + 24, detailW = w - listW - 38;
  const previewW = 58, previewH = 78;
  const rowH = 20, listH = h - 86;
  return {
    x, y, w, h,
    list: { x: x + 14, y: y + 36, w: listW, h: listH, rowH },
    visible: Math.max(1, Math.floor(listH / rowH)),
    detail: { x: detailX, y: y + 36, w: detailW, h: listH },
    name: { x: detailX, y: y + 58, w: detailW, h: 18 },
    classX: detailX, classY: y + 96, classW: detailW - previewW - 12, rowH: 14,
    preview: { x: detailX + detailW - previewW, y: y + 90, w: previewW, h: previewH },
    enter: { x: detailX, y: y + h - 32, w: 108, h: 20 },
    create: { x: detailX, y: y + h - 32, w: 82, h: 20 },
    newBtn: { x: x + 14, y: y + h - 32, w: 52, h: 20 },
    back: { x: detailX + 88, y: y + h - 32, w: 52, h: 20 },
    login: { x: x + w - 68, y: y + 10, w: 54, h: 18 },
  };
}

function selectedCharacter() {
  const s = game.charSelect;
  return s && s.selected >= 0 ? s.characters[s.selected] : null;
}

function createCharacter() {
  const s = game.charSelect;
  const name = (s.name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    s.error = 'Use 1-16 letters, digits, or _.';
    sfx('Buzzer1');
    return;
  }
  netSend(game.net, { t: 'createCharacter', name, class: s.class });
  s.error = 'Saving...';
  sfx('Decision1');
}

function enterCharacter() {
  const ch = selectedCharacter();
  if (!ch) {
    game.charSelect.error = 'Create or select a character.';
    sfx('Buzzer1');
    return;
  }
  netSend(game.net, { t: 'enterCharacter', name: ch.name });
  game.charSelect.error = 'Entering...';
  sfx('Decision1');
}

function returnToLoginScreen() {
  const url = game.net && game.net.url;
  const ws = game.net && game.net.ws;
  if (ws) {
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    ws.close();
  }
  if (url) netStart(url);
  else location.reload();
}

function updateCharacterScreen() {
  const s = game.charSelect, b = charBox();
  for (const c of clicks) {
    if (c.b !== 0) continue;
    if (hit(c, b.login.x, b.login.y, b.login.w, b.login.h)) {
      sfx('Cancel1');
      returnToLoginScreen();
      return;
    }
    if (s.mode === 'select') {
      for (let row = 0; row < b.visible; row++) {
        const i = s.scroll + row, y = b.list.y + row * b.list.rowH;
        if (i < s.characters.length && hit(c, b.list.x, y, b.list.w, b.list.rowH)) {
          s.selected = i; s.field = 'list'; s.error = ''; sfx('Cursor1');
          if (c.dbl) enterCharacter();
        }
      }
      if (hit(c, b.enter.x, b.enter.y, b.enter.w, b.enter.h)) enterCharacter();
      if (hit(c, b.newBtn.x, b.newBtn.y, b.newBtn.w, b.newBtn.h)) {
        s.mode = 'create'; s.field = 'name'; s.name = ''; s.error = ''; sfx('Decision1');
      }
    } else {
      if (hit(c, b.name.x, b.name.y, b.name.w, b.name.h)) { s.field = 'name'; sfx('Cursor1'); continue; }
      for (let i = 0; i < s.classes.length; i++) {
        const y = b.classY + i * b.rowH;
        if (hit(c, b.classX, y, b.classW, b.rowH)) {
          s.classCursor = i; s.class = s.classes[i]; s.field = 'class'; sfx('Cursor1');
        }
      }
      if (hit(c, b.create.x, b.create.y, b.create.w, b.create.h)) createCharacter();
      if (s.characters.length && hit(c, b.back.x, b.back.y, b.back.w, b.back.h)) {
        s.mode = 'select'; s.field = 'list'; s.error = ''; sfx('Cancel1');
      }
    }
  }
  for (const k of queue) {
    if (s.mode === 'select') {
      if (k === 'Enter') enterCharacter();
      else if (k === 'n' || k === 'N') { s.mode = 'create'; s.field = 'name'; s.name = ''; s.error = ''; sfx('Decision1'); }
      else if ((k === 'ArrowUp' || k === 'w') && s.characters.length) {
        s.selected = Math.max(0, s.selected - 1); s.scroll = Math.min(s.scroll, s.selected); sfx('Cursor1');
      } else if ((k === 'ArrowDown' || k === 's') && s.characters.length) {
        s.selected = Math.min(s.characters.length - 1, s.selected + 1);
        s.scroll = Math.max(s.scroll, s.selected - b.visible + 1); sfx('Cursor1');
      }
    } else {
      if (k === 'Escape' && s.characters.length) { s.mode = 'select'; s.field = 'list'; s.error = ''; sfx('Cancel1'); }
      else if (k === 'Tab') { s.field = s.field === 'name' ? 'class' : 'name'; sfx('Cursor1'); }
      else if (k === 'Enter') createCharacter();
      else if (s.field === 'name') {
        if (k === 'Backspace') s.name = s.name.slice(0, -1);
        else if (/^[A-Za-z0-9_]$/.test(k) && s.name.length < 16) { s.name += k; s.error = ''; }
      } else if (k === 'ArrowUp' || k === 'w') {
        s.classCursor = (s.classCursor + s.classes.length - 1) % s.classes.length; s.class = s.classes[s.classCursor]; sfx('Cursor1');
      } else if (k === 'ArrowDown' || k === 's') {
        s.classCursor = (s.classCursor + 1) % s.classes.length; s.class = s.classes[s.classCursor]; sfx('Cursor1');
      }
    }
  }
  queue = [];
}

function drawCharacterScreen() {
  const s = game.charSelect, b = charBox();
  if (img.title) ctx.drawImage(img.title, (W - 320) / 2, -20, 320, 240);
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
  drawWindow(b.x, b.y, b.w, b.h);
  text('Characters', b.x + 14, b.y + 12, '#ffe080');
  drawWindow(b.login.x, b.login.y, b.login.w, b.login.h);
  text('Logout', b.login.x + 11, b.login.y + 5);
  drawWindow(b.list.x, b.list.y, b.list.w, b.list.h);
  if (!s.characters.length) text('No characters', b.list.x + 10, b.list.y + 10, '#9ab');
  for (let row = 0; row < b.visible; row++) {
    const i = s.scroll + row, ch = s.characters[i];
    if (!ch) continue;
    const y = b.list.y + row * b.list.rowH;
    if (s.mode === 'select' && i === s.selected) drawCursor(b.list.x + 2, y + 1, b.list.w - 4, b.list.rowH - 2);
    text(ch.name, b.list.x + 8, y + 4, i === s.selected ? '#ffe080' : '#fff');
  }
  if (s.mode === 'select') {
    const ch = selectedCharacter();
    text(ch ? ch.name : 'Select a hero', b.detail.x, b.detail.y, '#ffe080');
    if (ch) {
      text(ch.class || 'No class', b.detail.x, b.detail.y + 18, '#bcd');
      text(`Lv ${ch.lv || 1}`, b.detail.x, b.detail.y + 34, '#fff');
      text(ch.map ? `Map ${ch.map}` : 'Map city', b.detail.x, b.detail.y + 50, '#9cf');
      text(`${ch.gold || 0} gold`, b.detail.x, b.detail.y + 66, '#ffd27a');
    }
    drawWindow(b.enter.x, b.enter.y, b.enter.w, b.enter.h);
    text('Enter World', b.enter.x + 12, b.enter.y + 6);
    drawWindow(b.newBtn.x, b.newBtn.y, b.newBtn.w, b.newBtn.h);
    text('New', b.newBtn.x + 16, b.newBtn.y + 6);
  } else {
    text('New Character', b.detail.x, b.detail.y, '#ffe080');
    text('Name', b.name.x, b.name.y - 11, '#bcd');
    drawLoginField(b.name, s.name, s.field === 'name');
    text('Class', b.classX, b.classY - 11, '#bcd');
    s.classes.forEach((cls, i) => {
      const y = b.classY + i * b.rowH;
      if (i === s.classCursor) drawCursor(b.classX - 2, y - 1, b.classW + 4, b.rowH);
      text(cls, b.classX + 8, y + 3, cls === s.class ? '#ffe080' : '#fff');
    });
    drawWindow(b.preview.x, b.preview.y, b.preview.w, b.preview.h);
    drawActor({ class: s.class, dir: 'down', moving: false, anim: 1 },
      b.preview.x + Math.floor(b.preview.w / 2), b.preview.y + 52);
    drawWindow(b.create.x, b.create.y, b.create.w, b.create.h);
    text('Create', b.create.x + 20, b.create.y + 6);
    if (s.characters.length) {
      drawWindow(b.back.x, b.back.y, b.back.w, b.back.h);
      text('Back', b.back.x + 16, b.back.y + 6);
    }
  }
  if (s.error) text(s.error, b.x + 14, b.y + b.h - 58, '#f76');
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
  } else {
    const pixelDrift = Math.hypot(you.px - h.px, you.py - h.py);
    const tileDrift = Math.abs(you.tx - h.tx) + Math.abs(you.ty - h.ty);
    if (pixelDrift > TS || tileDrift > 1) snapHero(you);
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
  h.name = you.name || h.name || net.id;
  game.isAdmin = !!you.admin;
  h.cheats = you.cheats || {};
  game.adminBans = game.isAdmin ? (m.banLists || { accounts: [], characters: [] }) : null;
  h.class = you.class || h.class || '';
  h.hair = you.hair || h.hair;
  h.cloth = you.cloth || h.cloth;
  h.skillPoints = you.skillPts || 0;
  h.skillLevels = you.skillLv || h.skillLevels || {};
  h.quests = you.quests || h.quests || {};
  ensureQuests(h);
  h.combatLogoutT = Math.max(0, you.combatLog || 0);
  h.dead = !!you.dead;
  if (h.dead) {
    if (!game.death || game.death.cause !== you.deathCause) {
      game.death = { cause: you.deathCause || 'unknown forces', cursor: 0 };
      game.menu = null; game.shop = null; game.itemPopup = null; game.corpseOpen = null;
    }
  } else if (game.death) game.death = null;
  if (you.slots) {
    h.slots = you.slots;
    normalizeHeroSlots(h);
  }
  h.bag = m.bag || {};          // authoritative inventory drives the panel
  h.equip = m.equip || {};
  h.points = m.points || 0;
  if (m.attr) h.attr = m.attr;  // character sheet (Attributes/Status screens)
  game.autoloot = !!m.autoloot;
  game.youPvp = !!you.pvp;
  if (m.log) for (const s of m.log) logMsg(s);
  if (m.chat) for (const c of m.chat) { pushChatLine(c); if (c.scope !== 'reward' && c.scope !== 'system') sfx('Cursor1'); }
  // party / trade windows come straight from the server
  game.party = m.party || null;
  const oldTrade = game.trade;
  game.trade = m.trade || null;
  if (game.trade && !oldTrade) {
    game.tradeGoldInputText = String(game.trade.you.gold || 0);
    game.tradeGoldFocused = false;
    game.tradeBagScroll = 0;
    game.tradeOfferScroll = 0;
    game.tradeTheirOfferScroll = 0;
    game.tradeDrag = null;
    game.tradePrompt = null;
  } else if (!game.trade && oldTrade) {
    game.tradeGoldFocused = false;
    game.tradeDrag = null;
    game.tradePrompt = null;
  } else if (game.trade) {
    if (!game.tradeGoldFocused) {
      game.tradeGoldInputText = String(game.trade.you.gold || 0);
    }
  }
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
      tx: v.tx, ty: v.ty,
      dir: v.dir, moving: v.moving, anim: v.anim, hp: v.hp, maxhp: v.maxhp,
    };
    else if (v.hp < p.hp - 0.01) {
      p.hurtT = 0;
      addPop('-' + Math.max(1, Math.round(p.hp - v.hp)), v.px + 8, v.py - 12, '#f76');
      if (game.pvpTarget === p && game.atkCool <= 0.15) {
        const dir = faceToward(p);
        if (Math.hypot(v.tx - you.tx, v.ty - you.ty) <= 2) {
          game.atkCool = 1.0 / stats().aspd;
          beginMeleeFx(dir);
        }
      }
    }
    p.tpx = v.px; p.tpy = v.py; p.dir = v.dir; p.moving = v.moving; p.anim = v.anim;
    if (v.tx !== undefined) p.tx = v.tx;
    if (v.ty !== undefined) p.ty = v.ty;
    p.hp = v.hp; p.maxhp = v.maxhp; p.name = v.name || v.id; p.class = v.class || '';
    p.hair = v.hair || p.hair; p.cloth = v.cloth || p.cloth;
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
      if (game.lock === e && game.atkCool <= 0.15) {
        const dir = faceToward(e);
        if (Math.hypot(v.tx - you.tx, v.ty - you.ty) <= 2) {
          game.atkCool = 1.0 / stats().aspd;
          beginMeleeFx(dir);
        }
      }
    }
    e.kind = v.kind; e.tx = v.tx; e.ty = v.ty; e.tpx = v.px; e.tpy = v.py;
    e.dir = v.dir; e.moving = v.moving; e.anim = v.anim; e.hp = v.hp; e.maxhp = v.maxhp; e.dying = v.dying;
  }
  for (const id in net.eById) if (!eSeen[id]) delete net.eById[id];
  game.enemies = Object.values(net.eById);
  game.lock = you.lock ? net.eById[you.lock] : null; // yellow lock marker
  game.pvpTarget = you.pvpTarget ? (net.byId[you.pvpTarget] || null) : null;
  game.followPlayer = you.followTarget ? (net.byId[you.followTarget] || null) : null;
  game.follow = !!you.follow;                          // blue follow marker
  game.followEngaged = game.follow;                    // after snap, assume engaged (initial bypass only at click)

  // fireballs and lightning are shared world entities; render them straight from
  // the server (boom < 0 means still flying, >= 0 means the impact burst)
  game.projectiles = (m.projectiles || []).map(v =>
    v.boom >= 0 ? { x: v.x, y: v.y, t: v.t, boom: v.boom } : { x: v.x, y: v.y, t: v.t });
  game.bolts = (m.bolts || []).map(v => ({ x: v.x, y: v.y, t: v.t }));

  // floor loot and corpses are shared world entities on the current map; tag them
  // with the map id so the existing renderer/queries (drawMap, floorAt, corpseAt) work
  game.floor = (m.floor || []).map(v => ({
    map: game.mapId,
    id: itemId(v),
    n: Math.max(1, Number(v.n ?? v.N ?? 1) || 1),
    tx: Number(v.tx ?? v.Tx),
    ty: Number(v.ty ?? v.Ty),
  })).filter(v => itemId(v.id) && Number.isFinite(v.tx) && Number.isFinite(v.ty));
  const openCorpse = game.corpseOpen;
  game.corpses = (m.corpses || []).map(v => normalizeCorpse({
    map: game.mapId, tx: v.tx, ty: v.ty, name: v.name || '',
    class: v.class || v.Class || '', hair: v.hair || v.Hair || '', cloth: v.cloth || v.Cloth || '',
    items: v.items || {}, decayed: !!v.decayed,
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
  updateNetPing(net);
  if (game.login) { updateLoginScreen(); drawLoginScreen(); return; } // not in the world yet
  if (game.charSelect) {
    updateCharacterScreen();
    if (game.charSelect) drawCharacterScreen();
    return;
  }
  let uiCaptured = false;
  const hadBlockingUi = !!(game.death || game.dialogue || game.mapOpen || game.menu || game.shop || game.invFocus || game.itemPopup ||
    game.dropPrompt || game.chatInput || game.trade || game.playerMenu);

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
  } else if (game.playerMenu) {
    updatePlayerMenu();
    uiCaptured = true;
  } else if (game.dropPrompt) {
    updateDropPrompt();
    uiCaptured = true;
  } else if (game.dialogue) {
    updateDialogue(frameDt);
    uiCaptured = true;
  } else if (handleHudToggleClicks()) {
    uiCaptured = true;
  } else if (!textInputActive() && typeof toggleChatWindow === 'function' && keyTapped(CHAT_TOGGLE_KEYS)) {
    toggleChatWindow();
    uiCaptured = true;
  } else if (handleWindowShortcuts()) {
    uiCaptured = true;
  } else if (!textInputActive() && keyTapped(MAP_KEYS)) {
    toggleMapWindow();
    uiCaptured = true;
  } else if (!textInputActive() && keyTapped(NET_OVERLAY_TOGGLE_KEYS)) {
    toggleNetOverlayWindow();
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
    const closedItemPopup = game.itemPopup && (pressed(CANCEL) || pressed(CONFIRM) || clicked(0));
    if (closedItemPopup) { game.itemPopup = null; sfx('Cancel1'); }
    updatePendingCorpseOpen();
    updatePendingFloorLoot((tx, ty) => netSend(net, { t: 'takeLoot', tx, ty }));
    if (game.corpseOpen && (game.corpseOpen.map !== game.mapId ||
      game.corpseOpen.decayed || !nearHero(game.corpseOpen.tx, game.corpseOpen.ty))) {
      game.corpseOpen = null;
      game.corpseDrag = null;
    }
    if (game.corpseOpen) updateCorpseWinControls((co, id) =>
      netSend(net, { t: 'takeCorpse', tx: co.tx, ty: co.ty, id }));
    if (!closedItemPopup && !game.corpseOpen && game.invOpen && pressed(CANCEL)) {
      closeInventory();
      uiCaptured = true;
    } else if (game.invOpen && !game.itemPopup) updateInvPanel(); // mouse drag/click -> item intents
  }
  if (game.death || game.dialogue || game.mapOpen || game.menu || game.shop || game.dropPrompt || game.chatInput || game.trade || game.playerMenu) {
    game.worldDrag = null;
  } else {
    if (finishWorldDragFromReleases(obj => netSend(net, obj))) uiCaptured = true;
    if (game.worldDrag) uiCaptured = true;
  }

  // movement is blocked while a panel owns the keyboard
  const captured = uiCaptured || hadBlockingUi || game.death || game.dialogue || game.mapOpen || game.menu || game.shop ||
    game.invFocus || game.itemPopup || game.dropPrompt || game.chatInput || game.trade || game.playerMenu || game.worldDrag;
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
    for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) { // cast hotbar skill/item
      const sk = h.slots && h.slots[i];
      const skill = sk && SKILLS[sk];
      const target = liveEnemyLock() || livePvpTarget();
      if (isHotbarItem(sk)) {
        if (!((h.bag && h.bag[sk]) > 0) || h.hp >= h.maxhp) { sfx('Buzzer1'); continue; }
        netSend(net, { t: 'cast', slot: i });
        game.healFx = 0.5;
        sfx('Recovery1');
        continue;
      }
      if (!skill || !skillAllowedForClass(sk, h) || !skillMpAvailable(sk, h) || (skillRequiresTarget(sk) && !target)) { sfx('Buzzer1'); continue; }
      netSend(net, { t: 'cast', slot: i });
      // optimistic local effect; damage and MP spending remain server-side
      if (sk === 'spin') { game.atkCool = 1.3 / stats().aspd; game.slashFx = { t: 0, spin: true, dur: 0.3 }; sfx('Sword1'); }
      else if (sk === 'heal') { game.atkCool = 0.4; game.healFx = 0.5; sfx('Recovery1'); }
      else if (sk === 'fire') { game.atkCool = 0.4; sfx('Flame1'); }
      else if (sk === 'bolt') { game.atkCool = 0.5; sfx('Thunder4'); }
      else if (sk === 'nova') { game.atkCool = 0.8; addNovaBolts(h); sfx('Thunder4'); }
    }
    const cam = camPos();
    for (const c of clicks) {
      if (game.invOpen && inPanel(c)) continue; // the panel owns its own clicks
      if (game.corpseOpen && inCorpseWin(c)) continue;
      if (game.worldDrag) continue;
      const wxp = c.x + cam.x, wyp = c.y + cam.y;
      const wx = Math.floor(wxp / TS), wy = Math.floor(wyp / TS);
      if (c.b === 2) { // right-click: open context/interact targets, not lock-on
        const shopNpc = shopNpcAtPoint(wxp, wyp);
        const co = corpseAt(wx, wy);
        const floor = floorAt(wx, wy);
        const pl = playerAtPoint(wxp, wyp);
        if (shopNpc) { setCorpseWalkTarget(null); setFloorLootTarget(null, null); openShopChoice(shopForNpc(shopNpc), c.x, c.y); }
        else if (co && !co.decayed) requestCorpseOpen(co, (tx, ty) => {
          netSend(net, { t: 'moveTo', tx, ty });
          game.follow = false;
          game.followEngaged = false;
        });
        else if (floor.length) requestFloorLoot(wx, wy, (tx, ty) => {
          netSend(net, { t: 'moveTo', tx, ty });
          game.follow = false;
          game.followEngaged = false;
        }, (tx, ty) => netSend(net, { t: 'takeLoot', tx, ty }));
        else if (pl) { setCorpseWalkTarget(null); setFloorLootTarget(null, null); openPlayerMenu(pl, c.x, c.y); }
        else { setCorpseWalkTarget(null); setFloorLootTarget(null, null); }
      } else if (c.b === 0 && c.ctrl && c.alt) { // Ctrl+Alt + left-click: activate both follow and attack (lock + follow)
        setCorpseWalkTarget(null); setFloorLootTarget(null, null);
        const en = enemyAtPoint(c.x + cam.x, c.y + cam.y);
        const pl = playerAtPoint(c.x + cam.x, c.y + cam.y);
        if (pl) {
          netSend(net, { t: 'lockPlayerAt', x: c.x + cam.x, y: c.y + cam.y });
          netSend(net, { t: 'toggleFollow' }); // force follow on after lock
          game.pvpTarget = pl; game.followPlayer = null; game.lock = null; game.follow = true; game.followEngaged = false; game.path = null; sfx('Decision1');
        }
        else if (en) {
          netSend(net, { t: 'followAt', x: c.x + cam.x, y: c.y + cam.y });
          game.lock = en; game.pvpTarget = null; game.followPlayer = null; game.follow = true; game.followEngaged = false; game.path = null; sfx('Decision1');
        }
      } else if (c.b === 0 && c.ctrl) { // Ctrl+left-click: toggle lock for attack (re-click same to release/unlock)
        setCorpseWalkTarget(null); setFloorLootTarget(null, null);
        const en = enemyAtPoint(c.x + cam.x, c.y + cam.y);
        const pl = playerAtPoint(c.x + cam.x, c.y + cam.y);
        if (pl) {
          if (game.pvpTarget === pl) {
            netSend(net, { t: 'unlock' });
            game.pvpTarget = null; game.followPlayer = null; game.lock = null; game.follow = false; game.followEngaged = false; sfx('Cancel1');
          } else {
            netSend(net, { t: 'lockPlayerAt', x: c.x + cam.x, y: c.y + cam.y });
            game.pvpTarget = pl; game.followPlayer = null; game.lock = null; game.follow = false; game.followEngaged = false; sfx('Cursor1');
          }
        }
        else if (en) {
          if (game.lock === en) {
            netSend(net, { t: 'unlock' });
            game.lock = null; game.pvpTarget = null; game.followPlayer = null; game.follow = false; game.followEngaged = false; sfx('Cancel1');
          } else {
            netSend(net, { t: 'lockAt', x: c.x + cam.x, y: c.y + cam.y });
            game.lock = en; game.pvpTarget = null; game.followPlayer = null; game.follow = false; game.followEngaged = false; sfx('Cursor1');
          }
        }
      } else if (c.b === 0 && c.alt) { // Alt + left-click: toggle "Follow mode" on the enemy/player (pure follow for players)
        setCorpseWalkTarget(null); setFloorLootTarget(null, null);
        const en = enemyAtPoint(c.x + cam.x, c.y + cam.y);
        const pl = playerAtPoint(c.x + cam.x, c.y + cam.y);
        if (pl) {
          const isCurrentFollowTarget = (game.followPlayer === pl) || (game.pvpTarget === pl);
          if (isCurrentFollowTarget) {
            netSend(net, { t: 'toggleFollow' });
            game.follow = !game.follow;
            game.followEngaged = false;
            sfx(game.follow ? 'Decision1' : 'Cancel1');
          } else {
            netSend(net, { t: 'followAt', x: c.x + cam.x, y: c.y + cam.y });
            game.followPlayer = pl; game.pvpTarget = null; game.lock = null; game.follow = true; game.followEngaged = false; game.path = null; sfx('Decision1');
          }
        }
        else if (en) {
          if (game.lock === en) {
            netSend(net, { t: 'toggleFollow' });
            game.follow = !game.follow;
            game.followEngaged = false;
            sfx(game.follow ? 'Decision1' : 'Cancel1');
          } else {
            netSend(net, { t: 'followAt', x: c.x + cam.x, y: c.y + cam.y });
            game.lock = en; game.pvpTarget = null; game.followPlayer = null; game.follow = true; game.followEngaged = false; game.path = null; sfx('Decision1');
          }
        }
      } else if (c.b === 0 && !game.invDrag) {
        if (startWorldDragAt(c)) continue;
        const co = corpseAt(wx, wy);
        if (co && !co.decayed && nearHero(wx, wy) && c.dbl) {
          setCorpseWalkTarget(null); setFloorLootTarget(null, null);
          game.corpseOpen = co; sfx('Decision1');
        } else {
          setCorpseWalkTarget(null); setFloorLootTarget(null, null);
          netSend(net, { t: 'moveTo', tx: wx, ty: wy });
          game.follow = false;
          game.followEngaged = false;
          startPathTo(wx, wy);
        }
      }
    }
    finishWorldDragFromReleases(obj => netSend(net, obj));
    game.lootDrag = null;
  }

  // 2) predict our own hero at the fixed 20 Hz tick, using the server's rules.
  //    Keep game.follow/game.lock (set from the snapshot) so the chase is
  //    predicted locally AND the blue follow marker renders.
  game.moveDir = dir || null;
  if (dir) {
    game.path = null;
    setCorpseWalkTarget(null);
    setFloorLootTarget(null, null);
  }
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
  drawMap(false);
  clearInterp();
  drawNetSocial(); // chat feed, party frames, name tags, trade window, prompts
  drawNetOverlay();
  if (game.menu) drawMenu();
}

function predictNetMeleeFx() {
  const h = game.hero, target = game.lock || game.pvpTarget;
  if (!target || h.dead || game.death || game.atkCool > 0 || target.dead || target.dying > 0) return;
  const dir = faceToward(target);
  if (!slashReaches(dir, target)) return;
  game.atkCool = 1.0 / stats().aspd;
  beginMeleeFx(dir);
}

function playerAtPoint(wx, wy) {
  return (game.players || []).find(p => !p.dead && spriteHit(wx, wy, p.px, p.py)) || null;
}

function livePvpTarget() {
  const t = game.pvpTarget;
  return t && !t.dead ? t : null;
}

function netSend(net, obj) {
  if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(obj));
}

function updateNetPing(net) {
  if (!net || !net.connected) return;
  const now = performance.now();
  if (net.pingPending && now - net.pingSentAt > 5000) {
    net.pingPending = false;
    net.ping = null;
  }
  if (net.pingPending || now < (net.pingNext || 0)) return;
  net.pingPending = true;
  net.pingSentAt = now;
  net.pingNext = now + 2000;
  netSend(net, { t: 'ping', ts: now });
}

// Facing a shopkeeper opens their shop locally (the shop UI is cosmetic; the
// server validates each purchase). Returns true if it handled the interaction.
function netInteract() {
  const h = game.hero, d = DIRV[h.dir];
  const fx = h.tx + d[0], fy = h.ty + d[1];
  const npc = npcs.find(n => n.map === game.mapId && n.tx === fx && n.ty === fy);
  if (shopForNpc(npc)) { openShopChoice(shopForNpc(npc)); return true; }
  if (npc && npc.id === 'elder') {
    const pages = elderQuestPages(h);
    netSend(game.net, { t: 'talkNpc', id: 'elder' });
    say(pages);
    sfx('Decision1');
    return true;
  }
  return false;
}

// tiny connection/roster banner so the demo is legible
function drawNetOverlay() {
  if (!game.netOverlayOpen) return;
  const net = game.net;
  const online = 1 + game.players.length;
  const ping = net.ping == null ? '...' : `${net.ping}ms`;
  drawWindow(W / 2 - 70, 4, 140, 34);
  text(`ONLINE  ${net.id || '?'}  (${online} here)`, W / 2 - 60, 12, net.connected ? '#9f9' : '#f76');
  text(`PING  ${ping}`, W / 2 - 60, 24, net.ping != null && net.ping < 180 ? '#bcd' : '#ffe080');
}

function toggleNetOverlayWindow() {
  game.netOverlayOpen = !game.netOverlayOpen;
  sfx(game.netOverlayOpen ? 'Decision1' : 'Cancel1');
}
