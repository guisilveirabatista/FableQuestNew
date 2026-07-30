// Preview helper for picking MZ tiles: renders labeled grids and tiling tests
// into the scratchpad so exact source coordinates can be chosen visually.
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const MZ = '/Users/guilhermesilveirabatista/Library/Application Support/Steam/steamapps/common/RPG Maker MZ/RPGMZ.app/Contents/Resources/newdata';
const OUT = process.argv[2] || '/tmp/mzprev';
fs.mkdirSync(OUT, { recursive: true });

async function gridSheet(file, out, x0, y0, w, h, scale = 2) {
  const im = await loadImage(file);
  const cw = Math.min(w, im.width - x0), ch = Math.min(h, im.height - y0);
  const cols = Math.ceil(cw / 48), rows = Math.ceil(ch / 48);
  const cv = createCanvas(cw * scale, ch * scale);
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#333'; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(im, x0, y0, cw, ch, 0, 0, cw * scale, ch * scale);
  c.strokeStyle = 'rgba(255,0,255,0.6)';
  c.font = 'bold 10px monospace';
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    c.strokeRect(col * 48 * scale + 0.5, r * 48 * scale + 0.5, 48 * scale, 48 * scale);
    const gx = (x0 / 48) + col, gy = (y0 / 48) + r;
    c.fillStyle = '#000';
    c.fillText(`${gx},${gy}`, col * 48 * scale + 3, r * 48 * scale + 11);
    c.fillStyle = '#ff0';
    c.fillText(`${gx},${gy}`, col * 48 * scale + 2, r * 48 * scale + 10);
  }
  fs.writeFileSync(path.join(OUT, out), cv.toBuffer('image/png'));
  console.log(out, `${cw}x${ch}`);
}

// tile a 48x48 source rect 4x4 to test seamlessness
async function tileTest(file, rects, out, scale = 2) {
  const im = await loadImage(file);
  const n = rects.length, cell = 48 * 4 * scale + 8;
  const cv = createCanvas(cell * Math.min(n, 4), cell * Math.ceil(n / 4) + 16);
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
  rects.forEach(([label, sx, sy], i) => {
    const ox = (i % 4) * cell, oy = Math.floor(i / 4) * cell + 14;
    for (let r = 0; r < 4; r++) for (let col = 0; col < 4; col++)
      c.drawImage(im, sx, sy, 48, 48, ox + col * 48 * scale, oy + r * 48 * scale, 48 * scale, 48 * scale);
    c.fillStyle = '#ff0';
    c.font = 'bold 11px monospace';
    c.fillText(`${label} (${sx},${sy})`, ox + 2, oy - 3);
  });
  fs.writeFileSync(path.join(OUT, out), cv.toBuffer('image/png'));
  console.log(out);
}

(async () => {
  const T = p => path.join(MZ, 'img/tilesets', p);
  // A2 interior-fill candidates: representative (block x*96, y*144) vs interior (+24,+72)
  await tileTest(T('Outside_A2.png'), [
    ['grass rep', 0, 0], ['grass int', 24, 72],
    ['dirt rep', 96, 0], ['dirt int', 120, 72],
    ['road rep', 192, 0], ['road int', 216, 72],
    ['cobble rep', 288, 0], ['cobble int', 312, 72],
  ], 'a2_fill.png', 1.5);
  // A1 water frames
  await tileTest(T('Outside_A1.png'), [
    ['sea f0 rep', 0, 0], ['sea f0 int', 24, 72],
    ['sea f1 int', 120, 72], ['sea f2 int', 216, 72],
  ], 'a1_water.png', 1.5);
  // A3/A4 wall faces
  await tileTest(T('Outside_A3.png'), [
    ['roof orange', 192, 0], ['wall beige', 96, 96], ['wall yellow', 0, 96], ['brick red', 192, 96],
  ], 'a3_walls.png', 1.5);
  await tileTest(T('Outside_A4.png'), [
    ['wallface gray', 0, 144], ['walltop gray', 0, 0], ['wallface brick', 0, 384], ['walltop brick', 24, 312],
  ], 'a4_walls.png', 1.5);
  // Outside_B quadrants, labeled per 48px cell
  await gridSheet(T('Outside_B.png'), 'b_q1.png', 384, 0, 384, 384, 2);
  await gridSheet(T('Outside_B.png'), 'b_q2.png', 384, 384, 384, 384, 2);
  await gridSheet(T('Outside_B.png'), 'b_q3.png', 0, 384, 384, 384, 2);
  await gridSheet(T('Outside_C.png'), 'c_q1.png', 0, 0, 384, 384, 2);
  await gridSheet(T('Outside_C.png'), 'c_q2.png', 384, 0, 384, 384, 2);
  await gridSheet(T('Dungeon_B.png'), 'd_q1.png', 0, 0, 384, 384, 2);
  await gridSheet(T('Dungeon_B.png'), 'd_q2.png', 384, 0, 384, 384, 2);
})().catch(e => { console.error(e); process.exit(1); });
