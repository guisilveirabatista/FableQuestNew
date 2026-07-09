'use strict';
// Fable Quest — authoritative SIMULATION (Phase 0 split of game.js).
// World model + rules only: no DOM, no canvas, no input, no audio, no
// persistence. Runs headless (see tools/simtest.js) so the same rules can
// drive the browser client today and the Go server later.
//
// The client never mutates the world directly — it pushes intents that the
// sim drains each tick in stepWorld(). applyIntent() is the sole entry point
// for player actions (the seam the authoritative server will sit behind).
// sfx(name) is provided by the host (client defines it; the headless test
// stubs it) — the sim only *requests* sounds, it doesn't play them.

const TS = 16, MW = 40, MH = 25;
const CORPSE_DECAY = 10 * 60;
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
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
function skillAllowedForClass(id, h = game.hero) {
  return id !== 'heal' || (h && h.class === 'Holy');
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
  ['fire', 'heal', 'spin', 'bolt', 'nova'].forEach(id => {
    h.skillLevels[id] = Math.max(1, Math.min(MAX_SKILL_LEVEL, h.skillLevels[id] || 1));
  });
  h.skillPoints = Math.max(0, h.skillPoints || 0);
}
function skillLevel(id, h = game.hero) { normalizeSkillProgress(h); return h.skillLevels[id] || 1; }
function skillCost(id, h = game.hero) {
  return SKILLS[id] ? SKILLS[id].mp + skillLevel(id, h) - 1 : 0;
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
function stats() { return statsForAttr(game.hero.attr); }
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
    dead: false,
    name: 'Hero', class: 'Knight', hair: '#6b3f22', cloth: '#2f7fd1',
    hp: 30, maxhp: 30, mp: 10, maxmp: 10, lv: 1, exp: 0, gold: 0,
    kills: 0,
    slots: defaultSlotsForClass('Knight'), // skill/item hotbar, keys 1-5
    skillPoints: 0,
    skillLevels: { fire: 1, heal: 1, spin: 1, bolt: 1, nova: 1 },
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
  game.intents = [];      // queued player actions, drained each tick in stepWorld
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
  let q = h.quests[ELDER_QUEST_ID];
  if (!q) {
    const completed = game.won === true;
    q = {
      active: !completed,
      progress: completed ? def.target : Math.min(def.target, h.kills || 0),
      ready: !completed && (h.kills || 0) >= def.target,
      completed,
      rewarded: completed,
    };
  }
  q.progress = Math.max(0, Math.min(def.target, q.progress || 0));
  q.completed = q.completed === true;
  q.rewarded = q.rewarded === true;
  q.active = !q.completed && q.active !== false;
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
  return h.quests[ELDER_QUEST_ID];
}
function advanceElderQuestKill(h = game.hero) {
  const def = QUESTS[ELDER_QUEST_ID], q = elderQuest(h);
  if (!q.active || q.completed || q.ready) return false;
  q.progress = Math.min(def.target, q.progress + 1);
  if (q.progress >= def.target) {
    q.ready = true;
    logMsg('Quest updated: Return to Elder for your reward.');
  }
  return true;
}
function collectElderQuestReward(h = game.hero) {
  const def = QUESTS[ELDER_QUEST_ID], q = elderQuest(h);
  if (!q.ready || q.completed) return false;
  q.progress = def.target;
  q.active = false;
  q.ready = false;
  q.completed = true;
  q.rewarded = true;
  game.won = true;
  h.gold += def.rewardGold;
  grantExp(h, def.rewardExp);
  for (const [id, n] of Object.entries(def.rewardItems)) addItem(id, n);
  logMsg(`Quest complete: ${def.title}: +${def.rewardExp} EXP, +${def.rewardGold} gold`);
  return true;
}
function elderQuestPages(h = game.hero) {
  const def = QUESTS[ELDER_QUEST_ID], q = elderQuest(h);
  if (q.completed) return ['Elder: Rest well, hero.', '* Fully recovered! *'];
  if (q.ready) return [
    'Elder: The fields are quieter already.',
    `Elder: Take this reward: ${def.rewardGold} gold, ${def.rewardExp} EXP, and potions.`,
  ];
  return [
    `Elder: Monsters plague our fields! Defeat ${def.target} of them. (${q.progress}/${def.target} so far)`,
    '* The Elder healed you and refilled a potion! *',
  ];
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
  game.follow = false;
  game.followEngaged = false;
  game.path = null;
  game.projectiles = [];
  game.bolts = [];
  game.pops = [];
}

// ---------------------------------------------------------------- dialogue
function say(pages) { game.dialogue = { pages, page: 0, chars: 0 }; }
function interact() { // returns true if something was there to talk to / read
  if (game.death) return false;
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
      const q = elderQuest(h);
      const pages = elderQuestPages(h);
      if (q.ready && !q.completed) collectElderQuestReward(h);
      say(pages);
      h.hp = h.maxhp; h.mp = h.maxmp;
      if ((h.bag.potion || 0) < 3) addItem('potion', 1);
      sfx('Recovery1');
      return true;
    }
    const shopId = shopForNpc(npc);
    if (shopId) {
      openShopChoice(shopId);
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
    say(['Monsters roam the grass! Lock onto a foe and step into reach to swing automatically. Cast skills with 1-5.',
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
// They chase the hero on sight; touching one hurts. Lock-on auto-melee slashes
// in reach, FIRE lobs a fireball. The dirt path stays monster-free.
const ENEMIES = {
  // flee: below this fraction of max HP the monster runs from you instead
  slime: { name: 'Slime', cx: 0, cy: 0, hp: 14, atk: 5, def: 2, exp: 5, gold: 7, speed: 38, wait: [0.25, 0.65], range: 7, flee: 0 },
  imp: { name: 'Imp', cx: 1, cy: 0, hp: 22, atk: 8, def: 3, exp: 8, gold: 14, speed: 54, wait: [0.12, 0.35], range: 9, flee: 0.15 },
  ghost: { name: 'Ghost', cx: 3, cy: 0, hp: 30, atk: 11, def: 3, exp: 14, gold: 24, speed: 62, wait: [0.08, 0.25], range: 11, flee: 0.2 },
};
const MAX_ENEMIES = 14; // the field is big now
function rnd(n) { return Math.floor(Math.random() * n); }
function pickEnemy() {
  const k = game.hero.kills;
  const pool = k < 2 ? ['slime'] : k < 4 ? ['slime', 'imp'] : ['slime', 'imp', 'ghost'];
  return pool[Math.floor(Math.random() * pool.length)];
}
function addPop(s, x, y, color) { game.pops.push({ s, x, y, t: 0, color }); }
function enemyAt(x, y) { return game.enemies.some(en => !en.dead && en.dying <= 0 && en.tx === x && en.ty === y); }
function playerAt(x, y) { return (game.players || []).some(p => !p.dead && p.tx === x && p.ty === y); }
function enemyAtPoint(x, y) { // point in the 24x32 sprite box
  return game.enemies.find(en => !en.dead && en.dying <= 0 &&
    x >= en.px - 4 && x < en.px + 20 && y >= en.py - 16 && y < en.py + 16);
}

// ---- click-to-move: BFS over walkable tiles, enemies and other players count as walls
function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => x + ',' + y;
  const prev = new Map([[key(sx, sy), null]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of Object.values(DIRV)) {
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
  if (!p) { // clicked a wall/NPC/enemy: walk up next to it instead
    for (const [dx, dy] of Object.values(DIRV)) {
      const nx = tx + dx, ny = ty + dy;
      if (isBlocked(nx, ny) || enemyAt(nx, ny) || playerAt(nx, ny)) continue;
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
      if (Math.abs(dx) + Math.abs(dy) <= e.range && Math.random() > 0.05) {
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
  if (h.hp <= 0) die(e.name);
}

// Death leaves your pack with the body and waits for an explicit respawn.
function die(cause) {
  const h = game.hero;
  if (h.dead) return;
  const items = {};
  for (const [id, n] of Object.entries(h.bag)) if (n > 0) items[id] = n;
  h.bag = {}; // your loot stays with the body — go get it back
  logMsg(`You died at ${new Date().toLocaleTimeString()} on ${game.mapId} (${h.tx},${h.ty}). Killed by ${cause || 'unknown forces'}.`);
  game.corpses.push({
    map: game.mapId, tx: h.tx, ty: h.ty, name: h.name || 'Hero',
    class: h.class || 'Knight', hair: h.hair, cloth: h.cloth,
    items, age: 0, decayed: false,
  });
  sfx('Damege2');
  h.hp = 0;
  h.moving = false;
  h.dead = true;
  game.death = { cause: cause || 'unknown forces', cursor: 0 };
  game.iframes = 0;
  game.dialogue = null; // death closes whatever you were reading
  game.menu = null;
  game.shop = null;
  game.itemPopup = null;
  game.corpseOpen = null;
  game.path = null;
  game.moveDir = null;
  game.lock = null;
  game.follow = false;
  game.followEngaged = false;
  addPop('You died!', h.px + 8, h.py - 14, '#f76');
}

function respawnHero() {
  const h = game.hero;
  switchMap(SPAWN.map, SPAWN.tx, SPAWN.ty);
  h.hp = h.maxhp;
  h.mp = h.maxmp;
  h.dir = 'down';
  h.dead = false;
  game.death = null;
  game.iframes = 2;
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
  h.kills++;
  advanceElderQuestKill(h);
  h.gold += e.gold;
  grantExp(h, e.exp);
  logMsg(`Defeated ${e.name}: +${e.exp} EXP, +${e.gold} gold`);
  if (Math.random() < 0.25) { // loot: autoloot pockets it, otherwise it falls
    const id = Math.random() < 0.7 ? 'bread' : 'potion';
    if (game.autoloot && canCarryItem(id, 1)) {
      addItem(id, 1);
      logMsg(`Looted ${ITEMS[id].name} x1`);
      sfx('Item1');
    } else {
      if (game.autoloot) warnCarryTooMuch();
      dropFloor(id, 1, en.tx, en.ty);
    }
  }
}
function grantExp(h, exp) {
  h.exp += exp;
  if (h.exp >= expToNextLevel(h.lv)) {
    h.exp -= expToNextLevel(h.lv);
    h.lv++;
    h.points += ATTR_POINTS_PER_LEVEL;
    h.skillPoints += SKILL_POINTS_PER_LEVEL;
    normalizeSkillProgress(h);
    recalcMax();
    h.hp = h.maxhp; h.mp = h.maxmp;
    sfx('Recovery2');
    logMsg(`LEVEL UP! Now Lv.${h.lv}  (+${ATTR_POINTS_PER_LEVEL} attribute points, +${SKILL_POINTS_PER_LEVEL} skill point)`);
    addPop('LEVEL UP!', h.px + 8, h.py - 22, '#ffe080');
  }
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
function slash() {
  const h = game.hero;
  game.atkCool = 1.0 / stats().aspd; // ponderous at Lv.1 — Agility speeds it up
  beginMeleeFx(h.dir);
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
  nova: { name: 'Nova', mp: 8, desc: 'Area magic around you. No lock required.', cast: castNova },
};
function skillRequiresTarget(id) { return id !== 'heal' && id !== 'nova'; }
function castSlot(i) {
  const h = game.hero, id = h.slots[i];
  if (game.atkCool > 0) return;
  if (!id) { sfx('Buzzer1'); return; }
  if (isHotbarItem(id)) {
    if (!useItem(id)) sfx('Buzzer1');
    return;
  }
  if (!SKILLS[id] || !skillAllowedForClass(id, h) || h.mp < skillCost(id, h)) { sfx('Buzzer1'); return; }
  if (skillRequiresTarget(id) && !liveEnemyLock()) { sfx('Buzzer1'); return; }
  if (SKILLS[id].cast()) h.mp -= skillCost(id, h);
  else sfx('Buzzer1');
}

function liveEnemyLock() {
  return game.lock && !game.lock.dead && game.lock.dying <= 0 ? game.lock : null;
}

function castFire() {
  const h = game.hero;
  const t = liveEnemyLock();
  if (!t) return false;
  game.atkCool = 0.4;
  sfx('Flame1');
  const m = Math.hypot(t.px - h.px, t.py - h.py) || 1;
  const dx = (t.px - h.px) / m, dy = (t.py - h.py) / m;
  game.projectiles.push({ x: h.px + 8 + dx * 8, y: h.py + 8 + dy * 8, dx, dy, target: t, dist: 0, t: 0 });
  return true;
}

function castHeal() {
  const h = game.hero;
  const healPower = 15 + (skillLevel('heal', h) - 1) * 5;
  const heal = Math.min(healPower, h.maxhp - Math.floor(h.hp));
  h.hp = Math.min(h.maxhp, h.hp + healPower);
  game.atkCool = 0.4;
  game.healFx = 0.5;
  sfx('Recovery1');
  if (heal > 0) addPop('+' + heal, h.px + 8, h.py - 14, '#9f9');
  return true;
}

function castSpin() {
  const h = game.hero;
  if (!liveEnemyLock()) return false;
  game.atkCool = Math.max(0.9, 1.3 - (skillLevel('spin', h) - 1) * 0.08) / stats().aspd;
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
  const t = liveEnemyLock();
  if (!t) return false;
  game.atkCool = 0.5;
  game.bolts.push({ x: t.px + 8, y: t.py + 4, t: 0 });
  sfx('Thunder4');
  hitEnemy(t, stats().matk * 2 + rnd(6) + (skillLevel('bolt', h) - 1) * 4);
  return true;
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
function novaDamage(h = game.hero) {
  return stats().matk + rnd(5) + (skillLevel('nova', h) - 1) * 3;
}
function castNova() {
  const h = game.hero;
  game.atkCool = 0.8;
  addNovaBolts(h);
  sfx('Thunder4');
  for (const en of game.enemies) {
    if (en.dying > 0 || en.dead) continue;
    const tx = Math.floor((en.px + 8) / TS), ty = Math.floor((en.py + 8) / TS);
    if (inNovaBounds(tx, ty, h)) hitEnemy(en, novaDamage(h));
  }
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
        hitEnemy(en, stats().matk * 2 + rnd(5) + (skillLevel('fire') - 1) * 4);
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
function canPlace(id, slot) {
  const it = ITEMS[id], want = it && it.slot;
  if (!want) return false;
  if (want === 'acc') return slot === 'acc1' || slot === 'acc2';
  if (want === 'main') return slot === 'main' || (!it.twoH && slot === 'off');
  return want === slot;
}
function slotFor(id) { // natural slot for keyboard/double-click equip
  const it = ITEMS[id], want = it && it.slot;
  if (want === 'acc') return !game.hero.equip.acc1 ? 'acc1' : 'acc2';
  if (want === 'main' && !it.twoH && game.hero.equip.main) return 'off';
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
  if (ITEMS[id].twoH) { // both hands on the claymore
    unequipSlot('main');
    unequipSlot('off');
  }
  if (slot === 'off' && h.equip.main && ITEMS[h.equip.main].twoH) unequipSlot('main');
  unequipSlot(slot);
  h.bag[id]--;
  h.equip[slot] = id;
  sfx('Decision1');
  return true;
}

function normalizeHeroEquipment() {
  const h = game.hero;
  if (!h.equip) h.equip = {};
  if (!h.bag) h.bag = {};
  for (const [slot, id] of Object.entries({ ...h.equip })) {
    if (!id) { delete h.equip[slot]; continue; }
    if (!ITEMS[id]) { delete h.equip[slot]; continue; }
    if (canPlace(id, slot)) continue;
    delete h.equip[slot];
    const natural = slotFor(id);
    if (natural && !h.equip[natural] && canPlace(id, natural)) h.equip[natural] = id;
    else h.bag[id] = (h.bag[id] || 0) + 1;
  }
}

function bagIds() { return Object.keys(ITEMS).filter(id => game.hero.bag[id] > 0); }
function bagWeight() {
  return Object.entries(game.hero.bag).reduce((s, [id, n]) => s + ITEMS[id].w * n, 0);
}
function capacity() { const h = game.hero; return 15 + h.lv * 2 + h.attr.str * 2; }
function overloaded() { return bagWeight() > capacity(); }
const CARRY_TOO_MUCH_MSG = "You're carrying too much weight already.";
function itemStackWeight(id, n) {
  const it = ITEMS[id];
  return it ? it.w * Math.max(0, n || 0) : Infinity;
}
function canCarryItem(id, n) {
  return bagWeight() + itemStackWeight(id, n) <= capacity();
}
function canCarryStacks(stacks) {
  let w = bagWeight();
  for (const [id, n] of Object.entries(stacks || {})) w += itemStackWeight(id, n);
  return w <= capacity();
}
function warnCarryTooMuch() {
  logMsg(CARRY_TOO_MUCH_MSG);
  sfx('Buzzer1');
}
function addItem(id, n) {
  game.hero.bag[id] = (game.hero.bag[id] || 0) + n;
}
function removeItem(id, n) {
  const h = game.hero;
  h.bag[id] = Math.max(0, (h.bag[id] || 0) - n);
}
function useItem(id) { // returns true if consumed/equipped
  const h = game.hero, it = ITEMS[id];
  if (!it || (h.bag[id] || 0) <= 0) return false;
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
  if (!here.length) return false;
  const stacks = {};
  for (const f of here) stacks[f.id] = (stacks[f.id] || 0) + f.n;
  if (!canCarryStacks(stacks)) {
    warnCarryTooMuch();
    return false;
  }
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
function simItemId(id, depth = 0) {
  if (depth > 3) return '';
  if (typeof id === 'string') {
    const key = id.trim();
    return key && key !== '[object Object]' && key.toLowerCase() !== 'object object' ? key : '';
  }
  if (id && typeof id === 'object') {
    for (const k of ['id', 'Id', 'ID', 'item', 'itemId', 'ItemId', 'name', 'Name']) {
      const key = simItemId(id[k], depth + 1);
      if (key) return key;
    }
    return '';
  }
  return id == null ? '' : String(id);
}
function moveFloorItem(fromTx, fromTy, toTx, toTy, id) {
  const want = simItemId(id);
  if (![fromTx, fromTy, toTx, toTy].every(Number.isFinite)) return false;
  if (!nearHero(fromTx, fromTy) || isBlocked(toTx, toTy)) return false;
  const i = game.floor.findIndex(f => f.map === game.mapId && f.tx === fromTx && f.ty === fromTy &&
    (!want || simItemId(f.id) === want));
  if (i < 0) return false;
  if (fromTx === toTx && fromTy === toTy) return true;
  const f = game.floor[i], movedId = simItemId(f.id), n = f.n;
  game.floor.splice(i, 1);
  dropFloor(movedId, n, toTx, toTy);
  sfx('Cancel1');
  return true;
}
function nearHero(tx, ty) { // same tile or adjacent (loot reach)
  return Math.abs(tx - game.hero.tx) <= 1 && Math.abs(ty - game.hero.ty) <= 1;
}
function corpseNear() {
  return game.corpses.find(c => !c.decayed && c.map === game.mapId && nearHero(c.tx, c.ty));
}
function corpseAt(tx, ty) {
  return game.corpses.find(c => c.map === game.mapId && c.tx === tx && c.ty === ty);
}
function moveCorpse(fromTx, fromTy, toTx, toTy) {
  if (![fromTx, fromTy, toTx, toTy].every(Number.isFinite)) return false;
  if (!nearHero(fromTx, fromTy) || !corpseDropTileAllowed(toTx, toTy)) return false;
  const i = game.corpses.findIndex(c => c.map === game.mapId && c.tx === fromTx && c.ty === fromTy);
  if (i < 0) return false;
  const c = game.corpses[i];
  if (cur().ground[toTy][toTx] === 'W') {
    if (game.corpseOpen === c) game.corpseOpen = null;
    game.corpses.splice(i, 1);
    sfx('Cancel1');
    return true;
  }
  c.tx = toTx;
  c.ty = toTy;
  sfx('Cancel1');
  return true;
}
function corpseDropTileAllowed(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return false;
  return !isBlocked(tx, ty) || cur().ground[ty][tx] === 'W';
}
function takeFromCorpse(c, id) {
  if (c.decayed || !c.items[id]) return false;
  if (!canCarryItem(id, c.items[id])) {
    warnCarryTooMuch();
    return false;
  }
  addItem(id, c.items[id]);
  addPop(`+${c.items[id]} ${ITEMS[id].name}`, game.hero.px + 8, game.hero.py - 12, '#9f9');
  delete c.items[id];
  sfx('Item1');
  return true;
}

// ---------------------------------------------------------------- shops
const SHOPS = {
  smith: { name: 'Blacksmith', stock: ['sword1', 'sword2', 'sword3', 'shield', 'hat', 'helm', 'armor', 'legs'] },
  grocer: { name: 'Grocer', stock: ['bread', 'meat', 'potion', 'boots', 'ring', 'amulet'] },
};
function shopForNpc(npc) {
  return npc && (npc.id === 'smith' || npc.id === 'grocer') ? npc.id : null;
}
function shopNpcAt(tx, ty) {
  return npcs.find(n => n.map === game.mapId && n.tx === tx && n.ty === ty && shopForNpc(n));
}
function shopNpcAtPoint(wx, wy) {
  return npcs.find(n => n.map === game.mapId && shopForNpc(n) &&
    wx >= n.px - 4 && wx < n.px + 20 && wy >= n.py - 16 && wy < n.py + 16);
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
function shopInStock(who, id) {
  return !!(SHOPS[who] && SHOPS[who].stock.includes(id));
}
function shopUnitPrice(id) {
  return ITEMS[id] ? ITEMS[id].price : 0;
}
function sellValue(id) {
  return shopUnitPrice(id);
}
function shopBuy(who, id, n = 1) {
  const h = game.hero, it = ITEMS[id], amount = Math.max(1, Math.floor(n || 1));
  if (!it || !shopInStock(who, id)) { sfx('Buzzer1'); return; }
  const total = it.price * amount;
  if (h.gold < total) { sfx('Buzzer1'); return; }
  if (!canCarryItem(id, amount)) { warnCarryTooMuch(); return; }
  h.gold -= total;
  addItem(id, amount);
  sfx('Item1');
  addPop(`+${amount} ${it.name}`, h.px + 8, h.py - 12, '#9f9');
}
function shopSell(id, n = 1) {
  const h = game.hero, it = ITEMS[id], amount = Math.max(1, Math.floor(n || 1));
  if (!it || (h.bag[id] || 0) < amount) { sfx('Buzzer1'); return; }
  removeItem(id, amount);
  h.gold += sellValue(id) * amount;
  sfx('Item1');
  addPop(`+${sellValue(id) * amount}g`, h.px + 8, h.py - 12, '#ffe080');
}
function assignSkillSlot(id, i) {
  const h = game.hero, old = h.slots.indexOf(id);
  if (i < 0 || i >= h.slots.length || !hotbarEntryAllowed(id, h)) { sfx('Buzzer1'); return; }
  if (old === i) h.slots[i] = null; // same slot again: unequip
  else { if (old >= 0) h.slots[old] = null; h.slots[i] = id; }
  sfx('Decision1');
}
function upgradeSkill(id) {
  const h = game.hero;
  normalizeSkillProgress(h);
  if (!SKILLS[id] || !skillAllowedForClass(id, h) || h.skillPoints <= 0 || h.skillLevels[id] >= MAX_SKILL_LEVEL) { sfx('Buzzer1'); return; }
  const req = SKILL_TREE[id];
  if (req && h.skillLevels[req] < 2) { sfx('Buzzer1'); return; }
  h.skillLevels[id]++;
  h.skillPoints--;
  sfx('Decision1');
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


// ================================================================ intent tick
// The seam between the (thin) client and the authoritative world. The client
// never calls slash()/castSlot()/equipTo()/... directly; it pushes intents and
// the sim applies them at the top of each tick. This is the exact shape the Go
// server will consume: one queue of validated player actions per tick. Every
// rule check (cooldowns, MP, range, gold, carry) already lives in the callees,
// so nothing here trusts the client beyond "the player asked to do X".
// In single-player, intents queue for the local sim. In netplay, the same UI
// code runs but its intents are forwarded to the authoritative server instead.
function pushIntent(it) {
  if (game.net) { if (typeof netSend === 'function') netSend(game.net, it); return; }
  game.intents.push(it);
}
function applyIntent(it) {
  const h = game.hero;
  switch (it.t) {
    case 'moveDir':                                   // held-key walk command
      game.moveDir = it.dir; if (it.dir) game.path = null; break;
    case 'moveTo':                                    // click-to-move (cancels follow)
      game.follow = false; game.followEngaged = false; startPathTo(it.tx, it.ty); break;
    case 'confirm':                                   // talk/read only; melee is lock-on automatic
      if (interact()) game.path = null;
      break;
    case 'cast': castSlot(it.slot); break;
    case 'cycleLock': cycleLock(); break;
    case 'lockAt': {                                  // Ctrl+click: lock for attack (no follow); Ctrl+click same target again to unlock/release
      const en = enemyAtPoint(it.x, it.y);
      if (en && game.lock === en) {
        game.lock = null;
        game.follow = false;
        game.followEngaged = false;
        sfx('Cancel1');
      } else {
        game.lock = en || null; game.follow = false; game.followEngaged = false;
        if (en) sfx('Cursor1');
      }
      break;
    }
    case 'followAt': {                                // used by Alt (on new target) or Ctrl+Alt to activate lock + follow
      const en = enemyAtPoint(it.x, it.y);
      if (en) { game.lock = en; game.follow = true; game.followEngaged = false; sfx('Decision1'); }
      break;
    }
    case 'toggleFollow':
      if (game.lock) {
        game.follow = !game.follow;
        game.followEngaged = false;
        sfx(game.follow ? 'Decision1' : 'Cancel1');
      } else sfx('Buzzer1');
      break;
    case 'unlock':
      game.lock = null;
      game.follow = false;
      game.followEngaged = false;
      break;
    case 'useItem': if (!useItem(it.id)) sfx('Buzzer1'); break;
    case 'equip': if (!equipTo(it.id, it.bslot)) sfx('Buzzer1'); break;
    case 'unequip':
      if (h.equip[it.bslot]) { unequipSlot(it.bslot); sfx('Cancel1'); } else sfx('Buzzer1'); break;
    case 'dropItem':
      if (h.bag[it.id] > 0) {
        const n = Math.max(1, Math.min(h.bag[it.id], Math.floor(it.n || 1)));
        removeItem(it.id, n);
        dropFloor(it.id, n, h.tx, h.ty);
        sfx('Cancel1');
      }
      break;
    case 'takeLoot': pickupAt(it.tx, it.ty); break;
    case 'moveFloorItem': moveFloorItem(it.tx, it.ty, it.toTx, it.toTy, it.id); break;
    case 'moveCorpse': moveCorpse(it.tx, it.ty, it.toTx, it.toTy); break;
    case 'takeCorpse':
      if (game.corpseOpen) {
        if (it.id === '*') {
          if (!canCarryStacks(game.corpseOpen.items)) warnCarryTooMuch();
          else Object.keys(game.corpseOpen.items).forEach(id => takeFromCorpse(game.corpseOpen, id));
        }
        else if (game.corpseOpen.items[it.id]) takeFromCorpse(game.corpseOpen, it.id);
      }
      break;
    case 'buy': shopBuy(it.who, it.id, it.n || 1); break;
    case 'sell': shopSell(it.id, it.n || 1); break;
    case 'spendAttr':
      if (h.points > 0) { h.attr[it.key]++; h.points--; recalcMax(); sfx('Decision1'); }
      else sfx('Buzzer1');
      break;
    case 'assignSkill': assignSkillSlot(it.id, it.slot); break;
    case 'upgradeSkill': upgradeSkill(it.id); break;
    case 'setAutoloot': game.autoloot = it.v; break;
  }
}

// One authoritative tick: drain the intent queue, then advance the world by dt.
// Callable at any dt — the browser drives it once per frame (variable dt, as
// the original loop did); the headless sim and the future server call it at a
// fixed 20 Hz (dt = 0.05). advanceWorld() is the old updateMap() minus all
// input reading: movement now follows game.moveDir/path/follow, which intents set.
function stepWorld(dt) {
  const ints = game.intents; game.intents = [];
  for (const it of ints) applyIntent(it);
  advanceWorld(dt);
}
function advanceWorld(dt) {
  const h = game.hero;
  for (const p of game.pops) p.t += dt;
  game.pops = game.pops.filter(p => p.t < 0.8);
  game.iframes = Math.max(0, game.iframes - dt);
  game.atkCool = Math.max(0, game.atkCool - dt);
  game.healFx = Math.max(0, game.healFx - dt);
  if (game.slashFx && (game.slashFx.t += dt) >= (game.slashFx.dur || 0.18)) game.slashFx = null;
  if (h.dead || game.death) {
    updateCorpses(dt);
    return;
  }
  h.mp = Math.min(h.maxmp, h.mp + dt * 0.35); // slow regen keeps skills in play
  h.hp = Math.min(h.maxhp, h.hp + dt * 0.4);
  updateCorpses(dt);
  updateNpcs(dt);
  updateEnemies(dt);
  if (game.scene !== 'map') return;
  updateProjectiles(dt);
  game.bolts.forEach(b => b.t += dt);
  game.bolts = game.bolts.filter(b => b.t < 0.25);
  if (game.lock && (game.lock.dead || game.lock.dying > 0)) { game.lock = null; game.follow = false; game.followEngaged = false; }
  faceFollowTargetIfInReach();
  // locked on and in reach: the sword strikes by itself, menus or not
  if (game.lock && game.atkCool <= 0) {
    const dir = faceToward(game.lock);
    if (slashReaches(dir, game.lock)) { h.dir = dir; slash(); }
  }

  stepHero(dt);
  faceFollowTargetIfInReach();
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

function updateCorpses(dt) {
  let decayed = 0;
  for (const c of game.corpses) {
    c.age = (c.age || 0) + dt;
    if (!c.decayed && c.age >= CORPSE_DECAY) {
      c.decayed = true;
      c.items = {};
      if (game.corpseOpen === c) game.corpseOpen = null;
    }
    if (c.decayed) decayed++;
  }
  if (decayed > 24) {
    let drop = decayed - 24;
    game.corpses = game.corpses.filter(c => {
      if (!c.decayed || drop <= 0) return true;
      drop--;
      return false;
    });
  }
}

// Hero locomotion: integrate toward the target tile while moving, else start a
// step from game.moveDir / click path / follow. Split out of advanceWorld() so
// the netplay client can predict the local hero with the exact same rules the
// Go server runs (world.go's stepPlayer is this function's port). Returns true
// if a map exit was taken (caller should stop advancing this tick).
function stepHero(dt) {
  const h = game.hero;
  if (h.dead || game.death) return false;
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
      if (exit) { switchMap(...exit); return true; }
    }
  } else {
    const dir = game.moveDir; // set by the 'moveDir' intent (null when a UI panel owns input)
    if (dir) {
      game.path = null; // keyboard overrides click-to-move
      h.dir = dir;
      h.anim += dt * 8.75; // keeps stepping against walls, like RM2k
      const d = DIRV[dir];
      const nx = h.tx + d[0], ny = h.ty + d[1];
      if (!isBlocked(nx, ny) && !enemyAt(nx, ny) && !playerAt(nx, ny)) { h.tx = nx; h.ty = ny; h.moving = true; }
    } else if (game.path) { // click-to-move keeps walking under any UI
      const [nx, ny] = game.path[0];
      h.dir = nx > h.tx ? 'right' : nx < h.tx ? 'left' : ny > h.ty ? 'down' : 'up';
      if (!isBlocked(nx, ny) && !enemyAt(nx, ny) && !playerAt(nx, ny)) {
        game.path.shift();
        h.tx = nx; h.ty = ny; h.moving = true;
      } else { // something wandered into the route: replan to the same goal
        const [gx, gy] = game.path[game.path.length - 1];
        game.path = findPath(h.tx, h.ty, gx, gy);
      }
      if (game.path && !game.path.length) game.path = null;
    } else if (liveFollowTarget()) {
      // follow mode (F): keep walking after the locked target until in reach
      const target = liveFollowTarget();
      const dx = target.tx - h.tx, dy = target.ty - h.ty;
      h.dir = faceToward(target);
      const within = Math.max(Math.abs(dx), Math.abs(dy)) <= 1;
      if (within && game.followEngaged) {
        // just face, stop chasing (rule active after first close)
      } else {
        // chase if far, or on initial follow (even if within)
        if (within) {
          game.followEngaged = true;
        }
        const hd = dx > 0 ? 'right' : 'left', vd = dy > 0 ? 'down' : 'up';
        const dirs = Math.abs(dx) > Math.abs(dy) ? [hd, vd] : [vd, hd];
        for (const fd of dirs) {
          const dv = DIRV[fd];
          if (!dx && (fd === 'left' || fd === 'right')) continue;
          if (!dy && (fd === 'up' || fd === 'down')) continue;
          const nx = h.tx + dv[0], ny = h.ty + dv[1];
          if (isBlocked(nx, ny) || enemyAt(nx, ny) || playerAt(nx, ny)) continue;
          h.dir = fd;
          h.tx = nx; h.ty = ny; h.moving = true;
          break;
        }
      }
      if (!h.moving) h.anim = 1;
    } else h.anim = 1; // standing frame
  }
  return false;
}

// Node (headless sim + future tooling) loads this file with require(); the
// browser loads it as a classic <script> and shares these via global scope.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { game, resetGame, stepWorld, pushIntent, switchMap };
}
