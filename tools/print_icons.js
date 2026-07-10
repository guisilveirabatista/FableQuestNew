const { loadImage, createCanvas } = require('canvas');

async function go() {
  for(let row=0; row<4; row++) {
    const img = await loadImage(`assets/w_row${row}.png`);
    const c = createCanvas(24, 24);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0,0,24,24).data;
    
    console.log(`--- Row ${row} ---`);
    for(let y=0; y<24; y+=2) {
      let line = '';
      for(let x=0; x<24; x+=1) {
        let idx = (y*24 + x)*4;
        let a = data[idx+3];
        line += a > 128 ? '#' : ' ';
      }
      console.log(line);
    }
  }
}
go();
