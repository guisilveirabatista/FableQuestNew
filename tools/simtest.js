'use strict';
// Headless proof that the Phase 0 simulation runs with NO browser attached —
// no DOM, no canvas, no audio. It require()s sim.js (which the browser instead
// loads as a <script>), stubs the host-provided sfx(), then drives the world
// purely through intents at a fixed 20 Hz tick. This is both a smoke test and
// the concrete demonstration that the same rules can run on a server.
//
//   node tools/simtest.js
//
// Exits non-zero on the first failed assertion.

global.sfx = () => {};                 // audio is a client concern; silence it
const sim = require('../sim.js');
const { game, resetGame, stepWorld, pushIntent, switchMap } = sim;

const FIXED = 0.05;                    // 20 Hz authoritative tick
let passed = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ FAIL:', msg); process.exit(1); }
  passed++;
  console.log('  ✓', msg);
}
function tick(n, intentEach) {
  for (let i = 0; i < n; i++) { if (intentEach) pushIntent(intentEach()); stepWorld(FIXED); }
}

console.log('Phase 0 headless sim test\n');

// ---- boot the world onto the field, exactly like the browser boot does
resetGame();
game.scene = 'map';
switchMap('field', 9, 12);
check(game.hero.tx === 9 && game.hero.ty === 12, 'hero spawned on the field');
check(Array.isArray(game.intents) && game.intents.length === 0, 'intent queue initialized empty');

// ---- the world advances on its own: monsters spawn on the grass
tick(120);
check(game.enemies.length > 0, `monsters spawned unbidden (${game.enemies.length} roaming)`);

// ---- movement is intent-driven: walking right increases hero.tx
const startX = game.hero.tx;
tick(80, () => ({ t: 'moveDir', dir: 'right' }));
check(game.hero.tx > startX, `hero walked right via moveDir intents (${startX} -> ${game.hero.tx})`);
pushIntent({ t: 'moveDir', dir: null }); stepWorld(FIXED); // stop

// ---- combat resolves server-side: face a slime and swing. Max out Dexterity
// so precision is 100% (no RNG misses — a miss is legitimate sim behavior, just
// not what we're asserting here), and give a few swings in case of a crit-less
// low roll leaving it barely alive.
resetGame();
game.scene = 'map';
switchMap('field', 9, 12);
game.hero.attr.dex = 20;              // precision -> 100%
game.hero.dir = 'right';
game.enemies = [{
  kind: 'slime', tx: 10, ty: 12, px: 10 * 16, py: 12 * 16, dir: 'left',
  anim: 1, moving: false, wait: 99, hp: 10, maxhp: 10,
  flash: 0, dying: 0, stun: 0, hurtT: 9, lunge: 0,
}];
const target = game.enemies[0];
const hpBefore = target.hp;
for (let i = 0; i < 4 && target.hp === hpBefore && target.dying <= 0; i++) {
  game.atkCool = 0;                   // ready the next swing
  pushIntent({ t: 'confirm' }); stepWorld(FIXED);
}
check(target.hp < hpBefore || target.dying > 0, `sword hit resolved in the sim (${hpBefore} -> ${target.hp})`);

// ---- inventory rules run server-side: buying costs gold, equipping consumes it
resetGame();
game.hero.gold = 1000;
game.hero.bag = { sword1: 1 };
pushIntent({ t: 'equip', id: 'sword1', bslot: 'main' }); stepWorld(FIXED);
check(game.hero.equip.main === 'sword1', 'equip intent moved the sword onto the body');
check(!game.hero.bag.sword1, 'equip intent removed the sword from the bag');

// ---- attribute spend is validated (only when points are available)
resetGame();
game.hero.points = 1;
const vit0 = game.hero.attr.vit;
pushIntent({ t: 'spendAttr', key: 'vit' }); stepWorld(FIXED);
pushIntent({ t: 'spendAttr', key: 'vit' }); stepWorld(FIXED); // second one must be refused
check(game.hero.attr.vit === vit0 + 1, 'spendAttr honored exactly one point (no overspend)');
check(game.hero.points === 0, 'attribute points decremented to zero');

console.log(`\nAll ${passed} checks passed — the sim ran fully headless.`);
