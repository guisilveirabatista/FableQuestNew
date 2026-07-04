// Knight charset with a real walk cycle:
//  - contact poses (legs apart, body 1px low) vs passing pose (legs together, high)
//  - counter-swing: the raised gauntlet is opposite the stepping leg
//  - profile view moves one whole leg at a time (near leg, then far leg)
//  - secondary motion: the helmet plume trails behind on contact frames
// Frames compose from body-part grids; left row and off-foot frames are mirrors.
const fs = require('fs');
const { PNG } = require('pngjs');

const PAL = {
  '.': null,
  'K': [30, 28, 40],    // outline
  'A': [198, 204, 220], // armor light
  'a': [152, 158, 178], // armor mid
  'd': [104, 110, 134], // armor dark
  'M': [76, 80, 100],   // boots / darkest metal
  'R': [208, 62, 48],   // plume
  'r': [152, 38, 36],   // plume shade
  'B': [64, 92, 168],   // tabard
  'b': [44, 66, 128],   // tabard shade
  'G': [218, 182, 92],  // gold trim
  'V': [18, 16, 26],    // visor slit
};

const g = s => s.trim().split('\n').map(r => r.trim());
const hflip = rows => rows.map(r => [...r].reverse().join(''));

// ---- front (down) ----
const plumeDown = g(`
......RRR.....
.....RRrRR....
`);
const headDown = g(`
....KKKKKK....
..KKAAAAAAKK..
.KAAAAAAAAAAK.
.KAAAAAAAAAAK.
KAAaVVVVVVaAAK
KAAAAAVVAAAAAK
.KAAAAAAAAAAK.
.KaAAAAAAAAaK.
..KKKAAAAKKK..
`);
const torsoDownStand = g(`
.KAAKBBBBKAAK.
KAAAKBBBBKAAAK
KaAAKBGGBKAAaK
KaAKBBBBBBKAaK
.KdKBBBBBBKdK.
..KKGGGGGGKK..
`);
const torsoDownStep = g(`
.KAAKBBBBKAAK.
KAAAKBBBBKAAAK
KaAAKBGGBKAAaK
KaAKBBBBBBKdK.
.KdKBBBBBBKK..
..KKGGGGGGKK..
`);
const legsStand = g(`
..KddddddddK..
..KdddKKdddK..
..KddK..KddK..
..KMMK..KMMK..
..KMMK..KMMK..
..KKKK..KKKK..
`);
const legsStep = g(`
..KddddddddK..
..KdddKKdddK..
..KddK..KddK..
..KMMK..KMMK..
..KKKK..KMMK..
........KKKK..
`);

// ---- back (up) ----
const plumeUp = g(`
......RRR.....
.....RRRRR....
`);
const headUp = g(`
....KKKKKK....
..KKAAAAAAKK..
.KAAAAAAAAAAK.
.KAAaAAAAaAAK.
KAAAAAAAAAAAAK
KAaAAAAAAAAaAK
.KAAAAAAAAAAK.
.KaAAAAAAAAaK.
..KKKAAAAKKK..
`);
const torsoUpStand = g(`
.KAAKBBBBKAAK.
KAAAKBBBBKAAAK
KaAAKBBBBKAAaK
KaAKBBBBBBKAaK
.KdKBBBBBBKdK.
..KKGGGGGGKK..
`);
const torsoUpStep = g(`
.KAAKBBBBKAAK.
KAAAKBBBBKAAAK
KaAAKBBBBKAAaK
KaAKBBBBBBKdK.
.KdKBBBBBBKK..
..KKGGGGGGKK..
`);

// ---- profile (right) ----
const plumeSideContact = g(`
.RRRR.........
RRrRRR........
`);
const plumeSidePassing = g(`
..RRRR........
.RRrRR........
`);
const headSide = g(`
....KKKKKK....
..KKAAAAAAK...
..KAAAAAAAAK..
..KAAAAAAAAK..
..KAAAAKVVVK..
..KAAAAAAVAK..
..KAAAAAAAAK..
...KaAAAAaK...
....KKAAKK....
`);
const armStand = g(`
...KAAAAAAK...
..KBBBAABBBK..
..KBBBAABBBK..
..KBBBAABBBK..
..KbBKddKBbK..
...KGGGGGGK...
`);
const armBack = g(`
...KAAAAAAK...
..KBBAABBBBK..
..KBAABBBBBK..
..KddBBBBBBK..
..KbBBBBBBbK..
...KGGGGGGK...
`);
const armFwd = g(`
...KAAAAAAK...
..KBBBBAABBK..
..KBBBBBAABK..
..KBBBBBBddK..
..KbBBBBBBbK..
...KGGGGGGK...
`);
const legsSideContact = g(`
...KddddddK...
..KddddddddK..
..KddK..KddK..
..KMMK..KMMK..
.KMMK....KMMK.
.KKKK....KKKK.
`);
const legsSidePassing = g(`
...KddddddK...
....KddddK....
....KddddK....
....KMMMMK....
....KMMMMK....
....KKKKKK....
`);

const frame = (dy, ...parts) => ({ dy, rows: [].concat(...parts) });
const mirror = f => ({ dy: f.dy, rows: hflip(f.rows) });

const downStep = frame(1, plumeDown, headDown, torsoDownStep, legsStep);
const upStep = frame(1, plumeUp, headUp, torsoUpStep, legsStep);
const DIRS = [ // charset rows: up, right, down, left
  [upStep, frame(0, plumeUp, headUp, torsoUpStand, legsStand), mirror(upStep)],
  [
    frame(1, plumeSideContact, headSide, armBack, legsSideContact),
    frame(0, plumeSidePassing, headSide, armStand, legsSidePassing),
    frame(1, plumeSideContact, headSide, armFwd, hflip(legsSideContact)),
  ],
  [downStep, frame(0, plumeDown, headDown, torsoDownStand, legsStand), mirror(downStep)],
  [],
];
DIRS[3] = DIRS[1].map(mirror); // left profile = mirrored right

const sheet = new PNG({ width: 72, height: 128 });
DIRS.forEach((frames, row) => frames.forEach((f, col) => {
  f.rows.forEach((r, y) => [...r].forEach((c, x) => {
    const p = PAL[c];
    if (!p) return;
    const i = ((row * 32 + y + 7 + f.dy) * 72 + col * 24 + x + 5) * 4;
    sheet.data[i] = p[0]; sheet.data[i + 1] = p[1]; sheet.data[i + 2] = p[2]; sheet.data[i + 3] = 255;
  }));
}));
fs.writeFileSync('knight.png', PNG.sync.write(sheet));

// 5x preview on gray
const S = 5;
const prev = new PNG({ width: 72 * S, height: 128 * S });
for (let y = 0; y < prev.height; y++) for (let x = 0; x < prev.width; x++) {
  const si = ((y / S | 0) * 72 + (x / S | 0)) * 4, di = (y * prev.width + x) * 4;
  const grid = ((x / S | 0) % 24 === 0 || (y / S | 0) % 32 === 0);
  for (let k = 0; k < 3; k++) prev.data[di + k] = sheet.data[si + 3] ? sheet.data[si + k] : (grid ? 120 : 150);
  prev.data[di + 3] = 255;
}
fs.writeFileSync('knight_prev.png', PNG.sync.write(prev));
console.log('knight written');
