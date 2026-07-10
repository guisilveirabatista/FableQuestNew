const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');

async function go() {
  const img1 = await loadImage('assets/weapons.png');
  const c1 = createCanvas(img1.width, img1.height);
  const ctx1 = c1.getContext('2d');
  ctx1.drawImage(img1, 0, 0);
  const imgData1 = ctx1.getImageData(0,0,img1.width,img1.height);
  const data1 = imgData1.data;
  const bgR1 = data1[0], bgG1 = data1[1], bgB1 = data1[2];
  for(let i=0; i<data1.length; i+=4) {
    if(data1[i]===bgR1 && data1[i+1]===bgG1 && data1[i+2]===bgB1) data1[i+3] = 0;
  }
  ctx1.putImageData(imgData1, 0, 0);

  // For each row
  for(let row=0; row<4; row++) {
    const iconC = createCanvas(96, 64);
    const iconCtx = iconC.getContext('2d');
    iconCtx.drawImage(c1, 0, row*64, 96, 64, 0, 0, 96, 64);
    
    const id = iconCtx.getImageData(0,0,96,64).data;
    let minX=96, minY=64, maxX=0, maxY=0;
    for(let y=0; y<64; y++) {
      for(let x=0; x<96; x++) {
        if (id[(y*96+x)*4+3] > 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    
    if (minX <= maxX) {
      let w = maxX - minX + 1;
      let h = maxY - minY + 1;
      let size = Math.max(w, h);
      const finalC = createCanvas(24, 24);
      const finalCtx = finalC.getContext('2d');
      let scale = size > 24 ? 24 / size : 1;
      let dw = w * scale, dh = h * scale;
      finalCtx.drawImage(c1, minX, row*64 + minY, w, h, 12 - dw/2, 12 - dh/2, dw, dh);
      fs.writeFileSync(`assets/w_row${row}.png`, finalC.toBuffer('image/png'));
    }
  }
}
go();
