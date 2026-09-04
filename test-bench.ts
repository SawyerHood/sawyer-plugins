import { ANIMATION_CLIPS, CANVAS_HEIGHT, CANVAS_WIDTH } from "./sprites";

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function renderTestBenchHtml(): string {
  const clips = safeJson(ANIMATION_CLIPS);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Miku animation test bench</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #d8fff9; background: #071b20; }
    header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 18px; padding: 18px 24px; border-bottom: 1px solid #17535a; background: rgba(7,27,32,.94); backdrop-filter: blur(12px); }
    h1 { margin: 0; font-size: 20px; }
    #summary { padding: 5px 10px; border-radius: 999px; color: #06201e; background: #5ff5da; font-weight: 800; font-size: 12px; }
    #summary.fail { color: #fff; background: #d83c67; }
    button { padding: 7px 12px; border: 1px solid #2f8f91; border-radius: 8px; color: inherit; background: #10343b; cursor: pointer; }
    label { display: flex; align-items: center; gap: 8px; color: #9fd5d3; font-size: 12px; }
    main { padding: 22px; }
    #grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: 18px; }
    .card { min-width: 0; overflow: hidden; border: 1px solid #17535a; border-radius: 14px; background: #0b272d; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
    .card[data-pass="false"] { border-color: #d83c67; }
    .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 13px 15px; border-bottom: 1px solid #17535a; }
    .card h2 { margin: 0; color: #5ff5da; font-size: 15px; }
    .meta { color: #85b6b5; font: 11px/1.3 ui-monospace, monospace; }
    .preview { display: grid; grid-template-columns: 190px minmax(0,1fr); min-height: 230px; }
    .stage { display: grid; place-items: center; border-right: 1px solid #17535a; background-color: #0e3238; background-image: linear-gradient(45deg,#123c43 25%,transparent 25%),linear-gradient(-45deg,#123c43 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#123c43 75%),linear-gradient(-45deg,transparent 75%,#123c43 75%); background-size: 20px 20px; background-position: 0 0,0 10px,10px -10px,-10px 0; }
    .stage canvas { width: ${CANVAS_WIDTH * 2}px; height: ${CANVAS_HEIGHT * 2}px; image-rendering: pixelated; filter: drop-shadow(0 4px 2px rgba(0,0,0,.35)); }
    .details { min-width: 0; padding: 12px; }
    .status { margin: 0 0 10px; color: #77e7c9; font: 11px/1.45 ui-monospace, monospace; }
    .status.fail { color: #ff83a4; }
    .filmstrip { display: flex; gap: 7px; overflow-x: auto; padding: 3px 2px 10px; }
    .frame { flex: 0 0 auto; text-align: center; color: #85b6b5; font: 10px/1.3 ui-monospace, monospace; }
    .frame canvas { display: block; width: 69px; height: 77px; margin-bottom: 4px; border: 1px solid #23656d; border-radius: 6px; background: #10343b; image-rendering: pixelated; }
    @media (max-width: 620px) { header { flex-wrap: wrap; } main { padding: 12px; } #grid { grid-template-columns: 1fr; } .preview { grid-template-columns: 1fr; } .stage { border-right: 0; border-bottom: 1px solid #17535a; } }
  </style>
</head>
<body>
  <header>
    <h1>Miku animation test bench</h1>
    <span id="summary">Loading sprite sheet…</span>
    <button id="play" type="button">Pause</button>
    <label>Speed <input id="speed" type="range" min="0.25" max="2" value="1" step="0.25"><output id="speed-value">1×</output></label>
  </header>
  <main><div id="grid"></div></main>
  <script>
    const clips = ${clips};
    const canvasWidth = ${CANVAS_WIDTH};
    const canvasHeight = ${CANVAS_HEIGHT};
    const spriteWidth = 1180;
    const spriteHeight = 497;
    const grid = document.querySelector('#grid');
    const summary = document.querySelector('#summary');
    const playButton = document.querySelector('#play');
    const speedInput = document.querySelector('#speed');
    const speedValue = document.querySelector('#speed-value');
    let playing = true;
    let speed = 1;
    let preparedSheet;
    const renderers = [];

    const drawFrame = (context, source) => {
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      context.drawImage(preparedSheet, source.x, source.y, source.width, source.height, Math.round((canvasWidth-source.width)/2), canvasHeight-source.height, source.width, source.height);
    };

    const foregroundAt = (pixels, x, y, background) => {
      const i = (y * spriteWidth + x) * 4;
      return Math.abs(pixels[i]-background[0]) + Math.abs(pixels[i+1]-background[1]) + Math.abs(pixels[i+2]-background[2]) > 9;
    };

    const validateFrame = (source, pixels, background) => {
      const errors = [];
      if (source.x < 0 || source.y < 0 || source.x + source.width > spriteWidth || source.y + source.height > spriteHeight) errors.push('outside sheet');
      if (source.width > canvasWidth || source.height > canvasHeight) errors.push('larger than canvas');
      let foreground = 0;
      let top = false, right = false, bottom = false, left = false;
      for (let y=source.y; y<source.y+source.height; y+=1) for (let x=source.x; x<source.x+source.width; x+=1) {
        if (!foregroundAt(pixels,x,y,background)) continue;
        foreground += 1;
        if (y===source.y) top=true;
        if (x===source.x+source.width-1) right=true;
        if (y===source.y+source.height-1) bottom=true;
        if (x===source.x) left=true;
      }
      if (foreground === 0) errors.push('empty crop');
      if (!(top && right && bottom && left)) errors.push('crop is not tightly trimmed');
      return { errors, foreground };
    };

    const boot = async () => {
      const image = new Image();
      image.src = './assets/miku.png';
      await image.decode();
      if (image.naturalWidth !== spriteWidth || image.naturalHeight !== spriteHeight) throw new Error('Expected 1180×497 sprite sheet, received '+image.naturalWidth+'×'+image.naturalHeight);
      const sheet = document.createElement('canvas');
      sheet.width = image.naturalWidth; sheet.height = image.naturalHeight;
      const sheetContext = sheet.getContext('2d', {willReadFrequently:true});
      sheetContext.drawImage(image,0,0);
      const raw = sheetContext.getImageData(0,0,sheet.width,sheet.height);
      const originalPixels = new Uint8ClampedArray(raw.data);
      const background = originalPixels.slice(0,3);
      for(let i=0;i<raw.data.length;i+=4) {
        const distance=Math.abs(raw.data[i]-background[0])+Math.abs(raw.data[i+1]-background[1])+Math.abs(raw.data[i+2]-background[2]);
        if(distance<=9) raw.data[i+3]=0;
      }
      sheetContext.putImageData(raw,0,0);
      preparedSheet=sheet;

      let totalSteps=0;
      const errors=[];
      Object.entries(clips).forEach(([name,clip]) => {
        totalSteps += clip.steps.length;
        const card=document.createElement('section'); card.className='card'; card.dataset.clip=name;
        const head=document.createElement('div'); head.className='card-head';
        const title=document.createElement('h2'); title.textContent=name;
        const meta=document.createElement('span'); meta.className='meta'; meta.textContent=clip.steps.length+' steps · '+(clip.loop?'loop':'one-shot');
        head.append(title,meta);
        const preview=document.createElement('div'); preview.className='preview';
        const stage=document.createElement('div'); stage.className='stage';
        const live=document.createElement('canvas'); live.width=canvasWidth; live.height=canvasHeight; stage.append(live);
        const details=document.createElement('div'); details.className='details';
        const status=document.createElement('p'); status.className='status';
        const film=document.createElement('div'); film.className='filmstrip';
        const clipErrors=[];
        clip.steps.forEach((step,index) => {
          const validation=validateFrame(step.frame,originalPixels,background);
          validation.errors.forEach(error=>clipErrors.push('frame '+(index+1)+': '+error));
          const item=document.createElement('div'); item.className='frame';
          const canvas=document.createElement('canvas'); canvas.width=canvasWidth; canvas.height=canvasHeight;
          drawFrame(canvas.getContext('2d'),step.frame);
          const caption=document.createElement('span'); caption.textContent=(index+1)+': '+step.frame.width+'×'+step.frame.height;
          item.append(canvas,caption); film.append(item);
        });
        card.dataset.pass=String(clipErrors.length===0);
        status.textContent=clipErrors.length===0?'PASS · every crop is tight, non-empty, in-bounds, and fits '+canvasWidth+'×'+canvasHeight:clipErrors.join(' · ');
        if(clipErrors.length) { status.classList.add('fail'); errors.push(...clipErrors.map(error=>name+': '+error)); }
        details.append(status,film); preview.append(stage,details); card.append(head,preview); grid.append(card);
        const duration=clip.steps.reduce((sum,step)=>sum+step.durationMs,0);
        renderers.push({clip,context:live.getContext('2d'),duration});
      });

      const result={pass:errors.length===0,clipCount:Object.keys(clips).length,stepCount:totalSteps,sheet:[image.naturalWidth,image.naturalHeight],canvas:[canvasWidth,canvasHeight],errors};
      window.__mikuBench={ready:true,result};
      document.body.dataset.ready='true';
      summary.textContent=result.pass?'PASS · '+result.clipCount+' clips · '+result.stepCount+' steps':'FAIL · '+errors.length+' sizing errors';
      summary.classList.toggle('fail',!result.pass);
      let elapsed=0, previous=performance.now();
      const animate=(now)=>{
        const delta=Math.min(100,now-previous); previous=now; if(playing) elapsed+=delta*speed;
        renderers.forEach(({clip,context,duration})=>{
          const cycle=clip.loop?duration:duration+600;
          const local=elapsed%cycle;
          let cursor=0, selected=clip.steps[clip.steps.length-1];
          for(const step of clip.steps){cursor+=step.durationMs;if(local<cursor){selected=step;break;}}
          drawFrame(context,selected.frame);
        });
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    };

    playButton.addEventListener('click',()=>{playing=!playing;playButton.textContent=playing?'Pause':'Play';});
    speedInput.addEventListener('input',()=>{speed=Number(speedInput.value);speedValue.textContent=speed+'×';});
    boot().catch(error=>{summary.textContent='FAIL · '+error.message;summary.classList.add('fail');window.__mikuBench={ready:true,result:{pass:false,errors:[error.message]}};document.body.dataset.ready='true';});
  </script>
</body>
</html>`;
}
