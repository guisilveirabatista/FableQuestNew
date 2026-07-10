const fs = require('fs');
const buf = fs.readFileSync('sys.bmp');
const offset = buf.readUInt32LE(10);
const w = buf.readInt32LE(18);
const h = Math.abs(buf.readInt32LE(22));
const bpp = buf.readUInt16LE(28);

const chars = ' .:-=+*#%@';
console.log('w:', w, 'h:', h, 'bpp:', bpp);

for(let row=0; row<5; row++) {
  for(let col=0; col<5; col++) {
    console.log('--- Icon', row, col, '---');
    for(let y=0; y<16; y++) {
      let line = '';
      for(let x=0; x<16; x++) {
        let px = 80 + col*16 + x;
        let py = row*16 + y;
        let realY = h - 1 - py;
        if (buf.readInt32LE(22) < 0) realY = py;
        
        let rowBytes = Math.floor((bpp * w + 31) / 32) * 4;
        let idx = offset + (realY * rowBytes) + px * (bpp / 8);
        
        if (bpp >= 24) {
          let b = buf[idx], g = buf[idx+1], r = buf[idx+2];
          let lum = (r+g+b)/3;
          line += lum < 20 ? ' ' : (lum > 200 ? '#' : '.');
        } else {
          line += '?';
        }
      }
      console.log(line);
    }
  }
}
