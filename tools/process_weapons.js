const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');

async function processImage() {
  // Process weapons2.png for arrows
  const img2 = await loadImage('assets/weapons2.png');
  const c2 = createCanvas(img2.width, img2.height);
  const ctx2 = c2.getContext('2d');
  ctx2.drawImage(img2, 0, 0);
  const imgData2 = ctx2.getImageData(0, 0, img2.width, img2.height);
  const data2 = imgData2.data;
  
  // top left pixel is bg
  const bgR2 = data2[0], bgG2 = data2[1], bgB2 = data2[2];
  for(let i=0; i<data2.length; i+=4) {
    if(data2[i]===bgR2 && data2[i+1]===bgG2 && data2[i+2]===bgB2) data2[i+3] = 0;
  }
  ctx2.putImageData(imgData2, 0, 0);
  
  // Extract first 3 icons (24x24) from weapons2
  for(let i=0; i<3; i++) {
    const iconC = createCanvas(24, 24);
    const iconCtx = iconC.getContext('2d');
    // x: 1, 26, 51. y: 1
    iconCtx.drawImage(c2, 1 + i*25, 1, 24, 24, 0, 0, 24, 24);
    fs.writeFileSync(`assets/i_arrow${i+1}.png`, iconC.toBuffer('image/png'));
    console.log(`Saved assets/i_arrow${i+1}.png`);
  }

  // Process weapons.png for the bow
  const img1 = await loadImage('assets/weapons.png');
  const c1 = createCanvas(img1.width, img1.height);
  const ctx1 = c1.getContext('2d');
  ctx1.drawImage(img1, 0, 0);
  const imgData1 = ctx1.getImageData(0, 0, img1.width, img1.height);
  const data1 = imgData1.data;
  const bgR1 = data1[0], bgG1 = data1[1], bgB1 = data1[2];
  for(let i=0; i<data1.length; i+=4) {
    if(data1[i]===bgR1 && data1[i+1]===bgG1 && data1[i+2]===bgB1) data1[i+3] = 0;
  }
  ctx1.putImageData(imgData1, 0, 0);

  // Print ascii to find the bow
  // Icon size 24x24 or 32x32? Let's check 32x32.
  for(let row=0; row<2; row++) {
    for(let col=0; col<8; col++) {
      console.log(`--- Icon ${row} ${col} ---`);
      let line = '';
      for(let y=0; y<32; y+=2) {
        for(let x=0; x<32; x+=2) {
          let idx = ((row*32 + y) * img1.width + (col*32 + x)) * 4;
          line += data1[idx+3] > 0 ? '#' : ' ';
        }
        line += '\n';
      }
      console.log(line);
    }
  }
}
processImage();
