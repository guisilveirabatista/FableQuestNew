// Fable Quest — a mini RPG built on the RPG Maker 2003 RTP assets.
// 320x240 internal resolution, scaled 2x in CSS.

'use strict';

const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

const TS = 16, MW = 20, MH = 15;

// ---------------------------------------------------------------- assets
const IMAGES = ['chipset', 'hero', 'npc', 'system', 'backdrop', 'title', 'gameover',
  'slime', 'imp', 'ghost'];
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
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (!held[e.key]) queue.push(e.key);
  held[e.key] = true;
  if (!audioOk) { audioOk = true; syncMusic(); }
});
addEventListener('keyup', e => { held[e.key] = false; });
function pressed(keys) { return queue.some(k => keys.includes(k)); }
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
function resetGame() {
  game.scene = 'title';
  game.hero = {
    tx: 9, ty: 8, px: 9 * TS, py: 8 * TS, dir: 'down', anim: 0, moving: false,
    hp: 30, maxhp: 30, mp: 10, maxmp: 10, atk: 5, lv: 1, exp: 0, gold: 0,
    potions: 3, kills: 0,
  };
  game.steps = 0;
  game.dialogue = null;
  game.battle = null;
  game.menu = null;
  game.titleCursor = 0;
  game.flash = 0;
  game.shake = 0;
  game.won = false;
}

// ---------------------------------------------------------------- music & save
function sceneSong() {
  return { title: 'title', map: 'field', battle: 'battle' }[game.scene] || null;
}
function syncMusic() {
  if (!audioOk) return;
  const s = sceneSong();
  if (s) MidiPlayer.play(s);
  else MidiPlayer.stop();
}
const SAVE_KEY = 'fablequest_save';
function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ hero: game.hero, won: game.won, steps: game.steps }));
}
function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  const d = JSON.parse(raw);
  Object.assign(game.hero, d.hero);
  game.won = d.won;
  game.steps = d.steps;
  const h = game.hero;
  h.px = h.tx * TS; h.py = h.ty * TS; h.moving = false;
  game.dialogue = null;
  game.battle = null;
  return true;
}

// ---------------------------------------------------------------- map data
const GROUND = [
  'GGGGGGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGWWWWGG',
  'GGGGGGGGGGGGGGWWWWGG',
  'GGGGGGGGGGGGGGWWWWGG',
  'GGGGGGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGGGGGG',
  'GGDDDDDDDDDDDDDDDDGG',
  'GGGGDGGGGGGGGGGGGGGG',
  'GGGGDGGGGGGGGGGGGGGG',
  'GGGGDGGGGGGGGGGGGGGG',
  'GGGGDGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGGGGGG',
];
const trees = [[2, 4], [6, 2], [9, 4], [15, 11], [11, 12], [17, 9], [12, 2]];
const props = [ // [tile, x, y]
  ['rock', 7, 6], ['rock', 13, 10], ['rock', 3, 7],
  ['well', 3, 12], ['sign', 10, 7], ['palm', 13, 5], ['palm', 18, 5],
  ['cactus', 7, 11],
];
const npcs = [
  { id: 'elder', cx: 2, cy: 1, tx: 5, ty: 12, dir: 'down' },
  { id: 'girl', cx: 3, cy: 0, tx: 15, ty: 6, dir: 'down' },
];

const blocked = new Set();
for (let x = 0; x < MW; x++) { blocked.add(x + ',0'); blocked.add(x + ',' + (MH - 1)); }
for (let y = 0; y < MH; y++) { blocked.add('0,' + y); blocked.add((MW - 1) + ',' + y); }
for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++)
  if (GROUND[y][x] === 'W') blocked.add(x + ',' + y);
for (const [x, y] of trees) for (const [dx, dy] of [[0, 0], [1, 0], [0, -1], [1, -1]])
  blocked.add((x + dx) + ',' + (y + dy));
for (const [, x, y] of props) blocked.add(x + ',' + y);

function isBlocked(x, y) {
  if (x < 0 || y < 0 || x >= MW || y >= MH) return true;
  if (blocked.has(x + ',' + y)) return true;
  return npcs.some(n => n.tx === x && n.ty === y);
}

// ---------------------------------------------------------------- dialogue
function say(pages) { game.dialogue = { pages, page: 0, chars: 0 }; }
function interact() {
  const h = game.hero;
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[h.dir];
  const fx = h.tx + d[0], fy = h.ty + d[1];
  const npc = npcs.find(n => n.tx === fx && n.ty === fy);
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
      if (h.potions < 3) h.potions++;
      sfx('Recovery1');
      return;
    }
    if (npc.id === 'girl') {
      say(['Girl: The pond is lovely, but stay on the dirt path if you are hurt...', 'Girl: Monsters never attack on the path!']);
      return;
    }
  }
  if (props.some(([t, x, y]) => t === 'sign' && x === fx && y === fy)) {
    sfx('Decision1');
    say(['Wild monsters roam the grass. The dirt path is safe!', 'Defeat 5 monsters, then talk to the Elder by the well (south-west).']);
  }
  if (props.some(([t, x, y]) => t === 'well' && x === fx && y === fy)) {
    sfx('Item1');
    say(['You toss a coin into the well... nothing happens. Classic.']);
  }
}

// ---------------------------------------------------------------- battle
const ENEMIES = {
  slime: { name: 'Slime', img: 'slime', hp: 10, atk: 4, def: 1, exp: 4, gold: 6, scale: 2 },
  imp: { name: 'Imp', img: 'imp', hp: 16, atk: 6, def: 2, exp: 7, gold: 12, scale: 2 },
  ghost: { name: 'Ghost', img: 'ghost', hp: 24, atk: 8, def: 2, exp: 12, gold: 20, scale: 2 },
};
function pickEnemy() {
  const k = game.hero.kills;
  const pool = k < 2 ? ['slime'] : k < 4 ? ['slime', 'imp'] : ['slime', 'imp', 'ghost'];
  return pool[Math.floor(Math.random() * pool.length)];
}
function startBattle(kind) {
  const e = ENEMIES[kind];
  game.battle = {
    kind, ehp: e.hp, emax: e.hp,
    phase: 'msg', msg: `${'AEIOU'.includes(e.name[0]) ? 'An' : 'A'} ${e.name} appears!`, next: 'menu',
    cursor: 0, timer: 0, t: 0, pops: [], eflash: 0,
  };
  game.scene = 'battle';
  sfx('Battle1');
  if (audioOk) MidiPlayer.play('battle');
  game.flash = 0.5;
}
const MENU = ['Attack', 'Fire', 'Potion', 'Run'];
function menuAction(b, h, e) {
  const i = b.cursor;
  if (i === 0) {
    sfx('Sword1');
    const dmg = Math.max(1, h.atk + rnd(4) - e.def);
    b.ehp = Math.max(0, b.ehp - dmg);
    b.eflash = 0.35;
    b.pops.push({ s: '' + dmg, t: 0 });
    setPhase(b, `You attack! ${dmg} damage!`, b.ehp <= 0 ? 'win' : 'enemy');
  } else if (i === 1) {
    if (h.mp < 4) { sfx('Buzzer1'); setPhase(b, 'Not enough MP!', 'menu'); return; }
    h.mp -= 4; sfx('Flame1');
    const dmg = h.atk * 2 + rnd(5);
    b.ehp = Math.max(0, b.ehp - dmg);
    b.eflash = 0.35;
    b.pops.push({ s: '' + dmg, t: 0 });
    setPhase(b, `Fire scorches the ${e.name}! ${dmg} damage!`, b.ehp <= 0 ? 'win' : 'enemy');
  } else if (i === 2) {
    if (h.potions <= 0) { sfx('Buzzer1'); setPhase(b, 'No potions left!', 'menu'); return; }
    h.potions--; sfx('Recovery1');
    const heal = Math.min(15, h.maxhp - h.hp);
    h.hp += heal;
    setPhase(b, `Potion restores ${heal} HP!`, 'enemy');
  } else {
    if (Math.random() < 0.7) {
      sfx('Escape');
      setPhase(b, 'You fled the battle!', 'flee');
    } else {
      sfx('Buzzer1');
      setPhase(b, "Can't escape!", 'enemy');
    }
  }
}
function setPhase(b, msg, next) { b.phase = 'msg'; b.msg = msg; b.next = next; b.timer = 0; }
function rnd(n) { return Math.floor(Math.random() * n); }

function updateBattle(dt) {
  const b = game.battle, h = game.hero, e = ENEMIES[b.kind];
  b.t += dt;
  b.eflash = Math.max(0, b.eflash - dt);
  b.pops.forEach(p => p.t += dt);
  b.pops = b.pops.filter(p => p.t < 0.8);

  if (b.phase === 'menu') {
    if (pressed(['ArrowUp', 'w'])) { b.cursor = (b.cursor + 3) % 4; sfx('Cursor1'); }
    if (pressed(['ArrowDown', 's'])) { b.cursor = (b.cursor + 1) % 4; sfx('Cursor1'); }
    if (pressed(CONFIRM)) menuAction(b, h, e);
  } else if (b.phase === 'msg') {
    b.timer += dt;
    if (b.timer > 0.5 && pressed(CONFIRM) || b.timer > 1.4) {
      if (b.next === 'menu') b.phase = 'menu';
      else if (b.next === 'enemy') {
        const dmg = Math.max(1, e.atk + rnd(3) - 1 - Math.floor(h.lv / 2));
        h.hp = Math.max(0, h.hp - dmg);
        sfx('Damege1');
        game.shake = 0.35;
        setPhase(b, `${e.name} attacks! You take ${dmg} damage!`, h.hp <= 0 ? 'lose' : 'menu');
      } else if (b.next === 'win') {
        sfx('Monster1');
        if (audioOk) MidiPlayer.play('fanfare', false);
        h.kills++; h.exp += e.exp; h.gold += e.gold;
        let m = `Victory! Got ${e.exp} EXP and ${e.gold} gold!`;
        if (h.exp >= h.lv * 10) {
          h.exp -= h.lv * 10; h.lv++; h.maxhp += 6; h.atk += 2; h.maxmp += 2;
          h.hp = h.maxhp; h.mp = h.maxmp;
          m += ` LEVEL UP! Now Lv.${h.lv}!`;
          sfx('Recovery2');
        }
        setPhase(b, m, 'exit');
      } else if (b.next === 'lose') {
        game.scene = 'gameover';
        sfx('Damege2');
        MidiPlayer.stop();
      } else { // exit / flee
        game.scene = 'map';
        game.battle = null;
        syncMusic();
      }
    }
  }
}

function drawBattle() {
  const b = game.battle, h = game.hero, e = ENEMIES[b.kind];
  ctx.drawImage(img.backdrop, 0, 0);
  // monster with idle bob
  const m = img[e.img];
  const s = e.scale, w = m.width * s, hh = m.height * s;
  const mx = 160 - w / 2, my = 108 - hh + Math.sin(b.t * 2.5) * 2;
  if (b.ehp > 0) {
    ctx.drawImage(m, mx, my, w, hh);
    if (b.eflash > 0) {
      const off = document.createElement('canvas');
      off.width = m.width; off.height = m.height;
      const o = off.getContext('2d');
      o.drawImage(m, 0, 0);
      o.globalCompositeOperation = 'source-in';
      o.fillStyle = '#fff';
      o.fillRect(0, 0, off.width, off.height);
      ctx.globalAlpha = b.eflash * 2;
      ctx.drawImage(off, mx, my, w, hh);
      ctx.globalAlpha = 1;
    }
  }
  for (const p of b.pops) text(p.s, 158, my - 12 - p.t * 20, '#ffe080');

  // enemy name + hp bar
  drawWindow(6, 6, 110, 30);
  text(e.name, 14, 13);
  ctx.fillStyle = '#333'; ctx.fillRect(14, 24, 94, 5);
  ctx.fillStyle = '#d33'; ctx.fillRect(14, 24, 94 * b.ehp / b.emax, 5);

  // message window
  if (b.phase === 'msg') {
    drawWindow(6, 130, 308, 30);
    text(b.msg, 16, 141);
  }
  // command + status windows
  drawWindow(0, 168, 96, 72);
  MENU.forEach((mn, i) => {
    if (b.phase === 'menu' && b.cursor === i) drawCursor(6, 174 + i * 16, 84, 16);
    text(mn, 16, 178 + i * 16, i === 1 && h.mp < 4 || i === 2 && h.potions <= 0 ? '#999' : '#fff');
  });
  drawWindow(96, 168, 224, 72);
  text(`Hero  Lv.${h.lv}`, 108, 178);
  text(`HP ${h.hp}/${h.maxhp}`, 108, 194);
  text(`MP ${h.mp}/${h.maxmp}`, 108, 210);
  text(`Potions x${h.potions}`, 200, 178);
  text(`Gold ${h.gold}`, 200, 194);
  text(`Kills ${h.kills}/5`, 200, 210);
}

// ---------------------------------------------------------------- game menu
const ROOT_MENU = ['Items', 'Status', 'Quest', 'Save', 'Load', 'Music', 'To Title'];
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
  } else if (m.mode === 'status') {
    drawWindow(8, 8, 188, 124);
    const lines = [
      `Hero  Lv.${h.lv}`,
      `HP  ${h.hp}/${h.maxhp}`,
      `MP  ${h.mp}/${h.maxmp}`,
      `Attack  ${h.atk}`,
      `EXP  ${h.exp}/${h.lv * 10}`,
      `Steps  ${game.steps}`,
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
function updateMap(dt) {
  const h = game.hero;
  if (game.menu) { updateMenu(dt); return; }
  if (game.dialogue) {
    const d = game.dialogue;
    d.chars += dt * 40;
    if (pressed(CONFIRM)) {
      if (d.chars < d.pages[d.page].length) d.chars = 999;
      else if (++d.page >= d.pages.length) game.dialogue = null;
      else d.chars = 0;
      sfx('Cursor1');
    }
    return;
  }
  if (h.moving) {
    const speed = 70 * dt;
    const gx = h.tx * TS, gy = h.ty * TS;
    h.px += Math.sign(gx - h.px) * Math.min(speed, Math.abs(gx - h.px));
    h.py += Math.sign(gy - h.py) * Math.min(speed, Math.abs(gy - h.py));
    h.anim += dt * 8;
    if (h.px === gx && h.py === gy) {
      h.moving = false;
      game.steps++;
      if (GROUND[h.ty][h.tx] === 'G' && game.steps > 3 && Math.random() < 0.11) {
        startBattle(pickEnemy());
        return;
      }
    }
  } else {
    h.anim = 1;
    if (pressed(CANCEL)) { game.menu = { mode: 'root', cursor: 0 }; sfx('Decision1'); return; }
    if (pressed(CONFIRM)) { interact(); queue = []; return; }
    const dir = dirHeld();
    if (dir) {
      h.dir = dir;
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
      if (!isBlocked(h.tx + d[0], h.ty + d[1])) {
        h.tx += d[0]; h.ty += d[1]; h.moving = true;
      }
    }
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
  let ox = 0, oy = 0;
  if (game.shake > 0) { ox = rnd(5) - 2; oy = rnd(3) - 1; }
  ctx.save();
  ctx.translate(ox, oy);

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
    base: (n.ty + 1) * TS,
    draw: () => drawChar(img.npc, n.cx, n.cy, n.dir, 1, n.tx * TS, n.ty * TS),
  });
  drawables.push({
    base: h.py + TS,
    draw: () => drawChar(img.hero, 0, 0, h.dir, h.moving ? [0, 1, 2, 1][Math.floor(h.anim) % 4] : 1, h.px, h.py),
  });
  drawables.sort((a, b) => a.base - b.base);
  for (const d of drawables) d.draw();
  ctx.restore();

  // HUD
  drawWindow(4, 4, 118, 22);
  text(`HP ${h.hp}/${h.maxhp}  Lv.${h.lv}`, 12, 11);

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
  if (!pressed(CONFIRM)) return;
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
  game.flash = Math.max(0, game.flash - dt);
  game.shake = Math.max(0, game.shake - dt);

  if (game.scene === 'title') {
    updateTitle();
    if (game.scene === 'title') drawTitle();
  } else if (game.scene === 'map') {
    updateMap(dt);
    if (game.scene === 'map') drawMap();
  } else if (game.scene === 'battle') {
    updateBattle(dt);
    if (game.battle) drawBattle();
    else if (game.scene === 'map') drawMap();
  } else if (game.scene === 'gameover') {
    ctx.drawImage(img.gameover, 0, 0);
    if (pressed(CONFIRM)) { resetGame(); syncMusic(); }
  }

  if (game.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${game.flash * 1.6})`;
    ctx.fillRect(0, 0, 320, 240);
  }
  queue = [];
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
  if (p.get('scene') === 'battle') {
    game.scene = 'map';
    startBattle(p.get('enemy') || 'slime');
    game.flash = 0;
    if (p.get('menu')) game.battle.phase = 'menu';
  }
  requestAnimationFrame(loop);
}).catch(e => {
  ctx.fillStyle = '#fff';
  ctx.fillText('Failed to load assets: ' + e, 10, 20);
});
