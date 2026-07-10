const fs = require('fs');
function crc32(buf) {
  let c = 0xffffffff;
  for(const b of buf) {
    c ^= b;
    for(let k=0; k<8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
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

const png = fs.readFileSync('assets/weapons.png');
const parts = [png.slice(0, 8)];
let off = 8, done = false;
while (off < png.length) {
  const len = png.readUInt32BE(off);
  const type = png.toString('ascii', off+4, off+8);
  if (type === 'tRNS') { off += 12 + len; continue; }
  parts.push(png.slice(off, off+12+len));
  off += 12 + len;
  if (type === 'PLTE' && !done) {
    parts.push(chunk('tRNS', Buffer.from([0])));
    done = true;
  }
}
fs.writeFileSync('weapons_trans.png', Buffer.concat(parts));
