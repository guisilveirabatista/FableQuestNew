'use strict';
// Fable Quest browser-side shared model and prediction helpers.
// The authoritative simulation lives in the Go server. This file contains the
// definitions, queries, and movement prediction needed by the browser client.

const TS = 16, MW = 40, MH = 25;
const CORPSE_DECAY = 10 * 60;
// 8-directional movement (Tibia-style). Diagonal steps only require the
// destination tile free, so the hero can squeeze between diagonal obstacles.
const DIRV = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  upleft: [-1, -1], upright: [1, -1], downleft: [-1, 1], downright: [1, 1],
};
const DIR_ORDER = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'];
// Effort pause when cutting between two diagonally-placed solids (matches server).
const SQUEEZE_DELAY = 0.5;
function dirBetween(fx, fy, tx, ty) {
  const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
  for (const name of DIR_ORDER) {
    const [vx, vy] = DIRV[name];
    if (vx === dx && vy === dy) return name;
  }
  return 'down';
}
function mapSolid(x, y) {
  if (x < 0 || y < 0 || x >= MW || y >= MH) return true;
  return cur().blocked.has(x + ',' + y);
}
function isDiagonalSqueeze(fx, fy, tx, ty) {
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return false;
  // Match the server: only map solids count as the "walls" you squeeze between.
  return mapSolid(fx + dx, fy) && mapSolid(fx, fy + dy);
}
function clearSqueeze(h = game.hero) {
  h.squeezeT = 0;
  h.squeezeDir = '';
  h.squeezeFromPath = false;
}
const ELDER_QUEST_ID = 'elder_fields';
const QUESTS = {
  elder_fields: {
    id: ELDER_QUEST_ID,
    title: 'Fields of Trouble',
    giver: 'Elder',
    target: 5,
    rewardGold: 50,
    rewardExp: 20,
    rewardItems: { potion: 2 },
  },
};
// ---------------------------------------------------------------- game state
const game = {};
// ---- attributes: 7 primaries the player raises on level-up; everything the
// combat math uses is derived from them in stats().
const ATTRS = [
  ['agi', 'Agility'], ['int', 'Intelligence'], ['vit', 'Vitality'], ['str', 'Strength'],
  ['dex', 'Dexterity'], ['mag', 'Magic Power'], ['luck', 'Luck'],
];
const BASE_ATTR = { agi: 1, int: 1, vit: 2, str: 2, dex: 1, mag: 1, luck: 1 };
const ATTR_POINTS_PER_LEVEL = 2, SKILL_POINTS_PER_LEVEL = 1, MAX_SKILL_LEVEL = 5;
const SKILL_TREE = { bolt: 'fire', spin: 'fire' };
function expToNextLevel(lv) { return Math.max(1, lv || 1) * 14; }
function cheatEnabled(id, h = game.hero) {
  return !!(h && h.cheats && h.cheats[id]);
}
function isAdminHero(h = game.hero) {
  return !!(game.isAdmin || (h && h.admin));
}
function skillAllowedForClass(id, h = game.hero) {
  if (SKILLS[id] && SKILLS[id].adminOnly) return isAdminHero(h);
  return cheatEnabled('allSkills', h) || id !== 'heal' || (h && h.class === 'Holy');
}
function availableSkillIds(h = game.hero) {
  return Object.keys(SKILLS).filter(id => skillAllowedForClass(id, h));
}
function isHotbarItem(id) {
  const it = ITEMS[id];
  return !!(it && it.heal);
}
function hotbarEntryAllowed(id, h = game.hero) {
  return !!(SKILLS[id] ? skillAllowedForClass(id, h) : isHotbarItem(id));
}
function defaultSlotsForClass(cls) {
  if (cls === 'Holy') return ['heal', 'bolt', 'fire', 'spin', null];
  return ['fire', 'potion', 'spin', 'bolt', null];
}
function normalizeHeroSlots(h = game.hero) {
  if (!h.slots || !Array.isArray(h.slots)) h.slots = defaultSlotsForClass(h.class);
  h.slots = h.slots.slice(0, 5);
  while (h.slots.length < 5) h.slots.push(null);
  const seen = new Set();
  for (let i = 0; i < h.slots.length; i++) {
    let id = h.slots[i];
    if (id === 'heal' && !skillAllowedForClass(id, h)) id = 'potion';
    if (!id || !hotbarEntryAllowed(id, h) || seen.has(id)) {
      h.slots[i] = null;
      continue;
    }
    h.slots[i] = id;
    seen.add(id);
  }
}
function normalizeSkillProgress(h = game.hero) {
  if (!h.skillLevels) h.skillLevels = {};
  Object.keys(SKILLS).forEach(id => {
    h.skillLevels[id] = Math.max(1, Math.min(skillMaxLevel(id), h.skillLevels[id] || 1));
  });
  h.skillPoints = Math.max(0, h.skillPoints || 0);
}
function skillLevel(id, h = game.hero) { normalizeSkillProgress(h); return h.skillLevels[id] || 1; }
function skillMaxLevel(id) { return SKILLS[id] && SKILLS[id].maxLevel ? SKILLS[id].maxLevel : MAX_SKILL_LEVEL; }
function skillCost(id, h = game.hero) {
  return SKILLS[id] ? SKILLS[id].mp + (skillMaxLevel(id) > 1 ? skillLevel(id, h) - 1 : 0) : 0;
}
function skillMpAvailable(id, h = game.hero) {
  return cheatEnabled('infiniteVitals', h) || h.mp >= skillCost(id, h);
}
function statsForAttr(attr) {
  const a = attr;
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
function effectiveAttr(h = game.hero) {
  return cheatEnabled('maxStats', h) || cheatEnabled('maxAttributes', h)
    ? { agi: 99, int: 99, vit: 99, str: 99, dex: 99, mag: 99, luck: 99 }
    : h.attr;
}
function stats() { return statsForAttr(effectiveAttr(game.hero)); }
function recalcMax() { // Vitality/Intelligence feed max HP/MP
  const h = game.hero;
  const a = effectiveAttr(h);
  h.maxhp = 18 + h.lv * 4 + a.vit * 4;
  h.maxmp = 6 + h.lv * 2 + a.int * 2;
  if (cheatEnabled('infiniteVitals', h)) {
    h.hp = h.maxhp;
    h.mp = h.maxmp;
    return;
  }
  h.hp = Math.min(h.hp, h.maxhp);
  h.mp = Math.min(h.mp, h.maxmp);
}
function resetGame() {
  game.scene = 'title';
  game.hero = {
    tx: SPAWN.tx, ty: SPAWN.ty, px: SPAWN.tx * TS, py: SPAWN.ty * TS, dir: 'down', anim: 0, moving: false,
    dead: false,
    name: 'Hero', class: 'Knight', hair: '#6b3f22', cloth: '#2f7fd1',
    hp: 30, maxhp: 30, mp: 10, maxmp: 10, lv: 1, exp: 0, gold: 0,
    kills: 0,
    slots: defaultSlotsForClass('Knight'), // skill/item hotbar, keys 1-5
    skillPoints: 0,
    skillLevels: { fire: 1, heal: 1, spin: 1, bolt: 1, nova: 1, supernova: 1 },
    cheats: {},
    quests: {},
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
  ensureQuests(game.hero);
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
  game.followEngaged = false;
  game.path = null;
  game.moveDir = null;   // current walk command (set by the 'moveDir' intent)
  game.mapId = SPAWN.map;
  game.floor = [];
  game.corpses = [];
  game.shop = null;
  game.autoloot = true;
  game.invOpen = true;
  game.invFocus = null;
  game.invDrag = null;
  game.bagScroll = 0;
  game.itemPopup = null;
  game.dropPrompt = null;
  game.corpseOpen = null;
  game.lootDrag = null;
  game.worldDrag = null;
  game.talkingNpc = null;
  game.mapOpen = false;
  game.minimapOpen = false;
  game.hudCompact = false;
  game.death = null;
  game.log = [];
  game.logOpen = true;
  game.netOverlayOpen = true;
  game.hero.combatLogoutT = 0;
}
// combat/reward log — shown in the toggleable bottom-left window
function logMsg(str) {
  game.log.push(str);
  if (game.log.length > 40) game.log.shift();
}

function ensureQuests(h = game.hero) {
  if (!h.quests || typeof h.quests !== 'object') h.quests = {};
  const def = QUESTS[ELDER_QUEST_ID];
  const q = h.quests[ELDER_QUEST_ID];
  if (!q) return h.quests;
  q.progress = Math.max(0, Math.min(def.target, q.progress || 0));
  q.completed = q.completed === true;
  q.rewarded = q.rewarded === true;
  q.active = !q.completed && q.active === true;
  q.ready = !q.completed && (q.ready === true || q.progress >= def.target);
  if (q.completed) {
    q.active = false;
    q.ready = false;
    q.rewarded = true;
    q.progress = def.target;
  }
  h.quests[ELDER_QUEST_ID] = q;
  return h.quests;
}
function elderQuest(h = game.hero) {
  ensureQuests(h);
  return h.quests[ELDER_QUEST_ID] || null;
}

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
      ['well', 5, 20],['well', 6, 21], ['sign', 11, 11], ['palm', 30, 10], ['palm', 35, 9],
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
    deco: [ // [sx, sy, w, h, x, y, solid] 48px chipset sprites, feet at tile (x,y)
      [144, 48, 48, 48, 9, 5, false],  // hanging sword sign (weapon shop)
      [192, 48, 48, 48, 29, 5, false], // hanging plate sign (item shop)
      [336, 48, 48, 144, 2, 6, true],  // streetlights
      [336, 48, 48, 144, 37, 6, true],
      [624, 0, 48, 48, 2, 22, true],   // barrels
      [624, 0, 48, 48, 3, 22, true],
      [624, 0, 48, 48, 36, 22, true],
      [624, 0, 48, 48, 37, 22, true],
    ],
    hedge: false,
    spawn: false,
    exits: { '0,12': ['field', 38, 12] },
  },
};
function cur() { return MAPS[game.mapId]; }

const npcs = [ // cells index the MZ sheets: npc = People2, custom = People1
  { id: 'elder', map: 'field', cx: 0, cy: 0, tx: 7, ty: 20, dir: 'down' },
  { id: 'girl', map: 'field', cx: 1, cy: 0, tx: 29, ty: 9, dir: 'down' },
  { id: 'pixel', map: 'field', sheet: 'custom', cx: 0, cy: 0, tx: 14, ty: 7, dir: 'down' },
  { id: 'knight', map: 'field', sheet: 'knight', cx: 0, cy: 0, tx: 20, ty: 10, dir: 'down', wander: 2 },
  { id: 'smith', map: 'city', cx: 2, cy: 1, tx: 7, ty: 6, dir: 'down' },
  { id: 'grocer', map: 'city', cx: 3, cy: 0, tx: 27, ty: 6, dir: 'down' },
  { id: 'kid', map: 'city', cx: 2, cy: 0, tx: 15, ty: 16, dir: 'down', wander: 2 },
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
  clearSqueeze(h);
  game.enemies = [];
  game.spawnT = 1;
  game.lock = null;
  game.follow = false;
  game.followEngaged = false;
  game.path = null;
  game.projectiles = [];
  game.bolts = [];
  game.pops = [];
}

// ---------------------------------------------------------------- dialogue
function say(pages, options = {}) {
  game.dialogue = {
    pages: Array.isArray(pages) ? pages : [],
    page: 0,
    chars: 0,
    offer: options.offer || null,
  };
}
// ---------------------------------------------------------------- action combat
// Enemies roam the grass in real time (charas from the RTP monster charset).
// They chase the hero on sight; touching one hurts. Lock-on auto-melee slashes
// in reach, FIRE lobs a fireball. The dirt path stays monster-free.
const ENEMIES = {
  // flee: below this fraction of max HP the monster runs from you instead
  // (cells index the MZ Monster.png charset; kinds keep their legacy ids)
  slime: { name: 'Goblin', cx: 1, cy: 0, hp: 14, atk: 5, def: 2, exp: 5, gold: 7, speed: 38, wait: [0.25, 0.65], range: 7, flee: 0 },
  imp: { name: 'Imp', cx: 0, cy: 0, hp: 22, atk: 8, def: 3, exp: 8, gold: 14, speed: 54, wait: [0.12, 0.35], range: 9, flee: 0.15 },
  ghost: { name: 'Lich', cx: 2, cy: 1, hp: 30, atk: 11, def: 3, exp: 14, gold: 24, speed: 62, wait: [0.08, 0.25], range: 11, flee: 0.2 },
};
function addPop(s, x, y, color) { game.pops.push({ s, x, y, t: 0, color }); }
function enemyAt(x, y) { return game.enemies.some(en => !en.dead && en.dying <= 0 && en.tx === x && en.ty === y); }
function playerAt(x, y) { return (game.players || []).some(p => !p.dead && p.tx === x && p.ty === y); }
function enemyAtPoint(x, y) { // point in the sprite's click box
  return game.enemies.find(en => !en.dead && en.dying <= 0 &&
    x >= en.px - 2 && x < en.px + 18 && y >= en.py - 6 && y < en.py + 16);
}

// ---- click-to-move: BFS over walkable tiles, enemies and other players count as walls
function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => x + ',' + y;
  const prev = new Map([[key(sx, sy), null]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const name of DIR_ORDER) {
      const [dx, dy] = DIRV[name];
      const nx = x + dx, ny = y + dy;
      if (prev.has(key(nx, ny)) || isBlocked(nx, ny) || enemyAt(nx, ny) || playerAt(nx, ny)) continue;
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
  if (!isBlocked(tx, ty) && !enemyAt(tx, ty) && !playerAt(tx, ty)) p = findPath(h.tx, h.ty, tx, ty);
  if (!p) { // clicked a wall/NPC/enemy: walk up next to it instead (cardinals preferred for adjacency)
    for (const name of DIR_ORDER) {
      const [dx, dy] = DIRV[name];
      const nx = tx + dx, ny = ty + dy;
      if (isBlocked(nx, ny) || enemyAt(nx, ny) || playerAt(nx, ny)) continue;
      const q = findPath(h.tx, h.ty, nx, ny);
      if (q && (!p || q.length < p.length)) p = q;
    }
  }
  game.path = p && p.length ? p : null;
}

function equippedCuttingWeapon(h = game.hero) {
  const eq = h.equip || {};
  return ['main', 'off'].map(slot => eq[slot]).map(id => id && ITEMS[id]).find(it => it && it.cut);
}
function beginMeleeFx(dir = game.hero.dir) {
  const h = game.hero;
  h.dir = dir || h.dir;
  // the slicing streak belongs to cutting weapons; bare fists (or anything
  // blunt) land an impact burst instead
  if (equippedCuttingWeapon(h)) {
    game.slashFx = { t: 0, dir: h.dir };
    sfx('Sword1');
  } else {
    game.slashFx = { t: 0, dir: h.dir, punch: true, dur: 0.24 };
    sfx('Blow1');
  }
}
function slashReaches(dir, en) {
  const h = game.hero, d = DIRV[dir];
  const cx = (h.tx + d[0]) * TS + 8, cy = (h.ty + d[1]) * TS + 8;
  return Math.abs(en.px + 8 - cx) <= 13 && Math.abs(en.py + 8 - cy) <= 13;
}

function faceToward(en) {
  const h = game.hero, dx = en.px - h.px, dy = en.py - h.py;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  // Face diagonally when both axes are meaningfully offset (tile-scale).
  if (ax > 4 && ay > 4) return (dy > 0 ? 'down' : 'up') + (dx > 0 ? 'right' : 'left');
  return ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// Skills equipped into the five server-authoritative hotbar slots.
const SKILLS = {
  fire: { name: 'Fire', mp: 4, desc: 'Hurls a homing fireball at your locked target. Damage scales with Magic Power and skill level.' },
  heal: { name: 'Heal', mp: 6, desc: 'Restores HP to yourself. Higher levels mend more wounds. Only Holy characters can use it.' },
  spin: { name: 'Spin', mp: 3, desc: 'Performs a quick weapon sweep around you, striking nearby enemies and hostile PvP targets.' },
  bolt: { name: 'Bolt', mp: 6, desc: 'Calls lightning onto your locked target from any range. Damage scales strongly with Magic Power.' },
  nova: { name: 'Nova', mp: 8, desc: 'Explodes lightning around your position. It does not need a lock and grows wider at level 3.' },
  supernova: {
    name: 'Super Nova',
    mp: 0,
    desc: 'Admin-only starfall that wipes out every monster on the current map. Players are untouched.',
    adminOnly: true,
    maxLevel: 1,
  },
};
function skillRequiresTarget(id) { return id !== 'heal' && id !== 'nova' && id !== 'supernova'; }
function liveEnemyLock() {
  return game.lock && !game.lock.dead && game.lock.dying <= 0 ? game.lock : null;
}
function novaSpan(h = game.hero) {
  return skillLevel('nova', h) >= 3 ? 4 : 3;
}
function novaBounds(h = game.hero) {
  const span = novaSpan(h);
  let left = Math.floor((span - 1) / 2), right = span - 1 - left;
  let up = left, down = right;
  if (span % 2 === 0) {
    if (h.dir === 'left') { left = 2; right = 1; }
    else if (h.dir === 'right') { left = 1; right = 2; }
    if (h.dir === 'up') { up = 2; down = 1; }
    else if (h.dir === 'down') { up = 1; down = 2; }
  }
  return { minTx: h.tx - left, maxTx: h.tx + right, minTy: h.ty - up, maxTy: h.ty + down };
}
function inNovaBounds(tx, ty, h = game.hero) {
  const b = novaBounds(h);
  return tx >= b.minTx && tx <= b.maxTx && ty >= b.minTy && ty <= b.maxTy;
}
function addNovaBolts(h = game.hero) {
  const b = novaBounds(h);
  for (let ty = b.minTy; ty <= b.maxTy; ty++) {
    for (let tx = b.minTx; tx <= b.maxTx; tx++) {
      if (tx >= 0 && ty >= 0 && tx < MW && ty < MH) game.bolts.push({ x: tx * TS + 8, y: ty * TS + 8, t: 0 });
    }
  }
}
function addSuperNovaBolts(h = game.hero) {
  for (let y = 0; y < MH; y += 2) {
    for (let x = 0; x < MW; x += 2) {
      if ((x + y) % 4 === 0 || Math.random() < 0.34) {
        game.bolts.push({
          x: x * TS + 8 + Math.random() * 6 - 3,
          y: y * TS + 8 + Math.random() * 6 - 3,
          t: -Math.random() * 0.35,
          kind: 'supernova',
        });
      }
    }
  }
  for (const en of game.enemies) {
    if (en.dying > 0 || en.dead) continue;
    game.bolts.push({ x: en.tx * TS + 8, y: en.ty * TS + 8, t: -Math.random() * 0.2, kind: 'supernova' });
  }
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
  sword3: { name: 'Claymore', img: 'i_sword3', w: 8, slot: 'main', atk: 9, twoH: true, cut: true, price: 340, desc: 'Heavy two-handed blade. Cleaves armor and bone.' },
  bow1: { name: 'Short Bow', img: 'i_bow1', w: 2.5, slot: 'main', atk: 4, twoH: true, weaponType: 'bow', price: 100, desc: 'A simple wooden bow.' },
  arrow1: { name: 'Bronze Arrow', img: 'i_arrow1', w: 0.05, price: 5, desc: 'A basic arrow.' },
  arrow2: { name: 'Iron Arrow', img: 'i_arrow2', w: 0.05, price: 10, desc: 'A sharp iron arrow.' },
  arrow3: { name: 'Steel Arrow', img: 'i_arrow3', w: 0.05, price: 20, desc: 'A heavy steel arrow.' },
  shield: { name: 'Buckler', img: 'i_shield', w: 4, slot: 'off', def: 2, price: 90, desc: 'A small round shield. Better than nothing.' },
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
function canPlace(id, slot) {
  const it = ITEMS[id], want = it && it.slot;
  if (!want) return false;
  if (want === 'acc') return slot === 'acc1' || slot === 'acc2';
  if (want === 'main') return slot === 'main' || (!it.twoH && slot === 'off');
  return want === slot;
}
function bagIds() { return Object.keys(ITEMS).filter(id => game.hero.bag[id] > 0); }
function bagWeight() {
  return Object.entries(game.hero.bag).reduce((s, [id, n]) => s + ITEMS[id].w * n, 0);
}
function capacity() {
  const h = game.hero;
  if (cheatEnabled('infiniteWeight', h)) return 999999;
  return 15 + h.lv * 2 + effectiveAttr(h).str * 2;
}
function overloaded() { return !cheatEnabled('infiniteWeight') && bagWeight() > capacity(); }
function floorAt(tx, ty) {
  return game.floor.filter(f => f.map === game.mapId && f.tx === tx && f.ty === ty);
}
function nearHero(tx, ty) { // same tile or adjacent (loot reach)
  return Math.abs(tx - game.hero.tx) <= 1 && Math.abs(ty - game.hero.ty) <= 1;
}
function corpseAt(tx, ty) {
  return game.corpses.find(c => c.map === game.mapId && c.tx === tx && c.ty === ty);
}
function corpseDropTileAllowed(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return false;
  return !isBlocked(tx, ty) || cur().ground[ty][tx] === 'W';
}
// ---------------------------------------------------------------- shops
const SHOPS = {
  smith: { name: 'Blacksmith', stock: ['sword1', 'sword2', 'sword3', 'bow1', 'arrow1', 'arrow2', 'arrow3', 'shield', 'hat', 'helm', 'armor', 'legs'] },
  grocer: { name: 'Grocer', stock: ['bread', 'meat', 'potion', 'boots', 'ring', 'amulet'] },
};
function shopForNpc(npc) {
  return npc && (npc.id === 'smith' || npc.id === 'grocer') ? npc.id : null;
}
function shopNpcAt(tx, ty) {
  return npcs.find(n => n.map === game.mapId && n.tx === tx && n.ty === ty && shopForNpc(n));
}
function shopNpcAtPoint(wx, wy) {
  const n = npcAtPoint(wx, wy);
  return n && shopForNpc(n) ? n : null;
}
function npcAtPoint(wx, wy) {
  return npcs.find(n => n.map === game.mapId &&
    wx >= n.px - 2 && wx < n.px + 18 && wy >= n.py - 6 && wy < n.py + 16);
}
function openShopChoice(who, x = null, y = null) {
  game.shop = { who, mode: 'choice', cursor: 0 };
  if (Number.isFinite(x) && Number.isFinite(y)) {
    game.shop.x = x;
    game.shop.y = y;
  }
  sfx('Decision1');
}
function openShop(who, mode = 'buy') {
  game.shop = { who, mode, cursor: 0, scroll: 0, qty: {}, edit: null, editText: '', warn: '' };
  sfx('Decision1');
}
function shopUnitPrice(id) {
  return ITEMS[id] ? ITEMS[id].price : 0;
}
function sellValue(id) {
  return shopUnitPrice(id);
}
// Shared UI actions are always sent to the authoritative server.
function pushIntent(intent) {
  netSend(game.net, intent);
}
function liveFollowLock() {
  return game.follow && game.lock && !game.lock.dead && game.lock.dying <= 0 ? game.lock : null;
}
function liveFollowTarget() {
  if (!game.follow) return null;
  if (game.followPlayer && !game.followPlayer.dead) return game.followPlayer;
  if (game.pvpTarget && !game.pvpTarget.dead) return game.pvpTarget;
  return liveFollowLock();
}
function followLockInReach(en) {
  const h = game.hero, dx = en.tx - h.tx, dy = en.ty - h.ty;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1; // one square around (incl. diagonal): in "reach" for follow facing
}
function faceFollowTargetIfInReach() {
  const h = game.hero, target = liveFollowTarget();
  if (!target || h.moving || !followLockInReach(target)) return false;
  h.dir = faceToward(target);
  h.anim = 1;
  return true;
}

function beginHeroStep(h, nx, ny, dir, fromPath, dt) {
  if (fromPath && game.path && game.path.length && game.path[0][0] === nx && game.path[0][1] === ny) {
    game.path.shift();
    if (!game.path.length) game.path = null;
  }
  h.dir = dir;
  h.tx = nx; h.ty = ny; h.moving = true;
  h.anim += dt * 8.75;
  clearSqueeze(h);
}

function commitOrSqueezeHero(h, nx, ny, dir, fromPath, dt) {
  if (isDiagonalSqueeze(h.tx, h.ty, nx, ny)) {
    h.squeezeT = SQUEEZE_DELAY;
    h.squeezeNX = nx; h.squeezeNY = ny;
    h.squeezeDir = dir;
    h.squeezeFromPath = fromPath;
    h.dir = dir;
    h.anim = 1;
    return;
  }
  beginHeroStep(h, nx, ny, dir, fromPath, dt);
}

function tickHeroSqueeze(h, dir, dt) {
  let holding = false;
  if (h.squeezeFromPath) {
    holding = !dir && game.path && game.path.length &&
      game.path[0][0] === h.squeezeNX && game.path[0][1] === h.squeezeNY;
  } else {
    holding = dir === h.squeezeDir;
  }
  if (!holding) {
    clearSqueeze(h);
    return false; // caller should re-process this frame's intent
  }
  h.dir = h.squeezeDir;
  h.squeezeT -= dt;
  h.anim = 1;
  if (h.squeezeT > 0) return true;
  const nx = h.squeezeNX, ny = h.squeezeNY, fromPath = h.squeezeFromPath;
  const face = h.squeezeDir;
  clearSqueeze(h);
  if (isBlocked(nx, ny) || enemyAt(nx, ny) || playerAt(nx, ny)) {
    if (fromPath && game.path) {
      const [gx, gy] = game.path[game.path.length - 1];
      game.path = findPath(h.tx, h.ty, gx, gy);
    }
    h.anim = 1;
    return true;
  }
  beginHeroStep(h, nx, ny, face, fromPath, dt);
  return true;
}

// Hero locomotion used for client prediction. The Go server remains
// authoritative and reconciles this predicted position through snapshots.
function stepHero(dt) {
  const h = game.hero;
  if (h.dead || game.death) return false;
  if (h.moving) {
    clearSqueeze(h);
    const speed = (overloaded() ? 32 : (cheatEnabled('superSpeed') ? 140 : 70)) * dt; // trudge when the pack is too heavy
    const gx = h.tx * TS, gy = h.ty * TS;
    h.px += Math.sign(gx - h.px) * Math.min(speed, Math.abs(gx - h.px));
    h.py += Math.sign(gy - h.py) * Math.min(speed, Math.abs(gy - h.py));
    h.anim += dt * (overloaded() ? 4 : 8.75); // 2 anim units per tile: half a 4-step cycle
    if (h.px === gx && h.py === gy) {
      h.moving = false;
      game.steps++;
      const exit = cur().exits[h.tx + ',' + h.ty];
      if (exit) { switchMap(...exit); return true; }
    }
  } else if (h.squeezeT > 0) {
    const dir = game.moveDir;
    if (tickHeroSqueeze(h, dir, dt)) return false;
    // Intent changed mid-squeeze: fall through and process the new intent.
    return stepHero(dt);
  } else {
    const dir = game.moveDir; // set by the 'moveDir' intent (null when a UI panel owns input)
    if (dir) {
      game.path = null; // keyboard overrides click-to-move
      clearSqueeze(h);
      h.dir = dir;
      h.anim += dt * 8.75; // keeps stepping against walls, like RM2k
      const d = DIRV[dir];
      if (d) {
        const nx = h.tx + d[0], ny = h.ty + d[1];
        if (!isBlocked(nx, ny) && !enemyAt(nx, ny) && !playerAt(nx, ny)) {
          commitOrSqueezeHero(h, nx, ny, dir, false, dt);
        } else h.anim = 1;
      } else h.anim = 1;
    } else if (game.path) { // click-to-move keeps walking under any UI
      const [nx, ny] = game.path[0];
      h.dir = dirBetween(h.tx, h.ty, nx, ny);
      if (!isBlocked(nx, ny) && !enemyAt(nx, ny) && !playerAt(nx, ny)) {
        commitOrSqueezeHero(h, nx, ny, h.dir, true, dt);
      } else { // something wandered into the route: replan to the same goal
        clearSqueeze(h);
        const [gx, gy] = game.path[game.path.length - 1];
        game.path = findPath(h.tx, h.ty, gx, gy);
      }
      if (game.path && !game.path.length) game.path = null;
    } else if (liveFollowTarget()) {
      // follow mode (F): keep walking after the locked target until in reach
      const target = liveFollowTarget();
      const dx = target.tx - h.tx, dy = target.ty - h.ty;
      h.dir = faceToward(target);
      let weaponRange = 1;
      const eq = game.hero.equip && game.hero.equip.main;
      if (eq && ITEMS[eq] && ITEMS[eq].weaponType === 'bow') {
        weaponRange = 5;
      }
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const within = dist <= weaponRange;
      const beyond = dist > weaponRange + 1;

      if (within && game.followEngaged) {
        // just face, stop chasing (rule active after first close)
      } else {
        // chase if far, or on initial follow (even if within)
        if (within) {
          game.followEngaged = true;
        } else if (beyond) {
          game.followEngaged = false;
        }
        const hd = dx > 0 ? 'right' : 'left', vd = dy > 0 ? 'down' : 'up';
        const dirs = [];
        if (dx && dy) dirs.push(vd + hd);
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx) dirs.push(hd);
          if (dy) dirs.push(vd);
        } else {
          if (dy) dirs.push(vd);
          if (dx) dirs.push(hd);
        }
        for (const fd of dirs) {
          const dv = DIRV[fd];
          if (!dv) continue;
          const nx = h.tx + dv[0], ny = h.ty + dv[1];
          if (isBlocked(nx, ny) || enemyAt(nx, ny) || playerAt(nx, ny)) continue;
          commitOrSqueezeHero(h, nx, ny, fd, false, dt);
          break;
        }
      }
      if (!h.moving && !(h.squeezeT > 0)) h.anim = 1;
    } else {
      clearSqueeze(h);
      h.anim = 1; // standing frame
    }
  }
  return false;
}
