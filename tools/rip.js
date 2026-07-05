// Rip palettized RTP PNGs into assets/ with palette index 0 made transparent,
// by injecting a tRNS chunk right after PLTE. No dependencies.
const fs = require('fs');
const path = require('path');

const RTP = path.join(__dirname, '..', '..', 'RTP');
const OUT = path.join(__dirname, '..', 'assets');
const RIPS = [
  ['CharSet/monster1.png', 'monsters.png'],
  ['Battle/2003sword.png', 'slash.png'],
  ['Battle/flame1.png', 'flame.png'],
];

const CRC_TABLE = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}

for (const [src, dst] of RIPS) {
  const png = fs.readFileSync(path.join(RTP, src));
  const parts = [png.slice(0, 8)];
  let off = 8, done = false;
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.toString('ascii', off + 4, off + 8);
    if (type === 'tRNS') { off += 12 + len; continue; } // replace any existing
    parts.push(png.slice(off, off + 12 + len));
    off += 12 + len;
    if (type === 'PLTE' && !done) {
      parts.push(chunk('tRNS', Buffer.from([0])));
      done = true;
    }
  }
  if (!done) throw new Error(src + ': no PLTE chunk (not palettized?)');
  fs.writeFileSync(path.join(OUT, dst), Buffer.concat(parts));
  console.log(src, '->', 'assets/' + dst);
}
