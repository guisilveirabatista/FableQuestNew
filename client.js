'use strict';
// Fable Quest — browser CLIENT (Phase 0 split of game.js): canvas + camera,
// input capture, rendering, UI panels/menus, localStorage persistence, and the
// main loop. It reads world state from sim.js to draw it, and turns raw input
// into intents (pushIntent) that the sim resolves. Loaded after sim.js, so it
// shares the global scope where sim's constants and functions live.

const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');
cv.tabIndex = 0;
cv.style.outline = 'none';

// pick the smallest integer scale that keeps the viewport within the map
const SCALE = Math.max(1, Math.ceil(Math.max(
  window.innerWidth / (MW * TS), window.innerHeight / (MH * TS))));
cv.width = Math.min(MW * TS, Math.ceil(window.innerWidth / SCALE));
cv.height = Math.min(MH * TS, Math.ceil(window.innerHeight / SCALE));
const W = cv.width, H = cv.height;
ctx.imageSmoothingEnabled = false;

function camPos() { // camera centered on the hero, clamped to the map
  const h = game.hero;
  return {
    x: Math.max(0, Math.min(MW * TS - W, Math.round(h.px) + 8 - Math.floor(W / 2))),
    y: Math.max(0, Math.min(MH * TS - H, Math.round(h.py) + 8 - Math.floor(H / 2))),
  };
}

// ---------------------------------------------------------------- assets
const IMAGES = ['chipset', 'hero', 'npc', 'custom', 'knight',
  'general1', 'general2', 'protagonist1', 'protagonist2', 'protagonist4',
  'system', 'title',
  'monsters', 'slash', 'flame', 'punch', 'skeleton',
  'i_potion', 'i_bread', 'i_meat', 'i_sword1', 'i_sword2', 'i_sword3',
  'i_hat', 'i_helm', 'i_shield', 'i_armor', 'i_legs', 'i_boots', 'i_ring', 'i_amulet'];
const img = {};
const CLASS_SPRITES = {
  Knight: { sheet: 'protagonist1', cx: 2, cy: 0 },
  Lancer: { sheet: 'protagonist4', cx: 2, cy: 0 },
  Wizard: { sheet: 'protagonist1', cx: 0, cy: 1 },
  Archer: { sheet: 'protagonist2', cx: 2, cy: 1 },
  Vampire: { sheet: 'protagonist4', cx: 3, cy: 0 },
  Holy: { sheet: 'general2', cx: 2, cy: 1 },
};
let audioOk = false;
function sfx(name) {
  if (!audioOk) return;
  const a = new Audio('assets/' + name + '.wav');
  a.volume = 0.5;
  a.play().catch(() => {});
}

// chipset source rects
const T = {
  grass: [304, 48], dirt: [352, 48], water: [0, 64],
  bush: [288, 144], rock: [432, 16], well: [432, 32], sign: [416, 48],
  palm: [320, 144], cactus: [304, 144],
};
const TREE = [288, 160, 32, 32]; // big tree, 2x2 tiles, base row at bottom

// ---------------------------------------------------------------- input
const held = {};
const heldInput = {};
let queue = [];
let keyTap = new Set();
const CONFIRM = ['Enter', ' ', 'z', 'Z'];
const CANCEL = ['Escape'];
var MENU_KEYS = ['x'];
var MAP_KEYS = ['m'];
var CHAT_TOGGLE_KEYS = ['c'];
var LOG_TOGGLE_KEYS = ['l'];
var NET_OVERLAY_TOGGLE_KEYS = ['n'];
var WINDOW_SHORTCUTS = [
  { keys: ['p'], menu: 'Status' },
  { keys: ['y'], menu: 'Quest' },
];
const KEY_DIR = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down',
  ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
const CAPTURE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab',
  ...MENU_KEYS, ...MAP_KEYS, ...CHAT_TOGGLE_KEYS, ...LOG_TOGGLE_KEYS, ...NET_OVERLAY_TOGGLE_KEYS, ...WINDOW_SHORTCUTS.flatMap(sc => sc.keys)];
let dirOrder = []; // held direction keys, most-recently-pressed last
function normKey(k) { return k && k.length === 1 ? k.toLowerCase() : k; }
function eventInputIds(e) {
  const ids = [normKey(e.key)];
  if (/^Key[A-Z]$/.test(e.code || '')) ids.push(e.code.slice(3).toLowerCase());
  else if (e.code === 'Space') ids.push(' ');
  else if (e.code && e.code.startsWith('Arrow')) ids.push(e.code);
  return [...new Set(ids.filter(Boolean))];
}
function eventHoldId(e) { return e.code || e.key; }
function focusGame() { if (document.activeElement !== cv) cv.focus({ preventScroll: true }); }
function clearKeys() {
  for (const k in held) held[k] = false;
  for (const k in heldInput) heldInput[k] = false;
  dirOrder = [];
}
function hasInputKey(ids, keys) { return keys.some(k => ids.includes(normKey(k))); }
function domTextInputActive() {
  const el = document.activeElement;
  if (!el || el === cv) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}
function gameTextInputActive() {
  if (typeof game === 'undefined') return false;
  if (game.login || game.chatInput) return true;
  if (game.charSelect && game.charSelect.mode === 'create' && game.charSelect.field === 'name') return true;
  if (game.shop && game.shop.edit) return true;
  if (game.trade && game.tradeGoldFocused) return true;
  if (game.menu && game.menu.mode === 'admin' && game.menu.admin && game.menu.admin.section !== 'root') return true;
  return false;
}
function textInputActive() { return domTextInputActive() || gameTextInputActive(); }
function tryImmediateShortcut(ids) {
  if (typeof game === 'undefined' || game.scene !== 'map' || textInputActive() || game.charSelect) return false;
  if (typeof toggleChatWindow === 'function' && game.net && hasInputKey(ids, CHAT_TOGGLE_KEYS)) {
    toggleChatWindow();
    return true;
  }
  if (game.trade) return false;
  if (hasInputKey(ids, MAP_KEYS) && !game.death) {
    toggleMapWindow();
    return true;
  }
  if (hasInputKey(ids, LOG_TOGGLE_KEYS) && !game.death) {
    toggleLogWindow();
    return true;
  }
  if (menuShortcutBlocked()) return false;
  if (hasInputKey(ids, MENU_KEYS)) {
    if (game.menu) { game.menu = null; sfx('Cancel1'); }
    else openRootMenu();
    return true;
  }
  for (const sc of WINDOW_SHORTCUTS) {
    if (hasInputKey(ids, sc.keys)) {
      openMenuSection(sc.menu);
      return true;
    }
  }
  return false;
}
addEventListener('keydown', e => {
  const ids = eventInputIds(e);
  const modified = e.altKey || e.ctrlKey || e.metaKey;
  const domInput = domTextInputActive();
  if (!modified && !domInput && ids.some(k => CAPTURE_KEYS.includes(k))) e.preventDefault();
  if (modified) return;
  if (domInput) return;
  focusGame();
  const holdId = eventHoldId(e);
  const fresh = !held[holdId];
  if (fresh && tryImmediateShortcut(ids)) {
    held[holdId] = true;
    ids.forEach(k => { heldInput[k] = true; });
    return;
  }
  if (!held[holdId]) {
    queue.push(e.key);
    ids.forEach(k => keyTap.add(k));
  }
  held[holdId] = true;
  ids.forEach(k => { heldInput[k] = true; });
  const d = ids.map(k => KEY_DIR[k]).find(Boolean); // newest direction takes over; releasing it falls back
  if (d && !dirOrder.includes(d)) dirOrder.push(d);
  if (!audioOk) { audioOk = true; syncMusic(); }
});
addEventListener('keyup', e => {
  const ids = eventInputIds(e);
  held[eventHoldId(e)] = false;
  ids.forEach(k => { heldInput[k] = false; });
  const d = ids.map(k => KEY_DIR[k]).find(Boolean);
  // drop the direction only if no other still-held key maps to it (w vs Arrow)
  if (d && !Object.keys(KEY_DIR).some(k => KEY_DIR[k] === d && heldInput[k]))
    dirOrder = dirOrder.filter(x => x !== d);
});
addEventListener('blur', clearKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });
function pressed(keys) { return queue.some(k => keys.includes(k)); }
function keyTapped(keys) { return keys.some(k => keyTap.has(normKey(k))); }

// mouse: button 0 walks (click-to-move), button 2 locks a target.
// In menus the same events drive the inventory: click, double-click, drag.
let clicks = [], releases = [];
let wheelY = 0;
const mouse = { x: 0, y: 0, down: false };
let lastClick = { t: 0, x: -99, y: -99 };
let buttonFeedback = [];
const BUTTON_FEEDBACK_MS = 1000;
function canvasXY(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
function recordButtonFeedback(p) {
  const now = performance.now();
  buttonFeedback = buttonFeedback.filter(f => now - f.t < BUTTON_FEEDBACK_MS);
  buttonFeedback.push({ x: p.x, y: p.y, t: now });
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousemove', e => Object.assign(mouse, canvasXY(e)));
cv.addEventListener('wheel', e => {
  const p = canvasXY(e);
  Object.assign(mouse, p);
  if (inPanel(p) || game.shop || game.menu) {
    e.preventDefault();
    wheelY += e.deltaY;
  }
}, { passive: false });
cv.addEventListener('mousedown', e => {
  e.preventDefault();
  focusGame();
  const p = canvasXY(e);
  Object.assign(mouse, p);
  if (e.button === 0) mouse.down = true;
  const now = performance.now();
  const dbl = e.button === 0 && now - lastClick.t < 400 &&
    Math.abs(p.x - lastClick.x) < 8 && Math.abs(p.y - lastClick.y) < 8;
  if (e.button === 0) lastClick = { t: dbl ? 0 : now, x: p.x, y: p.y };
  clicks.push({ b: e.button, x: p.x, y: p.y, dbl, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey });
  if (e.button === 0) recordButtonFeedback(p);
  if (!audioOk) { audioOk = true; syncMusic(); }
});
addEventListener('mouseup', e => {
  if (e.button === 0) mouse.down = false;
  releases.push({ b: e.button, x: mouse.x, y: mouse.y });
});
function clicked(button) { return clicks.some(c => c.b === button); }
function dirHeld() {
  // the most recently pressed direction wins; when it's released the previous
  // still-held one takes back over (hold D, tap W -> up, release W -> right)
  if (dirOrder.length) return dirOrder[dirOrder.length - 1];
  // a tap quicker than one frame still turns/steps the hero
  for (const [keys, dir] of [[['ArrowUp', 'w'], 'up'], [['ArrowDown', 's'], 'down'],
    [['ArrowLeft', 'a'], 'left'], [['ArrowRight', 'd'], 'right']])
    if (pressed(keys)) return dir;
  return null;
}

// ---------------------------------------------------------------- windows & text
function buttonFeedbackEligible(w, h) {
  return w <= 110 && h <= 26;
}
function buttonFeedbackAlpha(x, y, w, h, force = false) {
  if (!force && !buttonFeedbackEligible(w, h)) return 0;
  const now = performance.now();
  let alpha = 0;
  buttonFeedback = buttonFeedback.filter(f => {
    const age = now - f.t;
    if (age >= BUTTON_FEEDBACK_MS) return false;
    if (f.x >= x && f.x < x + w && f.y >= y && f.y < y + h) {
      alpha = Math.max(alpha, 0.42 * (1 - age / BUTTON_FEEDBACK_MS));
    }
    return true;
  });
  return alpha;
}
function drawWindow(x, y, w, h) {
  const s = img.system;
  ctx.globalAlpha = 0.85;
  ctx.drawImage(s, 0, 0, 32, 32, x + 1, y + 1, w - 2, h - 2);
  ctx.globalAlpha = 1;
  nineSlice(s, 32, 0, x, y, w, h);
  const feedback = buttonFeedbackAlpha(x, y, w, h);
  if (feedback > 0) {
    ctx.fillStyle = `rgba(0,0,0,${feedback})`;
    ctx.fillRect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4));
  }
}
function drawCursor(x, y, w, h) {
  nineSlice(img.system, 64, 0, x, y, w, h);
  const feedback = buttonFeedbackAlpha(x, y, w, h, true);
  if (feedback > 0) {
    ctx.fillStyle = `rgba(0,0,0,${feedback})`;
    ctx.fillRect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4));
  }
}
function nineSlice(s, sx, sy, x, y, w, h) {
  const b = 8, m = 32 - 2 * b;
  ctx.drawImage(s, sx, sy, b, b, x, y, b, b);
  ctx.drawImage(s, sx + 32 - b, sy, b, b, x + w - b, y, b, b);
  ctx.drawImage(s, sx, sy + 32 - b, b, b, x, y + h - b, b, b);
  ctx.drawImage(s, sx + 32 - b, sy + 32 - b, b, b, x + w - b, y + h - b, b, b);
  ctx.drawImage(s, sx + b, sy, m, b, x + b, y, w - 2 * b, b);
  ctx.drawImage(s, sx + b, sy + 32 - b, m, b, x + b, y + h - b, w - 2 * b, b);
  ctx.drawImage(s, sx, sy + b, b, m, x, y + b, b, h - 2 * b);
  ctx.drawImage(s, sx + 32 - b, sy + b, b, m, x + w - b, y + b, b, h - 2 * b);
}
function text(str, x, y, color = '#fff') {
  ctx.font = 'bold 8px "Courier New", monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1a2a3a';
  ctx.fillText(str, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
function textWidth(str) {
  ctx.font = 'bold 8px "Courier New", monospace';
  return ctx.measureText(str).width;
}
function drawMeter(x, y, w, h, cur, max, fill = '#d84242') {
  const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  ctx.fillStyle = '#111923';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#23303b';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, Math.round((w - 2) * pct), h - 2);
  ctx.strokeStyle = '#9fb4c8';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
function hpColor(cur, max) {
  const pct = max > 0 ? cur / max : 0;
  if (pct <= 0) return '#7b8791';
  if (pct < 0.3) return '#f76';
  if (pct < 0.65) return '#ffe080';
  return '#69d36d';
}
function heroDisplayName() {
  return (game.hero && game.hero.name) || (game.net && game.net.id) || 'Hero';
}

window.FQ = game; // console/test handle

// ---------------------------------------------------------------- music & save
function sceneSong() {
  return { title: 'title', map: 'field' }[game.scene] || null;
}
function syncMusic() {
  if (!audioOk) return;
  const s = sceneSong();
  if (s) MidiPlayer.play(s);
  else MidiPlayer.stop();
}
const SAVE_KEY = 'fablequest_save';
function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    hero: game.hero, won: game.won, steps: game.steps,
    mapId: game.mapId, floor: game.floor, autoloot: game.autoloot,
    corpses: game.corpses, invOpen: game.invOpen, logOpen: game.logOpen,
    minimapOpen: game.minimapOpen, hudCompact: game.hudCompact,
  }));
}
function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  const d = JSON.parse(raw);
  Object.assign(game.hero, d.hero);
  game.won = d.won;
  game.steps = d.steps;
  game.mapId = d.mapId || 'field';
  game.floor = d.floor || [];
  game.corpses = d.corpses || [];
  game.corpses.forEach(normalizeCorpse); // pre-loot/pre-sprite saves
  game.corpseOpen = null;
  game.autoloot = d.autoloot !== false;
  game.invOpen = d.invOpen !== false;
  game.bagScroll = 0;
  game.logOpen = d.logOpen !== false;
  game.mapOpen = false;
  game.minimapOpen = d.minimapOpen === true;
  game.hudCompact = d.hudCompact === true;
  game.shop = null;
  const h = game.hero;
  if (!h.name) h.name = 'Hero';
  if (!h.class) h.class = 'Knight';
  normalizeSkillProgress(h);
  ensureQuests(h);
  // pre-64x40 saves may sit out of bounds on the new maps
  if (h.tx >= MW || h.ty >= MH || cur().blocked.has(h.tx + ',' + h.ty)) {
    game.mapId = SPAWN.map; h.tx = SPAWN.tx; h.ty = SPAWN.ty;
  }
  h.px = h.tx * TS; h.py = h.ty * TS; h.moving = false;
  game.dialogue = null;
  game.enemies = [];
  game.projectiles = [];
  game.bolts = [];
  game.pops = [];
  game.iframes = 1;
  game.lock = null;
  game.follow = false;
  game.followEngaged = false;
  game.path = null;
  if (!h.slots) h.slots = defaultSlotsForClass(h.class); // pre-skillbar save
  normalizeHeroSlots(h);
  if (!h.attr) { // pre-attribute save: default attrs, level-ups worth of points to spend
    h.attr = { ...BASE_ATTR };
    h.points = (h.lv - 1) * 3;
    recalcMax();
  }
  if (!h.bag) { // pre-inventory save: h.potions was a bare counter
    h.bag = { potion: h.potions || 0 };
  }
  if (!h.equip) { // pre-paper-doll save: h.weapon was equipped straight from the bag
    h.equip = { head: null, main: null, off: null, torso: null, legs: null, boots: null, acc1: null, acc2: null };
    if (h.weapon && h.bag[h.weapon] > 0) {
      h.bag[h.weapon]--;
      h.equip.main = h.weapon;
    }
    delete h.weapon;
  }
  normalizeHeroEquipment();
  return true;
}

// ---------------------------------------------------------------- map data
// ground chars: G grass, D dirt, W water (blocked), P pavement,
// X city wall, R shop brick, U shop stucco, O shop door (all blocked)
const GROUND_T = {
  G: [304, 48], D: [352, 48], W: [0, 64], P: [192, 80],
  X: [224, 0], R: [224, 32], U: [224, 48], O: [208, 32],
};
const MAP_COLOR = {
  G: '#376f45', D: '#a9844d', W: '#2e6f9f', P: '#767f89',
  X: '#3e4d59', R: '#78484d', U: '#a87957', O: '#4a332a',
};
const MAP_NAME = { field: 'Field', city: 'City' };
const NPC_NAME = {
  elder: 'Elder',
  girl: 'Girl',
  pixel: 'Pixel',
  knight: 'Knight',
  smith: 'Blacksmith',
  grocer: 'Grocer',
  kid: 'Kid',
  guard: 'Guard',
};
function npcName(n) { return NPC_NAME[n.id] || n.id; }
function itemId(id, depth = 0) {
  if (depth > 3) return '';
  if (typeof id === 'string') {
    const key = id.trim();
    return key && key !== '[object Object]' && key.toLowerCase() !== 'object object' ? key : '';
  }
  if (id && typeof id === 'object') {
    for (const k of ['id', 'Id', 'ID', 'item', 'itemId', 'ItemId', 'name', 'Name']) {
      const key = itemId(id[k], depth + 1);
      if (key) return key;
    }
    return '';
  }
  return id == null ? '' : String(id);
}
function itemDef(id) {
  return ITEMS[itemId(id)] || null;
}
function itemName(id) {
  const key = itemId(id);
  return (ITEMS[key] && ITEMS[key].name) || (key && key !== '[object Object]' ? key : 'Item');
}
function itemLabel(f) {
  const name = itemName(f.id);
  return f.n > 1 ? `${name} x${f.n}` : name;
}
function corpseLabel(c) {
  const owner = c.name || c.owner || '';
  if (owner) return c.decayed ? `${owner}'s decayed body` : `${owner}'s body`;
  return c.decayed ? 'Decayed body' : 'Dead body';
}
function normalizeCorpse(c) {
  if (!c) return c;
  if (!c.items) c.items = {};
  c.class = c.class || c.Class || (c.sprite && c.sprite.class) || 'Knight';
  c.hair = c.hair || c.Hair || (c.sprite && c.sprite.hair) || '#6b3f22';
  c.cloth = c.cloth || c.Cloth || (c.sprite && c.sprite.cloth) || '#2f7fd1';
  return c;
}
function corpseActor(c) {
  return normalizeCorpse(c) || { class: 'Knight' };
}
function mapName(id) { return MAP_NAME[id] || id; }
function expToNextLevel(v = game.hero) {
  const lv = typeof v === 'number' ? v : ((v && v.lv) || 1);
  return Math.max(1, lv) * 14;
}
function hudHeight() { return game.hudCompact ? 52 : (overloaded() ? 102 : 91); }
function hudLayout() {
  return game.hudCompact ? { x: 4, y: 4, w: 120, h: hudHeight(), compact: true }
    : { x: 4, y: 4, w: 136, h: hudHeight(), compact: false };
}
function hudToggleButton() {
  const l = hudLayout();
  return { x: l.x + l.w - 20, y: l.y + 6, w: 14, h: 14 };
}
function clippedText(str, maxW) {
  const raw = String(str || '');
  let out = raw;
  while (out.length > 2 && textWidth(out) > maxW) out = out.slice(0, -2);
  if (out.length >= raw.length) return out;
  while (out.length > 0 && textWidth(out + '..') > maxW) out = out.slice(0, -1);
  return out + '..';
}
function handleHudToggleClicks() {
  const b = hudToggleButton();
  let consumed = false;
  clicks = clicks.filter(c => {
    if (c.b === 0 && hit(c, b.x, b.y, b.w, b.h)) {
      game.hudCompact = !game.hudCompact;
      sfx('Cursor1');
      consumed = true;
      return false;
    }
    return true;
  });
  return consumed;
}
function drawMapDot(mx, my, cell, tx, ty, color, r) {
  const x = mx + (tx + 0.5) * cell, y = my + (ty + 0.5) * cell;
  ctx.fillStyle = '#09131f';
  ctx.beginPath(); ctx.arc(x, y, r + 1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function drawHeroMapDot(mx, my, cell) {
  const h = game.hero, x = mx + (h.px / TS + 0.5) * cell, y = my + (h.py / TS + 0.5) * cell;
  const r = Math.max(2, Math.min(6, cell * 0.48));
  ctx.fillStyle = '#09131f';
  ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe080';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  const d = DIRV[h.dir] || DIRV.down;
  ctx.fillStyle = '#fff';
  ctx.fillRect(Math.round(x + d[0] * r) - 1, Math.round(y + d[1] * r) - 1, 2, 2);
}
function drawMapViewRect(mx, my, cell) {
  const cam = camPos();
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.strokeRect(mx + cam.x / TS * cell + 0.5, my + cam.y / TS * cell + 0.5,
    W / TS * cell, H / TS * cell);
}
function drawMapRaster(mapId, mx, my, cell, opts = {}) {
  const m = MAPS[mapId];
  if (!m) return;
  ctx.fillStyle = '#07111a';
  ctx.fillRect(mx - 1, my - 1, MW * cell + 2, MH * cell + 2);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    ctx.fillStyle = MAP_COLOR[m.ground[y][x]] || '#444';
    ctx.fillRect(mx + x * cell, my + y * cell, cell, cell);
  }
  ctx.fillStyle = '#1d4f32';
  for (const [x, y] of m.trees) ctx.fillRect(mx + x * cell, my + (y - 1) * cell, cell * 2, cell * 2);
  for (const [t, x, y] of m.props) {
    ctx.fillStyle = t === 'well' ? '#6db7d9' : t === 'sign' ? '#d7aa58' : '#445462';
    ctx.fillRect(mx + x * cell, my + y * cell, Math.max(1, cell), Math.max(1, cell));
  }
  ctx.fillStyle = '#9aa7b3';
  for (const [, , , , x, y, solid] of m.deco) if (solid)
    ctx.fillRect(mx + x * cell, my + y * cell, Math.max(1, cell), Math.max(1, cell));
  for (const key of Object.keys(m.exits || {})) {
    const [x, y] = key.split(',').map(Number);
    ctx.fillStyle = '#ffe080';
    ctx.fillRect(mx + x * cell, my + y * cell, Math.max(2, cell), Math.max(2, cell));
  }
  if (opts.viewport) drawMapViewRect(mx, my, cell);
  if (opts.actors) {
    const dot = Math.max(1.5, Math.min(3.5, cell * 0.28));
    for (const c of game.corpses) if (c.map === mapId) drawMapDot(mx, my, cell, c.tx, c.ty, c.decayed ? '#9aa0a6' : '#c7cad0', dot);
    for (const f of game.floor) if (f.map === mapId) drawMapDot(mx, my, cell, f.tx, f.ty, '#ffd75f', dot);
    for (const n of npcs) if (n.map === mapId) drawMapDot(mx, my, cell, n.tx, n.ty, '#7fd7ff', dot);
    for (const en of game.enemies) if (!en.dead && en.dying <= 0) drawMapDot(mx, my, cell, en.tx, en.ty, '#f76', dot);
    if (game.players) for (const p of game.players) if (!p.dead) drawMapDot(mx, my, cell, p.px / TS, p.py / TS, '#9cf', dot);
    if (!game.hero.dead) drawHeroMapDot(mx, my, cell);
  }
}
function mapWindowLayout() {
  const cell = Math.max(2, Math.floor(Math.min(Math.max(120, W - 88) / MW, Math.max(80, H - 114) / MH)));
  const mapW = MW * cell, mapH = MH * cell;
  const w = mapW + 40, h = mapH + 68;
  const x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  return { x, y, w, h, mx: x + 20, my: y + 36, cell, mapW, mapH };
}
function minimapLayout() {
  const cell = 2, pad = 5;
  const y = 4 + hudHeight() + 5;
  return { x: 4, y, w: MW * cell + pad * 2, h: MH * cell + pad * 2, mx: 4 + pad, my: y + pad, cell };
}
const BODY_GRID = [ // keyboard navigation layout (rows of the paper doll)
  [null, 'head', null],
  ['main', 'torso', 'off'],
  [null, 'legs', null],
  ['acc1', 'boots', 'acc2'],
];
// persistent inventory, docked as two side-by-side windows:
// the backpack on the left, the body paper-doll on the right. Toggled with I.
const BODY_WIN = { x: W - 124, y: 4, w: 120, h: 148 };
const BAG_WIN = { x: Math.max(4, BODY_WIN.x - 136), y: 4, w: 132, h: H - 8 };
const PANEL = { x: BAG_WIN.x }; // anything right of this belongs to the inventory/menu column
const BAG_UI = { x: BAG_WIN.x + 12, y: BAG_WIN.y + 34, C: 4, S: 26 };
const BODY_UI = {
  head: [BODY_WIN.x + 48, 20], main: [BODY_WIN.x + 16, 50], torso: [BODY_WIN.x + 48, 50], off: [BODY_WIN.x + 80, 50],
  legs: [BODY_WIN.x + 48, 80], acc1: [BODY_WIN.x + 16, 110], boots: [BODY_WIN.x + 48, 110], acc2: [BODY_WIN.x + 80, 110],
};
const BODY_LABEL = { head: 'Hd', main: 'Wpn', off: 'Off', torso: 'Tor', legs: 'Leg', boots: 'Bt', acc1: 'Ac', acc2: 'Ac' };
const BODY_NAV = { // keyboard moves between slots, roughly matching the doll shape
  head: { down: 'torso' },
  main: { right: 'torso', down: 'acc1' },
  torso: { up: 'head', left: 'main', right: 'off', down: 'legs' },
  off: { left: 'torso', down: 'acc2' },
  legs: { up: 'torso', down: 'boots', left: 'main', right: 'off' },
  acc1: { right: 'boots', up: 'main' },
  boots: { up: 'legs', left: 'acc1', right: 'acc2' },
  acc2: { left: 'boots', up: 'off' },
};
function bagRows() {
  return Math.max(1, Math.floor((BAG_WIN.y + BAG_WIN.h - 32 - BAG_UI.y) / BAG_UI.S));
}
function bagMaxScroll(ids = bagIds()) {
  return Math.max(0, Math.ceil(ids.length / BAG_UI.C) - bagRows());
}
function clampBagScroll(ids = bagIds()) {
  game.bagScroll = Math.max(0, Math.min(game.bagScroll || 0, bagMaxScroll(ids)));
}
function ensureBagCursorVisible(ids = bagIds()) {
  if (!ids.length) { game.bagScroll = 0; return; }
  clampBagScroll(ids);
  const row = Math.floor((game.invCursor || 0) / BAG_UI.C);
  const top = game.bagScroll || 0, rows = bagRows();
  if (row < top) game.bagScroll = row;
  else if (row >= top + rows) game.bagScroll = row - rows + 1;
  clampBagScroll(ids);
}
function bagCellAt(px, py) { // bag index under a canvas point, or -1
  const ids = bagIds();
  clampBagScroll(ids);
  const col = Math.floor((px - BAG_UI.x + 3) / BAG_UI.S);
  const row = Math.floor((py - BAG_UI.y + 3) / BAG_UI.S);
  if (col < 0 || col >= BAG_UI.C || row < 0 || row >= bagRows()) return -1;
  const i = (game.bagScroll || 0) * BAG_UI.C + row * BAG_UI.C + col;
  const x = BAG_UI.x + col * BAG_UI.S, y = BAG_UI.y + row * BAG_UI.S;
  return i >= 0 && i < ids.length && px >= x - 3 && px < x + 21 && py >= y - 3 && py < y + 21 ? i : -1;
}
function bodySlotAt(px, py) {
  for (const [slot, [x, y]] of Object.entries(BODY_UI))
    if (px >= x && px < x + 24 && py >= y && py < y + 24) return slot;
  return null;
}
function inPanel(p) { return p.x >= PANEL.x; }
function inBagWin(p) {
  return p.x >= BAG_WIN.x && p.x < BAG_WIN.x + BAG_WIN.w &&
    p.y >= BAG_WIN.y && p.y < BAG_WIN.y + BAG_WIN.h;
}
function panelWidth() { return W - PANEL.x; }

// corpse-loot window, docked just left of the inventory panel by default
const CORPSE_WIN = { x: Math.max(4, BAG_WIN.x - 132), y: 4, w: 128, h: 150, C: 4, S: 26 };
function clampCorpseWin() {
  CORPSE_WIN.x = Math.max(0, Math.min(W - CORPSE_WIN.w, CORPSE_WIN.x));
  CORPSE_WIN.y = Math.max(0, Math.min(H - CORPSE_WIN.h, CORPSE_WIN.y));
}
function inCorpseWin(p) {
  return p.x >= CORPSE_WIN.x && p.x < CORPSE_WIN.x + CORPSE_WIN.w &&
    p.y >= CORPSE_WIN.y && p.y < CORPSE_WIN.y + CORPSE_WIN.h;
}
function corpseTakeAllButton() {
  return { x: CORPSE_WIN.x + 10, y: CORPSE_WIN.y + CORPSE_WIN.h - 22, w: 58, h: 16 };
}
function corpseCloseButton() {
  return { x: CORPSE_WIN.x + CORPSE_WIN.w - 54, y: CORPSE_WIN.y + CORPSE_WIN.h - 22, w: 44, h: 16 };
}
function inCorpseButton(p, b) { return hit(p, b.x, b.y, b.w, b.h); }
function corpseCellAt(px, py) {
  const { x: X, y: Y, C, S } = CORPSE_WIN;
  for (let i = 0; i < C * 4; i++) {
    const x = X + 12 + (i % C) * S, y = Y + 30 + Math.floor(i / C) * S;
    if (px >= x - 3 && px < x + 21 && py >= y - 3 && py < y + 21) return i;
  }
  return -1;
}
function setCorpseWalkTarget(c) {
  game.corpseWalkTarget = c ? { map: c.map || game.mapId, tx: c.tx, ty: c.ty } : null;
}
function requestCorpseOpen(c, sendMove) {
  if (!c || c.decayed) return false;
  setFloorLootTarget(null, null);
  if (nearHero(c.tx, c.ty)) {
    setCorpseWalkTarget(null);
    game.corpseOpen = c;
    sfx('Decision1');
    return true;
  }
  game.corpseOpen = null;
  setCorpseWalkTarget(c);
  if (sendMove) sendMove(c.tx, c.ty);
  if (typeof startPathTo === 'function') startPathTo(c.tx, c.ty);
  sfx('Cursor1');
  return true;
}
function updatePendingCorpseOpen() {
  const t = game.corpseWalkTarget;
  if (!t) return false;
  if (t.map !== game.mapId) { setCorpseWalkTarget(null); return false; }
  const c = corpseAt(t.tx, t.ty);
  if (!c || c.decayed) { setCorpseWalkTarget(null); return false; }
  if (!nearHero(c.tx, c.ty)) return false;
  game.corpseOpen = c;
  setCorpseWalkTarget(null);
  game.path = null;
  sfx('Decision1');
  return true;
}
function setFloorLootTarget(tx, ty) {
  game.floorLootTarget = Number.isFinite(tx) && Number.isFinite(ty) ? { map: game.mapId, tx, ty } : null;
}
function requestFloorLoot(tx, ty, sendMove, takeFn) {
  if (!floorAt(tx, ty).length) return false;
  setCorpseWalkTarget(null);
  if (nearHero(tx, ty)) {
    setFloorLootTarget(null);
    takeFn(tx, ty);
    return true;
  }
  setFloorLootTarget(tx, ty);
  if (sendMove) sendMove(tx, ty);
  if (typeof startPathTo === 'function') startPathTo(tx, ty);
  sfx('Cursor1');
  return true;
}
function updatePendingFloorLoot(takeFn) {
  const t = game.floorLootTarget;
  if (!t) return false;
  if (t.map !== game.mapId) { setFloorLootTarget(null); return false; }
  if (!floorAt(t.tx, t.ty).length) { setFloorLootTarget(null); return false; }
  if (!nearHero(t.tx, t.ty)) return false;
  takeFn(t.tx, t.ty);
  setFloorLootTarget(null);
  game.path = null;
  return true;
}
function worldTileAtPoint(p) {
  const cam = camPos();
  const tx = Math.floor((p.x + cam.x) / TS), ty = Math.floor((p.y + cam.y) / TS);
  return tx >= 0 && ty >= 0 && tx < MW && ty < MH ? { tx, ty } : null;
}
function floorDragStackAt(tx, ty) {
  return floorAt(tx, ty).find(f => itemId(f.id)) || null;
}
function startWorldDragAt(p) {
  if (p.b !== 0 || p.ctrl || p.alt || game.invDrag) return false;
  const t = worldTileAtPoint(p);
  if (!t || !nearHero(t.tx, t.ty)) return false;
  const f = floorDragStackAt(t.tx, t.ty);
  if (f) {
    setCorpseWalkTarget(null);
    setFloorLootTarget(null, null);
    game.path = null;
    game.worldDrag = { kind: 'floor', tx: f.tx, ty: f.ty, id: itemId(f.id), n: f.n || 1 };
    sfx('Cursor1');
    return true;
  }
  const co = corpseAt(t.tx, t.ty);
  if (co) {
    setCorpseWalkTarget(null);
    setFloorLootTarget(null, null);
    game.path = null;
    game.worldDrag = {
      kind: 'corpse', tx: co.tx, ty: co.ty, name: corpseLabel(co), decayed: !!co.decayed,
      class: co.class, hair: co.hair, cloth: co.cloth,
    };
    sfx('Cursor1');
    return true;
  }
  return false;
}
function finishWorldDrag(sendFn, p) {
  const d = game.worldDrag;
  if (!d || p.b !== 0) return false;
  game.worldDrag = null;
  if ((game.invOpen && inPanel(p)) || (game.corpseOpen && inCorpseWin(p))) return true;
  const t = worldTileAtPoint(p);
  if (!t) return true;
  if (d.kind === 'floor' && isBlocked(t.tx, t.ty)) { sfx('Buzzer1'); return true; }
  if (d.kind === 'corpse' && !corpseDropTileAllowed(t.tx, t.ty)) { sfx('Buzzer1'); return true; }
  if (d.kind === 'floor') sendFn({ t: 'moveFloorItem', tx: d.tx, ty: d.ty, toTx: t.tx, toTy: t.ty, id: d.id });
  else if (d.kind === 'corpse') sendFn({ t: 'moveCorpse', tx: d.tx, ty: d.ty, toTx: t.tx, toTy: t.ty });
  sfx('Decision1');
  return true;
}
function finishWorldDragFromReleases(sendFn) {
  let consumed = false;
  for (const r of releases) if (finishWorldDrag(sendFn, r)) consumed = true;
  if (game.worldDrag && !mouse.down) { game.worldDrag = null; consumed = true; }
  return consumed;
}
function updateCorpseDrag() {
  const d = game.corpseDrag;
  if (!d) return;
  if (!mouse.down) { game.corpseDrag = null; return; }
  CORPSE_WIN.x = mouse.x - d.dx;
  CORPSE_WIN.y = mouse.y - d.dy;
  clampCorpseWin();
}
function updateCorpseWinControls(takeFn) {
  if (!game.corpseOpen) return false;
  updateCorpseDrag();
  const c = game.corpseOpen;
  if (pressed(CANCEL)) { game.corpseOpen = null; game.corpseDrag = null; sfx('Cancel1'); return true; }
  if (pressed(CONFIRM)) { takeFn(c, '*'); queue = []; sfx('Decision1'); return true; }
  const takeAll = corpseTakeAllButton(), close = corpseCloseButton();
  let consumed = false;
  clicks = clicks.filter(cl => {
    if (cl.b !== 0) return true;
    if (!inCorpseWin(cl)) {
      game.corpseOpen = null;
      game.corpseDrag = null;
      sfx('Cancel1');
      consumed = true;
      return false;
    }
    consumed = true;
    if (inCorpseButton(cl, close)) {
      game.corpseOpen = null;
      game.corpseDrag = null;
      sfx('Cancel1');
      return false;
    }
    if (inCorpseButton(cl, takeAll)) {
      takeFn(c, '*');
      sfx('Decision1');
      return false;
    }
    const ids = Object.keys(c.items);
    const i = corpseCellAt(cl.x, cl.y);
    if (i >= 0 && i < ids.length) {
      if (cl.dbl) takeFn(c, ids[i]);
      return false;
    }
    game.corpseDrag = { dx: cl.x - CORPSE_WIN.x, dy: cl.y - CORPSE_WIN.y };
    return false;
  });
  if (game.corpseDrag && !mouse.down) game.corpseDrag = null;
  return consumed;
}
function hotbarSlotAt(px, py) {
  for (let i = 0; i < 5; i++) {
    const x = 4 + i * 21, y = H - 24;
    if (px >= x && px < x + 20 && py >= y && py < y + 20) return i;
  }
  return -1;
}
function drawCorpseWin() {
  const c = game.corpseOpen, ids = Object.keys(c.items);
  clampCorpseWin();
  drawWindow(CORPSE_WIN.x, CORPSE_WIN.y, CORPSE_WIN.w, CORPSE_WIN.h);
  text(c.name || 'Your remains', CORPSE_WIN.x + 12, CORPSE_WIN.y + 7, '#f76');
  ids.forEach((id, i) => {
    const x = CORPSE_WIN.x + 12 + (i % CORPSE_WIN.C) * CORPSE_WIN.S;
    const y = CORPSE_WIN.y + 30 + Math.floor(i / CORPSE_WIN.C) * CORPSE_WIN.S;
    ctx.drawImage(img[ITEMS[id].img], x, y, 18, 18);
    text('' + c.items[id], x + 10, y + 12, '#ffe080');
  });
  if (!ids.length) text('Picked clean.', CORPSE_WIN.x + 12, CORPSE_WIN.y + 34, '#999');
  const takeAll = corpseTakeAllButton(), close = corpseCloseButton();
  drawWindow(takeAll.x, takeAll.y, takeAll.w, takeAll.h);
  text('Take all', takeAll.x + 5, takeAll.y + 5, ids.length ? '#fff' : '#999');
  drawWindow(close.x, close.y, close.w, close.h);
  text('Close', close.x + 7, close.y + 5, '#fff');
}

// mouse interactions on the live panel: click selects, double-click
// uses/equips/unequips, drag moves gear (drag out of the panel to drop/unequip)
function updateInvPanel() {
  const h = game.hero, ids = bagIds();
  game.invCursor = Math.min(game.invCursor || 0, Math.max(0, ids.length - 1));
  clampBagScroll(ids);
  if (wheelY) {
    if (inBagWin(mouse)) {
      const oldScroll = game.bagScroll || 0;
      game.bagScroll = Math.max(0, Math.min(oldScroll + (wheelY > 0 ? 1 : -1), bagMaxScroll(ids)));
      if (game.bagScroll !== oldScroll) sfx('Cursor1');
    }
    wheelY = 0;
  }
  if (!game.invSlot) game.invSlot = 'torso';
  for (const c of clicks) {
    if (!inPanel(c)) continue;
    const bi = bagCellAt(c.x, c.y), bs = bodySlotAt(c.x, c.y);
    if (c.b === 2 && bi >= 0) {
      game.invFocus = 'bag';
      game.invCursor = bi;
      game.itemPopup = ids[bi];
      sfx('Decision1');
    } else if (c.b === 2 && bs && h.equip[bs]) {
      game.invFocus = 'body';
      game.invSlot = bs;
      game.itemPopup = h.equip[bs];
      sfx('Decision1');
    } else if (c.b === 0 && bi >= 0) {
      game.invFocus = 'bag';
      game.invCursor = bi;
      if (c.dbl) pushIntent({ t: 'useItem', id: ids[bi] });
      else game.invDrag = { from: 'bag', id: ids[bi] };
    } else if (c.b === 0 && bs) {
      game.invFocus = 'body';
      game.invSlot = bs;
      if (c.dbl) pushIntent({ t: 'unequip', bslot: bs });
      else if (h.equip[bs]) game.invDrag = { from: 'body', slot: bs, id: h.equip[bs] };
    }
  }
  for (const r of releases) {
    if (r.b !== 0 || !game.invDrag) continue;
    const d = game.invDrag, bs = bodySlotAt(r.x, r.y), hs = hotbarSlotAt(r.x, r.y);
    if (d.from === 'bag') {
      if (hs >= 0) {
        if (isHotbarItem(d.id)) pushIntent({ t: 'assignSkill', id: d.id, slot: hs });
        else sfx('Buzzer1');
      } else if (bs) pushIntent({ t: 'equip', id: d.id, bslot: bs });
      else if (!inPanel(r)) requestDropItem(d.id); // dragged onto the map
    } else if (bs && bs !== d.slot && canPlace(d.id, bs)) {
      pushIntent({ t: 'unequip', bslot: d.slot }); // move between slots (ring to the other finger)
      pushIntent({ t: 'equip', id: d.id, bslot: bs });
    } else if (!bs) {
      pushIntent({ t: 'unequip', bslot: d.slot }); // dragged off the body: back to the bag
    }
    game.invDrag = null;
  }
  if (game.invDrag && !mouse.down) game.invDrag = null;
}

// keyboard mode: E focuses the panel (arrows navigate it instead of walking)
function updateInvKeys() {
  const h = game.hero, ids = bagIds(), C = BAG_UI.C;
  if (game.invFocus === 'bag') {
    if (ids.length) {
      if (pressed(['ArrowLeft', 'a'])) { game.invCursor = (game.invCursor + ids.length - 1) % ids.length; sfx('Cursor1'); }
      if (pressed(['ArrowRight', 'd'])) { game.invCursor = (game.invCursor + 1) % ids.length; sfx('Cursor1'); }
      if (pressed(['ArrowUp', 'w']) && game.invCursor >= C) { game.invCursor -= C; sfx('Cursor1'); }
      if (pressed(['ArrowDown', 's']) && game.invCursor + C < ids.length) { game.invCursor += C; sfx('Cursor1'); }
      ensureBagCursorVisible(ids);
      if (pressed(CONFIRM)) pushIntent({ t: 'useItem', id: ids[game.invCursor] });
      if (pressed(['q', 'Q'])) requestDropItem(ids[game.invCursor]);
    }
  } else { // body
    if (!game.invSlot) game.invSlot = 'torso';
    for (const [keys, dir] of [[['ArrowUp', 'w'], 'up'], [['ArrowDown', 's'], 'down'],
      [['ArrowLeft', 'a'], 'left'], [['ArrowRight', 'd'], 'right']]) {
      if (pressed(keys) && BODY_NAV[game.invSlot][dir]) { game.invSlot = BODY_NAV[game.invSlot][dir]; sfx('Cursor1'); }
    }
    if (pressed(CONFIRM) || pressed(['q', 'Q'])) pushIntent({ t: 'unequip', bslot: game.invSlot });
  }
}
function closeInventory() {
  game.invOpen = false;
  game.invFocus = null;
  game.invDrag = null;
  sfx('Cancel1');
}
function dropQtyMax(id) {
  return Math.max(1, (game.hero.bag && game.hero.bag[id]) || 0);
}
function requestDropItem(id) {
  const max = dropQtyMax(id);
  if (max <= 1) {
    pushIntent({ t: 'dropItem', id, n: 1 });
    return;
  }
  game.dropPrompt = { id, n: 1 };
  game.invDrag = null;
  sfx('Cursor1');
}
function dropPromptLayout() {
  const w = 168, h = 76, x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  return {
    x, y, w, h,
    minus: { x: x + 12, y: y + 35, w: 24, h: 18 },
    plus: { x: x + 42, y: y + 35, w: 24, h: 18 },
    all: { x: x + 72, y: y + 35, w: 34, h: 18 },
    drop: { x: x + 112, y: y + 35, w: 44, h: 18 },
    cancel: { x: x + 112, y: y + 56, w: 44, h: 14 },
  };
}
function clampDropPrompt() {
  const p = game.dropPrompt;
  if (!p) return;
  const max = dropQtyMax(p.id);
  if (max <= 0) { game.dropPrompt = null; return; }
  p.n = Math.max(1, Math.min(max, Math.floor(p.n || 1)));
}
function confirmDropPrompt() {
  const p = game.dropPrompt;
  if (!p) return;
  clampDropPrompt();
  if (game.dropPrompt) pushIntent({ t: 'dropItem', id: p.id, n: p.n });
  game.dropPrompt = null;
  sfx('Cancel1');
}
function updateDropPrompt() {
  const p = game.dropPrompt;
  if (!p) return false;
  clampDropPrompt();
  if (!game.dropPrompt) return true;
  const l = dropPromptLayout(), max = dropQtyMax(p.id);
  for (const c of clicks) {
    if (c.b !== 0) continue;
    if (hit(c, l.minus.x, l.minus.y, l.minus.w, l.minus.h)) { p.n--; clampDropPrompt(); sfx('Cursor1'); return true; }
    if (hit(c, l.plus.x, l.plus.y, l.plus.w, l.plus.h)) { p.n++; clampDropPrompt(); sfx('Cursor1'); return true; }
    if (hit(c, l.all.x, l.all.y, l.all.w, l.all.h)) { p.n = max; sfx('Cursor1'); return true; }
    if (hit(c, l.drop.x, l.drop.y, l.drop.w, l.drop.h)) { confirmDropPrompt(); return true; }
    if (hit(c, l.cancel.x, l.cancel.y, l.cancel.w, l.cancel.h) || !hit(c, l.x, l.y, l.w, l.h)) {
      game.dropPrompt = null; sfx('Cancel1'); return true;
    }
  }
  if (pressed(['ArrowLeft', 'a'])) { p.n--; clampDropPrompt(); sfx('Cursor1'); return true; }
  if (pressed(['ArrowRight', 'd'])) { p.n++; clampDropPrompt(); sfx('Cursor1'); return true; }
  if (pressed(CONFIRM)) { confirmDropPrompt(); return true; }
  if (pressed(CANCEL)) { game.dropPrompt = null; sfx('Cancel1'); return true; }
  return true;
}
function drawDropPrompt() {
  const p = game.dropPrompt;
  if (!p) return;
  clampDropPrompt();
  if (!game.dropPrompt) return;
  const l = dropPromptLayout(), it = ITEMS[p.id], max = dropQtyMax(p.id);
  drawWindow(l.x, l.y, l.w, l.h);
  text('Drop', l.x + 12, l.y + 8, '#ffe080');
  if (it) {
    ctx.drawImage(img[it.img], l.x + 12, l.y + 17, 14, 14);
    text(it.name, l.x + 32, l.y + 19, '#fff');
  }
  text(`${p.n}/${max}`, l.x + 116, l.y + 19, '#bcd');
  drawWindow(l.minus.x, l.minus.y, l.minus.w, l.minus.h); text('-', l.minus.x + 9, l.minus.y + 6);
  drawWindow(l.plus.x, l.plus.y, l.plus.w, l.plus.h); text('+', l.plus.x + 8, l.plus.y + 6);
  drawWindow(l.all.x, l.all.y, l.all.w, l.all.h); text('All', l.all.x + 8, l.all.y + 6);
  drawWindow(l.drop.x, l.drop.y, l.drop.w, l.drop.h); text('Drop', l.drop.x + 8, l.drop.y + 6);
  drawWindow(l.cancel.x, l.cancel.y, l.cancel.w, l.cancel.h); text('Cancel', l.cancel.x + 3, l.cancel.y + 4, '#bcd');
}

function inventoryHoverItem() {
  if (!game.invOpen || game.itemPopup || game.invDrag || game.dropPrompt) return null;
  const ids = bagIds();
  const bi = bagCellAt(mouse.x, mouse.y);
  if (bi >= 0 && ids[bi]) return ids[bi];
  const slot = bodySlotAt(mouse.x, mouse.y);
  return slot && game.hero.equip[slot] ? game.hero.equip[slot] : null;
}
function drawItemNameTip(id) {
  const name = ITEMS[id] ? ITEMS[id].name : id;
  const w = Math.ceil(textWidth(name)) + 14, h = 18;
  let x = mouse.x + 10, y = mouse.y + 10;
  if (x + w > W - 2) x = mouse.x - w - 8;
  if (y + h > H - 2) y = mouse.y - h - 8;
  x = Math.max(2, x); y = Math.max(2, y);
  drawWindow(x, y, w, h);
  text(name, x + 7, y + 6, '#ffe080');
}

function drawInvPanel() {
  const h = game.hero, ids = bagIds();
  game.invCursor = Math.min(game.invCursor || 0, Math.max(0, ids.length - 1));
  clampBagScroll(ids);

  // body window
  drawWindow(BODY_WIN.x, BODY_WIN.y, BODY_WIN.w, BODY_WIN.h);
  text('Body', BODY_WIN.x + 46, BODY_WIN.y + 6, '#bcd');
  const mainTwoH = h.equip.main && ITEMS[h.equip.main].twoH;
  for (const [slot, [x, y]] of Object.entries(BODY_UI)) {
    ctx.fillStyle = 'rgba(10,20,30,.5)';
    ctx.fillRect(x, y, 24, 24);
    const droppable = game.invDrag && canPlace(game.invDrag.id, slot);
    ctx.strokeStyle = droppable ? '#7f7' : '#56718a';
    ctx.strokeRect(x + 0.5, y + 0.5, 23, 23);
    const id = h.equip[slot];
    if (id && !(game.invDrag && game.invDrag.from === 'body' && game.invDrag.slot === slot)) {
      ctx.drawImage(img[ITEMS[id].img], x + 3, y + 3, 18, 18);
    } else if (!id && slot === 'off' && mainTwoH) {
      ctx.globalAlpha = 0.3; // both hands are busy with the two-hander
      ctx.drawImage(img[ITEMS[h.equip.main].img], x + 3, y + 3, 18, 18);
      ctx.globalAlpha = 1;
    } else if (!id) {
      text(BODY_LABEL[slot], x + 4, y + 8, '#4a6076');
    }
    if (game.invFocus === 'body' && game.invSlot === slot) drawCursor(x - 2, y - 2, 28, 28);
  }

  // backpack window
  drawWindow(BAG_WIN.x, BAG_WIN.y, BAG_WIN.w, BAG_WIN.h);
  text('Backpack', BAG_WIN.x + 12, BAG_WIN.y + 7, '#bcd');
  text(`${bagWeight().toFixed(1)}/${capacity()}kg`, BAG_WIN.x + 12, BAG_WIN.y + 18,
    overloaded() ? '#f76' : '#bcd');
  const first = (game.bagScroll || 0) * BAG_UI.C;
  const visible = ids.slice(first, first + bagRows() * BAG_UI.C);
  visible.forEach((id, off) => {
    const i = first + off;
    const x = BAG_UI.x + (off % BAG_UI.C) * BAG_UI.S, y = BAG_UI.y + Math.floor(off / BAG_UI.C) * BAG_UI.S;
    if (game.invFocus === 'bag' && game.invCursor === i) drawCursor(x - 4, y - 4, BAG_UI.S - 2, BAG_UI.S - 2);
    ctx.drawImage(img[ITEMS[id].img], x, y, 18, 18);
    text('' + h.bag[id], x + 10, y + 12, '#ffe080');
  });
  if (!ids.length) text('Empty...', BAG_UI.x, BAG_UI.y + 4, '#999');
  const maxScroll = bagMaxScroll(ids);
  if (maxScroll > 0) {
    const trackX = BAG_WIN.x + BAG_WIN.w - 10, trackY = BAG_UI.y;
    const trackH = bagRows() * BAG_UI.S - 6;
    ctx.fillStyle = 'rgba(10,20,30,.55)';
    ctx.fillRect(trackX, trackY, 4, trackH);
    const thumbH = Math.max(8, Math.floor(trackH * bagRows() / Math.ceil(ids.length / BAG_UI.C)));
    const thumbY = trackY + Math.round((trackH - thumbH) * (game.bagScroll || 0) / maxScroll);
    ctx.fillStyle = '#9fb4c8';
    ctx.fillRect(trackX, thumbY, 4, thumbH);
  }
  text('I:hide E:keys Q:drop', BAG_WIN.x + 10, BAG_WIN.y + BAG_WIN.h - 14, '#9cf');

  const hoverItem = inventoryHoverItem();
  if (hoverItem) drawItemNameTip(hoverItem);

  if (game.invDrag) { // ghost icon rides the cursor
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img[ITEMS[game.invDrag.id].img], mouse.x - 9, mouse.y - 9, 18, 18);
    ctx.globalAlpha = 1;
  }
}

function drawItemPopup() {
  const it = ITEMS[game.itemPopup];
  const pw = 190, ph = 96;
  const px = (W - pw) / 2, py = (H - ph) / 2;
  drawWindow(px, py, pw, ph);
  ctx.drawImage(img[it.img], px + 10, py + 10, 24, 24);
  text(it.name, px + 42, py + 12, '#ffe080');
  text(itemInfo(it), px + 42, py + 24, '#bcd');
  wrapText(it.desc, px + 10, py + 44, pw - 22);
  text(`Weight ${it.w}kg   Value ${it.price}g`, px + 10, py + ph - 26, '#bcd');
  text('Click or Esc to close', px + 10, py + ph - 14, '#9cf');
}
function itemInfo(it) {
  if (it.heal) return `Heals ${it.heal} HP`;
  const parts = [];
  if (it.atk) parts.push(`Atk+${it.atk}`);
  if (it.def) parts.push(`Def+${it.def}`);
  if (it.mdef) parts.push(`MDef+${it.mdef}`);
  if (it.dodge) parts.push(`Dodge+${it.dodge}%`);
  if (it.crit) parts.push(`Crit+${it.crit}%`);
  if (it.twoH) parts.push('2-handed');
  return parts.join('  ');
}
const SHOP_CHOICE = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
];
function shopModeLabel(s) {
  return s.mode === 'sell' ? 'Sell' : 'Buy';
}
function shopChoiceLayout(s = game.shop) {
  const w = 104, h = 60;
  const centeredX = Math.floor((W - w) / 2), centeredY = Math.floor((H - h) / 2);
  const rawX = Number.isFinite(s && s.x) ? s.x : centeredX;
  const rawY = Number.isFinite(s && s.y) ? s.y : centeredY;
  const x = Math.max(4, Math.min(W - w - 4, rawX));
  const y = Math.max(4, Math.min(H - h - 4, rawY));
  return { x, y, w, h, rowX: x + 6, rowY: y + 22, rowW: w - 12, rowH: 16 };
}
function shopItems(s = game.shop) {
  if (!s) return [];
  if (s.mode === 'sell') return bagIds();
  return SHOPS[s.who] ? SHOPS[s.who].stock : [];
}
function shopVisibleRows(ids) {
  return Math.min(5, Math.max(1, ids.length));
}
function shopMaxScroll(s, ids = shopItems(s)) {
  return Math.max(0, ids.length - shopVisibleRows(ids));
}
function clampShopScroll(s, ids = shopItems(s)) {
  s.scroll = Math.max(0, Math.min(s.scroll || 0, shopMaxScroll(s, ids)));
}
function shopLayout(s = game.shop) {
  const ids = shopItems(s);
  const rowH = 22, visibleRows = shopVisibleRows(ids);
  const listH = visibleRows * rowH;
  const w = 334, h = listH + 116;
  const x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  return {
    x, y, w, h, ids, rowH, visibleRows,
    rowY: y + 24, listX: x + 6, listW: w - 24, listH,
    footerY: y + 24 + listH + 8, btnY: y + h - 28,
  };
}
function shopRowLayout(l, i) {
  const y = l.rowY + i * l.rowH;
  return {
    x: l.x + 6, y, w: l.w - 24, h: l.rowH,
    iconX: l.x + 12, nameX: l.x + 32, priceX: l.x + 142, haveX: l.x + 176,
    minus: { x: l.x + 212, y: y + 3, w: 16, h: 16 },
    input: { x: l.x + 231, y: y + 3, w: 38, h: 16 },
    plus: { x: l.x + 272, y: y + 3, w: 16, h: 16 },
  };
}
function shopButtons(l, s = game.shop) {
  const buttons = [
    { id: 'confirm', label: shopModeLabel(s), x: l.x + 12, y: l.btnY, w: 54, h: 20 },
    { id: 'cancel', label: 'Close', x: l.x + l.w - 74, y: l.btnY, w: 62, h: 20 },
  ];
  if (shopHasPending(s)) buttons.splice(1, 0, { id: 'reset', label: 'Reset', x: l.x + 74, y: l.btnY, w: 58, h: 20 });
  return buttons;
}
function shopScrollbar(l, s, ids) {
  const max = shopMaxScroll(s, ids);
  if (max <= 0) return null;
  const x = l.x + l.w - 12, y = l.rowY + 2, h = l.listH - 4;
  const thumbH = Math.max(10, Math.floor(h * l.visibleRows / ids.length));
  const thumbY = y + Math.round((h - thumbH) * (s.scroll || 0) / max);
  return { x, y, w: 6, h, thumbY, thumbH, max };
}
function shopQty(id, s = game.shop) {
  return Math.max(0, (s.qty && s.qty[id]) || 0);
}
function shopHasPending(s = game.shop) {
  return !!(s && shopItems(s).some(id => shopQty(id, s) > 0));
}
function shopMaxQty(id, s = game.shop) {
  return s.mode === 'sell' ? (game.hero.bag[id] || 0) : 99;
}
function setShopQty(id, n, s = game.shop) {
  if (!s.qty) s.qty = {};
  const q = Math.max(0, Math.min(shopMaxQty(id, s), Math.floor(Number(n) || 0)));
  if (q <= 0) delete s.qty[id];
  else s.qty[id] = q;
  s.warn = '';
}
function adjustShopQty(id, delta, s = game.shop) {
  setShopQty(id, shopQty(id, s) + delta, s);
  sfx('Cursor1');
}
function beginShopEdit(id, s = game.shop) {
  s.edit = id;
  s.editText = shopQty(id, s) ? String(shopQty(id, s)) : '';
  sfx('Cursor1');
}
function finishShopEdit(s = game.shop) {
  if (s.edit) setShopQty(s.edit, s.editText || 0, s);
  s.edit = null;
  s.editText = '';
}
function updateShopEdit(s = game.shop) {
  for (const k of queue) {
    if (/^[0-9]$/.test(k) && (s.editText || '').length < 3) {
      s.editText = (s.editText || '') + k;
      setShopQty(s.edit, s.editText, s);
    } else if (k === 'Backspace') {
      s.editText = (s.editText || '').slice(0, -1);
      setShopQty(s.edit, s.editText || 0, s);
    } else if (CONFIRM.includes(k)) {
      finishShopEdit(s);
    }
  }
}
function resetShopQty(s = game.shop) {
  s.qty = {};
  s.edit = null;
  s.editText = '';
  s.warn = '';
  sfx('Cancel1');
}
function shopLinePrice(id, s = game.shop) {
  return shopQty(id, s) * sellValue(id);
}
function shopTotal(s = game.shop) {
  return shopItems(s).reduce((sum, id) => sum + shopLinePrice(id, s), 0);
}
function confirmShop(s = game.shop) {
  finishShopEdit(s);
  const ids = shopItems(s);
  const total = shopTotal(s);
  if (total <= 0) { s.warn = 'Choose an amount first.'; sfx('Buzzer1'); return; }
  if (s.mode === 'buy' && total > game.hero.gold) {
    s.warn = "You don't have enough gold.";
    sfx('Buzzer1');
    return;
  }
  const t = s.mode === 'sell' ? 'sell' : 'buy';
  for (const id of ids) {
    const n = shopQty(id, s);
    if (n > 0) pushIntent({ t, who: s.who, id, n });
  }
  s.qty = {};
  s.warn = '';
}
function drawShopButton(b, hot = false) {
  drawWindow(b.x, b.y, b.w, b.h);
  if (hot) drawCursor(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
  const label = b.label || '';
  if (label) text(label, b.x + Math.max(7, Math.floor((b.w - textWidth(label)) / 2)), b.y + 6, '#fff');
}
function drawShopAmountBox(b, value, editing) {
  ctx.fillStyle = '#192330';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = editing ? '#ffe080' : '#6f879d';
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
  const label = String(value);
  text(label, b.x + Math.max(4, Math.floor((b.w - textWidth(label)) / 2)), b.y + 4, editing ? '#ffe080' : '#fff');
}
function updateShopChoice() {
  const s = game.shop, l = shopChoiceLayout();
  for (const c of clicks) {
    if (c.b !== 0) continue;
    if (!hit(c, l.x, l.y, l.w, l.h)) { game.shop = null; sfx('Cancel1'); return; }
    for (let i = 0; i < SHOP_CHOICE.length; i++) {
      if (hit(c, l.rowX, l.rowY + i * l.rowH, l.rowW, l.rowH)) {
        s.cursor = i;
        const choice = SHOP_CHOICE[i].id;
        openShop(s.who, choice);
        return;
      }
    }
  }
  const hov = SHOP_CHOICE.findIndex((_, i) => hit(mouse, l.rowX, l.rowY + i * l.rowH, l.rowW, l.rowH));
  if (hov >= 0) s.cursor = hov;
  if (pressed(CANCEL)) { game.shop = null; sfx('Cancel1'); return; }
  if (pressed(['ArrowUp', 'w'])) { s.cursor = (s.cursor + SHOP_CHOICE.length - 1) % SHOP_CHOICE.length; sfx('Cursor1'); }
  if (pressed(['ArrowDown', 's'])) { s.cursor = (s.cursor + 1) % SHOP_CHOICE.length; sfx('Cursor1'); }
  if (pressed(CONFIRM)) {
    const choice = SHOP_CHOICE[s.cursor || 0].id;
    openShop(s.who, choice);
  }
}
function updateShop() {
  const s = game.shop;
  if (s.mode === 'choice') { updateShopChoice(); return; }
  if (!s.qty) s.qty = {};
  const l = shopLayout(s), ids = l.ids;
  clampShopScroll(s, ids);
  if (wheelY && hit(mouse, l.listX, l.rowY, l.listW, l.listH)) {
    const old = s.scroll || 0;
    s.scroll = Math.max(0, Math.min(old + (wheelY > 0 ? 1 : -1), shopMaxScroll(s, ids)));
    if (s.scroll !== old) sfx('Cursor1');
    wheelY = 0;
  }
  const first = s.scroll || 0;
  for (const c of clicks) {
    if (c.b !== 0) continue;
    if (!hit(c, l.x, l.y, l.w, l.h)) { game.shop = null; sfx('Cancel1'); return; }
    const sb = shopScrollbar(l, s, ids);
    if (sb && hit(c, sb.x - 2, sb.y, sb.w + 4, sb.h)) {
      s.scroll = Math.max(0, Math.min(sb.max, Math.round((c.y - sb.y) / sb.h * sb.max)));
      sfx('Cursor1');
      return;
    }
    for (let vi = 0; vi < l.visibleRows; vi++) {
      const i = first + vi;
      if (i >= ids.length) break;
      const r = shopRowLayout(l, vi);
      if (!hit(c, r.x, r.y, r.w, r.h)) continue;
      if (hit(c, r.minus.x, r.minus.y, r.minus.w, r.minus.h)) adjustShopQty(ids[i], -1, s);
      else if (hit(c, r.plus.x, r.plus.y, r.plus.w, r.plus.h)) adjustShopQty(ids[i], 1, s);
      else if (hit(c, r.input.x, r.input.y, r.input.w, r.input.h)) beginShopEdit(ids[i], s);
      else if (c.dbl) adjustShopQty(ids[i], 1, s);
    }
    for (const b of shopButtons(l, s)) {
      if (!hit(c, b.x, b.y, b.w, b.h)) continue;
      if (b.id === 'confirm') confirmShop(s);
      else if (b.id === 'reset') resetShopQty(s);
      else { game.shop = null; sfx('Cancel1'); }
      return;
    }
  }
  if (s.edit) {
    if (pressed(CANCEL)) { finishShopEdit(s); sfx('Cancel1'); }
    else updateShopEdit(s);
    return;
  }
  if (pressed(CANCEL)) { game.shop = null; sfx('Cancel1'); return; }
  if (pressed(CONFIRM)) confirmShop(s);
}
function drawShopChoice() {
  const s = game.shop, shop = SHOPS[s.who], l = shopChoiceLayout();
  drawWindow(l.x, l.y, l.w, l.h);
  text(shop.name, l.x + 12, l.y + 8, '#ffe080');
  SHOP_CHOICE.forEach((choice, i) => {
    const y = l.rowY + i * l.rowH;
    if ((s.cursor || 0) === i) drawCursor(l.rowX, y - 1, l.rowW, l.rowH);
    text(choice.label, l.rowX + 10, y + 3, '#fff');
  });
}
function drawShop() {
  const s = game.shop;
  if (s.mode === 'choice') { drawShopChoice(); return; }
  const h = game.hero, shop = SHOPS[s.who], l = shopLayout(s), ids = l.ids;
  clampShopScroll(s, ids);
  drawWindow(l.x, l.y, l.w, l.h);
  text(`${shop.name} ${shopModeLabel(s)} - Gold ${h.gold}`, l.x + 12, l.y + 8, '#ffe080');
  if (!ids.length) {
    text('Your backpack is empty.', l.x + 14, l.rowY + 8, '#bcd');
  }
  const first = s.scroll || 0;
  ids.slice(first, first + l.visibleRows).forEach((id, vi) => {
    const i = first + vi;
    const it = ITEMS[id], r = shopRowLayout(l, vi), q = shopQty(id, s);
    const muted = s.mode === 'buy' && h.gold < it.price;
    ctx.drawImage(img[it.img], r.iconX, r.y + 3, 16, 16);
    text(it.name, r.nameX, r.y + 7, muted ? '#999' : '#fff');
    text(sellValue(id) + 'g', r.priceX, r.y + 7, '#ffe080');
    text('x' + (h.bag[id] || 0), r.haveX, r.y + 7, '#bcd');
    drawShopButton(r.minus, hit(mouse, r.minus.x, r.minus.y, r.minus.w, r.minus.h));
    text('-', r.minus.x + 6, r.minus.y + 4, q ? '#fff' : '#667');
    drawShopAmountBox(r.input, s.edit === id ? (s.editText || '') : q, s.edit === id);
    drawShopButton(r.plus, hit(mouse, r.plus.x, r.plus.y, r.plus.w, r.plus.h));
    text('+', r.plus.x + 5, r.plus.y + 4, shopMaxQty(id, s) > q ? '#fff' : '#667');
  });
  const maxScroll = shopMaxScroll(s, ids);
  const sb = shopScrollbar(l, s, ids);
  if (sb) {
    ctx.fillStyle = 'rgba(10,20,30,.55)';
    ctx.fillRect(sb.x, sb.y, 4, sb.h);
    ctx.fillStyle = '#9fb4c8';
    ctx.fillRect(sb.x, sb.thumbY, 4, sb.thumbH);
  }
  const total = shopTotal(s);
  const totalColor = s.mode === 'buy' && total > h.gold ? '#f76' : '#ffe080';
  text(`Preview: ${shopModeLabel(s)} ${total}g`, l.x + 12, l.footerY + 26, totalColor);
  if (s.warn) text(s.warn, l.x + 12, l.footerY + 40, '#f76');
  for (const b of shopButtons(l, s)) drawShopButton(b, hit(mouse, b.x, b.y, b.w, b.h));
}

// tint buffer for colored hit-flashes on 24x32 charas
const tintCv = document.createElement('canvas');
tintCv.width = 24; tintCv.height = 32;
const tint = tintCv.getContext('2d');
function drawTint(sheet, cx, cy, dir, frame, px, py, color, alpha) {
  tint.clearRect(0, 0, 24, 32);
  tint.drawImage(sheet, cx * 72 + frame * 24, cy * 128 + DIRROW[dir] * 32, 24, 32, 0, 0, 24, 32);
  tint.globalCompositeOperation = 'source-in';
  tint.fillStyle = color;
  tint.fillRect(0, 0, 24, 32);
  tint.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.drawImage(tintCv, px - 4, py - 16);
  ctx.globalAlpha = 1;
}

function drawEnemy(en) {
  const e = ENEMIES[en.kind];
  const frame = en.moving ? [0, 1, 2, 1][Math.floor(en.anim) % 4] : 1;
  const l = en.lunge > 0 ? Math.sin((1 - en.lunge / 0.22) * Math.PI) * 5 : 0;
  const d = DIRV[en.dir];
  const px = en.px + d[0] * l, py = en.py + d[1] * l;
  if (en.dying > 0) ctx.globalAlpha = Math.max(0.1, en.dying / 0.45);
  drawChar(img.monsters, e.cx, e.cy, en.dir, frame, px, py);
  ctx.globalAlpha = 1;
  if (en.flash > 0)
    drawTint(img.monsters, e.cx, e.cy, en.dir, frame, px, py, '#fff',
      Math.min(1, en.flash * 3) * (en.dying > 0 ? en.dying / 0.45 : 1));
  if (en.hp > 0 && (game.lock === en || (en.hurtT < 1.6 && en.hp < en.maxhp))) {
    ctx.fillStyle = '#222';
    ctx.fillRect(en.px, en.py - 18, 16, 2);
    ctx.fillStyle = '#d33';
    ctx.fillRect(en.px, en.py - 18, Math.ceil(16 * en.hp / en.maxhp), 2);
  }
}

function drawActorTargetBox(en, color) {
  const p = Math.floor(performance.now() / 250) % 2; // gentle pulse
  const x = en.px - 3 - p, y = en.py - 12 - p, w = 22 + 2 * p, hh = 29 + 2 * p, L = 5;
  ctx.fillStyle = '#1a2a3a';
  drawCorners(x + 1, y + 1, w, hh, L);
  ctx.fillStyle = color;
  drawCorners(x, y, w, hh, L);
}
function drawLockBox() {
  drawActorTargetBox(game.lock, '#ffe080');
}
function drawPvpTargetBox() {
  drawActorTargetBox(game.pvpTarget, '#f88');
}
// follow marker: a blue bracket that sits one ring outside the yellow lock box
function drawFollowBox() {
  const en = game.lock || game.followPlayer || game.pvpTarget;
  if (!en) return;
  const x = en.px - 8, y = en.py - 17, w = 32, hh = 39, L = 6;
  ctx.fillStyle = '#0a1424';
  drawCorners(x + 1, y + 1, w, hh, L);
  ctx.fillStyle = '#4bacff';
  drawCorners(x, y, w, hh, L);
}
function drawCorners(x, y, w, h, L) {
  ctx.fillRect(x, y, L, 1); ctx.fillRect(x, y, 1, L);
  ctx.fillRect(x + w - L, y, L, 1); ctx.fillRect(x + w - 1, y, 1, L);
  ctx.fillRect(x, y + h - 1, L, 1); ctx.fillRect(x, y + h - L, 1, L);
  ctx.fillRect(x + w - L, y + h - 1, L, 1); ctx.fillRect(x + w - 1, y + h - L, 1, L);
}

const SLASH_ROT = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
function drawSlash() {
  const h = game.hero, f = game.slashFx;
  ctx.save();
  ctx.globalAlpha = 0.9;
  if (f.spin) { // full turn around the hero
    ctx.translate(h.px + 8, h.py + 8);
    ctx.rotate(f.t / f.dur * Math.PI * 2);
    ctx.drawImage(img.slash, 2 * 96, 0, 96, 96, TS - 22, -22, 44, 44);
  } else if (f.punch) { // unarmed: expanding impact burst on the struck tile
    const i = Math.min(3, Math.floor(f.t / 0.06));
    const d = DIRV[f.dir];
    ctx.translate(h.px + 8 + d[0] * TS, h.py + 8 + d[1] * TS);
    ctx.drawImage(img.punch, i * 96, 0, 96, 96, -16, -16, 32, 32);
  } else {
    const i = Math.min(2, Math.floor(f.t / 0.06)); // frames 0-2: growing streak
    const d = DIRV[f.dir];
    ctx.translate(h.px + 8 + d[0] * TS, h.py + 8 + d[1] * TS);
    ctx.rotate(SLASH_ROT[f.dir]);
    ctx.drawImage(img.slash, i * 96, 0, 96, 96, -22, -22, 44, 44);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBolts() {
  for (const b of game.bolts) {
    ctx.strokeStyle = Math.floor(b.t * 30) % 2 ? '#ffe080' : '#fff';
    ctx.beginPath();
    ctx.moveTo(b.x + rnd(9) - 4, game.camY || 0);
    for (let y = (game.camY || 0) + 8; y < b.y; y += 8) ctx.lineTo(b.x + rnd(9) - 4, y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1 - b.t / 0.25;
    ctx.fillStyle = '#fff';
    ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
    ctx.globalAlpha = 1;
  }
}

function drawProjectiles() {
  for (const p of game.projectiles) {
    // flame1 cells (0,0)/(1,0) are round puffs centered at (48,48); crop tight
    const fr = Math.floor(p.t * 12) % 2;
    if (p.boom !== undefined) {
      ctx.globalAlpha = Math.max(0, p.boom / 0.18);
      ctx.drawImage(img.flame, 4 * 96 + 30, 3 * 96 + 30, 36, 36, p.x - 14, p.y - 14, 28, 28);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(img.flame, fr * 96 + 30, 30, 36, 36, p.x - 9, p.y - 9, 18, 18);
    }
  }
}

function drawPops() {
  for (const p of game.pops) {
    ctx.font = 'bold 8px "Courier New", monospace';
    const w = ctx.measureText(p.s).width;
    text(p.s, Math.round(p.x - w / 2), Math.round(Math.max(2, p.y - p.t * 18)), p.color);
  }
}

function drawDeadHero(px, py, alpha = 0.85, actor = game.hero) {
  const sp = actorSprite(actor);
  ctx.save();
  ctx.translate(px + 8, py + 8);
  ctx.rotate(Math.PI / 2);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img[sp.sheet] || img.hero, sp.cx * 72 + 24, sp.cy * 128 + 64, 24, 32, -12, -16, 24, 32);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function deathButtons() {
  const pw = 230, ph = 104;
  const px = (W - pw) / 2, py = (H - ph) / 2;
  return {
    box: { x: px, y: py, w: pw, h: ph },
    buttons: [
      { id: 'respawn', label: 'Respawn', x: px + 20, y: py + 72, w: 86, h: 20 },
      { id: 'disconnect', label: 'Disconnect', x: px + 124, y: py + 72, w: 86, h: 20 },
    ],
  };
}

function deathCauseText() {
  const cause = game.death && game.death.cause ? game.death.cause : 'unknown forces';
  return `You were killed by ${cause}.`;
}

function drawDeathPopup() {
  const d = game.death;
  if (!d) return;
  const ui = deathButtons();
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  drawWindow(ui.box.x, ui.box.y, ui.box.w, ui.box.h);
  text('You died', ui.box.x + 94, ui.box.y + 14, '#f76');
  wrapText(deathCauseText(), ui.box.x + 18, ui.box.y + 34, ui.box.w - 36);
  ui.buttons.forEach((b, i) => {
    drawWindow(b.x, b.y, b.w, b.h);
    if ((d.cursor || 0) === i) drawCursor(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    text(b.label, b.x + 14, b.y + 7, '#fff');
  });
}

function deathAction(id) {
  if (id === 'respawn') {
    if (game.net) netSend(game.net, { t: 'respawn' });
    sfx('Decision1');
  } else {
    sfx('Cancel1');
    if (game.net) {
      if (game.net.ws) game.net.ws.close();
    }
    location.reload();
  }
}

function updateDeathPopup() {
  const d = game.death;
  if (!d) return;
  const ui = deathButtons();
  for (const c of clicks) {
    if (c.b !== 0) continue;
    for (let i = 0; i < ui.buttons.length; i++) {
      const b = ui.buttons[i];
      if (hit(c, b.x, b.y, b.w, b.h)) {
        d.cursor = i;
        deathAction(b.id);
        return;
      }
    }
  }
  const hov = ui.buttons.findIndex(b => hit(mouse, b.x, b.y, b.w, b.h));
  if (hov >= 0) d.cursor = hov;
  if (pressed(['ArrowLeft', 'ArrowRight', 'a', 'd'])) { d.cursor = (d.cursor || 0) ^ 1; sfx('Cursor1'); }
  if (pressed(CONFIRM)) deathAction(ui.buttons[d.cursor || 0].id);
}

function hoverBlockedByUI() {
  if (game.worldDrag || game.death || game.mapOpen || game.menu || game.shop || game.itemPopup || game.dropPrompt || game.dialogue ||
    game.playerMenu || game.trade) return true;
  if (game.invOpen && inPanel(mouse)) return true;
  if (game.corpseOpen && inCorpseWin(mouse)) return true;
  return false;
}
function spriteHit(wx, wy, px, py) {
  return wx >= px - 4 && wx < px + 20 && wy >= py - 16 && wy < py + 16;
}
function tileHit(wx, wy, tx, ty, inset = 0) {
  return wx >= tx * TS + inset && wx < (tx + 1) * TS - inset &&
    wy >= ty * TS + inset && wy < (ty + 1) * TS - inset;
}
function floorItemHit(wx, wy, f) {
  return wx >= f.tx * TS + 1 && wx < f.tx * TS + 15 &&
    wy >= f.ty * TS + 1 && wy < f.ty * TS + 15;
}
function hoverTarget() {
  if (hoverBlockedByUI()) return null;
  const cam = camPos();
  const wx = mouse.x + cam.x, wy = mouse.y + cam.y;
  const tx = Math.floor(wx / TS), ty = Math.floor(wy / TS);
  const hits = [];
  const add = (base, pri, t) => hits.push({ base, pri, ...t });

  for (const f of game.floor) {
    if (f.map === game.mapId && tileHit(wx, wy, f.tx, f.ty, 1)) {
      const direct = floorItemHit(wx, wy, f);
      add(direct ? f.ty * TS + TS + 1 : f.ty * TS + 2, direct ? 6 : 1, {
        name: itemLabel(f), hp: 1, maxhp: 1, hpColor: '#9fb4c8',
        x: f.tx * TS + 8 - cam.x, y: f.ty * TS - cam.y, color: '#ffe080',
      });
    }
  }
  for (const c of game.corpses) {
    if (c.map === game.mapId && tileHit(wx, wy, c.tx, c.ty))
      add(c.ty * TS + 4, 2, {
        name: corpseLabel(c), hp: 0, maxhp: 1, hpColor: c.decayed ? '#7b8791' : '#9aa0a6',
        x: c.tx * TS + 8 - cam.x, y: c.ty * TS - cam.y, color: c.decayed ? '#b8c0c8' : '#f0d0d0',
      });
  }
  for (const n of npcs) {
    if (n.map === game.mapId && spriteHit(wx, wy, n.px, n.py))
      add(n.py + TS, 3, {
        name: npcName(n), hp: 1, maxhp: 1, hpColor: '#69d36d',
        x: n.px + 8 - cam.x, y: n.py - 18 - cam.y, color: '#bde8ff',
      });
  }
  for (const en of game.enemies) {
    if (!en.dead && en.dying <= 0 && spriteHit(wx, wy, en.px, en.py))
      add(en.py + TS, 4, {
        name: ENEMIES[en.kind] ? ENEMIES[en.kind].name : en.kind,
        hp: en.hp, maxhp: en.maxhp, hpColor: hpColor(en.hp, en.maxhp),
        x: en.px + 8 - cam.x, y: en.py - 18 - cam.y, color: '#ffd0d0',
      });
  }
  if (game.players) for (const p of game.players) {
    if (!p.dead && spriteHit(wx, wy, p.px, p.py))
      add(p.py + TS, 5, {
        name: p.name || p.id || 'Player', hp: p.hp, maxhp: p.maxhp || 1,
        hpColor: hpColor(p.hp, p.maxhp || 1),
        x: p.px + 8 - cam.x, y: p.py - 18 - cam.y, color: '#d6e8ff',
      });
  }
  const fs = floorAt(tx, ty);
  if (fs.length && !hits.some(h => h.name === itemLabel(fs[0]))) {
    const label = fs.map(itemLabel).slice(0, 2).join(', ') + (fs.length > 2 ? '...' : '');
    add(ty * TS + 1, 0, {
      name: label, hp: 1, maxhp: 1, hpColor: '#9fb4c8',
      x: tx * TS + 8 - cam.x, y: ty * TS - cam.y, color: '#ffe080',
    });
  }
  hits.sort((a, b) => a.base - b.base || a.pri - b.pri);
  return hits[hits.length - 1] || null;
}
function drawHoverCard() {
  const t = hoverTarget();
  if (!t) return;
  const hasHp = typeof t.hp === 'number' && typeof t.maxhp === 'number';
  const w = Math.max(66, Math.ceil(textWidth(t.name)) + 18, hasHp ? 84 : 0);
  const h = hasHp ? 32 : 20;
  const x = Math.max(2, Math.min(W - w - 2, Math.round(t.x - w / 2)));
  const y = Math.max(2, Math.min(H - h - 2, Math.round(t.y - h - 4)));
  drawWindow(x, y, w, h);
  text(t.name, x + 8, y + 6, t.color || '#fff');
  if (hasHp) drawMeter(x + 8, y + 21, w - 16, 5, t.hp, t.maxhp, t.hpColor || hpColor(t.hp, t.maxhp));
}
function drawWorldDrag() {
  const d = game.worldDrag;
  if (!d) return;
  ctx.save();
  ctx.globalAlpha = 0.82;
  if (d.kind === 'floor') {
    const it = itemDef(d.id);
    if (it && img[it.img]) {
      ctx.drawImage(img[it.img], mouse.x - 9, mouse.y - 9, 18, 18);
    } else {
      drawWindow(mouse.x - 9, mouse.y - 9, 18, 18);
      text('?', mouse.x - 2, mouse.y - 3, '#ffe080');
    }
    if (d.n > 1) text(String(d.n), mouse.x + 2, mouse.y + 5, '#ffe080');
  } else if (d.decayed) {
    ctx.translate(mouse.x, mouse.y);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img.skeleton, -16, -10, 32, 20);
  } else {
    drawDeadHero(mouse.x - 8, mouse.y - 8, 0.82, corpseActor(d));
  }
  ctx.restore();
}

const PLAYER_MENU_ITEMS = [
  ['trade', 'Trade'], ['message', 'Message'], ['follow', 'Follow'],
];
function playerMenuItems() {
  if (!game.isAdmin) return PLAYER_MENU_ITEMS;
  return PLAYER_MENU_ITEMS.concat([
    ['adminTeleport', 'Teleport To'],
    ['adminBanAccount', 'Ban Account'],
    ['adminBanCharacter', 'Ban Character'],
  ]);
}
function openPlayerMenu(p, sx, sy) {
  if (!p) return;
  const items = playerMenuItems();
  const w = 104, h = 22 + items.length * 16;
  game.playerMenu = {
    id: p.id, name: p.name || p.id || 'Player', wx: p.px + 8, wy: p.py + 4,
    x: Math.max(4, Math.min(W - w - 4, sx)), y: Math.max(4, Math.min(H - h - 4, sy)), cursor: 0,
  };
  sfx('Cursor1');
}
function playerMenuBox() {
  const m = game.playerMenu;
  return { x: m.x, y: m.y, w: 104, h: 22 + playerMenuItems().length * 16, rowY: m.y + 20, rowH: 16 };
}
function closePlayerMenu() { game.playerMenu = null; }
function playerMenuAction(id) {
  const m = game.playerMenu;
  if (!m) return;
  if (id === 'trade' && game.net) netSend(game.net, { t: 'tradeRequest', id: m.id });
  else if (id === 'message' && typeof openChat === 'function') openChat(`/dm ${m.name} `);
  else if (id === 'follow' && game.net) {
    netSend(game.net, { t: 'followAt', x: m.wx, y: m.wy });
    const p = (game.players || []).find(o => o.id === m.id);
    if (p) { game.followPlayer = p; game.pvpTarget = null; game.lock = null; game.follow = true; game.followEngaged = false; game.path = null; }
  }
  else if (id === 'adminTeleport' && game.net) netSend(game.net, { t: 'adminTeleport', target: m.id });
  else if (id === 'adminBanAccount' && game.net) netSend(game.net, { t: 'adminBanAccount', target: m.id });
  else if (id === 'adminBanCharacter' && game.net) netSend(game.net, { t: 'adminBanCharacter', target: m.id, name: m.name });
  sfx('Decision1');
  closePlayerMenu();
}
function updatePlayerMenu() {
  const m = game.playerMenu;
  if (!m) return;
  const items = playerMenuItems();
  const b = playerMenuBox();
  const hov = hoverRow(b.x + 6, b.rowY, b.w - 12, b.rowH, items.length);
  if (hov >= 0) m.cursor = hov;
  for (const c of clicks) if (c.b === 0) {
    if (!hit(c, b.x, b.y, b.w, b.h)) { closePlayerMenu(); sfx('Cancel1'); return; }
    const row = Math.floor((c.y - b.rowY) / b.rowH);
    if (row >= 0 && row < items.length) { m.cursor = row; playerMenuAction(items[row][0]); return; }
  }
  if (pressed(CANCEL)) { closePlayerMenu(); sfx('Cancel1'); return; }
  if (pressed(['ArrowUp', 'w'])) { m.cursor = (m.cursor + items.length - 1) % items.length; sfx('Cursor1'); }
  if (pressed(['ArrowDown', 's'])) { m.cursor = (m.cursor + 1) % items.length; sfx('Cursor1'); }
  if (pressed(CONFIRM)) playerMenuAction(items[m.cursor][0]);
}
function drawPlayerMenu() {
  const m = game.playerMenu;
  if (!m) return;
  const items = playerMenuItems();
  const b = playerMenuBox();
  drawWindow(b.x, b.y, b.w, b.h);
  text(m.name, b.x + 10, b.y + 7, '#ffe080');
  items.forEach((it, i) => {
    const y = b.rowY + i * b.rowH;
    if (m.cursor === i) drawCursor(b.x + 6, y, b.w - 12, b.rowH);
    text(it[1], b.x + 14, y + 4);
  });
}

function openMapWindow() {
  game.mapOpen = true;
  game.menu = null;
  game.shop = null;
  game.itemPopup = null;
  game.dropPrompt = null;
  game.playerMenu = null;
  game.invFocus = null;
  game.invDrag = null;
  game.lootDrag = null;
  sfx('Decision1');
}
function closeMapWindow() {
  game.mapOpen = false;
  sfx('Cancel1');
}
function toggleMapWindow() {
  if (game.mapOpen) closeMapWindow();
  else openMapWindow();
}
function updateMapWindow() {
  if (pressed(CANCEL) || pressed(CONFIRM)) {
    closeMapWindow();
    return;
  }
  const l = mapWindowLayout();
  for (const c of clicks) if (c.b === 0 && !hit(c, l.x, l.y, l.w, l.h)) {
    closeMapWindow();
    return;
  }
}
function drawWorldMapWindow() {
  if (!game.mapOpen) return;
  const h = game.hero, l = mapWindowLayout();
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.42)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  drawWindow(l.x, l.y, l.w, l.h);
  text(mapName(game.mapId), l.x + 18, l.y + 12, '#ffe080');
  text(`${h.tx},${h.ty}`, l.x + l.w - 54, l.y + 12, '#bcd');
  drawMapRaster(game.mapId, l.mx, l.my, l.cell, { actors: true, viewport: true });
  ctx.strokeStyle = '#9fb4c8';
  ctx.strokeRect(l.mx - 0.5, l.my - 0.5, l.mapW + 1, l.mapH + 1);
}
function drawMiniMap() {
  if (!game.minimapOpen || game.mapOpen) return;
  const l = minimapLayout();
  drawWindow(l.x, l.y, l.w, l.h);
  drawMapRaster(game.mapId, l.mx, l.my, l.cell, { actors: true, viewport: false });
}

// ---------------------------------------------------------------- game menu
const MENU_W = 120;
const MRX = W - 124; // right column: same grid as the inventory windows
const ROOT_MENU = ['Inventory', 'Map', 'Skills', 'Attributes', 'Status', 'Quest', 'Options', 'Log Out'];
const OPTIONS_MENU = ['Music', 'Autoloot', 'Mini Map', 'Log', 'Network'];
function syncAdminMenuEntry() {
  const has = ROOT_MENU.includes('Admin');
  if (game.isAdmin && !has) ROOT_MENU.splice(ROOT_MENU.length - 1, 0, 'Admin');
  else if (!game.isAdmin && has) ROOT_MENU.splice(ROOT_MENU.indexOf('Admin'), 1);
}
function rootBox() { return { x: MRX, y: 8, w: MENU_W, h: ROOT_MENU.length * 16 + 12 }; }
function subX(w) { return Math.max(4, MRX - w - 6); }
function optionLabel(s) {
  return s === 'Music' ? 'Music: ' + (MidiPlayer.isEnabled() ? 'On' : 'Off')
    : s === 'Autoloot' ? 'Autoloot: ' + (game.autoloot ? 'On' : 'Off')
    : s === 'Mini Map' ? 'Mini Map: ' + (game.minimapOpen ? 'On' : 'Off')
    : s === 'Log' ? 'Log: ' + (game.logOpen ? 'On' : 'Off')
    : s === 'Network' ? 'Network: ' + (game.netOverlayOpen ? 'On' : 'Off') : s;
}
function toggleLogWindow() {
  game.logOpen = !game.logOpen;
  sfx(game.logOpen ? 'Decision1' : 'Cancel1');
}
function toggleOption(sel) {
  if (sel === 'Music') {
    MidiPlayer.setEnabled(!MidiPlayer.isEnabled());
    if (MidiPlayer.isEnabled()) syncMusic();
    sfx('Decision1');
  } else if (sel === 'Autoloot') { pushIntent({ t: 'setAutoloot', v: !game.autoloot }); sfx('Decision1'); }
  else if (sel === 'Mini Map') { game.minimapOpen = !game.minimapOpen; sfx('Decision1'); }
  else if (sel === 'Log') toggleLogWindow();
  else if (sel === 'Network') toggleNetOverlayWindow();
}
function logOut() {
  if (game.net) {
    const left = game.isAdmin ? 0 : Math.ceil(game.hero.combatLogoutT || 0);
    if (left > 0) {
      sfx('Buzzer1');
      logMsg(`You cannot log out during combat. Wait ${left}s.`);
      return;
    }
    if (typeof openCharacterScreen === 'function') {
      if (typeof netSend === 'function') netSend(game.net, { t: 'leaveCharacter' });
      game.menu = null;
      game.mapOpen = false;
      game.shop = null;
      game.itemPopup = null;
      game.invFocus = null;
      game.trade = null;
      openCharacterScreen({
        characters: (game.net && game.net.characters) || [{ name: game.hero.name || '', class: game.hero.class || '', lv: game.hero.lv || 1, map: game.mapId || 'city', gold: game.hero.gold || 0 }],
        selected: game.hero.name || '',
        class: game.hero.class || '',
      });
      sfx('Decision1');
      return;
    }
    sfx('Decision1');
    if (game.net.ws) game.net.ws.close();
    location.reload();
    return;
  }
  sfx('Decision1');
  location.reload();
}
function clearMenuShortcutUi() {
  game.mapOpen = false;
  game.shop = null;
  game.itemPopup = null;
  game.dropPrompt = null;
  game.invFocus = null;
  game.invDrag = null;
  game.lootDrag = null;
}
function openRootMenu(cursor = 0) {
  syncAdminMenuEntry();
  clearMenuShortcutUi();
  game.menu = { mode: 'root', cursor };
  sfx('Decision1');
}
function openMenuSection(sel) {
  clearMenuShortcutUi();
  game.menu = { mode: 'root', cursor: Math.max(0, ROOT_MENU.indexOf(sel)) };
  rootMenuSelect(sel);
}
function menuShortcutBlocked() {
  return !!(game.death || game.shop || game.dialogue || game.itemPopup || game.dropPrompt || game.corpseOpen || game.invFocus || game.playerMenu);
}
function handleWindowShortcuts() {
  if (textInputActive() || menuShortcutBlocked()) return false;
  if (keyTapped(MENU_KEYS)) {
    if (game.menu) { game.menu = null; sfx('Cancel1'); }
    else openRootMenu();
    return true;
  }
  for (const sc of WINDOW_SHORTCUTS) {
    if (keyTapped(sc.keys)) {
      openMenuSection(sc.menu);
      return true;
    }
  }
  return false;
}
function rootMenuSelect(sel) {
  const m = game.menu;
  if (sel === 'Inventory') { game.invOpen = !game.invOpen; game.menu = null; sfx('Decision1'); }
  else if (sel === 'Map') openMapWindow();
  else if (sel === 'Skills') { m.mode = 'skills'; m.skillDrag = null; beginSkillDraft(m); sfx('Decision1'); }
  else if (sel === 'Attributes') { m.mode = 'attributes'; m.cursor2 = 0; beginAttrDraft(m); sfx('Decision1'); }
  else if (sel === 'Status') { m.mode = 'status'; sfx('Decision1'); }
  else if (sel === 'Quest') { m.mode = 'quest'; m.questTab = 'active'; sfx('Decision1'); }
  else if (sel === 'Options') { m.mode = 'options'; m.cursor2 = 0; sfx('Decision1'); }
  else if (sel === 'Admin' && typeof openAdminMenu === 'function') openAdminMenu(m);
  else if (sel === 'Log Out') logOut();
}
function hit(c, x, y, w, hgt) { return c.x >= x && c.x < x + w && c.y >= y && c.y < y + hgt; }
function hoverRow(x, y, w, hgt, count, step = hgt) {
  const i = Math.floor((mouse.y - y) / step);
  return i >= 0 && i < count && mouse.x >= x && mouse.x < x + w &&
    mouse.y >= y + i * step && mouse.y < y + i * step + hgt ? i : -1;
}
function copyAttr(a) { return Object.fromEntries(ATTRS.map(([k]) => [k, a[k]])); }
function beginAttrDraft(m) {
  m.attrBase = copyAttr(game.hero.attr);
  m.attrDraft = copyAttr(game.hero.attr);
  m.attrBasePoints = game.hero.points;
  m.attrPoints = game.hero.points;
}
function attrPending(m, k) { return m.attrDraft && m.attrBase && m.attrDraft[k] > m.attrBase[k]; }
function attrHasPending(m) { return !!(m.attrDraft && m.attrBase && ATTRS.some(([k]) => attrPending(m, k))); }
function ensureAttrDraft(m) { if (!m.attrDraft || !m.attrBase) beginAttrDraft(m); }
function addAttrDraft(m, k) {
  ensureAttrDraft(m);
  if (m.attrPoints <= 0) { sfx('Buzzer1'); return; }
  m.attrDraft[k]++;
  m.attrPoints--;
  sfx('Cursor1');
}
function resetAttrDraft(m) {
  ensureAttrDraft(m);
  m.attrDraft = copyAttr(m.attrBase);
  m.attrPoints = m.attrBasePoints;
  sfx('Cancel1');
}
function confirmAttrDraft(m) {
  ensureAttrDraft(m);
  let spent = 0;
  for (const [k] of ATTRS) {
    for (let i = 0; i < m.attrDraft[k] - m.attrBase[k]; i++) {
      pushIntent({ t: 'spendAttr', key: k });
      spent++;
    }
  }
  sfx(spent ? 'Decision1' : 'Cancel1');
  m.attrBase = copyAttr(m.attrDraft);
  m.attrBasePoints = m.attrPoints;
}
function skillUiLevel(id, h = game.hero) { return typeof skillLevel === 'function' ? skillLevel(id, h) : ((h.skillLevels && h.skillLevels[id]) || 1); }
function skillReqForLevels(id, levels = null, h = game.hero) {
  const req = SKILL_TREE && SKILL_TREE[id];
  const reqLevel = levels ? (levels[req] || skillUiLevel(req, h)) : skillUiLevel(req, h);
  return req && reqLevel < 2 ? req : '';
}
function skillReq(id, h = game.hero) {
  return skillReqForLevels(id, null, h);
}
function canUpgradeSkill(id, h = game.hero) {
  return !!(SKILLS[id] && (h.skillPoints || 0) > 0 && skillUiLevel(id, h) < MAX_SKILL_LEVEL && !skillReq(id, h));
}
function copySkillLevels(h = game.hero) {
  return Object.fromEntries(Object.keys(SKILLS).map(id => [id, skillUiLevel(id, h)]));
}
function beginSkillDraft(m, h = game.hero) {
  m.skillBase = copySkillLevels(h);
  m.skillDraft = copySkillLevels(h);
  m.skillBasePoints = h.skillPoints || 0;
  m.skillPoints = h.skillPoints || 0;
}
function ensureSkillDraft(m) {
  if (!m.skillBase || !m.skillDraft || m.skillBasePoints == null || m.skillPoints == null) beginSkillDraft(m);
}
function skillDraftLevel(m, id, h = game.hero) {
  ensureSkillDraft(m);
  return m.skillDraft[id] || skillUiLevel(id, h);
}
function skillPending(m, id) {
  ensureSkillDraft(m);
  return (m.skillDraft[id] || 1) > (m.skillBase[id] || 1);
}
function skillHasPending(m) {
  ensureSkillDraft(m);
  return Object.keys(SKILLS).some(id => skillPending(m, id));
}
function canUpgradeSkillDraft(m, id, h = game.hero) {
  ensureSkillDraft(m);
  return !!(SKILLS[id] && m.skillPoints > 0 && skillDraftLevel(m, id, h) < MAX_SKILL_LEVEL &&
    !skillReqForLevels(id, m.skillDraft, h));
}
function addSkillDraft(m, id) {
  ensureSkillDraft(m);
  if (!canUpgradeSkillDraft(m, id)) { sfx('Buzzer1'); return; }
  m.skillDraft[id] = skillDraftLevel(m, id) + 1;
  m.skillPoints--;
  sfx('Cursor1');
}
function resetSkillDraft(m) {
  ensureSkillDraft(m);
  m.skillDraft = { ...m.skillBase };
  m.skillPoints = m.skillBasePoints;
  sfx('Cancel1');
}
function confirmSkillDraft(m) {
  ensureSkillDraft(m);
  let spent = 0;
  for (const id of Object.keys(SKILLS)) {
    for (let i = 0; i < (m.skillDraft[id] || 1) - (m.skillBase[id] || 1); i++) {
      pushIntent({ t: 'upgradeSkill', id });
      spent++;
    }
  }
  sfx(spent ? 'Decision1' : 'Cancel1');
  m.skillBase = { ...m.skillDraft };
  m.skillBasePoints = m.skillPoints;
}
function skillMpText(id, h = game.hero) {
  const cost = typeof skillCost === 'function' ? skillCost(id, h) : SKILLS[id].mp;
  return cost + 'MP';
}
function skillLayout(ids = Object.keys(SKILLS)) {
  const w = 236, rowH = 18, y = 8, rowY = y + 28;
  const slotsY = rowY + ids.length * rowH + 24;
  return { x: subX(w), y, w, h: ids.length * rowH + 104, rowY, rowH, slotsY, buttonY: slotsY + 26, hintY: slotsY + 50 };
}
function skillSlotAt(l, px, py) {
  for (let j = 0; j < 5; j++) {
    const x = l.x + 14 + j * 22, y = l.slotsY;
    if (px >= x && px < x + 18 && py >= y && py < y + 18) return j;
  }
  return -1;
}
function drawSkillIcon(id, x, y, selected = false) {
  ctx.fillStyle = selected ? '#456380' : 'rgba(10,20,30,.6)';
  ctx.fillRect(x, y, 16, 16);
  ctx.strokeStyle = selected ? '#ffe080' : '#56718a';
  ctx.strokeRect(x + 0.5, y + 0.5, 15, 15);
  text(SKILLS[id].name[0], x + 5, y + 4, selected ? '#ffe080' : '#fff');
}
function drawHotbarEntry(id, x, y, selected = false, h = game.hero) {
  if (!id) return;
  if (SKILLS[id]) {
    drawSkillIcon(id, x, y, selected);
    return;
  }
  const it = ITEMS[id];
  if (!it) return;
  const count = (h.bag && h.bag[id]) || 0;
  ctx.fillStyle = selected ? '#456380' : 'rgba(10,20,30,.6)';
  ctx.fillRect(x, y, 16, 16);
  ctx.strokeStyle = selected ? '#ffe080' : '#56718a';
  ctx.strokeRect(x + 0.5, y + 0.5, 15, 15);
  ctx.globalAlpha = count > 0 ? 1 : 0.45;
  ctx.drawImage(img[it.img], x + 1, y + 1, 14, 14);
  ctx.globalAlpha = 1;
  if (count > 0) text(count > 9 ? '9+' : String(count), x + 7, y + 8, '#ffe080');
}
function attrLayout() { const w = 224, h = 174; return { x: subX(w), y: 8, w, h }; }
function optionsLayout() { const w = 132; return { x: subX(w), y: 8, w, h: OPTIONS_MENU.length * 16 + 16 }; }
function questLayout() { const w = 236, h = 154; return { x: subX(w), y: 8, w, h, tabY: 28, bodyY: 50 }; }
function questTabs(m) {
  if (!m.questTab) m.questTab = 'active';
  return [
    { id: 'active', label: 'Active' },
    { id: 'completed', label: 'Completed' },
  ];
}
function questStepLine(done, label) {
  return `${done ? '[x]' : '[ ]'} ${label}`;
}
function elderQuestLines(q = elderQuest(game.hero)) {
  const def = QUESTS[ELDER_QUEST_ID];
  const progress = Math.min(def.target, q.progress || 0);
  return [
    questStepLine(q.active || q.ready || q.completed, `Talk to ${def.giver}`),
    questStepLine(progress >= def.target, `Defeat monsters ${progress}/${def.target}`),
    questStepLine(q.completed, `Return to ${def.giver} for reward`),
  ];
}
function getTabQuests(tab, h = game.hero) {
  const list = [];
  const q = elderQuest(h);
  const def = QUESTS[ELDER_QUEST_ID];
  if (tab === 'completed') {
    if (q.completed) list.push({ id: ELDER_QUEST_ID, def, q });
  } else {
    if (q.active || q.ready || !q.completed) list.push({ id: ELDER_QUEST_ID, def, q });
  }
  return list;
}
function updateQuestMenu(m, mc) {
  const l = questLayout(), tabs = questTabs(m);
  const h = game.hero;
  if (m.questCursor === undefined) m.questCursor = 0;
  if (m.questScroll === undefined) m.questScroll = 0;
  if (!m.questExpanded) m.questExpanded = {};

  const entries = getTabQuests(m.questTab || 'active', h);

  for (const c of mc) {
    if (!hit(c, l.x, l.y, l.w, l.h)) { m.mode = 'root'; sfx('Cancel1'); return; }
    tabs.forEach((tab, i) => {
      const bx = l.x + 12 + i * 72;
      if (hit(c, bx, l.tabY, 66, 16)) {
        if (m.questTab !== tab.id) {
          m.questTab = tab.id;
          m.questCursor = 0;
          m.questScroll = 0;
          sfx('Cursor1');
        }
      }
    });
    if (game._questRowHits) {
      const hitRow = game._questRowHits.find(r => hit(c, r.x, r.y, r.w, r.h));
      if (hitRow) {
        m.questCursor = hitRow.index;
        m.questExpanded[hitRow.id] = !m.questExpanded[hitRow.id];
        sfx('Decision1');
      }
    }
  }

  if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
  if (pressed(['ArrowLeft', 'a', 'ArrowRight', 'd'])) {
    m.questTab = m.questTab === 'active' ? 'completed' : 'active';
    m.questCursor = 0;
    m.questScroll = 0;
    sfx('Cursor1');
    return;
  }
  if (pressed(['ArrowUp', 'w'])) {
    if (entries.length > 0) {
      m.questCursor = (m.questCursor - 1 + entries.length) % entries.length;
      sfx('Cursor1');
    }
  }
  if (pressed(['ArrowDown', 's'])) {
    if (entries.length > 0) {
      m.questCursor = (m.questCursor + 1) % entries.length;
      sfx('Cursor1');
    }
  }
  if (pressed(['Enter', ' '])) {
    const entry = entries[m.questCursor];
    if (entry) {
      m.questExpanded[entry.id] = !m.questExpanded[entry.id];
      sfx('Decision1');
    }
  }
  if (mouse.wheel !== 0) {
    if (entries.length > 0) {
      m.questScroll = Math.max(0, Math.min(entries.length - 1, m.questScroll + (mouse.wheel > 0 ? 1 : -1)));
    }
    mouse.wheel = 0;
  }
}

function updateMenu(dt) {
  const m = game.menu, h = game.hero;
  syncAdminMenuEntry();
  if (m.msg) {
    m.msgT += dt;
    if (m.msgT > 1.1 || pressed(CONFIRM) || clicked(0)) m.msg = null;
    return;
  }
  if (m.mode !== 'root' && m.cursor2 == null) m.cursor2 = 0;
  const mc = clicks.filter(c => c.b === 0); // left clicks route through the menu
  const rb = rootBox();
  if (m.mode === 'root') {
    const hov = hoverRow(rb.x + 6, rb.y + 6, rb.w - 12, 16, ROOT_MENU.length);
    if (hov >= 0) m.cursor = hov;
    for (const c of mc) {
      let acted = false;
      for (let i = 0; i < ROOT_MENU.length; i++)
        if (hit(c, rb.x + 6, rb.y + 6 + i * 16, rb.w - 12, 16)) { m.cursor = i; rootMenuSelect(ROOT_MENU[i]); acted = true; break; }
      if (!acted && !hit(c, rb.x, rb.y, rb.w, rb.h)) { game.menu = null; sfx('Cancel1'); return; }
      if (!game.menu || game.menu.mode !== 'root') return;
    }
    if (pressed(['ArrowUp', 'w'])) { m.cursor = (m.cursor + ROOT_MENU.length - 1) % ROOT_MENU.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor = (m.cursor + 1) % ROOT_MENU.length; sfx('Cursor1'); }
    if (pressed(CANCEL)) { game.menu = null; sfx('Cancel1'); return; }
    if (pressed(CONFIRM)) rootMenuSelect(ROOT_MENU[m.cursor]);
  } else if (m.mode === 'skills') {
    ensureSkillDraft(m);
    const ids = availableSkillIds(h);
    const l = skillLayout(ids);
    for (const c of clicks) if (c.b === 2 && hit(c, l.x, l.y, l.w, l.h)) {
      const slot = skillSlotAt(l, c.x, c.y);
      if (slot >= 0) {
        const id = h.slots[slot];
        if (id) { pushIntent({ t: 'assignSkill', id, slot }); m.skillDrag = null; sfx('Cancel1'); }
        else sfx('Buzzer1');
        return;
      }
    }
    for (const c of mc) {
      if (!hit(c, l.x, l.y, l.w, l.h)) { m.mode = 'root'; m.skillDrag = null; sfx('Cancel1'); return; }
      const slot = skillSlotAt(l, c.x, c.y);
      if (slot >= 0) {
        if (m.skillDrag) { pushIntent({ t: 'assignSkill', id: m.skillDrag, slot }); m.skillDrag = null; }
        else sfx('Buzzer1');
        continue;
      }
      for (let i = 0; i < ids.length; i++) {
        const ry = l.rowY + i * l.rowH;
        if (hit(c, l.x + l.w - 28, ry + 1, 16, 16)) {
          addSkillDraft(m, ids[i]);
          continue;
        }
        if (hit(c, l.x + 8, ry, l.w - 16, 16)) {
          if (hit(c, l.x + 10, ry, 16, 16)) { m.skillDrag = ids[i]; sfx('Cursor1'); }
        }
      }
      if (skillHasPending(m)) {
        if (hit(c, l.x + 16, l.buttonY, 72, 18)) confirmSkillDraft(m);
        if (hit(c, l.x + 96, l.buttonY, 56, 18)) resetSkillDraft(m);
      }
    }
    for (const r of releases) if (m.skillDrag) {
      const slot = skillSlotAt(l, r.x, r.y);
      if (slot >= 0) pushIntent({ t: 'assignSkill', id: m.skillDrag, slot });
      m.skillDrag = null;
    }
    if (m.skillDrag && !mouse.down) m.skillDrag = null;
    if (m.skillDrag) {
      for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) {
        pushIntent({ t: 'assignSkill', id: m.skillDrag, slot: i });
        m.skillDrag = null; return;
      }
    }
    if (pressed(CANCEL)) { m.mode = 'root'; m.skillDrag = null; sfx('Cancel1'); return; }
    if (pressed(CONFIRM) && skillHasPending(m)) confirmSkillDraft(m);
  } else if (m.mode === 'attributes') {
    ensureAttrDraft(m);
    const l = attrLayout();
    for (const c of mc) {
      if (!hit(c, l.x, l.y, l.w, l.h)) { m.mode = 'root'; sfx('Cancel1'); return; }
      for (let i = 0; i < ATTRS.length; i++) {
        const y = l.y + 30 + i * 15;
        if (hit(c, l.x + 96, y, 14, 14)) addAttrDraft(m, ATTRS[i][0]);
      }
      if (attrHasPending(m)) {
        if (hit(c, l.x + 16, l.y + l.h - 26, 72, 18)) confirmAttrDraft(m);
        if (hit(c, l.x + 96, l.y + l.h - 26, 56, 18)) resetAttrDraft(m);
      }
    }
    if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
    if (pressed(CONFIRM) && attrHasPending(m)) confirmAttrDraft(m);
  } else if (m.mode === 'quest') {
    updateQuestMenu(m, mc);
  } else if (m.mode === 'options') {
    const l = optionsLayout();
    const hov = hoverRow(l.x + 6, l.y + 8, l.w - 12, 16, OPTIONS_MENU.length);
    if (hov >= 0) m.cursor2 = hov;
    for (const c of mc) {
      if (!hit(c, l.x, l.y, l.w, l.h)) { m.mode = 'root'; sfx('Cancel1'); return; }
      for (let i = 0; i < OPTIONS_MENU.length; i++)
        if (hit(c, l.x + 6, l.y + 8 + i * 16, l.w - 12, 16)) { m.cursor2 = i; toggleOption(OPTIONS_MENU[i]); }
    }
    if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
    if (pressed(['ArrowUp', 'w'])) { m.cursor2 = (m.cursor2 + OPTIONS_MENU.length - 1) % OPTIONS_MENU.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor2 = (m.cursor2 + 1) % OPTIONS_MENU.length; sfx('Cursor1'); }
    if (pressed(CONFIRM)) toggleOption(OPTIONS_MENU[m.cursor2]);
  } else if (m.mode === 'admin' && typeof updateAdminMenu === 'function') {
    updateAdminMenu(m, mc, dt);
  } else { // status
    if (pressed(CONFIRM) || pressed(CANCEL) || clicked(0)) { m.mode = 'root'; sfx('Cancel1'); }
  }
}
function drawMenu() {
  const m = game.menu, h = game.hero;
  syncAdminMenuEntry();
  const rb = rootBox();
  drawWindow(rb.x, rb.y, rb.w, rb.h);
  ROOT_MENU.forEach((s, i) => {
    if (m.mode === 'root' && m.cursor === i) drawCursor(rb.x + 6, rb.y + 6 + i * 16, rb.w - 12, 16);
    const left = s === 'Log Out' && game.net && !game.isAdmin ? Math.ceil(h.combatLogoutT || 0) : 0;
    text(left > 0 ? `Log Out ${left}s` : s, rb.x + 14, rb.y + 10 + i * 16, left > 0 ? '#999' : '#fff');
  });
  if (m.mode === 'skills') {
    ensureSkillDraft(m);
    const ids = availableSkillIds(h);
    const l = skillLayout(ids);
    drawWindow(l.x, l.y, l.w, l.h);
    text('Skills', l.x + 12, l.y + 8, '#ffe080');
    text(`Pts ${m.skillPoints}`, l.x + 92, l.y + 8, m.skillPoints ? '#ffe080' : '#bcd');
    ids.forEach((id, i) => {
      const sk = SKILLS[id], slot = h.slots.indexOf(id);
      const y = l.rowY + i * l.rowH, pending = skillPending(m, id);
      drawSkillIcon(id, l.x + 10, y, false);
      text(sk.name, l.x + 32, y + 4);
      text(`Lv${skillDraftLevel(m, id, h)}`, l.x + 82, y + 4, pending ? '#f76' : '#ffe080');
      text(skillMpText(id, h), l.x + 112, y + 4, '#bcd');
      if (slot >= 0) text(`[${slot + 1}]`, l.x + 154, y + 4, '#ffe080');
      drawWindow(l.x + l.w - 28, y, 16, 16);
      text('+', l.x + l.w - 23, y + 4, canUpgradeSkillDraft(m, id, h) ? '#fff' : '#777');
    });
    text('Slots', l.x + 12, l.slotsY - 13, '#9cf');
    for (let j = 0; j < 5; j++) { // clickable hotbar slot boxes
      const bx = l.x + 14 + j * 22, by = l.slotsY;
      drawWindow(bx, by, 18, 18);
      text(String(j + 1), bx + 3, by - 8, '#9cf');
      const sid = h.slots[j];
      if (sid) drawHotbarEntry(sid, bx + 1, by + 1, false, h);
    }
    if (skillHasPending(m)) {
      drawWindow(l.x + 16, l.buttonY, 72, 18);
      text('Confirm', l.x + 30, l.buttonY + 6);
      drawWindow(l.x + 96, l.buttonY, 56, 18);
      text('Reset', l.x + 112, l.buttonY + 6);
    }
    text('Drag skill icons to slots.', l.x + 12, l.hintY, '#bcd');
    if (m.skillDrag) {
      drawSkillIcon(m.skillDrag, mouse.x - 8, mouse.y - 8, true);
      text(SKILLS[m.skillDrag].name, Math.min(W - 86, mouse.x + 12), mouse.y - 3, '#ffe080');
    }
  } else if (m.mode === 'attributes') {
    ensureAttrDraft(m);
    const l = attrLayout(), st = statsForAttr(m.attrDraft);
    drawWindow(l.x, l.y, l.w, l.h);
    text(`Points: ${m.attrPoints}`, l.x + 10, l.y + 10, m.attrPoints > 0 ? '#ffe080' : '#bcd');
    ATTRS.forEach(([k, label], i) => {
      const y = l.y + 30 + i * 15, pending = attrPending(m, k);
      text(label, l.x + 10, y + 2);
      text('' + m.attrDraft[k], l.x + 80, y + 2, pending ? '#f76' : '#ffe080');
      drawWindow(l.x + 96, y, 14, 14);
      text('+', l.x + 100, y + 3, m.attrPoints > 0 ? '#fff' : '#777');
    });
    const dv = [
      ['Attack', st.atk], ['Magic Atk', st.matk], ['Precision', st.prec + '%'],
      ['Crit', st.crit + '%'], ['Endurance', st.end], ['Magic End', st.mend],
      ['Dodge', st.dodge + '%'], ['Atk Spd', st.aspd.toFixed(2)],
    ];
    dv.forEach(([label, v], i) => {
      text(label, l.x + 122, l.y + 16 + i * 15, '#bcd');
      text('' + v, l.x + 180, l.y + 16 + i * 15);
    });
    if (attrHasPending(m)) {
      drawWindow(l.x + 16, l.y + l.h - 26, 72, 18);
      text('Confirm', l.x + 30, l.y + l.h - 20);
      drawWindow(l.x + 96, l.y + l.h - 26, 56, 18);
      text('Reset', l.x + 112, l.y + l.h - 20);
    }
  } else if (m.mode === 'status') {
    const w = 188, x = subX(w);
    const l = { x, y: 8, w, h: 124 };
    drawWindow(l.x, l.y, l.w, l.h);
    const lines = [
      `${heroDisplayName()}  Lv.${h.lv}`,
      `HP  ${Math.floor(h.hp)}/${h.maxhp}`,
      `MP  ${Math.floor(h.mp)}/${h.maxmp}`,
      `Attack ${stats().atk}  Magic ${stats().matk}`,
      `EXP  ${h.exp}/${expToNextLevel(h)}`,
      `Attr points  ${h.points}`,
      `Monsters slain  ${h.kills}`,
    ];
    lines.forEach((line, i) => text(line, x + 12, 18 + i * 15));
  } else if (m.mode === 'quest') {
    const l = questLayout(), tabs = questTabs(m);
    drawWindow(l.x, l.y, l.w, l.h);
    text('Quests', l.x + 12, l.y + 8, '#ffe080');
    tabs.forEach((tab, i) => {
      const bx = l.x + 12 + i * 72;
      if ((m.questTab || 'active') === tab.id) drawCursor(bx - 2, l.tabY - 1, 68, 16);
      text(tab.label, bx + 8, l.tabY + 3);
    });

    if (m.questCursor === undefined) m.questCursor = 0;
    if (m.questScroll === undefined) m.questScroll = 0;
    if (!m.questExpanded) m.questExpanded = {};

    const entries = getTabQuests(m.questTab || 'active', h);

    if (m.questCursor >= entries.length) m.questCursor = Math.max(0, entries.length - 1);
    if (m.questCursor < m.questScroll) m.questScroll = m.questCursor;

    game._questRowHits = [];

    if (entries.length === 0) {
      text(m.questTab === 'completed' ? 'No completed quests.' : 'No active quests.', l.x + 18, l.bodyY + 6, '#9aa7b3');
    } else {
      let curY = l.bodyY;
      const viewMaxY = l.y + l.h - 10;

      for (let index = m.questScroll; index < entries.length; index++) {
        const entry = entries[index];
        const isSelected = m.questCursor === index;
        const isExpanded = !!m.questExpanded[entry.id];

        game._questRowHits.push({
          id: entry.id,
          index: index,
          x: l.x + 6,
          y: curY,
          w: l.w - 28,
          h: 16
        });

        if (isSelected) {
          drawCursor(l.x + 6, curY - 1, l.w - 28, 16);
        }

        const arrow = isExpanded ? '▼ ' : '► ';
        text(arrow + entry.def.title, l.x + 12, curY + 3, isSelected ? '#ffe080' : '#fff');
        curY += 16;

        if (isExpanded) {
          const detailsX = l.x + 20;
          text(`Given by ${entry.def.giver}`, detailsX, curY + 2, '#bcd');
          curY += 14;

          const stepLines = elderQuestLines(entry.q);
          stepLines.forEach((line, i) => {
            let color = '#cde';
            if (m.questTab === 'active' && i === 2 && entry.q.ready) color = '#ffe080';
            text(line, detailsX, curY + 2, color);
            curY += 14;
          });

          text(`Reward: ${entry.def.rewardGold}G ${entry.def.rewardExp}EXP`, detailsX, curY + 2, '#9f9');
          curY += 14;

          let statusText = 'In progress';
          let statusColor = '#bcd';
          if (m.questTab === 'completed') {
            statusText = 'Completed';
            statusColor = '#9f9';
          } else if (entry.q.ready) {
            statusText = 'Ready to turn in';
            statusColor = '#ffe080';
          }
          text(statusText, detailsX, curY + 2, statusColor);
          curY += 14;

          curY += 6;
        }

        if (curY > viewMaxY && index < entries.length - 1) {
          if (isSelected) {
            m.questScroll = Math.min(entries.length - 1, m.questScroll + 1);
          }
          break;
        }
      }

      if (entries.length > 1) {
        const sbX = l.x + l.w - 12;
        const sbY = l.bodyY;
        const sbH = l.h - (l.bodyY - l.y) - 8;
        drawWindow(sbX, sbY, 6, sbH);

        const thumbH = Math.max(10, Math.floor(sbH / entries.length));
        const thumbY = sbY + Math.floor((sbH - thumbH) * (m.questScroll / (entries.length - 1)));
        ctx.fillStyle = '#ffe080';
        ctx.fillRect(sbX + 1, thumbY + 1, 4, thumbH - 2);
      }
    }
  } else if (m.mode === 'options') {
    const l = optionsLayout();
    drawWindow(l.x, l.y, l.w, l.h);
    OPTIONS_MENU.forEach((s, i) => {
      if (m.cursor2 === i) drawCursor(l.x + 6, l.y + 8 + i * 16, l.w - 12, 16);
      text(optionLabel(s), l.x + 14, l.y + 12 + i * 16);
    });
  } else if (m.mode === 'admin' && typeof drawAdminMenu === 'function') {
    drawAdminMenu(m);
  }
  if (m.msg) {
    drawWindow((W - 140) / 2, (H - 30) / 2, 140, 30);
    text(m.msg, (W - 140) / 2 + 14, (H - 30) / 2 + 11, '#ffe080');
  }
}

const DIRROW = { up: 0, right: 1, down: 2, left: 3 };
function drawChar(sheet, cx, cy, dir, frame, px, py) {
  const sx = cx * 72 + Math.floor(frame) % 3 * 24;
  const sy = cy * 128 + DIRROW[dir] * 32;
  ctx.drawImage(sheet, sx, sy, 24, 32, px - 4, py - 16, 24, 32);
}
function actorSprite(a = {}) {
  return CLASS_SPRITES[a.class] || CLASS_SPRITES.Knight;
}
function drawActor(a, px = a.px, py = a.py, alpha = 1) {
  const sp = actorSprite(a);
  const frame = a.moving ? [0, 1, 2, 1][Math.floor(a.anim || 0) % 4] : 1;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  drawChar(img[sp.sheet] || img.hero, sp.cx, sp.cy, a.dir || 'down', frame, px, py);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function drawHud() {
  const h = game.hero, l = hudLayout(), b = hudToggleButton();
  drawWindow(l.x, l.y, l.w, l.h);
  drawWindow(b.x, b.y, b.w, b.h);
  text(game.hudCompact ? '+' : '-', b.x + 5, b.y + 3, '#ffe080');
  if (game.hudCompact) {
    text(clippedText(`${heroDisplayName()} Lv.${h.lv}`, 82), l.x + 8, l.y + 8, '#ffe080');
    drawMeter(l.x + 8, l.y + 24, 62, 5, h.hp, h.maxhp, hpColor(h.hp, h.maxhp));
    text(`${Math.floor(h.hp)}/${h.maxhp}`, l.x + 74, l.y + 21);
    drawMeter(l.x + 8, l.y + 40, 62, 5, h.mp, h.maxmp, '#4bacff');
    text(`${Math.floor(h.mp)}/${h.maxmp}`, l.x + 74, l.y + 37, '#bcd');
    return;
  }
  text(`${heroDisplayName()}  Lv.${h.lv}`, l.x + 8, l.y + 6, '#ffe080');
  drawMeter(l.x + 8, l.y + 19, 112, 5, h.hp, h.maxhp, hpColor(h.hp, h.maxhp));
  text(`HP ${Math.floor(h.hp)}/${h.maxhp}`, l.x + 8, l.y + 27);
  drawMeter(l.x + 8, l.y + 39, 112, 5, h.mp, h.maxmp, '#4bacff');
  text(`MP ${Math.floor(h.mp)}/${h.maxmp}`, l.x + 8, l.y + 47, '#bcd');
  const nextExp = expToNextLevel(h);
  drawMeter(l.x + 8, l.y + 59, 112, 5, h.exp, nextExp, '#ffe080');
  text(`EXP ${Math.floor(h.exp)}/${nextExp}`, l.x + 8, l.y + 67, '#f6d98b');
  text(`Gold ${h.gold}`, l.x + 8, l.y + 78, '#ffe080');
  if (overloaded()) text('OVERWEIGHT', l.x + 8, l.y + 89, '#f76');
}

function drawMap(drawMenuLayer = true) {
  const h = game.hero, m = cur();
  const cam = camPos();
  game.camY = cam.y; // drawBolts anchors lightning to the visible sky
  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const t = GROUND_T[m.ground[y][x]];
    ctx.drawImage(img.chipset, t[0], t[1], TS, TS, x * TS, y * TS, TS, TS);
  }
  const drawables = [];
  if (m.hedge) { // border hedge (skip exit tiles)
    for (let x = 0; x < MW; x++) { drawables.push(prop('bush', x, 0)); drawables.push(prop('bush', x, MH - 1)); }
    for (let y = 1; y < MH - 1; y++) {
      if (!m.exits['0,' + y]) drawables.push(prop('bush', 0, y));
      if (!m.exits[(MW - 1) + ',' + y]) drawables.push(prop('bush', MW - 1, y));
    }
  }
  for (const [t, x, y] of m.props) drawables.push(prop(t, x, y));
  for (const [sx, sy, w, hh, x, y] of m.deco) drawables.push({
    base: (y + 1) * TS,
    draw: () => ctx.drawImage(img.chipset, sx, sy, w, hh, x * TS, (y + 1) * TS - hh, w, hh),
  });
  for (const [x, y] of m.trees) drawables.push({
    base: (y + 1) * TS,
    draw: () => ctx.drawImage(img.chipset, TREE[0], TREE[1], TREE[2], TREE[3], x * TS, y * TS - 16, TREE[2], TREE[3]),
  });
  for (const c of game.corpses) {
    if (c.map !== game.mapId) continue;
    drawables.push({
      base: c.ty * TS + 4, // under the living
      draw: () => {
        if (c.decayed) {
          ctx.save();
          ctx.translate(c.tx * TS + 8, c.ty * TS + 8);
          ctx.rotate(Math.PI / 2);
          ctx.globalAlpha = 0.8;
          ctx.drawImage(img.skeleton, -16, -10, 32, 20);
          ctx.globalAlpha = 1;
          ctx.restore();
        } else {
          drawDeadHero(c.tx * TS, c.ty * TS, 0.85, corpseActor(c));
        }
      },
    });
  }
  for (const f of game.floor) {
    if (f.map !== game.mapId) continue;
    drawables.push({
      base: f.ty * TS + 2, // under actors on the same tile
      draw: () => {
        const it = itemDef(f.id);
        if (it && img[it.img]) ctx.drawImage(img[it.img], f.tx * TS + 2, f.ty * TS + 2, 12, 12);
        else {
          ctx.fillStyle = '#ffe080';
          ctx.fillRect(f.tx * TS + 5, f.ty * TS + 5, 6, 6);
        }
        if (f.n > 1) text('' + f.n, f.tx * TS + 10, f.ty * TS + 8, '#ffe080');
      },
    });
  }
  for (const n of npcs) {
    if (n.map !== game.mapId) continue;
    drawables.push({
      base: n.py + TS,
      draw: () => drawChar(img[n.sheet || 'npc'], n.cx, n.cy, n.dir,
        n.moving ? [0, 1, 2, 1][Math.floor(n.anim) % 4] : 1, n.px, n.py),
    });
  }
  for (const en of game.enemies) drawables.push({
    base: en.py + TS,
    draw: () => drawEnemy(en),
  });
  if (game.players) for (const pl of game.players) if (!pl.dead) drawables.push({ // netplay: other players
    base: pl.py + TS,
    draw: () => drawActor(pl),
  });
  drawables.push({
    base: h.py + TS,
    draw: () => {
      if (h.dead) return;
      const frame = [0, 1, 2, 1][Math.floor(h.anim) % 4];
      drawActor(h);
      if (game.iframes > 0 && Math.floor(game.iframes * 12) % 2) // hurt: flash red
        drawTint(img[actorSprite(h).sheet] || img.hero, actorSprite(h).cx, actorSprite(h).cy, h.dir, frame, h.px, h.py, '#e33', 0.65);
      else if (game.healFx > 0) // healing: green glow
        drawTint(img[actorSprite(h).sheet] || img.hero, actorSprite(h).cx, actorSprite(h).cy, h.dir, frame, h.px, h.py, '#6f6', game.healFx);
    },
  });
  drawables.sort((a, b) => a.base - b.base);
  for (const d of drawables) d.draw();
  if (game.path) { // click-to-move destination marker
    const [dx, dy] = game.path[game.path.length - 1];
    ctx.fillStyle = `rgba(255,224,128,${Math.floor(performance.now() / 200) % 2 ? 0.9 : 0.4})`;
    ctx.fillRect(dx * TS + 6, dy * TS + 6, 4, 4);
  }
  if (game.lock) drawLockBox();
  if (game.pvpTarget) drawPvpTargetBox();
  if (game.follow && (game.lock || game.followPlayer || game.pvpTarget)) drawFollowBox();
  if (game.slashFx) drawSlash();
  drawProjectiles();
  drawBolts();
  drawPops();
  ctx.restore(); // end of the scrolled world; UI is screen-fixed below

  drawHud();
  if (!game.dialogue) { // skill hotbar
    h.slots.forEach((id, i) => {
      const x = 4 + i * 21, y = H - 24;
      drawWindow(x, y, 20, 20);
      text(String(i + 1), x + 3, y + 2, '#9cf');
      if (id) {
        const canUse = SKILLS[id] ? (skillAllowedForClass(id, h) && skillMpAvailable(id, h)) : ((h.bag && h.bag[id]) > 0);
        ctx.globalAlpha = canUse ? 1 : 0.55;
        drawHotbarEntry(id, x + 2, y + 3, false, h);
        ctx.globalAlpha = 1;
      }
    });
  }
  drawMiniMap();
  drawHoverCard();

  if (game.invOpen) drawInvPanel();
  if (game.corpseOpen) drawCorpseWin();
  if (game.logOpen) drawLog();
  drawWorldDrag();
  drawDropPrompt();
  if (game.dialogue) {
    const d = game.dialogue;
    const dw = W - 8 - (game.invOpen ? panelWidth() : 0);
    drawWindow(4, H - 62, dw, 58);
    const full = d.pages[d.page];
    const shown = full.slice(0, Math.floor(d.chars));
    wrapText(shown, 14, H - 52, dw - 24);
    if (d.chars >= full.length && Math.floor(performance.now() / 400) % 2)
      text('▼', dw - 16, H - 18);
  }
  if (game.shop) drawShop();
  if (game.itemPopup) drawItemPopup();
  if (game.mapOpen) drawWorldMapWindow();
  if (game.playerMenu) drawPlayerMenu();
  if (game.death) drawDeathPopup();
  if (drawMenuLayer && game.menu) drawMenu();
}

function updateDialogue(dt) {
  const d = game.dialogue;
  if (!d) return false;
  if (pressed(CANCEL)) {
    game.dialogue = null;
    sfx('Cancel1');
    return true;
  }
  d.chars += dt * 40;
  const full = d.pages[d.page] || '';
  const tapped = pressed(CONFIRM) ||
    clicks.some(c => c.b === 0 && !(game.invOpen && inPanel(c)));
  if (tapped) {
    if (d.chars < full.length) d.chars = full.length;
    else if (++d.page >= d.pages.length) game.dialogue = null;
    else d.chars = 0;
    sfx('Cursor1');
  }
  return true;
}
// toggleable combat/reward log, docked above the skill hotbar (bottom-left)
function drawLog() {
  const rows = 5, lh = 10, lw = 250, lhgt = rows * lh + 16;
  const lx = 4, ly = H - 24 - 6 - lhgt;
  drawWindow(lx, ly, lw, lhgt);
  text('Log', lx + 8, ly + 4, '#bcd');
  game.log.slice(-rows).forEach((s, i) => text(s, lx + 8, ly + 15 + i * lh, '#cde'));
}
function prop(t, x, y) {
  return {
    base: (y + 1) * TS - (t === 'bush' ? 8 : 0),
    draw: () => ctx.drawImage(img.chipset, T[t][0], T[t][1], TS, TS, x * TS, y * TS, TS, TS),
  };
}
function wrapText(str, x, y, w) {
  ctx.font = 'bold 8px "Courier New", monospace';
  const words = str.split(' ');
  let line = '', ly = y;
  for (const wd of words) {
    const t2 = line ? line + ' ' + wd : wd;
    if (ctx.measureText(t2).width > w) { text(line, x, ly); line = wd; ly += 12; }
    else line = t2;
  }
  text(line, x, ly);
}

// ---------------------------------------------------------------- input → intents
// The client half of the old updateMap(): read raw input, drive the local UI
// state (menus, panels, dialogue, drag), and translate player actions into
// intents for the sim. It mutates only presentation/UI state here — every
// change to the *world* goes through pushIntent().
function processInput(dt) {
  const h = game.hero;
  if (game.death) {
    pushIntent({ t: 'moveDir', dir: null });
    updateDeathPopup();
    return;
  }
  if (game.dropPrompt) {
    pushIntent({ t: 'moveDir', dir: null });
    updateDropPrompt();
    return;
  }
  if (handleHudToggleClicks()) {
    pushIntent({ t: 'moveDir', dir: null });
    return;
  }
  if (handleWindowShortcuts()) {
    pushIntent({ t: 'moveDir', dir: null });
    return;
  }
  if (!textInputActive() && keyTapped(MAP_KEYS)) {
    pushIntent({ t: 'moveDir', dir: null });
    toggleMapWindow();
    return;
  }
  if (game.mapOpen) {
    pushIntent({ t: 'moveDir', dir: null });
    updateMapWindow();
    return;
  }
  // walk command: the held direction, unless a UI panel owns the keyboard
  const captured = game.shop || game.menu || game.dialogue || game.itemPopup || game.dropPrompt || game.invFocus || game.worldDrag;
  const heldDir = captured ? null : dirHeld();
  if (heldDir) { setCorpseWalkTarget(null); setFloorLootTarget(null, null); }
  pushIntent({ t: 'moveDir', dir: heldDir });

  // walked away from your remains: the loot window closes itself
  updatePendingCorpseOpen();
  updatePendingFloorLoot((tx, ty) => pushIntent({ t: 'takeLoot', tx, ty }));
  if (game.corpseOpen && (game.corpseOpen.map !== game.mapId ||
    game.corpseOpen.decayed || !nearHero(game.corpseOpen.tx, game.corpseOpen.ty))) {
    game.corpseOpen = null;
    game.corpseDrag = null;
  }

  if (game.itemPopup) { // item details popup: any confirm/click closes
    if (pressed(CANCEL) || pressed(CONFIRM) || clicked(0)) { game.itemPopup = null; sfx('Cancel1'); }
    return;
  }
  if (game.corpseOpen) { // corpse window: take loot; walking stays live
    updateCorpseWinControls((c, id) => pushIntent({ t: 'takeCorpse', tx: c.tx, ty: c.ty, id }));
  }
  if (!game.corpseOpen && !game.shop && !game.menu && !game.dialogue && game.invOpen && pressed(CANCEL)) {
    closeInventory();
    return;
  }
  if (game.invOpen) updateInvPanel(); // panel mouse works in every mode
  if (game.shop) { updateShop(); return; }
  if (game.menu) { updateMenu(dt); return; }
  if (game.dialogue) {
    updateDialogue(dt);
    return;
  }

  // inventory panel: I toggles it, E cycles keyboard focus into it
  if (pressed(['i', 'I'])) {
    game.invOpen = !game.invOpen;
    if (!game.invOpen) { game.invFocus = null; game.invDrag = null; }
    sfx('Decision1');
  }
  if (game.invOpen && pressed(['e', 'E'])) {
    game.invFocus = game.invFocus === null ? 'bag' : game.invFocus === 'bag' ? 'body' : null;
    sfx('Cursor1');
  }

  const cam = camPos(); // screen clicks land in the scrolled world
  finishWorldDragFromReleases(pushIntent);
  for (const c of clicks) {
    if (game.invOpen && inPanel(c)) continue; // the panel owns its clicks
    if (game.corpseOpen && inCorpseWin(c)) continue; // handled above
    if (game.worldDrag) continue;
    if (c.b === 2) { // right-click: interact/open nearby things, no direct lock-on
      const wxp = c.x + cam.x, wyp = c.y + cam.y;
      const wx = Math.floor(wxp / TS), wy = Math.floor(wyp / TS);
      const shopNpc = shopNpcAtPoint(wxp, wyp);
      const co = corpseAt(wx, wy);
      const floor = floorAt(wx, wy);
      if (shopNpc) { setCorpseWalkTarget(null); setFloorLootTarget(null, null); openShopChoice(shopForNpc(shopNpc), c.x, c.y); }
      else if (co && !co.decayed) requestCorpseOpen(co, (tx, ty) => pushIntent({ t: 'moveTo', tx, ty }));
      else if (floor.length) requestFloorLoot(wx, wy,
        (tx, ty) => pushIntent({ t: 'moveTo', tx, ty }),
        (tx, ty) => pushIntent({ t: 'takeLoot', tx, ty }));
      else { setCorpseWalkTarget(null); setFloorLootTarget(null, null); }
    } else if (game.net) {
      // net mode combat clicks (Ctrl/Alt for lock/follow) are handled in netclient.js
    } else if (c.b === 0 && c.ctrl && c.alt) { // Ctrl+Alt + left-click: activate both lock (attack) and follow
      setCorpseWalkTarget(null); setFloorLootTarget(null, null);
      pushIntent({ t: 'followAt', x: c.x + cam.x, y: c.y + cam.y });
    } else if (c.b === 0 && c.ctrl) { // Ctrl+left-click: toggle lock for attack (re-click same to unlock)
      setCorpseWalkTarget(null); setFloorLootTarget(null, null);
      pushIntent({ t: 'lockAt', x: c.x + cam.x, y: c.y + cam.y });
    } else if (c.b === 0 && c.alt) { // Alt + left-click: toggle "Follow mode" on the enemy
      setCorpseWalkTarget(null); setFloorLootTarget(null, null);
      const wx = c.x + cam.x;
      const wy = c.y + cam.y;
      const en = enemyAtPoint(wx, wy);
      if (en && game.lock === en) {
        // direct for local: toggle follow state + sfx (no need to push, apply would double)
        game.follow = !game.follow;
        game.followEngaged = false;
        sfx(game.follow ? 'Decision1' : 'Cancel1');
      } else if (en) {
        pushIntent({ t: 'followAt', x: wx, y: wy });
      }
    } else if (c.b === 0 && !game.invDrag) {
      if (startWorldDragAt(c)) continue;
      const wx = Math.floor((c.x + cam.x) / TS), wy = Math.floor((c.y + cam.y) / TS);
      const co = corpseAt(wx, wy);
      if (co && !co.decayed && nearHero(wx, wy) && c.dbl) { setCorpseWalkTarget(null); setFloorLootTarget(null, null); game.corpseOpen = co; sfx('Decision1'); } // open your remains
      else {
        setCorpseWalkTarget(null); setFloorLootTarget(null, null);
        pushIntent({ t: 'moveTo', tx: wx, ty: wy });
      }
    }
  }
  finishWorldDragFromReleases(pushIntent);
  game.lootDrag = null;
  if (pressed(CANCEL)) {
    if (game.invFocus) { game.invFocus = null; sfx('Cancel1'); return; }
    return;
  }
  if (game.invFocus) { updateInvKeys(); return; } // arrows/Enter/Q work the panel
  if (pressed(['Tab'])) pushIntent({ t: 'cycleLock' });
  if (pressed(['f', 'F'])) pushIntent({ t: 'toggleFollow' });
  if (pressed(CONFIRM)) pushIntent({ t: 'confirm' });
  for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) pushIntent({ t: 'cast', slot: i });
}

// ---------------------------------------------------------------- render interpolation
// The sim advances in discrete 20 Hz ticks, so between ticks entity positions
// would sit still and then jump. To keep motion smooth at any refresh rate we
// remember each moving entity's position at the start of the latest tick (rpx/
// rpy) and, at draw time, blend it toward the current position by the leftover
// accumulator fraction. drawMap() reads px/py as usual — applyInterp() swaps in
// the blended values just for the draw and clearInterp() restores the truth
// afterwards, so input/logic always see real positions.
function snapshotPrev() {
  const h = game.hero; if (h) { h.rpx = h.px; h.rpy = h.py; }
  for (const e of game.enemies) { e.rpx = e.px; e.rpy = e.py; }
  for (const n of npcs) { n.rpx = n.px; n.rpy = n.py; }
  for (const p of game.projectiles) { p.rpx = p.x; p.rpy = p.y; }
}
function blend(cur, prev, a) { return prev == null ? cur : prev + (cur - prev) * a; }
function applyInterp(a) {
  const h = game.hero;
  h._px = h.px; h._py = h.py; h.px = blend(h.px, h.rpx, a); h.py = blend(h.py, h.rpy, a);
  for (const e of game.enemies) { e._px = e.px; e._py = e.py; e.px = blend(e.px, e.rpx, a); e.py = blend(e.py, e.rpy, a); }
  for (const n of npcs) { n._px = n.px; n._py = n.py; n.px = blend(n.px, n.rpx, a); n.py = blend(n.py, n.rpy, a); }
  for (const p of game.projectiles) { p._x = p.x; p._y = p.y; p.x = blend(p.x, p.rpx, a); p.y = blend(p.y, p.rpy, a); }
}
function clearInterp() {
  const h = game.hero;
  h.px = h._px; h.py = h._py;
  for (const e of game.enemies) { e.px = e._px; e.py = e._py; }
  for (const n of npcs) { n.px = n._px; n.py = n._py; }
  for (const p of game.projectiles) { p.x = p._x; p.y = p._y; }
}

// ---------------------------------------------------------------- main loop
// Fixed-timestep loop: input every rendered frame, but the world only advances
// in whole 20 Hz ticks pulled from a time accumulator (so the sim is fully
// decoupled from the display's refresh rate — the same cadence the server will
// run). Whatever time is left in the accumulator becomes the interpolation
// alpha for a smooth draw.
const FIXED = 1 / 20; // authoritative tick: 20 Hz
let last = 0, acc = 0;
function loop(ts) {
  let frame = (ts - last) / 1000;
  last = ts;
  if (!(frame >= 0)) frame = 0;   // first frame / clock reset
  if (frame > 0.25) frame = 0.25; // don't spiral after a long pause
  if (game.scene === 'title') {
    if (!game.net) netStart(configuredNetUrl());
    acc = 0;
  } else if (game.scene === 'map') {
    if (game.net) {
      netFrame(frame); // netplay: predict own hero, render server snapshots
    } else {
      netStart(configuredNetUrl());
      acc = 0;
    }
  }
  queue = [];
  keyTap.clear();
  clicks = [];
  releases = [];
  wheelY = 0;
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- boot
function defaultNetUrl() {
  return (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
}
function configuredNetUrl() {
  const v = new URLSearchParams(location.search).get('net');
  return v && v !== '1' ? v : defaultNetUrl();
}
Promise.all(IMAGES.map(n => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => { img[n] = i; res(); };
  i.onerror = rej;
  i.src = 'assets/' + n + '.png';
}))).then(() => {
  resetGame();
  netStart(configuredNetUrl());
  focusGame();
  requestAnimationFrame(loop);
}).catch(e => {
  ctx.fillStyle = '#fff';
  ctx.fillText('Failed to load assets: ' + e, 10, 20);
});
