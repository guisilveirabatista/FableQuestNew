// Full RM2k3 charset (3 frames x 4 directions, 24x32 each -> 72x128 sheet)
// for the hand-drawn pixel character. Left row is a mirror of right; the
// off-foot step frames mirror each other for the symmetric front/back views.
const fs = require('fs');
const { PNG } = require('pngjs');

const PAL = {
  '.': null,
  'K': [42, 32, 56],    // outline
  'H': [200, 80, 42],   // hair
  'h': [232, 120, 64],  // hair highlight
  'S': [240, 200, 160], // skin
  's': [208, 152, 112], // skin shade
  'T': [58, 152, 80],   // tunic
  't': [40, 112, 56],   // tunic shade
  'B': [90, 64, 44],    // belt / boots
  'P': [112, 80, 56],   // pants
};

const g = s => s.trim().split('\n').map(r => r.trim());

const downBody = g(`
....KKKKKK....
..KKHHHHHHKK..
.KHHhHHHHhHHK.
.KHHHHHHHHHHK.
KHHHHHHHHHHHHK
KHHHSSSSSSHHHK
KHSSSSSSSSSSHK
KHSSKSSSSKSSHK
.KSSSSSSSSSSK.
.KSsSSSSSSsSK.
..KSSSSSSSSK..
..KKTTTTTTKK..
.KTTTTTTTTTTK.
KTTTTTTTTTTTTK
KTtTTTTTTTTtTK
KTtTTTTTTTTtTK
KSKBBBBBBBBKSK
`);

const upBody = g(`
....KKKKKK....
..KKHHHHHHKK..
.KHHhHHHHhHHK.
.KHHHHHHHHHHK.
KHHHHHHHHHHHHK
KHHHHHHHHHHHHK
KHHHHhHHHHHHHK
.KHHHHHHHHHHK.
.KHHHHHHHHhHK.
.KHHHHHHHHHHK.
..KHHHHHHHHK..
..KKTTTTTTKK..
.KTTTTTTTTTTK.
KTTTTTTTTTTTTK
KTtTTTTTTTTtTK
KTtTTTTTTTTtTK
KSKBBBBBBBBKSK
`);

const legsStand = g(`
.KKPPPPPPPPKK.
..KPPPKKPPPK..
..KPPK..KPPK..
..KBBK..KBBK..
..KBBK..KBBK..
..KKKK..KKKK..
`);

const legsStep = g(`
.KKPPPPPPPPKK.
..KPPPKKPPPK..
..KPPK..KPPK..
..KBBK..KBBK..
..KBBK..KKKK..
..KKKK........
`);

const sideBody = g(`
....KKKKKK....
..KKHHHHHHKK..
.KHHHhHHHHHK..
.KHHHHHHHHHK..
.KHHHHHHHHHHK.
.KHHHHSSSSSK..
.KHHHSSSSSSK..
.KHHHSSKSSSK..
.KHHHSSKSSsK..
..KHHSSSSSK...
...KKSSSSK....
...KTTTTTTK...
..KTTTTTTTTK..
..KTtTTTTTTK..
..KTtTTTTTTK..
..KTtTTTTTTK..
...KBBBBBSK...
`);

const sideStand = g(`
...KPPPPPPK...
....KPPPPK....
....KPPPPK....
....KBBBBK....
....KBBBBK....
....KKKKKK....
`);

const sideStrideA = g(`
...KPPPPPPK...
..KPPPPPPPPK..
..KPPK..KPPK..
..KBBK..KBBK..
.KBBK....KBBK.
.KKKK....KKKK.
`);

const sideStrideB = g(`
...KPPPPPPK...
...KPPPPPPK...
....KPPPPK....
....KBBBBK....
....KBBBK.....
....KKKKK.....
`);

const hflip = rows => rows.map(r => [...r].reverse().join(''));
const frame = (body, legs) => body.concat(legs);

const downStep = frame(downBody, legsStep);
const upStep = frame(upBody, legsStep);
const DIRS = [ // charset row order: up, right, down, left
  [upStep, frame(upBody, legsStand), hflip(upStep)],
  [frame(sideBody, sideStrideA), frame(sideBody, sideStand), frame(sideBody, sideStrideB)],
  [downStep, frame(downBody, legsStand), hflip(downStep)],
  [],
];
DIRS[3] = DIRS[1].map(hflip); // left = mirrored right

const sheet = new PNG({ width: 72, height: 128 });
DIRS.forEach((frames, row) => frames.forEach((grid, col) => {
  grid.forEach((r, y) => [...r].forEach((c, x) => {
    const p = PAL[c];
    if (!p) return;
    const i = ((row * 32 + y + 8) * 72 + col * 24 + x + 5) * 4;
    sheet.data[i] = p[0]; sheet.data[i + 1] = p[1]; sheet.data[i + 2] = p[2]; sheet.data[i + 3] = 255;
  }));
}));
fs.writeFileSync('custom_charset.png', PNG.sync.write(sheet));

// 5x preview on gray
const S = 5;
const prev = new PNG({ width: 72 * S, height: 128 * S });
for (let y = 0; y < prev.height; y++) for (let x = 0; x < prev.width; x++) {
  const si = ((y / S | 0) * 72 + (x / S | 0)) * 4, di = (y * prev.width + x) * 4;
  const grid = ((x / S | 0) % 24 === 0 || (y / S | 0) % 32 === 0);
  for (let k = 0; k < 3; k++) prev.data[di + k] = sheet.data[si + 3] ? sheet.data[si + k] : (grid ? 120 : 150);
  prev.data[di + 3] = 255;
}
fs.writeFileSync('custom_charset_prev.png', PNG.sync.write(prev));
console.log('charset written');
