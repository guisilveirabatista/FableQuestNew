// Fable Quest — a mini RPG built on the RPG Maker 2003 RTP assets.
// 320x240 internal resolution, scaled 2x in CSS.

'use strict';

const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

const TS = 16, MW = 20, MH = 15;

// ---------------------------------------------------------------- assets
const IMAGES = ['chipset', 'hero', 'npc', 'custom', 'knight', 'system', 'title', 'gameover',
  'monsters', 'slash', 'flame'];
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
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
  if (!held[e.key]) queue.push(e.key);
  held[e.key] = true;
  if (!audioOk) { audioOk = true; syncMusic(); }
});
addEventListener('keyup', e => { held[e.key] = false; });
function pressed(keys) { return queue.some(k => keys.includes(k)); }

// mouse: button 0 walks (click-to-move), button 2 locks a target
let clicks = [];
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  clicks.push({ b: e.button, x: (e.clientX - r.left) * 320 / r.width, y: (e.clientY - r.top) * 240 / r.height });
  if (!audioOk) { audioOk = true; syncMusic(); }
});
function clicked(button) { return clicks.some(c => c.b === button); }
function dirHeld() {
  if (held['ArrowUp'] || held['w']) return 'up';
  if (held['ArrowDown'] || held['s']) return 'down';
  if (held['ArrowLeft'] || held['a']) return 'left';
  if (held['ArrowRight'] || held['d']) return 'right';
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
  const wpn = game.hero.weapon ? ITEMS[game.hero.weapon].atk : 0;
  return {
    atk: Math.floor(1 + a.str * 2 + a.dex * 0.5) + wpn,     // physical damage
    matk: Math.floor(2 + a.mag * 2 + a.int),                // fire/bolt damage
    prec: Math.min(100, 80 + a.dex + Math.floor(a.luck * 0.5)), // % chance melee connects
    crit: Math.min(80, Math.floor(2 + a.luck + a.dex * 0.5)),   // % chance of double damage
    end: Math.floor(a.vit + a.str * 0.25),                  // halves off physical hits
    mend: Math.floor(a.int + a.vit * 0.5),                  // halves off magic (ghost) hits
    dodge: Math.min(60, Math.floor(a.agi + a.luck * 0.5)),  // % chance to evade a hit
    aspd: 1 + a.agi * 0.02,                                 // attack cooldown divider
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
    tx: 9, ty: 8, px: 9 * TS, py: 8 * TS, dir: 'down', anim: 0, moving: false,
    hp: 30, maxhp: 30, mp: 10, maxmp: 10, lv: 1, exp: 0, gold: 0,
    potions: 3, kills: 0,
    slots: ['fire', 'heal', 'spin', 'bolt', null], // skill hotbar, keys 1-5
    attr: { ...BASE_ATTR },
    points: 0, // attribute points to spend (3 per level-up)
    bag: { potion: 3 },
    weapon: null,
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
  game.path = null;
  game.mapId = 'field';
  game.floor = [];
  game.shop = null;
  game.autoloot = true;
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
  game.autoloot = d.autoloot !== false;
  game.shop = null;
  const h = game.hero;
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
    h.weapon = null;
  }
  return true;
}

// ---------------------------------------------------------------- map data
// ground chars: G grass, D dirt, W water (blocked), P pavement,
// X city wall, R shop brick, U shop stucco, O shop door (all blocked)
const GROUND_T = {
  G: [304, 48], D: [352, 48], W: [0, 64], P: [208, 96],
  X: [224, 80], R: [224, 32], U: [224, 48], O: [208, 48],
};
const SOLID_GROUND = 'WXRUO';

const MAPS = {
  field: {
    ground: [
      'GGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGWWWWGG',
      'GGGGGGGGGGGGGGWWWWGG',
      'GGGGGGGGGGGGGGWWWWGG',
      'GGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGG',
      'GGDDDDDDDDDDDDDDDDDD', // path runs off the east edge, into the city
      'GGGGDGGGGGGGGGGGGGGG',
      'GGGGDGGGGGGGGGGGGGGG',
      'GGGGDGGGGGGGGGGGGGGG',
      'GGGGDGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGG',
    ],
    trees: [[2, 4], [6, 2], [9, 4], [15, 11], [11, 12], [17, 9], [12, 2]],
    props: [
      ['rock', 7, 6], ['rock', 13, 10], ['rock', 3, 7],
      ['well', 3, 12], ['sign', 10, 7], ['palm', 13, 5], ['palm', 18, 5],
      ['cactus', 7, 11],
    ],
    deco: [],
    hedge: true,
    spawn: true,
    exits: { '19,8': ['city', 1, 8] },
  },
  city: {
    ground: [
      'XXXXXXXXXXXXXXXXXXXX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XPRRRRRPPPPPRRRRRPPX', // two shop facades
      'XPUUOUUPPPPPUUOUUPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'DPPPPPPPPPPPPPPPPPPX', // gate to the field
      'XPPPPPPPPPPPPPPPPPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XPPPPPPPPPPPPPPPPPPX',
      'XXXXXXXXXXXXXXXXXXXX',
    ],
    trees: [],
    props: [['well', 9, 10]],
    deco: [ // [sx, sy, x, y, solid] 16x32 chipset sprites, feet at (x,y)
      [432, 64, 6, 3, false],  // hanging sword sign (weapon shop)
      [464, 64, 16, 3, false], // hanging flask sign (item shop)
      [384, 64, 1, 4, true],   // torches
      [384, 64, 18, 4, true],
      [400, 128, 1, 12, true], // barrels
      [400, 128, 2, 12, true],
      [400, 128, 18, 12, true],
    ],
    hedge: false,
    spawn: false,
    exits: { '0,8': ['field', 18, 8] },
  },
};
function cur() { return MAPS[game.mapId]; }

const npcs = [
  { id: 'elder', map: 'field', cx: 2, cy: 1, tx: 5, ty: 12, dir: 'down' },
  { id: 'girl', map: 'field', cx: 3, cy: 0, tx: 15, ty: 6, dir: 'down' },
  { id: 'pixel', map: 'field', sheet: 'custom', cx: 0, cy: 0, tx: 8, ty: 5, dir: 'down' },
  { id: 'knight', map: 'field', sheet: 'knight', cx: 0, cy: 0, tx: 12, ty: 6, dir: 'down', wander: 2 },
  { id: 'smith', map: 'city', cx: 0, cy: 1, tx: 4, ty: 4, dir: 'down' },
  { id: 'grocer', map: 'city', cx: 1, cy: 1, tx: 14, ty: 4, dir: 'down' },
  { id: 'kid', map: 'city', cx: 1, cy: 0, tx: 8, ty: 10, dir: 'down', wander: 2 },
  { id: 'guard', map: 'city', sheet: 'knight', cx: 0, cy: 0, tx: 2, ty: 6, dir: 'down', wander: 1 },
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
  for (const [, , x, y, solid] of m.deco) if (solid) b.add(x + ',' + y);
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
  if (!game.autoloot && pickupAt(h.tx, h.ty)) return true; // manual loot underfoot
  const d = DIRV[h.dir];
  const fx = h.tx + d[0], fy = h.ty + d[1];
  const npc = npcs.find(n => n.map === game.mapId && n.tx === fx && n.ty === fy);
  if (npc) {
    npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[h.dir];
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
  slime: { name: 'Slime', cx: 0, cy: 0, hp: 10, atk: 4, def: 1, exp: 4, gold: 6, speed: 30, wait: [0.5, 1.1], range: 4 },
  imp: { name: 'Imp', cx: 1, cy: 0, hp: 16, atk: 6, def: 2, exp: 7, gold: 12, speed: 45, wait: [0.25, 0.6], range: 5 },
  ghost: { name: 'Ghost', cx: 3, cy: 0, hp: 24, atk: 8, def: 2, exp: 12, gold: 20, speed: 55, wait: [0.1, 0.4], range: 6 },
};
const MAX_ENEMIES = 5;
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
      if (Math.abs(dx) + Math.abs(dy) <= e.range && Math.random() > 0.2) {
        // chase: preferred axis first, other axis as fallback around obstacles
        const hd = dx > 0 ? 'right' : 'left', vd = dy > 0 ? 'down' : 'up';
        dirs = Math.abs(dx) > Math.abs(dy) ? [hd, vd] : [vd, hd];
        if (!dx || !dy) dirs = [dirs[0], ['up', 'down', 'left', 'right'][rnd(4)]];
      } else dirs = [['up', 'down', 'left', 'right'][rnd(4)]];
      for (const dir of dirs) {
        const d = DIRV[dir];
        const nx = en.tx + d[0], ny = en.ty + d[1];
        if (nx === h.tx && ny === h.ty) { en.dir = dir; attackHero(en); break; } // bump = attack
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
  if (h.hp <= 0) {
    game.scene = 'gameover';
    sfx('Damege2');
    MidiPlayer.stop();
  }
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
  addPop(`+${e.exp}exp`, en.px + 8, en.py - 20, '#9f9');
  if (h.exp >= h.lv * 10) {
    h.exp -= h.lv * 10; h.lv++; h.points += 3;
    recalcMax();
    h.hp = h.maxhp; h.mp = h.maxmp;
    sfx('Recovery2');
    addPop('LEVEL UP! +3pts', h.px + 8, h.py - 22, '#ffe080');
  }
}

function slash() {
  const h = game.hero;
  game.atkCool = 0.5 / stats().aspd;
  game.slashFx = { t: 0, dir: h.dir };
  sfx('Sword1');
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
  game.atkCool = 0.7 / stats().aspd;
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
// use-items heal; weapons add Attack while equipped. Everything weighs you down:
// past capacity (level + Strength) the hero trudges at half speed.
const ITEMS = {
  bread: { name: 'Bread', img: 'i_bread', w: 0.4, heal: 8, price: 10 },
  meat: { name: 'Meat', img: 'i_meat', w: 0.8, heal: 25, price: 35 },
  potion: { name: 'Potion', img: 'i_potion', w: 0.5, heal: 15, price: 25 },
  sword1: { name: 'Bronze Sword', img: 'i_sword1', w: 3, atk: 2, price: 60 },
  sword2: { name: 'Iron Sword', img: 'i_sword2', w: 5, atk: 5, price: 150 },
  sword3: { name: 'Claymore', img: 'i_sword3', w: 8, atk: 9, price: 340 },
};
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
  if (!h.bag[id] && h.weapon === id) h.weapon = null; // dropped your blade
}
function useItem(id) { // returns true if consumed/toggled
  const h = game.hero, it = ITEMS[id];
  if (it.heal) {
    if (h.hp >= h.maxhp) return false;
    h.hp = Math.min(h.maxhp, h.hp + it.heal);
    removeItem(id, 1);
    game.healFx = 0.5;
    sfx('Recovery1');
    return true;
  }
  if (it.atk) {
    h.weapon = h.weapon === id ? null : id;
    sfx('Decision1');
    return true;
  }
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

// ---------------------------------------------------------------- shops
const SHOPS = {
  smith: { name: 'Blacksmith', stock: ['sword1', 'sword2', 'sword3'] },
  grocer: { name: 'Grocer', stock: ['bread', 'meat', 'potion'] },
};
function openShop(who) {
  game.shop = { who, cursor: 0 };
  sfx('Decision1');
}
function updateShop() {
  const s = game.shop, h = game.hero, stock = SHOPS[s.who].stock;
  if (pressed(CANCEL)) { game.shop = null; sfx('Cancel1'); return; }
  if (pressed(['ArrowUp', 'w'])) { s.cursor = (s.cursor + stock.length - 1) % stock.length; sfx('Cursor1'); }
  if (pressed(['ArrowDown', 's'])) { s.cursor = (s.cursor + 1) % stock.length; sfx('Cursor1'); }
  if (pressed(CONFIRM)) {
    const id = stock[s.cursor], it = ITEMS[id];
    if (h.gold < it.price) { sfx('Buzzer1'); return; }
    h.gold -= it.price;
    addItem(id, 1);
    sfx('Item1');
    addPop(`+1 ${it.name}`, h.px + 8, h.py - 12, '#9f9');
  }
}
function drawShop() {
  const s = game.shop, h = game.hero, shop = SHOPS[s.who], stock = shop.stock;
  drawWindow(40, 40, 240, stock.length * 18 + 74);
  text(`${shop.name} — Gold ${h.gold}`, 52, 48, '#ffe080');
  stock.forEach((id, i) => {
    const it = ITEMS[id];
    if (s.cursor === i) drawCursor(46, 60 + i * 18, 228, 18);
    ctx.drawImage(img[it.img], 52, 61 + i * 18, 16, 16);
    text(it.name, 72, 65 + i * 18, h.gold >= it.price ? '#fff' : '#999');
    text(it.price + 'g', 192, 65 + i * 18, '#ffe080');
    text('x' + (h.bag[id] || 0), 236, 65 + i * 18, '#bcd');
  });
  const it = ITEMS[stock[s.cursor]];
  text(it.atk ? `Attack +${it.atk}` : `Heals ${it.heal} HP`, 52, stock.length * 18 + 66, '#bcd');
  text(`Weight ${it.w}   (carrying ${bagWeight().toFixed(1)}/${capacity()})`, 52, stock.length * 18 + 80, '#bcd');
  text('Enter: buy   Esc: leave', 52, stock.length * 18 + 96, '#9cf');
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
    ctx.moveTo(b.x + rnd(9) - 4, 0);
    for (let y = 8; y < b.y; y += 8) ctx.lineTo(b.x + rnd(9) - 4, y);
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
const ROOT_MENU = ['Items', 'Skills', 'Attribs', 'Status', 'Quest', 'Save', 'Load', 'Music', 'To Title'];
function updateMenu(dt) {
  const m = game.menu, h = game.hero;
  if (m.msg) {
    m.msgT += dt;
    if (m.msgT > 1.1 || pressed(CONFIRM)) m.msg = null;
    return;
  }
  if (m.mode === 'root') {
    if (pressed(['ArrowUp', 'w'])) { m.cursor = (m.cursor + ROOT_MENU.length - 1) % ROOT_MENU.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor = (m.cursor + 1) % ROOT_MENU.length; sfx('Cursor1'); }
    if (pressed(CANCEL)) { game.menu = null; sfx('Cancel1'); return; }
    if (!pressed(CONFIRM)) return;
    const sel = ROOT_MENU[m.cursor];
    if (sel === 'Items') { m.mode = 'items'; sfx('Decision1'); }
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
    } else { // To Title
      sfx('Decision1');
      game.menu = null;
      game.scene = 'title';
      game.titleCursor = 0;
      syncMusic();
    }
  } else if (m.mode === 'items') {
    if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
    if (pressed(CONFIRM)) {
      if (h.potions > 0 && h.hp < h.maxhp) {
        h.potions--;
        h.hp = Math.min(h.maxhp, h.hp + 15);
        sfx('Recovery1');
      } else sfx('Buzzer1');
    }
  } else if (m.mode === 'skills') {
    const ids = Object.keys(SKILLS);
    if (m.assign) { // waiting for a slot number
      if (pressed(CANCEL)) { m.assign = false; sfx('Cancel1'); return; }
      for (let i = 0; i < 5; i++) {
        if (!pressed([String(i + 1)])) continue;
        const id = ids[m.cursor2];
        const old = h.slots.indexOf(id);
        if (old === i) h.slots[i] = null; // same slot again: unequip
        else {
          if (old >= 0) h.slots[old] = null;
          h.slots[i] = id;
        }
        m.assign = false;
        sfx('Decision1');
        return;
      }
      return;
    }
    if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
    if (pressed(['ArrowUp', 'w'])) { m.cursor2 = (m.cursor2 + ids.length - 1) % ids.length; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { m.cursor2 = (m.cursor2 + 1) % ids.length; sfx('Cursor1'); }
    if (pressed(CONFIRM)) { m.assign = true; sfx('Decision1'); }
  } else if (m.mode === 'attribs') {
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
    if (pressed(CONFIRM) || pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); }
  }
}
function drawMenu() {
  const m = game.menu, h = game.hero;
  drawWindow(202, 8, 112, ROOT_MENU.length * 16 + 12);
  ROOT_MENU.forEach((s, i) => {
    if (m.mode === 'root' && m.cursor === i) drawCursor(208, 14 + i * 16, 100, 16);
    const label = s === 'Music' ? 'Music: ' + (MidiPlayer.isEnabled() ? 'On' : 'Off') : s;
    text(label, 216, 18 + i * 16);
  });
  drawWindow(202, ROOT_MENU.length * 16 + 24, 112, 24);
  text(`Gold ${h.gold}`, 216, ROOT_MENU.length * 16 + 32);
  if (m.mode === 'items') {
    drawWindow(8, 8, 188, 46);
    drawCursor(14, 14, 176, 16);
    text(`Potion  x${h.potions}`, 24, 18, h.potions > 0 ? '#fff' : '#999');
    text('Restores 15 HP.', 24, 34, '#bcd');
  } else if (m.mode === 'skills') {
    const ids = Object.keys(SKILLS);
    drawWindow(8, 8, 188, ids.length * 16 + 48);
    ids.forEach((id, i) => {
      const sk = SKILLS[id], slot = h.slots.indexOf(id);
      if (m.cursor2 === i) drawCursor(14, 14 + i * 16, 176, 16);
      text(sk.name, 24, 18 + i * 16);
      text(sk.mp + 'MP', 88, 18 + i * 16, '#bcd');
      if (slot >= 0) text(`[${slot + 1}]`, 128, 18 + i * 16, '#ffe080');
    });
    wrapText(SKILLS[ids[m.cursor2]].desc, 20, ids.length * 16 + 22, 164);
    text(m.assign ? 'Press 1-5 (same slot clears)' : 'Enter: pick a slot', 20, ids.length * 16 + 44,
      m.assign ? '#ffe080' : '#9cf');
  } else if (m.mode === 'attribs') {
    const st = stats();
    drawWindow(4, 8, 100, ATTRS.length * 15 + 34);
    text(`Points: ${h.points}`, 12, 15, h.points > 0 ? '#ffe080' : '#bcd');
    ATTRS.forEach(([k, label], i) => {
      if (m.cursor2 === i) drawCursor(8, 27 + i * 15, 92, 15);
      text(label, 14, 31 + i * 15);
      text('' + h.attr[k], 86, 31 + i * 15, '#ffe080');
    });
    text(h.points > 0 ? 'Enter: +1' : 'No points', 12, ATTRS.length * 15 + 28, '#9cf');
    drawWindow(106, 8, 94, 132);
    const dv = [
      ['Attack', st.atk], ['Magic Atk', st.matk], ['Precision', st.prec + '%'],
      ['Crit', st.crit + '%'], ['Endurance', st.end], ['Magic End', st.mend],
      ['Dodge', st.dodge + '%'], ['Atk Spd', st.aspd.toFixed(2)],
    ];
    dv.forEach(([label, v], i) => {
      text(label, 114, 16 + i * 15, '#bcd');
      text('' + v, 168, 16 + i * 15);
    });
  } else if (m.mode === 'status') {
    drawWindow(8, 8, 188, 124);
    const lines = [
      `Hero  Lv.${h.lv}`,
      `HP  ${Math.floor(h.hp)}/${h.maxhp}`,
      `MP  ${Math.floor(h.mp)}/${h.maxmp}`,
      `Attack ${stats().atk}  Magic ${stats().matk}`,
      `EXP  ${h.exp}/${h.lv * 10}`,
      `Attr points  ${h.points}`,
      `Monsters slain  ${h.kills}`,
    ];
    lines.forEach((l, i) => text(l, 20, 18 + i * 15));
  } else if (m.mode === 'quest') {
    drawWindow(8, 8, 188, 76);
    text('QUEST', 20, 16, '#ffe080');
    wrapText(
      game.won ? 'Complete! You are the hero of the valley.'
        : `The Elder asked you to slay 5 monsters in the grass. (${h.kills}/5)`,
      20, 32, 164);
  }
  if (m.msg) {
    drawWindow(90, 104, 140, 30);
    text(m.msg, 104, 115, '#ffe080');
  }
}

// ---------------------------------------------------------------- map scene
function updateNpcs(dt) {
  for (const n of npcs) {
    if (n.map !== game.mapId || !n.wander) continue;
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
  if (game.menu) { updateMenu(dt); return; }
  if (game.dialogue) {
    const d = game.dialogue;
    d.chars += dt * 40;
    if (pressed(CONFIRM) || clicked(0)) {
      if (d.chars < d.pages[d.page].length) d.chars = 999;
      else if (++d.page >= d.pages.length) game.dialogue = null;
      else d.chars = 0;
      sfx('Cursor1');
    }
    return;
  }
  game.iframes = Math.max(0, game.iframes - dt);
  game.atkCool = Math.max(0, game.atkCool - dt);
  game.healFx = Math.max(0, game.healFx - dt);
  if (game.slashFx && (game.slashFx.t += dt) >= (game.slashFx.dur || 0.18)) game.slashFx = null;
  h.mp = Math.min(h.maxmp, h.mp + dt * 0.35); // slow regen keeps skills in play
  h.hp = Math.min(h.maxhp, h.hp + dt * 0.4);
  updateNpcs(dt);
  updateEnemies(dt);
  if (game.scene !== 'map') return; // fell in battle
  updateProjectiles(dt);
  game.bolts.forEach(b => b.t += dt);
  game.bolts = game.bolts.filter(b => b.t < 0.25);
  for (const p of game.pops) p.t += dt;
  game.pops = game.pops.filter(p => p.t < 0.8);

  if (game.lock && (game.lock.dead || game.lock.dying > 0)) game.lock = null;
  for (const c of clicks) {
    if (c.b === 2) { // right-click: lock what's under the cursor (or clear)
      const en = enemyAtPoint(c.x, c.y);
      game.lock = en || null;
      if (en) sfx('Cursor1');
    } else if (c.b === 0) startPathTo(Math.floor(c.x / TS), Math.floor(c.y / TS));
  }
  if (pressed(CANCEL)) { game.menu = { mode: 'root', cursor: 0 }; sfx('Decision1'); return; }
  if (pressed(['Tab'])) cycleLock();
  if (pressed(CONFIRM)) {
    if (interact()) { queue = []; game.path = null; return; }
    if (game.atkCool <= 0) slash();
  }
  for (let i = 0; i < 5; i++) if (pressed([String(i + 1)])) castSlot(i);
  // locked on and in reach: the sword strikes by itself
  if (game.lock && game.atkCool <= 0) {
    const dir = faceToward(game.lock);
    if (slashReaches(dir, game.lock)) { h.dir = dir; slash(); }
  }

  if (h.moving) {
    const speed = 70 * dt;
    const gx = h.tx * TS, gy = h.ty * TS;
    h.px += Math.sign(gx - h.px) * Math.min(speed, Math.abs(gx - h.px));
    h.py += Math.sign(gy - h.py) * Math.min(speed, Math.abs(gy - h.py));
    h.anim += dt * 8.75; // 2 anim units per tile: half a 4-step cycle
    if (h.px === gx && h.py === gy) {
      h.moving = false;
      game.steps++;
    }
  } else {
    const dir = dirHeld();
    if (dir) {
      game.path = null; // keyboard overrides click-to-move
      h.dir = dir;
      h.anim += dt * 8.75; // keeps stepping against walls, like RM2k
      const d = DIRV[dir];
      const nx = h.tx + d[0], ny = h.ty + d[1];
      if (!isBlocked(nx, ny) && !enemyAt(nx, ny)) {
        h.tx = nx; h.ty = ny; h.moving = true;
      }
    } else if (game.path) {
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
    } else h.anim = 1; // standing frame
  }
}

const DIRROW = { up: 0, right: 1, down: 2, left: 3 };
function drawChar(sheet, cx, cy, dir, frame, px, py) {
  const sx = cx * 72 + Math.floor(frame) % 3 * 24;
  const sy = cy * 128 + DIRROW[dir] * 32;
  ctx.drawImage(sheet, sx, sy, 24, 32, px - 4, py - 16, 24, 32);
}

function drawMap() {
  const h = game.hero;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const g = GROUND[y][x];
    const t = g === 'W' ? T.water : g === 'D' ? T.dirt : T.grass;
    ctx.drawImage(img.chipset, t[0], t[1], TS, TS, x * TS, y * TS, TS, TS);
  }
  // border hedge
  const drawables = [];
  for (let x = 0; x < MW; x++) { drawables.push(prop('bush', x, 0)); drawables.push(prop('bush', x, MH - 1)); }
  for (let y = 1; y < MH - 1; y++) { drawables.push(prop('bush', 0, y)); drawables.push(prop('bush', MW - 1, y)); }
  for (const [t, x, y] of props) drawables.push(prop(t, x, y));
  for (const [x, y] of trees) drawables.push({
    base: (y + 1) * TS,
    draw: () => ctx.drawImage(img.chipset, TREE[0], TREE[1], TREE[2], TREE[3], x * TS, y * TS - 16, TREE[2], TREE[3]),
  });
  for (const n of npcs) drawables.push({
    base: n.py + TS,
    draw: () => drawChar(img[n.sheet || 'npc'], n.cx, n.cy, n.dir,
      n.moving ? [0, 1, 2, 1][Math.floor(n.anim) % 4] : 1, n.px, n.py),
  });
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
  if (game.slashFx) drawSlash();
  drawProjectiles();
  drawBolts();
  drawPops();

  // HUD
  drawWindow(4, 4, 126, h.points > 0 ? 45 : 34);
  text(`HP ${Math.floor(h.hp)}/${h.maxhp}  Lv.${h.lv}`, 12, 10);
  text(`MP ${Math.floor(h.mp)}/${h.maxmp}  Kills ${h.kills}/5`, 12, 21);
  if (h.points > 0) text(`+${h.points}pts: Esc>Attribs`, 12, 32, '#ffe080');
  if (!game.dialogue) { // skill hotbar
    h.slots.forEach((id, i) => {
      const x = 4 + i * 21, y = 216;
      drawWindow(x, y, 20, 20);
      text(String(i + 1), x + 3, y + 2, '#9cf');
      if (id) text(SKILLS[id].name[0], x + 9, y + 9, h.mp >= SKILLS[id].mp ? '#fff' : '#999');
    });
  }

  if (game.dialogue) {
    const d = game.dialogue;
    drawWindow(4, 178, 312, 58);
    const full = d.pages[d.page];
    const shown = full.slice(0, Math.floor(d.chars));
    wrapText(shown, 14, 188, 292);
    if (d.chars >= full.length && Math.floor(performance.now() / 400) % 2)
      text('▼', 300, 222);
  }
  if (game.menu) drawMenu();
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
  ctx.drawImage(img.title, 0, 0);
  drawWindow(96, 150, 128, 24);
  text('FABLE QUEST', 128, 158, '#ffe080');
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  drawWindow(96, 180, 128, 48);
  drawCursor(102, 186 + game.titleCursor * 16, 116, 16);
  text('New Game', 128, 190);
  text('Continue', 128, 206, hasSave ? '#fff' : '#999');
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
  } else if (game.scene === 'gameover') {
    ctx.drawImage(img.gameover, 0, 0);
    if (pressed(CONFIRM) || clicked(0)) { resetGame(); syncMusic(); }
  }

  queue = [];
  clicks = [];
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
  if (p.get('enemy')) { // spawn one next to the hero for testing
    game.scene = 'map';
    game.enemies.push({
      kind: p.get('enemy'), tx: 11, ty: 8, px: 11 * TS, py: 8 * TS, dir: 'left',
      anim: 1, moving: false, wait: 0.5, hp: ENEMIES[p.get('enemy')].hp,
      maxhp: ENEMIES[p.get('enemy')].hp, flash: 0, dying: 0, stun: 0, hurtT: 9,
    });
  }
  requestAnimationFrame(loop);
}).catch(e => {
  ctx.fillStyle = '#fff';
  ctx.fillText('Failed to load assets: ' + e, 10, 20);
});
