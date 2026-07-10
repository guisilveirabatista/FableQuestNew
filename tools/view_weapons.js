const fs = require('fs');

function parseBMP(file) {
  const buf = fs.readFileSync(file);
  const offset = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  let h = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const flip = h > 0;
  h = Math.abs(h);
  
  let rgba = Buffer.alloc(w * h * 4);
  let rowBytes = Math.floor((bpp * w + 31) / 32) * 4;
  
  for(let y=0; y<h; y++) {
    let realY = flip ? h - 1 - y : y;
    let idx = offset + realY * rowBytes;
    for(let x=0; x<w; x++) {
      let dst = (y * w + x) * 4;
      if (bpp >= 24) {
        let b = buf[idx + x*(bpp/8)], g = buf[idx + x*(bpp/8) + 1], r = buf[idx + x*(bpp/8) + 2];
        rgba[dst] = r; rgba[dst+1] = g; rgba[dst+2] = b; rgba[dst+3] = 255;
      }
    }
  }
  return {w, h, rgba};
}

let w1 = parseBMP('weapons.bmp');

// let's print the first 2 rows (18 icons)
for(let row=0; row<2; row++) {
  for(let col=0; col<9; col++) {
    console.log(`--- Icon ${row} ${col} ---`);
    for(let y=0; y<32; y+=2) {
      let line = '';
      for(let x=0; x<32; x+=2) {
        let idx = ((row*32 + y) * w1.w + (col*32 + x)) * 4;
        let r = w1.rgba[idx], g = w1.rgba[idx+1], b = w1.rgba[idx+2];
        if (r===0 && g===255 && b===0) line += ' ';
        else if (r>0 || g>0 || b>0) line += '#';
        else line += ' ';
      }
      console.log(line);
    }
  }
}
