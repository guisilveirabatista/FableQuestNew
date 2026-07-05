// Fable Quest — a mini action RPG built on the RPG Maker 2003 RTP assets.
// The canvas fills the whole window at an integer pixel scale (no stretching,
// no letterboxing): the viewport matches the window's aspect ratio and a
// camera follows the hero across the 40x25-tile maps.

'use strict';

const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');

const TS = 16, MW = 40, MH = 25;
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
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
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

// ---------------------------------------------------------------- game state
const game = {};
window.FQ = game; // console/test handle

// ---- attributes: 7 primaries the player raises on level-up; everything the
// combat math uses is derived from them in stats().
const ATTRS = [
  ['agi', 'Agility'], ['int', 'Intelligence'], ['vit', 'Vitality'], ['str', 'Strength'],
  ['dex', 'Dexterity'], ['mag', 'Magic Power'], ['luck', 'Luck'],
];
const BASE_ATTR = { agi: 1, int: 1, vit: 2, str: 2, dex: 1, mag: 1, luck: 1 };
function stats() {
  const a = game.hero.attr;
  const eq = { atk: 0, def: 0, mdef: 0, dodge: 0, crit: 0 }; // worn gear bonuses
  for (const id of Object.values(game.hero.equip)) {
    if (!id) continue;
    const it = ITEMS[id];
    eq.atk += it.atk || 0; eq.def += it.def || 0; eq.mdef += it.mdef || 0;
    eq.dodge += it.dodge || 0; eq.crit += it.crit || 0;
  }
  return {
    atk: Math.floor(1 + a.str * 2 + a.dex * 0.5) + eq.atk,  // physical damage
    matk: Math.floor(2 + a.mag * 2 + a.int),                // fire/bolt damage
    prec: Math.min(100, 80 + a.dex + Math.floor(a.luck * 0.5)), // % chance melee connects
    crit: Math.min(80, Math.floor(2 + a.luck + a.dex * 0.5) + eq.crit), // % chance of double damage
    end: Math.floor(a.vit + a.str * 0.25) + eq.def,         // halves off physical hits
    mend: Math.floor(a.int + a.vit * 0.5) + eq.mdef,        // halves off magic (ghost) hits
    dodge: Math.min(60, Math.floor(a.agi + a.luck * 0.5) + eq.dodge), // % chance to evade a hit
    aspd: 1 + (a.agi - 1) * 0.06,                           // attack cooldown divider
  };
}
function recalcMax() { // Vitality/Intelligence feed max HP/MP
  const h = game.hero;
  h.maxhp = 18 + h.lv * 4 + h.attr.vit * 4;
  h.maxmp = 6 + h.lv * 2 + h.attr.int * 2;
  h.hp = Math.min(h.hp, h.maxhp);
  h.mp = Math.min(h.mp, h.maxmp);
}
function resetGame() {
  game.scene = 'title';
  game.hero = {
    tx: SPAWN.tx, ty: SPAWN.ty, px: SPAWN.tx * TS, py: SPAWN.ty * TS, dir: 'down', anim: 0, moving: false,
    hp: 30, maxhp: 30, mp: 10, maxmp: 10, lv: 1, exp: 0, gold: 0,
    kills: 0,
    slots: ['fire', 'heal', 'spin', 'bolt', null], // skill hotbar, keys 1-5
    attr: { ...BASE_ATTR },
    points: 0, // attribute points to spend (3 per level-up)
    bag: { potion: 3 },
    equip: { head: null, main: null, off: null, torso: null, legs: null, boots: null, acc1: null, acc2: null },
  };
  recalcMax();
  game.steps = 0;
  game.dialogue = null;
  game.menu = null;
  game.titleCursor = 0;
  game.won = false;
  game.enemies = [];
  game.projectiles = [];
  game.bolts = [];
  game.pops = [];
  game.spawnT = 0;
  game.iframes = 0;
  game.atkCool = 0;
  game.slashFx = null;
  game.healFx = 0;
  game.lock = null;
  game.follow = false;
  game.path = null;
  game.mapId = SPAWN.map;
  game.floor = [];
  game.corpses = [];
  game.shop = null;
  game.autoloot = true;
  game.invOpen = true;
  game.invFocus = null;
  game.invDrag = null;
  game.itemPopup = null;
  game.tipBtn = null;
  game.corpseOpen = null;
  game.lootDrag = null;
  game.talkingNpc = null;
  game.log = [];
  game.logOpen = true;
}
// combat/reward log — shown in the toggleable bottom-left window
function logMsg(str) {
  game.log.push(str);
  if (game.log.length > 40) game.log.shift();
}

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
const SOLID_GROUND = 'WXRUO';

// where everyone (re)spawns: the city plaza, by the well
const SPAWN = { map: 'city', tx: 19, ty: 16 };

const MAPS = {
  field: {
    // grass with a pond; the path runs east to the city gate, with a
    // southern branch down to the well and the Elder
    ground: (() => {
      const rows = [];
      for (let y = 0; y < MH; y++) {
        let r = '';
        for (let x = 0; x < MW; x++) {
          if (y >= 4 && y <= 8 && x >= 28 && x <= 33) r += 'W';
          else if (y === 12 && x >= 2) r += 'D';
          else if (x === 6 && y >= 13 && y <= 20) r += 'D';
          else r += 'G';
        }
        rows.push(r);
      }
      return rows;
    })(),
    trees: [[3, 4], [8, 3], [14, 5], [20, 3], [25, 6], [34, 4], [3, 16],
      [12, 17], [18, 15], [24, 18], [31, 16], [36, 18], [10, 21], [27, 21], [16, 9]],
    props: [
      ['rock', 4, 9], ['rock', 22, 14], ['rock', 33, 10], ['rock', 15, 19],
      ['well', 5, 20], ['sign', 11, 11], ['palm', 30, 10], ['palm', 35, 9],
      ['cactus', 9, 18],
    ],
    deco: [],
    hedge: true,
    spawn: true,
    exits: { '39,12': ['city', 1, 12] },
  },
  city: {
    // walled city: two shops up north, plaza with the well in the middle,
    // gate to the field on the west wall
    ground: (() => {
      const rows = [];
      for (let y = 0; y < MH; y++) {
        let r = '';
        for (let x = 0; x < MW; x++) {
          const shopL = x >= 4 && x <= 10, shopR = x >= 24 && x <= 30;
          if (y === 0 || y === MH - 1 || ((x === 0 || x === MW - 1) && !(x === 0 && y === 12))) r += 'X';
          else if (x === 0 && y === 12) r += 'D'; // the gate
          else if (y === 4 && (shopL || shopR)) r += 'R';
          else if (y === 5 && (x === 7 || x === 27)) r += 'O'; // shop doors
          else if (y === 5 && (shopL || shopR)) r += 'U';
          else r += 'P';
        }
        rows.push(r);
      }
      return rows;
    })(),
    trees: [],
    props: [['well', 19, 14]],
    deco: [ // [sx, sy, w, h, x, y, solid] chipset sprites, feet at tile (x,y)
      [432, 64, 16, 16, 9, 5, false],  // hanging sword sign (weapon shop)
      [464, 64, 16, 16, 29, 5, false], // hanging flask sign (item shop)
      [384, 64, 16, 16, 2, 6, true],   // torches
      [384, 64, 16, 16, 37, 6, true],
      [448, 128, 16, 32, 2, 22, true], // barrels
      [448, 128, 16, 32, 3, 22, true],
      [448, 128, 16, 32, 36, 22, true],
      [448, 128, 16, 32, 37, 22, true],
    ],
    hedge: false,
    spawn: false,
    exits: { '0,12': ['field', 38, 12] },
  },
};
function cur() { return MAPS[game.mapId]; }

const npcs = [
  { id: 'elder', map: 'field', cx: 2, cy: 1, tx: 7, ty: 20, dir: 'down' },
  { id: 'girl', map: 'field', cx: 3, cy: 0, tx: 29, ty: 9, dir: 'down' },
  { id: 'pixel', map: 'field', sheet: 'custom', cx: 0, cy: 0, tx: 14, ty: 7, dir: 'down' },
  { id: 'knight', map: 'field', sheet: 'knight', cx: 0, cy: 0, tx: 20, ty: 10, dir: 'down', wander: 2 },
  { id: 'smith', map: 'city', cx: 0, cy: 1, tx: 7, ty: 6, dir: 'down' },
  { id: 'grocer', map: 'city', cx: 1, cy: 1, tx: 27, ty: 6, dir: 'down' },
  { id: 'kid', map: 'city', cx: 1, cy: 0, tx: 15, ty: 16, dir: 'down', wander: 2 },
  { id: 'guard', map: 'city', sheet: 'knight', cx: 0, cy: 0, tx: 3, ty: 12, dir: 'down', wander: 1 },
];
for (const n of npcs) { n.px = n.tx * TS; n.py = n.ty * TS; n.anim = 1; n.moving = false; n.wait = 0; n.hx = n.tx; n.hy = n.ty; }

for (const [id, m] of Object.entries(MAPS)) {
  const b = m.blocked = new Set();
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (SOLID_GROUND.includes(m.ground[y][x])) b.add(x + ',' + y);
    else if (m.hedge && (x === 0 || y === 0 || x === MW - 1 || y === MH - 1) && !m.exits[x + ',' + y])
      b.add(x + ',' + y); // hedge border, except exits
  }
  for (const [x, y] of m.trees) for (const [dx, dy] of [[0, 0], [1, 0], [0, -1], [1, -1]])
    b.add((x + dx) + ',' + (y + dy));
  for (const [, x, y] of m.props) b.add(x + ',' + y);
  for (const [, , , , x, y, solid] of m.deco) if (solid) b.add(x + ',' + y);
}

function isBlocked(x, y) {
  if (x < 0 || y < 0 || x >= MW || y >= MH) return true;
  if (cur().blocked.has(x + ',' + y)) return true;
  return npcs.some(n => n.map === game.mapId && n.tx === x && n.ty === y);
}

function switchMap(to, tx, ty) {
  const h = game.hero;
  game.mapId = to;
  h.tx = tx; h.ty = ty; h.px = tx * TS; h.py = ty * TS; h.moving = false;
  game.enemies = [];
  game.spawnT = 1;
  game.lock = null;
  game.path = null;
  game.projectiles = [];
  game.bolts = [];
  game.pops = [];
}

// ---------------------------------------------------------------- dialogue
function say(pages) { game.dialogue = { pages, page: 0, chars: 0 }; }
function interact() { // returns true if something was there to talk to / read
  const h = game.hero;
  const corpse = corpseNear();
  if (corpse) { game.corpseOpen = corpse; sfx('Decision1'); return true; }
  const d = DIRV[h.dir];
  const fx = h.tx + d[0], fy = h.ty + d[1];
  const npc = npcs.find(n => n.map === game.mapId && n.tx === fx && n.ty === fy);
  if (npc) {
    npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[h.dir];
    game.talkingNpc = npc; // they politely stand still for the chat
    sfx('Decision1');
    if (npc.id === 'elder') {
      if (h.kills >= 5 && !game.won) {
        game.won = true;
        say(['Elder: Five monsters slain...', 'Elder: You truly are the hero of this valley! THE END... but feel free to keep exploring.']);
      } else if (game.won) {
        say(['Elder: Rest well, hero.', '* Fully recovered! *']);
      } else {
        say([`Elder: Monsters plague our fields! Defeat 5 of them. (${h.kills}/5 so far)`, '* The Elder healed you and refilled a potion! *']);
      }
      h.hp = h.maxhp; h.mp = h.maxmp;
      if ((h.bag.potion || 0) < 3) addItem('potion', 1);
      sfx('Recovery1');
      return true;
    }
    if (npc.id === 'smith') {
      openShop('smith');
      return true;
    }
    if (npc.id === 'grocer') {
      openShop('grocer');
      return true;
    }
    if (npc.id === 'kid') {
      say(['Kid: Monsters never come into town! The walls scare them... or maybe the guard does.']);
      return true;
    }
    if (npc.id === 'guard') {
      say(['Guard: The wilds are dangerous. Buy a proper sword before you wander off!',
        'Guard: And mind your pack — carry too much and you can barely walk.']);
      return true;
    }
    if (npc.id === 'girl') {
      say(['Girl: The pond is lovely, but monsters fear the dirt path...', 'Girl: They will never set foot on it. Retreat there if you are hurt!']);
      return true;
    }
    if (npc.id === 'pixel') {
      say(['Boy: The Elder says I just appeared here one day...',
        'Boy: The truth? An AI drew me from scratch, pixel by pixel. All 12 frames of me!']);
      return true;
    }
    if (npc.id === 'knight') {
      say(['Knight: Observe my stride! Contact, passing, contact... each leg in its turn, arms swinging counter to the step.',
        'Knight: And the plume? It trails behind me as I march. Follow-through, they call it. A knight studies his animation principles!']);
      return true;
    }
    return true;
  }
  if (cur().props.some(([t, x, y]) => t === 'sign' && x === fx && y === fy)) {
    sfx('Decision1');
    say(['Monsters roam the grass! Swing your sword with SPACE, cast skills with 1-5.',
      'TAB or right-click locks on to a foe: in reach your sword strikes by itself, and fire seeks the mark!',
      'The path east leads to town — shops, safety, no monsters. Slay 5 and see the Elder by the well.']);
    return true;
  }
  if (cur().props.some(([t, x, y]) => t === 'well' && x === fx && y === fy)) {
    sfx('Item1');
    say(['You toss a coin into the well... nothing happens. Classic.']);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- action combat
// Enemies roam the grass in real time (charas from the RTP monster charset).
// They chase the hero on sight; touching one hurts. CONFIRM slashes the faced
// tile, FIRE lobs a fireball. The dirt path stays monster-free.
const ENEMIES = {
  // flee: below this fraction of max HP the monster runs from you instead
  slime: { name: 'Slime', cx: 0, cy: 0, hp: 10, atk: 4, def: 1, exp: 4, gold: 6, speed: 30, wait: [0.5, 1.1], range: 4, flee: 0 },
  imp: { name: 'Imp', cx: 1, cy: 0, hp: 16, atk: 6, def: 2, exp: 7, gold: 12, speed: 45, wait: [0.25, 0.6], range: 5, flee: 0.2 },
  ghost: { name: 'Ghost', cx: 3, cy: 0, hp: 24, atk: 8, def: 2, exp: 12, gold: 20, speed: 55, wait: [0.1, 0.4], range: 6, flee: 0.25 },
};
const MAX_ENEMIES = 10; // the field is big now
function rnd(n) { return Math.floor(Math.random() * n); }
function pickEnemy() {
  const k = game.hero.kills;
  const pool = k < 2 ? ['slime'] : k < 4 ? ['slime', 'imp'] : ['slime', 'imp', 'ghost'];
  return pool[Math.floor(Math.random() * pool.length)];
}
function addPop(s, x, y, color) { game.pops.push({ s, x, y, t: 0, color }); }
function enemyAt(x, y) { return game.enemies.some(en => !en.dead && en.dying <= 0 && en.tx === x && en.ty === y); }
function enemyAtPoint(x, y) { // point in the 24x32 sprite box
  return game.enemies.find(en => !en.dead && en.dying <= 0 &&
    x >= en.px - 4 && x < en.px + 20 && y >= en.py - 16 && y < en.py + 16);
}

// ---- click-to-move: BFS over walkable tiles, enemies count as walls
function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => x + ',' + y;
  const prev = new Map([[key(sx, sy), null]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of Object.values(DIRV)) {
      const nx = x + dx, ny = y + dy;
      if (prev.has(key(nx, ny)) || isBlocked(nx, ny) || enemyAt(nx, ny)) continue;
      prev.set(key(nx, ny), [x, y]);
      if (nx === tx && ny === ty) {
        const path = [];
        for (let c = [nx, ny]; c; c = prev.get(key(c[0], c[1]))) path.push(c);
        path.pop(); // drop the start tile
        return path.reverse();
      }
      q.push([nx, ny]);
    }
  }
  return null;
}
function startPathTo(tx, ty) {
  const h = game.hero;
  let p = null;
  if (!isBlocked(tx, ty) && !enemyAt(tx, ty)) p = findPath(h.tx, h.ty, tx, ty);
  if (!p) { // clicked a wall/NPC/enemy: walk up next to it instead
    for (const [dx, dy] of Object.values(DIRV)) {
      const nx = tx + dx, ny = ty + dy;
      if (isBlocked(nx, ny) || enemyAt(nx, ny)) continue;
      const q = findPath(h.tx, h.ty, nx, ny);
      if (q && (!p || q.length < p.length)) p = q;
    }
  }
  game.path = p && p.length ? p : null;
}

function spawnEnemy() {
  const h = game.hero;
  for (let tries = 0; tries < 30; tries++) {
    const x = 1 + rnd(MW - 2), y = 1 + rnd(MH - 2);
    if (cur().ground[y][x] !== 'G' || isBlocked(x, y)) continue;
    if (Math.abs(x - h.tx) + Math.abs(y - h.ty) < 5) continue;
    if (game.enemies.some(e => e.tx === x && e.ty === y)) continue;
    const kind = pickEnemy();
    game.enemies.push({
      kind, tx: x, ty: y, px: x * TS, py: y * TS, dir: 'down',
      anim: 1, moving: false, wait: 0.5 + Math.random(),
      hp: ENEMIES[kind].hp, maxhp: ENEMIES[kind].hp,
      flash: 0, dying: 0, stun: 0, hurtT: 9, lunge: 0,
    });
    return;
  }
}

function updateEnemies(dt) {
  const h = game.hero;
  if (!cur().spawn) return; // monsters live on the field only; the city is safe
  game.spawnT -= dt;
  if (game.enemies.length < MAX_ENEMIES && game.spawnT <= 0) { spawnEnemy(); game.spawnT = 2; }

  for (const en of game.enemies) {
    en.flash = Math.max(0, en.flash - dt);
    en.lunge = Math.max(0, en.lunge - dt);
    en.hurtT += dt;
    if (en.dying > 0) {
      en.dying -= dt;
      if (en.dying <= 0) en.dead = true;
      continue;
    }
    en.stun = Math.max(0, en.stun - dt);
    if (en.stun > 0) continue;
    const e = ENEMIES[en.kind];
    if (en.moving) {
      const gx = en.tx * TS, gy = en.ty * TS, sp = e.speed * dt;
      en.px += Math.sign(gx - en.px) * Math.min(sp, Math.abs(gx - en.px));
      en.py += Math.sign(gy - en.py) * Math.min(sp, Math.abs(gy - en.py));
      en.anim += dt * 5;
      if (en.px === gx && en.py === gy) { en.moving = false; en.anim = 1; }
    } else {
      en.wait -= dt;
      if (en.wait > 0) continue;
      en.wait = e.wait[0] + Math.random() * (e.wait[1] - e.wait[0]);
      const dx = h.tx - en.tx, dy = h.ty - en.ty;
      let dirs;
      const fleeing = e.flee > 0 && en.hp / en.maxhp <= e.flee;
      if (Math.abs(dx) + Math.abs(dy) <= e.range && Math.random() > 0.2) {
        // chase (or flee: same pathing, away instead of toward)
        const hd = (fleeing ? dx < 0 : dx > 0) ? 'right' : 'left';
        const vd = (fleeing ? dy < 0 : dy > 0) ? 'down' : 'up';
        dirs = Math.abs(dx) > Math.abs(dy) ? [hd, vd] : [vd, hd];
        if (!dx || !dy) dirs = [dirs[0], ['up', 'down', 'left', 'right'][rnd(4)]];
      } else dirs = [['up', 'down', 'left', 'right'][rnd(4)]];
      for (const dir of dirs) {
        const d = DIRV[dir];
        const nx = en.tx + d[0], ny = en.ty + d[1];
        if (nx === h.tx && ny === h.ty) { // bump = attack (unless running for its life)
          en.dir = dir;
          if (!fleeing) attackHero(en);
          break;
        }
        if (ny < 0 || ny >= MH || cur().ground[ny][nx] !== 'G') continue; // grass only: the path is safe
        if (isBlocked(nx, ny)) continue;
        if (game.enemies.some(o => o !== en && !o.dead && o.tx === nx && o.ty === ny)) continue;
        en.dir = dir;
        en.tx = nx; en.ty = ny; en.moving = true;
        break;
      }
    }
  }
  game.enemies = game.enemies.filter(en => !en.dead);
}

function attackHero(en) {
  const h = game.hero, e = ENEMIES[en.kind];
  en.lunge = 0.22;
  en.wait = 0.8 + Math.random() * 0.4;
  if (game.iframes > 0) return;
  const st = stats();
  if (rnd(100) < st.dodge) {
    sfx('Evasion1');
    addPop('dodge!', h.px + 8, h.py - 12, '#9cf');
    return;
  }
  const guard = en.kind === 'ghost' ? st.mend : st.end; // ghosts hit with magic
  const dmg = Math.max(1, e.atk + rnd(3) - 1 - Math.floor(guard / 2));
  h.hp = Math.max(0, h.hp - dmg);
  game.iframes = 1;
  sfx('Damege1');
  addPop('-' + dmg, h.px + 8, h.py - 12, '#f76');
  if (h.hp <= 0) die();
}

// no game-over screen: your body stays where you fell and you wake up
// at the spawn point with your gear intact
function die() {
  const h = game.hero;
  const items = {};
  for (const [id, n] of Object.entries(h.bag)) if (n > 0) items[id] = n;
  h.bag = {}; // your loot stays with the body — go get it back
  game.corpses.push({ map: game.mapId, tx: h.tx, ty: h.ty, items });
  if (game.corpses.length > 8) game.corpses.shift(); // the field tidies itself
  sfx('Damege2');
  switchMap(SPAWN.map, SPAWN.tx, SPAWN.ty);
  h.hp = h.maxhp;
  h.mp = h.maxmp;
  h.dir = 'down';
  game.iframes = 2;
  game.dialogue = null; // death closes whatever you were reading
  game.menu = null;
  game.shop = null;
  game.itemPopup = null;
  game.corpseOpen = null;
  addPop('You died!', h.px + 8, h.py - 14, '#f76');
}

function hitEnemy(en, dmg, crit) {
  if (crit) dmg *= 2;
  en.hp -= dmg;
  en.flash = 0.3;
  en.stun = 0.45;
  en.hurtT = 0;
  addPop(crit ? dmg + '!!' : '' + dmg, en.px + 8, en.py - 10, crit ? '#f96' : '#ffe080');
  if (en.hp <= 0) killEnemy(en);
}
function meleeHit(en) { // precision / crit rolls for one sword hit
  const st = stats();
  if (rnd(100) >= st.prec) {
    addPop('miss', en.px + 8, en.py - 10, '#9cf');
    return;
  }
  hitEnemy(en, Math.max(1, st.atk + rnd(4) - ENEMIES[en.kind].def), rnd(100) < st.crit);
}
function killEnemy(en) {
  const h = game.hero, e = ENEMIES[en.kind];
  en.dying = 0.45;
  sfx('Monster1');
  h.kills++; h.exp += e.exp; h.gold += e.gold;
  logMsg(`Defeated ${e.name}: +${e.exp} EXP, +${e.gold} gold`);
  if (Math.random() < 0.25) { // loot: autoloot pockets it, otherwise it falls
    const id = Math.random() < 0.7 ? 'bread' : 'potion';
    if (game.autoloot) {
      addItem(id, 1);
      logMsg(`Looted ${ITEMS[id].name} x1`);
      sfx('Item1');
    } else dropFloor(id, 1, en.tx, en.ty);
  }
  if (h.exp >= h.lv * 10) {
    h.exp -= h.lv * 10; h.lv++; h.points += 3;
    recalcMax();
    h.hp = h.maxhp; h.mp = h.maxmp;
    sfx('Recovery2');
    logMsg(`LEVEL UP! Now Lv.${h.lv}  (+3 attribute points)`);
    addPop('LEVEL UP!', h.px + 8, h.py - 22, '#ffe080');
  }
}

function slash() {
  const h = game.hero;
  const wpn = h.equip.main && ITEMS[h.equip.main];
  game.atkCool = 1.0 / stats().aspd; // ponderous at Lv.1 — Agility speeds it up
  // the slicing streak belongs to cutting weapons; bare fists (or anything
  // blunt) land an impact burst instead
  if (wpn && wpn.cut) {
    game.slashFx = { t: 0, dir: h.dir };
    sfx('Sword1');
  } else {
    game.slashFx = { t: 0, dir: h.dir, punch: true, dur: 0.24 };
    sfx('Blow1');
  }
  for (const en of game.enemies) {
    if (en.dying > 0 || en.dead) continue;
    if (slashReaches(h.dir, en)) meleeHit(en);
  }
}
function slashReaches(dir, en) {
  const h = game.hero, d = DIRV[dir];
  const cx = (h.tx + d[0]) * TS + 8, cy = (h.ty + d[1]) * TS + 8;
  return Math.abs(en.px + 8 - cx) <= 13 && Math.abs(en.py + 8 - cy) <= 13;
}

// ---- lock-on: Tab cycles targets; melee fires by itself in reach and
// fireballs home in on the mark.
function cycleLock() {
  const h = game.hero;
  const alive = game.enemies.filter(en => !en.dead && en.dying <= 0)
    .sort((a, b) => Math.hypot(a.px - h.px, a.py - h.py) - Math.hypot(b.px - h.px, b.py - h.py));
  if (!alive.length) { game.lock = null; sfx('Buzzer1'); return; }
  game.lock = alive[(alive.indexOf(game.lock) + 1) % alive.length];
  sfx('Cursor1');
}
function faceToward(en) {
  const h = game.hero, dx = en.px - h.px, dy = en.py - h.py;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// ---- skills: equipped into 5 hotbar slots (keys 1-5) via the Skills menu.
// cast() returns false when the skill can't fire; MP is only spent on success.
const SKILLS = {
  fire: { name: 'Fire', mp: 4, desc: 'Hurl a fireball. Homes in on your lock.', cast: castFire },
  heal: { name: 'Heal', mp: 6, desc: 'Mend your wounds for 15 HP.', cast: castHeal },
  spin: { name: 'Spin', mp: 3, desc: 'Sword sweep hitting all around you.', cast: castSpin },
  bolt: { name: 'Bolt', mp: 6, desc: 'Lightning strikes your lock or the nearest foe.', cast: castBolt },
};
function castSlot(i) {
  const h = game.hero, id = h.slots[i];
  if (game.atkCool > 0) return;
  if (!id || h.mp < SKILLS[id].mp) { sfx('Buzzer1'); return; }
  if (SKILLS[id].cast()) h.mp -= SKILLS[id].mp;
  else sfx('Buzzer1');
}

function castFire() {
  const h = game.hero;
  game.atkCool = 0.4;
  sfx('Flame1');
  let [dx, dy] = DIRV[h.dir];
  if (game.lock) {
    const m = Math.hypot(game.lock.px - h.px, game.lock.py - h.py) || 1;
    dx = (game.lock.px - h.px) / m; dy = (game.lock.py - h.py) / m;
  }
  game.projectiles.push({ x: h.px + 8 + dx * 8, y: h.py + 8 + dy * 8, dx, dy, target: game.lock, dist: 0, t: 0 });
  return true;
}

function castHeal() {
  const h = game.hero;
  if (h.hp >= h.maxhp) return false;
  const heal = Math.min(15, h.maxhp - Math.floor(h.hp));
  h.hp = Math.min(h.maxhp, h.hp + 15);
  game.atkCool = 0.4;
  game.healFx = 0.5;
  sfx('Recovery1');
  addPop('+' + heal, h.px + 8, h.py - 14, '#9f9');
  return true;
}

function castSpin() {
  const h = game.hero;
  game.atkCool = 1.3 / stats().aspd;
  game.slashFx = { t: 0, spin: true, dur: 0.3 };
  sfx('Sword1');
  for (const en of game.enemies) {
    if (en.dying > 0 || en.dead) continue;
    if (Math.abs(en.px - h.px) <= 24 && Math.abs(en.py - h.py) <= 24) meleeHit(en);
  }
  return true;
}

function castBolt() {
  const h = game.hero;
  let t = game.lock;
  if (!t || t.dead || t.dying > 0) { // no lock: nearest foe within 6 tiles
    let bd = 6 * TS;
    t = null;
    for (const en of game.enemies) {
      if (en.dead || en.dying > 0) continue;
      const d = Math.hypot(en.px - h.px, en.py - h.py);
      if (d < bd) { bd = d; t = en; }
    }
  }
  if (!t) return false;
  game.atkCool = 0.5;
  game.bolts.push({ x: t.px + 8, y: t.py + 4, t: 0 });
  sfx('Thunder4');
  hitEnemy(t, stats().matk * 2 + rnd(6));
  return true;
}
function updateProjectiles(dt) {
  for (const p of game.projectiles) {
    p.t += dt;
    if (p.boom !== undefined) { p.boom -= dt; continue; }
    if (p.target && !p.target.dead && p.target.dying <= 0) { // home in on the lock
      const m = Math.hypot(p.target.px + 8 - p.x, p.target.py + 8 - p.y) || 1;
      p.dx = (p.target.px + 8 - p.x) / m;
      p.dy = (p.target.py + 8 - p.y) / m;
    }
    const sp = 130 * dt;
    p.x += p.dx * sp; p.y += p.dy * sp; p.dist += sp;
    let hit = p.dist > 5.5 * TS || isBlocked(Math.floor(p.x / TS), Math.floor(p.y / TS));
    for (const en of game.enemies) {
      if (en.dying > 0 || en.dead) continue;
      if (Math.abs(en.px + 8 - p.x) < 11 && Math.abs(en.py + 8 - p.y) < 11) {
        hitEnemy(en, stats().matk * 2 + rnd(5));
        hit = true;
        break;
      }
    }
    if (hit) p.boom = 0.18;
  }
  game.projectiles = game.projectiles.filter(p => p.boom === undefined || p.boom > 0);
}

// ---------------------------------------------------------------- items & inventory
// use-items heal; equipment goes on the body (slot field) and its bonuses feed
// stats(). Bag contents weigh you down: past capacity (level + Strength) the
// hero trudges at half speed. Worn gear weighs nothing — you're wearing it.
const ITEMS = {
  bread: { name: 'Bread', img: 'i_bread', w: 0.4, heal: 8, price: 10, desc: 'Fresh from the city oven. Keeps a traveler going.' },
  meat: { name: 'Meat', img: 'i_meat', w: 0.8, heal: 25, price: 35, desc: 'A hearty roast. The grocer swears it is not slime.' },
  potion: { name: 'Potion', img: 'i_potion', w: 0.5, heal: 15, price: 25, desc: 'Bitter red brew that knits wounds shut.' },
  sword1: { name: 'Bronze Sword', img: 'i_sword1', w: 3, slot: 'main', atk: 2, cut: true, price: 60, desc: 'A dull but honest blade for beginners.' },
  sword2: { name: 'Iron Sword', img: 'i_sword2', w: 5, slot: 'main', atk: 5, cut: true, price: 150, desc: 'Solid smithing. Holds an edge through a long day.' },
  sword3: { name: 'Claymore', img: 'i_sword3', w: 8, slot: 'main', atk: 9, cut: true, twoH: true, price: 340, desc: 'A massive two-hander. Needs both arms and some nerve.' },
  shield: { name: 'Buckler', img: 'i_shield', w: 4, slot: 'off', def: 2, price: 90, desc: 'Small round shield. Better than an elbow.' },
  hat: { name: 'Felt Hat', img: 'i_hat', w: 0.5, slot: 'head', def: 1, price: 40, desc: 'Stylish, and it keeps the sun off.' },
  helm: { name: 'Iron Helm', img: 'i_helm', w: 3, slot: 'head', def: 3, price: 180, desc: 'Muffles your hearing, saves your skull.' },
  armor: { name: 'Breastplate', img: 'i_armor', w: 7, slot: 'torso', def: 4, price: 260, desc: 'Polished plate. The smith is proud of this one.' },
  legs: { name: 'Greaves', img: 'i_legs', w: 4, slot: 'legs', def: 2, price: 120, desc: 'Shin guards that have seen some kicks.' },
  boots: { name: 'Swift Boots', img: 'i_boots', w: 1.5, slot: 'boots', dodge: 3, price: 110, desc: 'Light soles. You barely feel the ground.' },
  ring: { name: 'Lucky Ring', img: 'i_ring', w: 0.1, slot: 'acc', crit: 5, price: 200, desc: 'A faint shimmer. Dice seem to like you more.' },
  amulet: { name: 'Ward Amulet', img: 'i_amulet', w: 0.2, slot: 'acc', mdef: 3, price: 200, desc: 'An old charm that soaks up curses.' },
};

// body slots: what the hero wears. 'acc' items fit either accessory slot;
// a two-handed weapon needs both arms, so it kicks out (and blocks) the shield.
const BODY_SLOTS = ['head', 'main', 'torso', 'off', 'legs', 'acc1', 'boots', 'acc2'];
const BODY_GRID = [ // keyboard navigation layout (rows of the paper doll)
  [null, 'head', null],
  ['main', 'torso', 'off'],
  [null, 'legs', null],
  ['acc1', 'boots', 'acc2'],
];
function canPlace(id, slot) {
  const want = ITEMS[id].slot;
  if (!want) return false;
  if (want === 'acc') return slot === 'acc1' || slot === 'acc2';
  return want === slot;
}
function slotFor(id) { // natural slot for keyboard/double-click equip
  const want = ITEMS[id].slot;
  if (want === 'acc') return !game.hero.equip.acc1 ? 'acc1' : 'acc2';
  return want;
}
function unequipSlot(slot) {
  const h = game.hero, id = h.equip[slot];
  if (!id) return;
  h.equip[slot] = null;
  h.bag[id] = (h.bag[id] || 0) + 1;
}
function equipTo(id, slot) {
  const h = game.hero;
  if (!canPlace(id, slot) || !(h.bag[id] > 0)) return false;
  if (ITEMS[id].twoH) unequipSlot('off'); // both hands on the claymore
  if (slot === 'off' && h.equip.main && ITEMS[h.equip.main].twoH) unequipSlot('main');
  unequipSlot(slot);
  h.bag[id]--;
  h.equip[slot] = id;
  sfx('Decision1');
  return true;
}

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
      if (c.dbl) { if (!useItem(ids[bi])) sfx('Buzzer1'); }
      else game.invDrag = { from: 'bag', id: ids[bi] };
    } else if (bs) {
      game.invFocus = 'body';
      game.invSlot = bs;
      if (c.dbl) {
        if (h.equip[bs]) { unequipSlot(bs); sfx('Cancel1'); } else sfx('Buzzer1');
      } else if (h.equip[bs]) game.invDrag = { from: 'body', slot: bs, id: h.equip[bs] };
    }
  }
  for (const r of releases) {
    if (r.b !== 0 || !game.invDrag) continue;
    const d = game.invDrag, bs = bodySlotAt(r.x, r.y);
    if (d.from === 'bag') {
      if (bs) { if (!equipTo(d.id, bs)) sfx('Buzzer1'); }
      else if (!inPanel(r)) { // dragged onto the map: drop at your feet
        removeItem(d.id, 1);
        dropFloor(d.id, 1, h.tx, h.ty);
        sfx('Cancel1');
      }
    } else if (bs && bs !== d.slot && canPlace(d.id, bs)) {
      unequipSlot(d.slot); // move between slots (ring to the other finger)
      equipTo(d.id, bs);
    } else if (!bs) {
      unequipSlot(d.slot); // dragged off the body: back to the bag
      sfx('Cancel1');
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
      if (pressed(CONFIRM)) { if (!useItem(ids[game.invCursor])) sfx('Buzzer1'); }
      if (pressed(['q', 'Q'])) {
        const id = ids[game.invCursor];
        removeItem(id, 1);
        dropFloor(id, 1, h.tx, h.ty);
        sfx('Cancel1');
      }
    }
  } else { // body
    if (!game.invSlot) game.invSlot = 'torso';
    for (const [keys, dir] of [[['ArrowUp', 'w'], 'up'], [['ArrowDown', 's'], 'down'],
      [['ArrowLeft', 'a'], 'left'], [['ArrowRight', 'd'], 'right']]) {
      if (pressed(keys) && BODY_NAV[game.invSlot][dir]) { game.invSlot = BODY_NAV[game.invSlot][dir]; sfx('Cursor1'); }
    }
    if (pressed(CONFIRM) || pressed(['q', 'Q'])) {
      if (h.equip[game.invSlot]) { unequipSlot(game.invSlot); sfx('Cancel1'); }
      else sfx('Buzzer1');
    }
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
function bagIds() { return Object.keys(ITEMS).filter(id => game.hero.bag[id] > 0); }
function bagWeight() {
  return Object.entries(game.hero.bag).reduce((s, [id, n]) => s + ITEMS[id].w * n, 0);
}
function capacity() { const h = game.hero; return 15 + h.lv * 2 + h.attr.str * 2; }
function overloaded() { return bagWeight() > capacity(); }
function addItem(id, n) {
  game.hero.bag[id] = (game.hero.bag[id] || 0) + n;
}
function removeItem(id, n) {
  const h = game.hero;
  h.bag[id] = Math.max(0, (h.bag[id] || 0) - n);
}
function useItem(id) { // returns true if consumed/equipped
  const h = game.hero, it = ITEMS[id];
  if (it.heal) {
    if (h.hp >= h.maxhp) return false;
    h.hp = Math.min(h.maxhp, h.hp + it.heal);
    removeItem(id, 1);
    game.healFx = 0.5;
    sfx('Recovery1');
    return true;
  }
  if (it.slot) return equipTo(id, slotFor(id));
  return false;
}

// floor items: [{map, id, n, tx, ty}] — dropped by you or by slain monsters
function dropFloor(id, n, tx, ty) {
  const f = game.floor.find(f => f.map === game.mapId && f.id === id && f.tx === tx && f.ty === ty);
  if (f) f.n += n;
  else game.floor.push({ map: game.mapId, id, n, tx, ty });
}
function floorAt(tx, ty) {
  return game.floor.filter(f => f.map === game.mapId && f.tx === tx && f.ty === ty);
}
function pickupAt(tx, ty) {
  const here = floorAt(tx, ty);
  for (const f of here) {
    addItem(f.id, f.n);
    addPop(`+${f.n} ${ITEMS[f.id].name}`, tx * TS + 8, ty * TS - 6, '#9f9');
    f.n = 0;
  }
  if (here.length) {
    sfx('Item1');
    game.floor = game.floor.filter(f => f.n > 0);
    return true;
  }
  return false;
}
function nearHero(tx, ty) { // same tile or adjacent (loot reach)
  return Math.abs(tx - game.hero.tx) <= 1 && Math.abs(ty - game.hero.ty) <= 1;
}
function corpseNear() {
  return game.corpses.find(c => c.map === game.mapId && nearHero(c.tx, c.ty));
}
function corpseAt(tx, ty) {
  return game.corpses.find(c => c.map === game.mapId && c.tx === tx && c.ty === ty);
}
function takeFromCorpse(c, id) {
  addItem(id, c.items[id]);
  addPop(`+${c.items[id]} ${ITEMS[id].name}`, game.hero.px + 8, game.hero.py - 12, '#9f9');
  delete c.items[id];
  sfx('Item1');
}

// ---------------------------------------------------------------- shops
const SHOPS = {
  smith: { name: 'Blacksmith', stock: ['sword1', 'sword2', 'sword3', 'shield', 'hat', 'helm', 'armor', 'legs'] },
  grocer: { name: 'Grocer', stock: ['bread', 'meat', 'potion', 'boots', 'ring', 'amulet'] },
};
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
function openShop(who) {
  game.shop = { who, cursor: 0 };
  sfx('Decision1');
}
function shopBuy() {
  const s = game.shop, h = game.hero, it = ITEMS[SHOPS[s.who].stock[s.cursor]];
  if (h.gold < it.price) { sfx('Buzzer1'); return; }
  h.gold -= it.price;
  addItem(SHOPS[s.who].stock[s.cursor], 1);
  sfx('Item1');
  addPop(`+1 ${it.name}`, h.px + 8, h.py - 12, '#9f9');
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
        if (c.dbl) shopBuy(); else sfx('Cursor1');
      }
  }
  if (pressed(CANCEL)) { game.shop = null; sfx('Cancel1'); return; }
  if (pressed(['ArrowUp', 'w'])) { s.cursor = (s.cursor + stock.length - 1) % stock.length; sfx('Cursor1'); }
  if (pressed(['ArrowDown', 's'])) { s.cursor = (s.cursor + 1) % stock.length; sfx('Cursor1'); }
  if (pressed(CONFIRM)) shopBuy();
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
  } else if (sel === 'Autoloot') { game.autoloot = !game.autoloot; sfx('Decision1'); }
  else if (sel === 'Log') { game.logOpen = !game.logOpen; sfx('Decision1'); }
  else { // To Title
    sfx('Decision1');
    game.menu = null;
    game.scene = 'title';
    game.titleCursor = 0;
    syncMusic();
  }
}
function assignSkillSlot(id, i) {
  const h = game.hero, old = h.slots.indexOf(id);
  if (old === i) h.slots[i] = null; // same slot again: unequip
  else { if (old >= 0) h.slots[old] = null; h.slots[i] = id; }
  sfx('Decision1');
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
        if (hit(c, LX + 12 + j * 20, ids.length * 16 + 40, 16, 16)) assignSkillSlot(ids[m.cursor2], j);
    }
    if (m.assign) { // waiting for a slot number
      if (pressed(CANCEL)) { m.assign = false; sfx('Cancel1'); return; }
      for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) { assignSkillSlot(ids[m.cursor2], i); m.assign = false; return; }
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
          if (h.points > 0) { h.attr[ATTRS[i][0]]++; h.points--; recalcMax(); sfx('Decision1'); }
          else sfx('Buzzer1');
        }
    }
    if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
    if (pressed(['ArrowUp', 'w'])) { m.cursor2 = (m.cursor2 + ATTRS.length - 1) % ATTRS.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor2 = (m.cursor2 + 1) % ATTRS.length; sfx('Cursor1'); }
    if (pressed(CONFIRM) || pressed(['ArrowRight', 'd'])) {
      if (h.points > 0) {
        h.attr[ATTRS[m.cursor2][0]]++;
        h.points--;
        recalcMax();
        sfx('Decision1');
      } else sfx('Buzzer1');
    }
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

// ---------------------------------------------------------------- map scene
function updateNpcs(dt) {
  if (!game.dialogue) game.talkingNpc = null;
  for (const n of npcs) {
    if (n.map !== game.mapId || !n.wander) continue;
    if (game.talkingNpc === n && !n.moving) continue; // mid-conversation
    if (n.moving) {
      const gx = n.tx * TS, gy = n.ty * TS, sp = 40 * dt;
      n.px += Math.sign(gx - n.px) * Math.min(sp, Math.abs(gx - n.px));
      n.py += Math.sign(gy - n.py) * Math.min(sp, Math.abs(gy - n.py));
      n.anim += dt * 5;
      if (n.px === gx && n.py === gy) { n.moving = false; n.anim = 1; }
    } else {
      n.wait -= dt;
      if (n.wait > 0) continue;
      n.wait = 0.8 + Math.random() * 1.8;
      const dir = ['up', 'down', 'left', 'right'][rnd(4)];
      n.dir = dir;
      const d = DIRV[dir];
      const nx = n.tx + d[0], ny = n.ty + d[1];
      if (Math.abs(nx - n.hx) > n.wander || Math.abs(ny - n.hy) > n.wander) continue;
      if (isBlocked(nx, ny) || (game.hero.tx === nx && game.hero.ty === ny)) continue;
      n.tx = nx; n.ty = ny; n.moving = true;
    }
  }
}

function updateMap(dt) {
  const h = game.hero;
  // ------------------------------------------------- simulation
  // The world never pauses (this is headed toward an MMORPG): NPCs, enemies,
  // projectiles, regen and your own steps keep going while dialogue, menus,
  // shops or popups are open. UI only captures *input*.
  const captured = game.shop || game.menu || game.dialogue || game.itemPopup || game.invFocus;
  for (const p of game.pops) p.t += dt;
  game.pops = game.pops.filter(p => p.t < 0.8);
  game.iframes = Math.max(0, game.iframes - dt);
  game.atkCool = Math.max(0, game.atkCool - dt);
  game.healFx = Math.max(0, game.healFx - dt);
  if (game.slashFx && (game.slashFx.t += dt) >= (game.slashFx.dur || 0.18)) game.slashFx = null;
  h.mp = Math.min(h.maxmp, h.mp + dt * 0.35); // slow regen keeps skills in play
  h.hp = Math.min(h.maxhp, h.hp + dt * 0.4);
  updateNpcs(dt);
  updateEnemies(dt);
  if (game.scene !== 'map') return;
  updateProjectiles(dt);
  game.bolts.forEach(b => b.t += dt);
  game.bolts = game.bolts.filter(b => b.t < 0.25);
  if (game.lock && (game.lock.dead || game.lock.dying > 0)) { game.lock = null; game.follow = false; }
  // locked on and in reach: the sword strikes by itself, menus or not
  if (game.lock && game.atkCool <= 0) {
    const dir = faceToward(game.lock);
    if (slashReaches(dir, game.lock)) { h.dir = dir; slash(); }
  }

  if (h.moving) {
    const speed = (overloaded() ? 32 : 70) * dt; // trudge when the pack is too heavy
    const gx = h.tx * TS, gy = h.ty * TS;
    h.px += Math.sign(gx - h.px) * Math.min(speed, Math.abs(gx - h.px));
    h.py += Math.sign(gy - h.py) * Math.min(speed, Math.abs(gy - h.py));
    h.anim += dt * (overloaded() ? 4 : 8.75); // 2 anim units per tile: half a 4-step cycle
    if (h.px === gx && h.py === gy) {
      h.moving = false;
      game.steps++;
      const exit = cur().exits[h.tx + ',' + h.ty];
      if (exit) { switchMap(...exit); return; }
    }
  } else {
    const dir = captured ? null : dirHeld();
    if (dir) {
      game.path = null; // keyboard overrides click-to-move
      h.dir = dir;
      h.anim += dt * 8.75; // keeps stepping against walls, like RM2k
      const d = DIRV[dir];
      const nx = h.tx + d[0], ny = h.ty + d[1];
      if (!isBlocked(nx, ny) && !enemyAt(nx, ny)) {
        h.tx = nx; h.ty = ny; h.moving = true;
      }
    } else if (game.path) { // click-to-move keeps walking under any UI
      const [nx, ny] = game.path[0];
      h.dir = nx > h.tx ? 'right' : nx < h.tx ? 'left' : ny > h.ty ? 'down' : 'up';
      if (!isBlocked(nx, ny) && !enemyAt(nx, ny)) {
        game.path.shift();
        h.tx = nx; h.ty = ny; h.moving = true;
      } else { // something wandered into the route: replan to the same goal
        const [gx, gy] = game.path[game.path.length - 1];
        game.path = findPath(h.tx, h.ty, gx, gy);
      }
      if (game.path && !game.path.length) game.path = null;
    } else if (game.follow && game.lock && !game.lock.dead && game.lock.dying <= 0) {
      // follow mode (F): keep walking after the locked target until in reach
      const en = game.lock;
      const dx = en.tx - h.tx, dy = en.ty - h.ty;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 1 || (dx !== 0 && dy !== 0)) {
        const hd = dx > 0 ? 'right' : 'left', vd = dy > 0 ? 'down' : 'up';
        const dirs = Math.abs(dx) > Math.abs(dy) ? [hd, vd] : [vd, hd];
        for (const fd of dirs) {
          const dv = DIRV[fd];
          if (!dx && (fd === 'left' || fd === 'right')) continue;
          if (!dy && (fd === 'up' || fd === 'down')) continue;
          const nx = h.tx + dv[0], ny = h.ty + dv[1];
          if (isBlocked(nx, ny) || enemyAt(nx, ny)) continue;
          h.dir = fd;
          h.tx = nx; h.ty = ny; h.moving = true;
          break;
        }
      }
      if (!h.moving) h.anim = 1;
    } else h.anim = 1; // standing frame
  }

  // walked away from your remains: the window closes itself
  if (game.corpseOpen && (game.corpseOpen.map !== game.mapId ||
    !nearHero(game.corpseOpen.tx, game.corpseOpen.ty))) game.corpseOpen = null;

  // ------------------------------------------------- input routing
  if (game.itemPopup) { // item details popup: any confirm/click closes
    if (pressed(CANCEL) || pressed(CONFIRM) || clicked(0)) { game.itemPopup = null; sfx('Cancel1'); }
    return;
  }
  if (game.corpseOpen) { // corpse window: take loot; walking stays live
    const c = game.corpseOpen;
    if (pressed(CANCEL)) { game.corpseOpen = null; sfx('Cancel1'); return; }
    if (pressed(CONFIRM)) { // take everything
      Object.keys(c.items).forEach(id => takeFromCorpse(c, id));
      queue = [];
    }
    clicks = clicks.filter(cl => {
      if (cl.b !== 0 || !inCorpseWin(cl)) return true;
      const ids = Object.keys(c.items);
      const i = corpseCellAt(cl.x, cl.y);
      if (cl.dbl && i >= 0 && i < ids.length) takeFromCorpse(c, ids[i]);
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
      if (co && nearHero(wx, wy)) {
        game.corpseOpen = co;
        sfx('Decision1');
      } else {
        const en = enemyAtPoint(c.x + cam.x, c.y + cam.y);
        game.lock = en || null;
        game.follow = false;
        if (en) sfx('Cursor1');
      }
    } else if (c.b === 0 && c.alt) { // Alt+click locks an enemy AND follows it
      const en = enemyAtPoint(c.x + cam.x, c.y + cam.y);
      if (en) { game.lock = en; game.follow = true; sfx('Decision1'); }
    } else if (c.b === 0 && !game.invDrag) {
      const wx = Math.floor((c.x + cam.x) / TS), wy = Math.floor((c.y + cam.y) / TS);
      const co = corpseAt(wx, wy);
      if (co && nearHero(wx, wy) && c.dbl) { // open your remains
        game.corpseOpen = co;
        sfx('Decision1');
      } else if (floorAt(wx, wy).length && nearHero(wx, wy)) {
        // loot in reach: double-click pockets it, a press starts a drag
        if (c.dbl) pickupAt(wx, wy);
        else game.lootDrag = { tx: wx, ty: wy };
      } else {
        game.follow = false; // clicking to move cancels follow (keeps the lock)
        startPathTo(wx, wy);
      }
    }
  }
  for (const r of releases) { // floor loot dragged into the backpack window
    if (r.b !== 0 || !game.lootDrag) continue;
    const d = game.lootDrag;
    if (inPanel(r) && nearHero(d.tx, d.ty)) pickupAt(d.tx, d.ty);
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
  if (pressed(['Tab'])) cycleLock();
  if (pressed(['f', 'F'])) { // toggle follow mode on the current lock
    if (game.lock) { game.follow = !game.follow; sfx(game.follow ? 'Decision1' : 'Cancel1'); }
    else sfx('Buzzer1');
  }
  if (pressed(CONFIRM)) {
    if (interact()) { queue = []; game.path = null; return; }
    if (game.atkCool <= 0) slash();
  }
  for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) castSlot(i);
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

// ---------------------------------------------------------------- main loop
let last = 0;
function loop(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;

  if (game.scene === 'title') {
    updateTitle();
    if (game.scene === 'title') drawTitle();
  } else if (game.scene === 'map') {
    updateMap(dt);
    if (game.scene === 'map') drawMap();
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
