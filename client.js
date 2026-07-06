'use strict';
// Fable Quest — browser CLIENT (Phase 0 split of game.js): canvas + camera,
// input capture, rendering, UI panels/menus, localStorage persistence, and the
// main loop. It reads world state from sim.js to draw it, and turns raw input
// into intents (pushIntent) that the sim resolves. Loaded after sim.js, so it
// shares the global scope where sim's constants and functions live.

const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');

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
const IMAGES = ['chipset', 'hero', 'npc', 'custom', 'knight', 'system', 'title',
  'monsters', 'slash', 'flame', 'punch',
  'i_potion', 'i_bread', 'i_meat', 'i_sword1', 'i_sword2', 'i_sword3',
  'i_hat', 'i_helm', 'i_shield', 'i_armor', 'i_legs', 'i_boots', 'i_ring', 'i_amulet'];
const img = {};
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
let queue = [];
const CONFIRM = ['Enter', ' ', 'z', 'Z'];
const CANCEL = ['Escape', 'x', 'X'];
const KEY_DIR = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down',
  ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
let dirOrder = []; // held direction keys, most-recently-pressed last
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
  if (!held[e.key]) queue.push(e.key);
  held[e.key] = true;
  const d = KEY_DIR[e.key]; // newest direction takes over; releasing it falls back
  if (d && !dirOrder.includes(d)) dirOrder.push(d);
  if (!audioOk) { audioOk = true; syncMusic(); }
});
addEventListener('keyup', e => {
  held[e.key] = false;
  const d = KEY_DIR[e.key];
  // drop the direction only if no other still-held key maps to it (w vs Arrow)
  if (d && !Object.keys(KEY_DIR).some(k => KEY_DIR[k] === d && held[k]))
    dirOrder = dirOrder.filter(x => x !== d);
});
function pressed(keys) { return queue.some(k => keys.includes(k)); }

// mouse: button 0 walks (click-to-move), button 2 locks a target.
// In menus the same events drive the inventory: click, double-click, drag.
let clicks = [], releases = [];
const mouse = { x: 0, y: 0, down: false };
let lastClick = { t: 0, x: -99, y: -99 };
function canvasXY(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousemove', e => Object.assign(mouse, canvasXY(e)));
cv.addEventListener('mousedown', e => {
  e.preventDefault();
  const p = canvasXY(e);
  Object.assign(mouse, p);
  if (e.button === 0) mouse.down = true;
  const now = performance.now();
  const dbl = e.button === 0 && now - lastClick.t < 400 &&
    Math.abs(p.x - lastClick.x) < 8 && Math.abs(p.y - lastClick.y) < 8;
  if (e.button === 0) lastClick = { t: dbl ? 0 : now, x: p.x, y: p.y };
  clicks.push({ b: e.button, x: p.x, y: p.y, dbl, alt: e.altKey });
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
function drawWindow(x, y, w, h) {
  const s = img.system;
  ctx.globalAlpha = 0.85;
  ctx.drawImage(s, 0, 0, 32, 32, x + 1, y + 1, w - 2, h - 2);
  ctx.globalAlpha = 1;
  nineSlice(s, 32, 0, x, y, w, h);
}
function drawCursor(x, y, w, h) { nineSlice(img.system, 64, 0, x, y, w, h); }
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
  game.corpses.forEach(c => { if (!c.items) c.items = {}; }); // pre-loot saves
  game.corpseOpen = null;
  game.autoloot = d.autoloot !== false;
  game.invOpen = d.invOpen !== false;
  game.logOpen = d.logOpen !== false;
  game.shop = null;
  const h = game.hero;
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
  game.path = null;
  if (!h.slots) h.slots = ['fire', 'heal', 'spin', 'bolt', null]; // pre-skillbar save
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
  return true;
}

// ---------------------------------------------------------------- map data
// ground chars: G grass, D dirt, W water (blocked), P pavement,
// X city wall, R shop brick, U shop stucco, O shop door (all blocked)
const GROUND_T = {
  G: [304, 48], D: [352, 48], W: [0, 64], P: [192, 80],
  X: [224, 0], R: [224, 32], U: [224, 48], O: [208, 32],
};
const BODY_GRID = [ // keyboard navigation layout (rows of the paper doll)
  [null, 'head', null],
  ['main', 'torso', 'off'],
  [null, 'legs', null],
  ['acc1', 'boots', 'acc2'],
];
// persistent inventory, docked to the right edge as two separate windows:
// the body paper-doll on top, the backpack below it. Toggled with I.
const BODY_WIN = { x: W - 124, y: 4, w: 120, h: 148 };
const BAG_WIN = { x: W - 124, y: 156, w: 120, h: H - 160 };
const PANEL = { x: W - 124 }; // anything right of this belongs to the panel
const BAG_UI = { x: BAG_WIN.x + 12, y: BAG_WIN.y + 30, C: 4, S: 26 };
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
function bagCellAt(px, py) { // bag index under a canvas point, or -1
  const n = bagIds().length;
  for (let i = 0; i < n; i++) {
    const x = BAG_UI.x + (i % BAG_UI.C) * BAG_UI.S, y = BAG_UI.y + Math.floor(i / BAG_UI.C) * BAG_UI.S;
    if (px >= x - 3 && px < x + 21 && py >= y - 3 && py < y + 21) return i;
  }
  return -1;
}
function bodySlotAt(px, py) {
  for (const [slot, [x, y]] of Object.entries(BODY_UI))
    if (px >= x && px < x + 24 && py >= y && py < y + 24) return slot;
  return null;
}
function inPanel(p) { return p.x >= PANEL.x; }

// corpse-loot window, docked just left of the inventory panel
const CORPSE_WIN = { x: W - 260, y: 4, w: 128, h: 150, C: 4, S: 26 };
function inCorpseWin(p) {
  return p.x >= CORPSE_WIN.x && p.x < CORPSE_WIN.x + CORPSE_WIN.w &&
    p.y >= CORPSE_WIN.y && p.y < CORPSE_WIN.y + CORPSE_WIN.h;
}
function corpseCellAt(px, py) {
  const { x: X, y: Y, C, S } = CORPSE_WIN;
  for (let i = 0; i < C * 4; i++) {
    const x = X + 12 + (i % C) * S, y = Y + 30 + Math.floor(i / C) * S;
    if (px >= x - 3 && px < x + 21 && py >= y - 3 && py < y + 21) return i;
  }
  return -1;
}
function drawCorpseWin() {
  const c = game.corpseOpen, ids = Object.keys(c.items);
  drawWindow(CORPSE_WIN.x, CORPSE_WIN.y, CORPSE_WIN.w, CORPSE_WIN.h);
  text('Your remains', CORPSE_WIN.x + 12, CORPSE_WIN.y + 7, '#f76');
  ids.forEach((id, i) => {
    const x = CORPSE_WIN.x + 12 + (i % CORPSE_WIN.C) * CORPSE_WIN.S;
    const y = CORPSE_WIN.y + 30 + Math.floor(i / CORPSE_WIN.C) * CORPSE_WIN.S;
    ctx.drawImage(img[ITEMS[id].img], x, y, 18, 18);
    text('' + c.items[id], x + 10, y + 12, '#ffe080');
  });
  if (!ids.length) text('Picked clean.', CORPSE_WIN.x + 12, CORPSE_WIN.y + 34, '#999');
  text('Dbl-click: take', CORPSE_WIN.x + 10, CORPSE_WIN.y + CORPSE_WIN.h - 26, '#9cf');
  text('Enter: take all', CORPSE_WIN.x + 10, CORPSE_WIN.y + CORPSE_WIN.h - 14, '#9cf');
}

// what item (if any) the mouse is hovering in the panel
function panelHoverId() {
  if (!game.invOpen || game.invDrag) return null;
  const bi = bagCellAt(mouse.x, mouse.y);
  if (bi >= 0) return bagIds()[bi];
  const bs = bodySlotAt(mouse.x, mouse.y);
  if (bs && game.hero.equip[bs]) return game.hero.equip[bs];
  return null;
}

// mouse interactions on the live panel: click selects, double-click
// uses/equips/unequips, drag moves gear (drag out of the panel to drop/unequip)
function updateInvPanel() {
  const h = game.hero, ids = bagIds();
  game.invCursor = Math.min(game.invCursor || 0, Math.max(0, ids.length - 1));
  if (!game.invSlot) game.invSlot = 'torso';
  // the tooltip's [?] button opens the item details popup and eats the click
  if (game.tipBtn) {
    const b = game.tipBtn;
    const hit = clicks.find(c => c.b === 0 &&
      c.x >= b.x && c.x < b.x + b.w && c.y >= b.y && c.y < b.y + b.h);
    if (hit) {
      game.itemPopup = b.id;
      sfx('Decision1');
      clicks = clicks.filter(c => c !== hit);
      return;
    }
  }
  for (const c of clicks) {
    if (c.b !== 0 || !inPanel(c)) continue;
    const bi = bagCellAt(c.x, c.y), bs = bodySlotAt(c.x, c.y);
    if (bi >= 0) {
      game.invFocus = 'bag';
      game.invCursor = bi;
      if (c.dbl) pushIntent({ t: 'useItem', id: ids[bi] });
      else game.invDrag = { from: 'bag', id: ids[bi] };
    } else if (bs) {
      game.invFocus = 'body';
      game.invSlot = bs;
      if (c.dbl) pushIntent({ t: 'unequip', slot: bs });
      else if (h.equip[bs]) game.invDrag = { from: 'body', slot: bs, id: h.equip[bs] };
    }
  }
  for (const r of releases) {
    if (r.b !== 0 || !game.invDrag) continue;
    const d = game.invDrag, bs = bodySlotAt(r.x, r.y);
    if (d.from === 'bag') {
      if (bs) pushIntent({ t: 'equip', id: d.id, slot: bs });
      else if (!inPanel(r)) pushIntent({ t: 'dropItem', id: d.id }); // dragged onto the map
    } else if (bs && bs !== d.slot && canPlace(d.id, bs)) {
      pushIntent({ t: 'unequip', slot: d.slot }); // move between slots (ring to the other finger)
      pushIntent({ t: 'equip', id: d.id, slot: bs });
    } else if (!bs) {
      pushIntent({ t: 'unequip', slot: d.slot }); // dragged off the body: back to the bag
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
      if (pressed(CONFIRM)) pushIntent({ t: 'useItem', id: ids[game.invCursor] });
      if (pressed(['q', 'Q'])) pushIntent({ t: 'dropItem', id: ids[game.invCursor] });
    }
  } else { // body
    if (!game.invSlot) game.invSlot = 'torso';
    for (const [keys, dir] of [[['ArrowUp', 'w'], 'up'], [['ArrowDown', 's'], 'down'],
      [['ArrowLeft', 'a'], 'left'], [['ArrowRight', 'd'], 'right']]) {
      if (pressed(keys) && BODY_NAV[game.invSlot][dir]) { game.invSlot = BODY_NAV[game.invSlot][dir]; sfx('Cursor1'); }
    }
    if (pressed(CONFIRM) || pressed(['q', 'Q'])) pushIntent({ t: 'unequip', slot: game.invSlot });
  }
}

function drawInvPanel() {
  const h = game.hero, ids = bagIds();
  game.invCursor = Math.min(game.invCursor || 0, Math.max(0, ids.length - 1));

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
  ids.forEach((id, i) => {
    const x = BAG_UI.x + (i % BAG_UI.C) * BAG_UI.S, y = BAG_UI.y + Math.floor(i / BAG_UI.C) * BAG_UI.S;
    if (game.invFocus === 'bag' && game.invCursor === i) drawCursor(x - 4, y - 4, BAG_UI.S - 2, BAG_UI.S - 2);
    ctx.drawImage(img[ITEMS[id].img], x, y, 18, 18);
    text('' + h.bag[id], x + 10, y + 12, '#ffe080');
  });
  if (!ids.length) text('Empty...', BAG_UI.x, BAG_UI.y + 4, '#999');
  text('I:hide E:keys Q:drop', BAG_WIN.x + 10, BAG_WIN.y + BAG_WIN.h - 14, '#9cf');

  // hover tooltip: item name + a [?] button that opens the details popup
  game.tipBtn = null;
  const hovId = panelHoverId();
  if (hovId) {
    const it = ITEMS[hovId];
    ctx.font = 'bold 8px "Courier New", monospace';
    const tw = ctx.measureText(it.name).width + 26;
    const tx = Math.max(4, Math.min(W - tw - 4, mouse.x - tw + 4));
    const ty = Math.max(4, mouse.y - 22);
    drawWindow(tx, ty, tw, 18);
    text(it.name, tx + 6, ty + 5);
    const bx = tx + tw - 15;
    ctx.fillStyle = '#2a4a6a';
    ctx.fillRect(bx, ty + 4, 11, 10);
    ctx.strokeStyle = '#9cf';
    ctx.strokeRect(bx + 0.5, ty + 4.5, 10, 9);
    text('?', bx + 3, ty + 5, '#9cf');
    game.tipBtn = { x: bx, y: ty + 4, w: 11, h: 10, id: hovId };
  }

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
function updateShop() {
  const s = game.shop, stock = SHOPS[s.who].stock;
  const SX = (W - 240) / 2, SY = (H - stock.length * 18 - 74) / 2; // matches drawShop
  for (const c of clicks) {
    if (c.b !== 0) continue;
    if (!hit(c, SX, SY, 240, stock.length * 18 + 74)) { game.shop = null; sfx('Cancel1'); return; }
    for (let i = 0; i < stock.length; i++)
      if (hit(c, SX + 6, SY + 20 + i * 18, 228, 18)) { // click selects, dbl-click buys
        s.cursor = i;
        if (c.dbl) pushIntent({ t: 'buy' }); else sfx('Cursor1');
      }
  }
  if (pressed(CANCEL)) { game.shop = null; sfx('Cancel1'); return; }
  if (pressed(['ArrowUp', 'w'])) { s.cursor = (s.cursor + stock.length - 1) % stock.length; sfx('Cursor1'); }
  if (pressed(['ArrowDown', 's'])) { s.cursor = (s.cursor + 1) % stock.length; sfx('Cursor1'); }
  if (pressed(CONFIRM)) pushIntent({ t: 'buy' });
}
function drawShop() {
  const s = game.shop, h = game.hero, shop = SHOPS[s.who], stock = shop.stock;
  const SX = (W - 240) / 2, SY = (H - stock.length * 18 - 74) / 2;
  drawWindow(SX, SY, 240, stock.length * 18 + 74);
  text(`${shop.name} — Gold ${h.gold}`, SX + 12, SY + 8, '#ffe080');
  stock.forEach((id, i) => {
    const it = ITEMS[id];
    if (s.cursor === i) drawCursor(SX + 6, SY + 20 + i * 18, 228, 18);
    ctx.drawImage(img[it.img], SX + 12, SY + 21 + i * 18, 16, 16);
    text(it.name, SX + 32, SY + 25 + i * 18, h.gold >= it.price ? '#fff' : '#999');
    text(it.price + 'g', SX + 152, SY + 25 + i * 18, '#ffe080');
    text('x' + (h.bag[id] || 0), SX + 196, SY + 25 + i * 18, '#bcd');
  });
  const it = ITEMS[stock[s.cursor]];
  text(itemInfo(it), SX + 12, SY + stock.length * 18 + 26, '#bcd');
  text(`Weight ${it.w}   (carrying ${bagWeight().toFixed(1)}/${capacity()})`, SX + 12, SY + stock.length * 18 + 40, '#bcd');
  text('Enter / dbl-click: buy   Esc: leave', SX + 12, SY + stock.length * 18 + 56, '#9cf');
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

function drawLockBox() {
  const en = game.lock;
  const p = Math.floor(performance.now() / 250) % 2; // gentle pulse
  const x = en.px - 3 - p, y = en.py - 12 - p, w = 22 + 2 * p, hh = 29 + 2 * p, L = 5;
  ctx.fillStyle = '#1a2a3a';
  drawCorners(x + 1, y + 1, w, hh, L);
  ctx.fillStyle = '#ffe080';
  drawCorners(x, y, w, hh, L);
}
// follow marker: a blue bracket that sits one ring outside the yellow lock box
function drawFollowBox() {
  const en = game.lock;
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

// ---------------------------------------------------------------- game menu
const ROOT_MENU = ['Inventory', 'Skills', 'Attribs', 'Status', 'Quest', 'Save', 'Load', 'Music', 'Autoloot', 'Log', 'To Title'];
function rootMenuSelect(sel) {
  const m = game.menu;
  if (sel === 'Inventory') { game.invOpen = !game.invOpen; game.menu = null; sfx('Decision1'); }
  else if (sel === 'Skills') { m.mode = 'skills'; m.cursor2 = 0; m.assign = false; sfx('Decision1'); }
  else if (sel === 'Attribs') { m.mode = 'attribs'; m.cursor2 = 0; sfx('Decision1'); }
  else if (sel === 'Status' || sel === 'Quest') { m.mode = sel.toLowerCase(); sfx('Decision1'); }
  else if (sel === 'Save') { saveGame(); m.msg = 'Game saved!'; m.msgT = 0; sfx('Recovery1'); }
  else if (sel === 'Load') {
    if (loadGame()) { m.msg = 'Game loaded!'; m.msgT = 0; sfx('Recovery1'); }
    else { m.msg = 'No saved game.'; m.msgT = 0; sfx('Buzzer1'); }
  } else if (sel === 'Music') {
    MidiPlayer.setEnabled(!MidiPlayer.isEnabled());
    if (MidiPlayer.isEnabled()) syncMusic();
    sfx('Decision1');
  } else if (sel === 'Autoloot') { pushIntent({ t: 'setAutoloot', v: !game.autoloot }); sfx('Decision1'); }
  else if (sel === 'Log') { game.logOpen = !game.logOpen; sfx('Decision1'); }
  else { // To Title
    sfx('Decision1');
    game.menu = null;
    game.scene = 'title';
    game.titleCursor = 0;
    syncMusic();
  }
}
function hit(c, x, y, w, hgt) { return c.x >= x && c.x < x + w && c.y >= y && c.y < y + hgt; }

function updateMenu(dt) {
  const m = game.menu, h = game.hero;
  if (m.msg) {
    m.msgT += dt;
    if (m.msgT > 1.1 || pressed(CONFIRM) || clicked(0)) m.msg = null;
    return;
  }
  const mc = clicks.filter(c => c.b === 0); // left clicks route through the menu
  const LX = MRX - 200; // must match drawMenu
  if (m.mode === 'root') {
    for (const c of mc) {
      let acted = false;
      for (let i = 0; i < ROOT_MENU.length; i++)
        if (hit(c, MRX + 6, 14 + i * 16, 100, 16)) { m.cursor = i; rootMenuSelect(ROOT_MENU[i]); acted = true; break; }
      if (!acted && !hit(c, MRX, 8, 112, ROOT_MENU.length * 16 + 40)) { game.menu = null; sfx('Cancel1'); return; }
      if (!game.menu || game.menu.mode !== 'root') return;
    }
    if (pressed(['ArrowUp', 'w'])) { m.cursor = (m.cursor + ROOT_MENU.length - 1) % ROOT_MENU.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor = (m.cursor + 1) % ROOT_MENU.length; sfx('Cursor1'); }
    if (pressed(CANCEL)) { game.menu = null; sfx('Cancel1'); return; }
    if (pressed(CONFIRM)) rootMenuSelect(ROOT_MENU[m.cursor]);
  } else if (m.mode === 'skills') {
    const ids = Object.keys(SKILLS);
    for (const c of mc) {
      if (!hit(c, LX, 8, 188, ids.length * 16 + 64)) { m.mode = 'root'; sfx('Cancel1'); return; }
      for (let i = 0; i < ids.length; i++) // click a skill row: select it
        if (hit(c, LX + 6, 14 + i * 16, 176, 16)) { m.cursor2 = i; m.assign = true; sfx('Cursor1'); }
      for (let j = 0; j < 5; j++) // click a hotbar slot box: assign
        if (hit(c, LX + 12 + j * 20, ids.length * 16 + 40, 16, 16)) pushIntent({ t: 'assignSkill', id: ids[m.cursor2], slot: j });
    }
    if (m.assign) { // waiting for a slot number
      if (pressed(CANCEL)) { m.assign = false; sfx('Cancel1'); return; }
      for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) { pushIntent({ t: 'assignSkill', id: ids[m.cursor2], slot: i }); m.assign = false; return; }
    }
    if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
    if (pressed(['ArrowUp', 'w'])) { m.cursor2 = (m.cursor2 + ids.length - 1) % ids.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor2 = (m.cursor2 + 1) % ids.length; sfx('Cursor1'); }
    if (pressed(CONFIRM)) { m.assign = true; sfx('Decision1'); }
  } else if (m.mode === 'attribs') {
    for (const c of mc) {
      if (!hit(c, LX, 8, 100, ATTRS.length * 15 + 34)) { m.mode = 'root'; sfx('Cancel1'); return; }
      for (let i = 0; i < ATTRS.length; i++)
        if (hit(c, LX + 4, 27 + i * 15, 92, 15)) { // click an attribute: spend a point
          m.cursor2 = i;
          pushIntent({ t: 'spendAttr', key: ATTRS[i][0] });
        }
    }
    if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
    if (pressed(['ArrowUp', 'w'])) { m.cursor2 = (m.cursor2 + ATTRS.length - 1) % ATTRS.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor2 = (m.cursor2 + 1) % ATTRS.length; sfx('Cursor1'); }
    if (pressed(CONFIRM) || pressed(['ArrowRight', 'd']))
      pushIntent({ t: 'spendAttr', key: ATTRS[m.cursor2][0] });
  } else { // status / quest
    if (pressed(CONFIRM) || pressed(CANCEL) || clicked(0)) { m.mode = 'root'; sfx('Cancel1'); }
  }
}
const MRX = (W - 112) / 2; // root menu, centered
function drawMenu() {
  const m = game.menu, h = game.hero;
  drawWindow(MRX, 8, 112, ROOT_MENU.length * 16 + 12);
  ROOT_MENU.forEach((s, i) => {
    if (m.mode === 'root' && m.cursor === i) drawCursor(MRX + 6, 14 + i * 16, 100, 16);
    const label = s === 'Music' ? 'Music: ' + (MidiPlayer.isEnabled() ? 'On' : 'Off')
      : s === 'Autoloot' ? 'Autoloot: ' + (game.autoloot ? 'On' : 'Off')
      : s === 'Log' ? 'Log: ' + (game.logOpen ? 'On' : 'Off')
      : s === 'Inventory' ? 'Inventory: ' + (game.invOpen ? 'On' : 'Off') : s;
    text(label, MRX + 14, 18 + i * 16);
  });
  drawWindow(MRX, ROOT_MENU.length * 16 + 24, 112, 24);
  text(`Gold ${h.gold}`, MRX + 14, ROOT_MENU.length * 16 + 32);
  const LX = MRX - 200; // sub-screens open just left of the menu column
  if (m.mode === 'skills') {
    const ids = Object.keys(SKILLS);
    drawWindow(LX, 8, 188, ids.length * 16 + 64);
    ids.forEach((id, i) => {
      const sk = SKILLS[id], slot = h.slots.indexOf(id);
      if (m.cursor2 === i) drawCursor(LX + 6, 14 + i * 16, 176, 16);
      text(sk.name, LX + 16, 18 + i * 16);
      text(sk.mp + 'MP', LX + 80, 18 + i * 16, '#bcd');
      if (slot >= 0) text(`[${slot + 1}]`, LX + 120, 18 + i * 16, '#ffe080');
    });
    text('Slots (click to assign):', LX + 12, ids.length * 16 + 26, '#9cf');
    for (let j = 0; j < 5; j++) { // clickable hotbar slot boxes
      const bx = LX + 12 + j * 20, by = ids.length * 16 + 40;
      drawWindow(bx, by, 16, 16);
      text(String(j + 1), bx + 2, by - 8, '#9cf');
      const sid = h.slots[j];
      if (sid) text(SKILLS[sid].name[0], bx + 5, by + 4, sid === ids[m.cursor2] ? '#ffe080' : '#fff');
    }
  } else if (m.mode === 'attribs') {
    const st = stats();
    drawWindow(LX, 8, 100, ATTRS.length * 15 + 34);
    text(`Points: ${h.points}`, LX + 8, 15, h.points > 0 ? '#ffe080' : '#bcd');
    ATTRS.forEach(([k, label], i) => {
      if (m.cursor2 === i) drawCursor(LX + 4, 27 + i * 15, 92, 15);
      text(label, LX + 10, 31 + i * 15);
      text('' + h.attr[k], LX + 82, 31 + i * 15, '#ffe080');
    });
    text(h.points > 0 ? 'Enter: +1' : 'No points', LX + 8, ATTRS.length * 15 + 28, '#9cf');
    drawWindow(LX + 102, 8, 94, 132);
    const dv = [
      ['Attack', st.atk], ['Magic Atk', st.matk], ['Precision', st.prec + '%'],
      ['Crit', st.crit + '%'], ['Endurance', st.end], ['Magic End', st.mend],
      ['Dodge', st.dodge + '%'], ['Atk Spd', st.aspd.toFixed(2)],
    ];
    dv.forEach(([label, v], i) => {
      text(label, LX + 110, 16 + i * 15, '#bcd');
      text('' + v, LX + 164, 16 + i * 15);
    });
  } else if (m.mode === 'status') {
    drawWindow(LX, 8, 188, 124);
    const lines = [
      `Hero  Lv.${h.lv}`,
      `HP  ${Math.floor(h.hp)}/${h.maxhp}`,
      `MP  ${Math.floor(h.mp)}/${h.maxmp}`,
      `Attack ${stats().atk}  Magic ${stats().matk}`,
      `EXP  ${h.exp}/${h.lv * 10}`,
      `Attr points  ${h.points}`,
      `Monsters slain  ${h.kills}`,
    ];
    lines.forEach((l, i) => text(l, LX + 12, 18 + i * 15));
  } else if (m.mode === 'quest') {
    drawWindow(LX, 8, 188, 76);
    text('QUEST', LX + 12, 16, '#ffe080');
    wrapText(
      game.won ? 'Complete! You are the hero of the valley.'
        : `The Elder asked you to slay 5 monsters in the grass. (${h.kills}/5)`,
      LX + 12, 32, 164);
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

function drawMap() {
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
        ctx.save();
        ctx.translate(c.tx * TS + 8, c.ty * TS + 8);
        ctx.rotate(Math.PI / 2);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(img.hero, 24, 64, 24, 32, -12, -16, 24, 32); // lying on his side
        ctx.globalAlpha = 1;
        ctx.restore();
      },
    });
  }
  for (const f of game.floor) {
    if (f.map !== game.mapId) continue;
    drawables.push({
      base: f.ty * TS + 2, // under actors on the same tile
      draw: () => {
        ctx.drawImage(img[ITEMS[f.id].img], f.tx * TS + 2, f.ty * TS + 2, 12, 12);
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
  drawables.push({
    base: h.py + TS,
    draw: () => {
      const frame = [0, 1, 2, 1][Math.floor(h.anim) % 4];
      drawChar(img.hero, 0, 0, h.dir, frame, h.px, h.py);
      if (game.iframes > 0 && Math.floor(game.iframes * 12) % 2) // hurt: flash red
        drawTint(img.hero, 0, 0, h.dir, frame, h.px, h.py, '#e33', 0.65);
      else if (game.healFx > 0) // healing: green glow
        drawTint(img.hero, 0, 0, h.dir, frame, h.px, h.py, '#6f6', game.healFx);
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
  if (game.follow && game.lock) drawFollowBox();
  if (game.slashFx) drawSlash();
  drawProjectiles();
  drawBolts();
  drawPops();
  ctx.restore(); // end of the scrolled world; UI is screen-fixed below

  // HUD
  drawWindow(4, 4, 126, overloaded() ? 45 : 34);
  text(`HP ${Math.floor(h.hp)}/${h.maxhp}  Lv.${h.lv}`, 12, 10);
  text(`MP ${Math.floor(h.mp)}/${h.maxmp}`, 12, 21);
  if (overloaded()) text('OVERWEIGHT', 12, 32, '#f76');
  if (!game.dialogue) { // skill hotbar
    h.slots.forEach((id, i) => {
      const x = 4 + i * 21, y = H - 24;
      drawWindow(x, y, 20, 20);
      text(String(i + 1), x + 3, y + 2, '#9cf');
      if (id) text(SKILLS[id].name[0], x + 9, y + 9, h.mp >= SKILLS[id].mp ? '#fff' : '#999');
    });
  }

  if (game.invOpen) drawInvPanel();
  if (game.corpseOpen) drawCorpseWin();
  if (game.lootDrag) { // floor loot riding the cursor toward the backpack
    const f = floorAt(game.lootDrag.tx, game.lootDrag.ty)[0];
    if (f) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img[ITEMS[f.id].img], mouse.x - 9, mouse.y - 9, 18, 18);
      ctx.globalAlpha = 1;
    }
  }
  if (game.logOpen) drawLog();
  if (game.dialogue) {
    const d = game.dialogue;
    const dw = W - 8 - (game.invOpen ? 124 : 0);
    drawWindow(4, H - 62, dw, 58);
    const full = d.pages[d.page];
    const shown = full.slice(0, Math.floor(d.chars));
    wrapText(shown, 14, H - 52, dw - 24);
    if (d.chars >= full.length && Math.floor(performance.now() / 400) % 2)
      text('▼', dw - 16, H - 18);
  }
  if (game.menu) drawMenu();
  if (game.shop) drawShop();
  if (game.itemPopup) drawItemPopup();
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

// ---------------------------------------------------------------- title / gameover
function drawTitle() {
  // scale the 320x240 title art to cover the screen, biased to keep the castle
  const s = Math.max(W / 320, H / 240);
  ctx.drawImage(img.title, (W - 320 * s) / 2, Math.min(0, H - 240 * s), 320 * s, 240 * s);
  const my = Math.floor(H / 2);
  drawWindow(W / 2 - 64, my, 128, 24);
  text('FABLE QUEST', W / 2 - 32, my + 8, '#ffe080');
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  drawWindow(W / 2 - 64, my + 30, 128, 48);
  drawCursor(W / 2 - 58, my + 36 + game.titleCursor * 16, 116, 16);
  text('New Game', W / 2 - 32, my + 40);
  text('Continue', W / 2 - 32, my + 56, hasSave ? '#fff' : '#999');
}
function updateTitle() {
  if (pressed(['ArrowUp', 'ArrowDown', 'w', 's'])) { game.titleCursor ^= 1; sfx('Cursor1'); }
  if (!pressed(CONFIRM) && !clicked(0)) return;
  if (game.titleCursor === 0) {
    sfx('Decision1');
    resetGame();
    game.scene = 'map';
    syncMusic();
  } else if (localStorage.getItem(SAVE_KEY)) {
    sfx('Decision1');
    resetGame();
    loadGame();
    game.scene = 'map';
    syncMusic();
  } else sfx('Buzzer1');
}

// ---------------------------------------------------------------- input → intents
// The client half of the old updateMap(): read raw input, drive the local UI
// state (menus, panels, dialogue, drag), and translate player actions into
// intents for the sim. It mutates only presentation/UI state here — every
// change to the *world* goes through pushIntent().
function processInput(dt) {
  const h = game.hero;
  // walk command: the held direction, unless a UI panel owns the keyboard
  const captured = game.shop || game.menu || game.dialogue || game.itemPopup || game.invFocus;
  pushIntent({ t: 'moveDir', dir: captured ? null : dirHeld() });

  // walked away from your remains: the loot window closes itself
  if (game.corpseOpen && (game.corpseOpen.map !== game.mapId ||
    !nearHero(game.corpseOpen.tx, game.corpseOpen.ty))) game.corpseOpen = null;

  if (game.itemPopup) { // item details popup: any confirm/click closes
    if (pressed(CANCEL) || pressed(CONFIRM) || clicked(0)) { game.itemPopup = null; sfx('Cancel1'); }
    return;
  }
  if (game.corpseOpen) { // corpse window: take loot; walking stays live
    const c = game.corpseOpen;
    if (pressed(CANCEL)) { game.corpseOpen = null; sfx('Cancel1'); return; }
    if (pressed(CONFIRM)) { pushIntent({ t: 'takeCorpse', id: '*' }); queue = []; } // take everything
    clicks = clicks.filter(cl => {
      if (cl.b !== 0 || !inCorpseWin(cl)) return true;
      const ids = Object.keys(c.items);
      const i = corpseCellAt(cl.x, cl.y);
      if (cl.dbl && i >= 0 && i < ids.length) pushIntent({ t: 'takeCorpse', id: ids[i] });
      return false; // the window ate this click
    });
  }
  if (game.invOpen) updateInvPanel(); // panel mouse works in every mode
  if (game.shop) { updateShop(); return; }
  if (game.menu) { updateMenu(dt); return; }
  if (game.dialogue) {
    const d = game.dialogue;
    d.chars += dt * 40;
    const tapped = pressed(CONFIRM) ||
      clicks.some(c => c.b === 0 && !(game.invOpen && inPanel(c)));
    if (tapped) {
      if (d.chars < d.pages[d.page].length) d.chars = 999;
      else if (++d.page >= d.pages.length) game.dialogue = null;
      else d.chars = 0;
      sfx('Cursor1');
    }
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
  for (const c of clicks) {
    if (game.invOpen && inPanel(c)) continue; // the panel owns its clicks
    if (game.corpseOpen && inCorpseWin(c)) continue; // handled above
    if (c.b === 2) { // right-click: open your corpse, else lock for attack (no follow)
      const wx = Math.floor((c.x + cam.x) / TS), wy = Math.floor((c.y + cam.y) / TS);
      const co = corpseAt(wx, wy);
      if (co && nearHero(wx, wy)) { game.corpseOpen = co; sfx('Decision1'); }
      else pushIntent({ t: 'lockAt', x: c.x + cam.x, y: c.y + cam.y });
    } else if (c.b === 0 && c.alt) { // Alt+click locks an enemy AND follows it
      pushIntent({ t: 'followAt', x: c.x + cam.x, y: c.y + cam.y });
    } else if (c.b === 0 && !game.invDrag) {
      const wx = Math.floor((c.x + cam.x) / TS), wy = Math.floor((c.y + cam.y) / TS);
      const co = corpseAt(wx, wy);
      if (co && nearHero(wx, wy) && c.dbl) { game.corpseOpen = co; sfx('Decision1'); } // open your remains
      else if (floorAt(wx, wy).length && nearHero(wx, wy)) {
        // loot in reach: double-click pockets it, a press starts a drag
        if (c.dbl) pushIntent({ t: 'takeLoot', tx: wx, ty: wy });
        else game.lootDrag = { tx: wx, ty: wy };
      } else pushIntent({ t: 'moveTo', tx: wx, ty: wy });
    }
  }
  for (const r of releases) { // floor loot dragged into the backpack window
    if (r.b !== 0 || !game.lootDrag) continue;
    const d = game.lootDrag;
    if (inPanel(r) && nearHero(d.tx, d.ty)) pushIntent({ t: 'takeLoot', tx: d.tx, ty: d.ty });
    game.lootDrag = null;
  }
  if (game.lootDrag && !mouse.down) game.lootDrag = null;
  if (pressed(CANCEL)) {
    if (game.invFocus) { game.invFocus = null; sfx('Cancel1'); return; }
    game.menu = { mode: 'root', cursor: 0 };
    sfx('Decision1');
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
    updateTitle();
    if (game.scene === 'title') drawTitle();
    acc = 0;
  } else if (game.scene === 'map') {
    processInput(frame); // raw input -> UI state + intents (every frame)
    if (game.scene === 'map') {
      acc += frame;
      let ticks = 0;
      while (acc >= FIXED && ticks < 5) { snapshotPrev(); stepWorld(FIXED); acc -= FIXED; ticks++; }
      if (ticks === 5) acc = 0; // fell too far behind: drop the backlog
      if (game.scene === 'map') {
        const a = Math.max(0, Math.min(1, acc / FIXED));
        applyInterp(a);
        drawMap();
        clearInterp();
      }
    }
  }
  queue = [];
  clicks = [];
  releases = [];
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- boot
Promise.all(IMAGES.map(n => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => { img[n] = i; res(); };
  i.onerror = rej;
  i.src = 'assets/' + n + '.png';
}))).then(() => {
  resetGame();
  const p = new URLSearchParams(location.search);
  if (p.get('scene') === 'map') game.scene = 'map';
  if (p.get('gamemenu')) { game.scene = 'map'; game.menu = { mode: p.get('gamemenu') === '1' ? 'root' : p.get('gamemenu'), cursor: 0 }; }
  if (p.get('enemy')) { // put the hero on the field with one enemy for testing
    game.scene = 'map';
    switchMap('field', 9, 12);
    game.enemies.push({
      kind: p.get('enemy'), tx: 11, ty: 12, px: 11 * TS, py: 12 * TS, dir: 'left',
      anim: 1, moving: false, wait: 0.5, hp: ENEMIES[p.get('enemy')].hp,
      maxhp: ENEMIES[p.get('enemy')].hp, flash: 0, dying: 0, stun: 0, hurtT: 9, lunge: 0,
    });
  }
  requestAnimationFrame(loop);
}).catch(e => {
  ctx.fillStyle = '#fff';
  ctx.fillText('Failed to load assets: ' + e, 10, 20);
});

