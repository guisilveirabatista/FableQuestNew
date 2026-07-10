const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  let out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writePNG(w, h, rgbaData, file) {
  let scanlines = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    scanlines[y * (w * 4 + 1)] = 0;
    rgbaData.copy(scanlines, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  let idat = zlib.deflateSync(scanlines);
  let ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]));
}

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

function getBgColor(img) {
  let freq = {};
  for(let i=0; i<img.rgba.length; i+=4) {
    let key = img.rgba[i]+','+img.rgba[i+1]+','+img.rgba[i+2];
    freq[key] = (freq[key]||0)+1;
  }
  let max = 0, bgStr = '';
  for(let k in freq) {
    if (freq[k]>max) { max = freq[k]; bgStr = k; }
  }
  return bgStr.split(',').map(Number);
}

function extractIcon(img, bg, iconW, iconH, ox, oy, outPath) {
  let out = Buffer.alloc(iconW * iconH * 4);
  for(let y=0; y<iconH; y++) {
    for(let x=0; x<iconW; x++) {
      let src = ((oy + y) * img.w + (ox + x)) * 4;
      let dst = (y * iconW + x) * 4;
      let r = img.rgba[src], g = img.rgba[src+1], b = img.rgba[src+2];
      if (Math.abs(r-bg[0])<10 && Math.abs(g-bg[1])<10 && Math.abs(b-bg[2])<10) {
        out[dst+3] = 0; // transparent
      } else {
        out[dst] = r; out[dst+1] = g; out[dst+2] = b; out[dst+3] = 255;
      }
    }
  }
  writePNG(iconW, iconH, out, outPath);
}

let w2 = parseBMP('weapons2.bmp');
let bg2 = getBgColor(w2);
console.log('weapons2 bg:', bg2);
// weapons2 spacing 25x25 (24x24 icons + 1px border)
extractIcon(w2, bg2, 24, 24, 1, 1, 'assets/i_arrow1.png');
extractIcon(w2, bg2, 24, 24, 26, 1, 'assets/i_arrow2.png');
extractIcon(w2, bg2, 24, 24, 51, 1, 'assets/i_arrow3.png');

let w1 = parseBMP('weapons.bmp');
let bg1 = getBgColor(w1);
console.log('weapons bg:', bg1);

// the user said: "get a bow from there"
// Where is the bow?
// We will output the first few icons from weapons.png assuming 24x24 or 32x32 to see if one is a bow.
// For now, let's just dump the first row of 24x24 and 32x32.
for(let i=0; i<8; i++) {
  extractIcon(w1, bg1, 24, 24, i*24, 0, `assets/w1_24_${i}.png`);
  extractIcon(w1, bg1, 32, 32, i*32, 0, `assets/w1_32_${i}.png`);
}

