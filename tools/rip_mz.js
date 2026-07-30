// Build the FableQuestMZ asset set from the RPG Maker MZ library (newdata
// runtime template + owned DLC packs). Replaces the RM2k3 RTP rips with
// modern 48px MZ art:
//   - chipset.png: a compact 768x192 atlas of the map tiles/props the game
//     uses (ground fills come from the A1/A2 autotile interiors, walls from
//     A3/A4 representatives, props from Outside_B/C)
//   - character sheets: MZ 48x48 charsets copied verbatim (cells are picked
//     in client.js / sim.js)
//   - system.png: the MZ windowskin (192x192 Window.png)
//   - title.png: an MZ title background
//   - flame.png: 15-frame directional fireball VFX (Action Combat pack)
//   - skeleton.png: bones tile for decayed corpses
//   - se/*.ogg + bgm/*.ogg: MZ audio under the names the client uses
//   - fonts/: the MZ default font
// Run: node tools/rip_mz.js
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const MZROOT = '/Users/guilhermesilveirabatista/Library/Application Support/Steam/steamapps/common/RPG Maker MZ';
const ND = path.join(MZROOT, 'RPGMZ.app/Contents/Resources/newdata');
const AC = path.join(MZROOT, 'dlc/RPG Maker Action Combat Plugin/RPG Maker Action Combat Plugin (En version)');
const OUT = path.join(__dirname, '..', 'assets');

const tiles = p => path.join(ND, 'img/tilesets', p);
const chars = p => path.join(ND, 'img/characters', p);

// ---------------------------------------------------------------- chipset
// Atlas layout (48px grid). Mirrored by GROUND_T / T / TREE / deco tables in
// the client — keep both in sync.
//   row 0: G D P W0 W1 W2 X R U O rock well sign barrel cactus bush
//   rows 1-3: tree(2x2) palm(1x2) swordsign platesign bonesA bonesB lamp(1x3)
async function buildChipset() {
  const a1 = await loadImage(tiles('Outside_A1.png'));
  const a2 = await loadImage(tiles('Outside_A2.png'));
  const a3 = await loadImage(tiles('Outside_A3.png'));
  const a4 = await loadImage(tiles('Outside_A4.png'));
  const b = await loadImage(tiles('Outside_B.png'));
  const c = await loadImage(tiles('Outside_C.png'));
  const cv = createCanvas(768, 192);
  const g = cv.getContext('2d');
  const put = (im, sx, sy, dx, dy, w = 48, h = 48) => g.drawImage(im, sx, sy, w, h, dx, dy, w, h);
  // ground row
  put(a2, 24, 72, 0, 0);        // G grass interior
  put(a2, 120, 72, 48, 0);      // D dirt interior
  put(a2, 312, 72, 96, 0);      // P cobblestone interior
  put(a1, 24, 72, 144, 0);      // W water frame 0
  put(a1, 120, 72, 192, 0);     // W water frame 1
  put(a1, 216, 72, 240, 0);     // W water frame 2
  put(a4, 0, 144, 288, 0);      // X city wall face (gray stone)
  put(a3, 192, 0, 336, 0);      // R shop roof (orange shingles)
  put(a3, 96, 96, 384, 0);      // U shop wall (beige)
  put(a3, 96, 96, 432, 0);      // O door: beige wall...
  put(b, 144, 624, 432, 0);     //   ...with the arched door composited on top
  put(b, 720, 144, 480, 0);     // rock
  put(b, 528, 48, 528, 0);      // well
  put(b, 432, 48, 576, 0);      // signpost
  put(b, 624, 48, 624, 0);      // barrel
  put(b, 672, 624, 672, 0);     // cactus
  put(b, 672, 192, 720, 0);     // bush (border hedge)
  // props rows
  put(b, 384, 288, 0, 48, 96, 96);   // big tree 2x2
  put(b, 576, 624, 96, 48, 48, 96);  // palm 1x2
  put(b, 48, 384, 144, 48);          // hanging sword sign (weapon shop)
  put(b, 0, 432, 192, 48);           // hanging plate sign (item shop)
  put(c, 0, 144, 240, 48);           // bones A
  put(c, 48, 144, 288, 48);          // bones B
  put(b, 0, 0, 336, 48, 48, 144);    // streetlight 1x3
  fs.writeFileSync(path.join(OUT, 'chipset.png'), cv.toBuffer('image/png'));
}

// ---------------------------------------------------------------- charsets
async function cropChar(srcFile, cx, cy, outFile) {
  const im = await loadImage(srcFile);
  const cv = createCanvas(144, 192);
  cv.getContext('2d').drawImage(im, cx * 144, cy * 192, 144, 192, 0, 0, 144, 192);
  fs.writeFileSync(path.join(OUT, outFile), cv.toBuffer('image/png'));
}

async function buildSkeleton() {
  const c = await loadImage(tiles('Outside_C.png'));
  const cv = createCanvas(48, 48);
  cv.getContext('2d').drawImage(c, 0, 144, 48, 48, 0, 0, 48, 48);
  fs.writeFileSync(path.join(OUT, 'skeleton.png'), cv.toBuffer('image/png'));
}

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

(async () => {
  await buildChipset();
  await buildSkeleton();

  // character sheets (drawn with MZ 48x48 cell geometry client-side)
  copy(chars('Actor1.png'), path.join(OUT, 'hero.png'));
  copy(chars('Actor1.png'), path.join(OUT, 'protagonist1.png'));
  copy(chars('Actor2.png'), path.join(OUT, 'protagonist2.png'));
  copy(chars('Actor3.png'), path.join(OUT, 'protagonist4.png'));
  copy(chars('People2.png'), path.join(OUT, 'npc.png'));
  copy(chars('People1.png'), path.join(OUT, 'custom.png'));
  copy(chars('Monster.png'), path.join(OUT, 'monsters.png'));
  await cropChar(chars('Actor3.png'), 2, 1, 'knight.png'); // blue plate knight

  // UI + scenes
  copy(path.join(ND, 'img/system/Window.png'), path.join(OUT, 'system.png'));
  copy(path.join(ND, 'img/titles1/Bigtree.png'), path.join(OUT, 'title.png'));
  copy(path.join(ND, 'fonts/mplus-1m-regular.woff'), path.join(OUT, 'fonts/mplus-1m-regular.woff'));

  // effects
  copy(path.join(AC, 'img/characters/VFX/$Fire_Ball_f15.png'), path.join(OUT, 'flame.png'));

  // sound effects: MZ file -> the name the client already uses
  const SE = {
    Battle1: 'Battle1', Blow1: 'Blow1', Buzzer1: 'Buzzer1', Cancel1: 'Cancel1',
    Cursor1: 'Cursor1', Damege1: 'Damage1', Damege2: 'Damage2',
    Decision1: 'Decision1', Escape: 'Run', Evasion1: 'Evasion1',
    Flame1: 'Fire1', Item1: 'Item1', Monster1: 'Monster1',
    Recovery1: 'Recovery', Recovery2: 'Heal1', Sword1: 'Sword1', Thunder4: 'Thunder4',
  };
  for (const [dst, src] of Object.entries(SE))
    copy(path.join(ND, 'audio/se', src + '.ogg'), path.join(OUT, 'se', dst + '.ogg'));

  // music
  copy(path.join(ND, 'audio/bgm/Theme6.ogg'), path.join(OUT, 'bgm', 'title.ogg'));
  copy(path.join(ND, 'audio/bgm/Field1.ogg'), path.join(OUT, 'bgm', 'field.ogg'));

  console.log('MZ assets written to', OUT);
})().catch(e => { console.error(e); process.exit(1); });
