import {timecode,nearestBeat,reduceMarks,exportMarks,waveformBins,fitFourTaps,beatLight,isHitKey} from './core.mjs';
const $=id=>document.getElementById(id);
const audio=$('audio'), file=$('file'), wave=$('wave'), ctx=wave.getContext('2d');
const controls=['play','back','forward','mark','set-downbeat','seek','tap-sync'];
const lights=[...document.querySelectorAll('.beat-lights span')];
let taps=null, calibrated=null, shownLight=-2;
let mediaUrl='', source=null, peaks=[], model={items:[],history:[]}, serial=0, token=0, animation=0, cursorId=0;
function ready(){return Number.isFinite(audio.duration)&&audio.duration>0&&!!source;}
const seconds=v=>Number.isFinite(v)?v.toFixed(3):'0.000';
function gridSettings(){
  if(!$('grid').checked||$('bpm').value===''||$('downbeat').value==='')return {};
  return {bpm:Number($('bpm').value),downbeat:Number($('downbeat').value), subdivision:Number($('subdivision').value)};
}
function speak(msg){$('feedback').textContent=msg;}
const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
const effects=new WeakMap();
let hitAudio;
function pulsePad(el,press=true){
  if(!el?.animate)return;
  effects.get(el)?.cancel();
  const motion=press&&!reducedMotion?.matches;
  const keyframes=motion?[
    {transform:'translateY(2px) scale(.979)',boxShadow:'inset 0 0 0 2px #e8ff825e, 0 1px 0 #465025',offset:0},
    {transform:'translateY(-1px) scale(1.005)',boxShadow:'inset 0 0 0 1px #edff9650, 0 0 0 4px #d5ef3c31',offset:.31},
    {transform:'translateY(0) scale(1)',boxShadow:'inset 0 0 0 0 #edff9600, 0 4px 0 #46502500',offset:1}
  ]:[{boxShadow:'inset 0 0 0 2px #f2ff99b0'},{boxShadow:'inset 0 0 0 2px #f2ff9900'}];
  try{effects.set(el,el.animate(keyframes,{duration:motion?185:115,easing:'cubic-bezier(.2,.7,.3,1)'}));}catch{}
}
function prepareHitSound(){
  if(!$('hit-sound').checked)return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC){$('hit-sound').checked=false;speak('当前浏览器不支持敲击音。');return;}
    if(!hitAudio||hitAudio.state==='closed')hitAudio=new AC();
    if(hitAudio.state!=='running')hitAudio.resume().catch(()=>{});
  }catch{}
}
$('hit-sound').addEventListener('change',prepareHitSound);
function hit(id,light=-1){
  pulsePad($(id));
  if(light>=0)pulsePad(lights[light],false);
  if(!$('hit-sound').checked)return;
  try{
    prepareHitSound();
    if(hitAudio?.state!=='running')return;
    const t=hitAudio.currentTime;
    const tone=hitAudio.createOscillator(), gain=hitAudio.createGain();
    tone.type='sine';
    tone.frequency.setValueAtTime(light===0?940:810,t);
    tone.frequency.exponentialRampToValueAtTime(330,t+.026);
    gain.gain.setValueAtTime(.0001,t);
    gain.gain.exponentialRampToValueAtTime(.045,t+.003);
    gain.gain.exponentialRampToValueAtTime(.0001,t+.034);
    tone.connect(gain);gain.connect(hitAudio.destination);
    tone.onended=()=>{tone.disconnect();gain.disconnect();};
    tone.start(t);tone.stop(t+.037);
  }catch{} // A feedback-only sound must never block recording or calibration.
}
function paintWave(){
  const w=wave.clientWidth,h=wave.clientHeight;
  if(!w||!h)return;
  const d=Math.min(2,window.devicePixelRatio||1);
  if(wave.width!==Math.round(w*d)||wave.height!==Math.round(h*d)){wave.width=Math.round(w*d);wave.height=Math.round(h*d);}
  ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
  ctx.lineWidth=1;ctx.strokeStyle='#343641';
  ctx.beginPath();
  for(let i=1;i<10;i++){const x=i/10*w;ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,h);}
  ctx.moveTo(0,h/2+.5);ctx.lineTo(w,h/2+.5);ctx.stroke();
  if(!ready())return;
  const pos=(t)=>Math.min(w-1,Math.max(0,t/audio.duration*w));
  if(peaks.length){
    const step=Math.max(1,Math.ceil(peaks.length/w*2));ctx.lineWidth=1;
    for(let i=0;i<peaks.length;i+=step){
      const x=i/peaks.length*w, a=Math.max(1,Math.pow(peaks[i],.7)*(h*.43));
      ctx.strokeStyle=x<=pos(audio.currentTime)?'#bfd440':'#677083';
      ctx.beginPath();ctx.moveTo(x,h/2-a);ctx.lineTo(x,h/2+a);ctx.stroke();
    }
  }
  const {bpm,downbeat,subdivision}=gridSettings(), grid=nearestBeat(0,bpm,downbeat);
  if(grid&&downbeat<=audio.duration){
    const beat=60/bpm/subdivision, n=1+Math.floor((audio.duration-downbeat)/beat), step=Math.max(1,Math.ceil(n/(w/8)));
    ctx.strokeStyle='#7294ff';ctx.setLineDash([2,4]);ctx.beginPath();
    for(let i=0;i<n;i+=step){const x=pos(downbeat+i*beat);ctx.moveTo(x,0);ctx.lineTo(x,h);}
    ctx.stroke();ctx.setLineDash([]);
  }
  ctx.fillStyle='#dcf75d';
  model.items.forEach(({time})=>{const x=pos(time);ctx.globalAlpha=.76;ctx.fillRect(x,3,1,h-6);ctx.globalAlpha=1;ctx.fillRect(x-1,3,3,5);});
  const x=pos(audio.currentTime);
  ctx.fillStyle='#fffef2';ctx.fillRect(x,0,1.6,h);
  ctx.beginPath();ctx.moveTo(x-4,1);ctx.lineTo(x+5,1);ctx.lineTo(x+.5,7);ctx.fill();
}
function paintLights(){
  const grid=calibrated||gridSettings();
  const i=ready()&&!taps?beatLight(audio.currentTime,grid.bpm,grid.downbeat):-1;
  if(i===shownLight)return;
  shownLight=i;
  lights.forEach((el,n)=>el.classList.toggle('lit',n===i));
}
const hitKey=()=>$('hit-key').value;
function syncUI(){
  const key=hitKey();
  $('mark-key-badge').textContent=key;
  $('mark-key-inline').textContent=key;
  $('mark').setAttribute('aria-keyshortcuts',taps?'':key);
  $('tap-sync').setAttribute('aria-keyshortcuts',taps?key:'');
  const {bpm,downbeat}=gridSettings();
  const label=taps?'校准中 · '+taps.length+'/4':calibrated?'已按手点校准':nearestBeat(0,bpm,downbeat)?'按手动网格':'未同步';
  if($('beat-status').textContent!==label)$('beat-status').textContent=label;
  $('tap-sync').textContent=taps?'跟着拍子点 · '+taps.length+'/4':calibrated?'重新跟拍校准':'跟着音乐点四下';
  $('tap-cancel').hidden=!taps;
  $('beat-note').textContent=taps?'点击上方按钮，或按 '+key+' 键连续点四拍。校准点不进入右侧记录。':calibrated?'灯跟着你设定的节奏循环。歌曲变速时，可以重新点四拍。':'先播放，再跟着音乐点四下。第一下就是第 1 拍；灯不是自动识别。';
  paintLights();
}
function cancelTap(message){
  if(!taps)return;
  taps=null;syncUI();
  if(message)speak(message);
}
function tapPoint(){
  if(!ready()||audio.paused||audio.seeking)return;
  const t=audio.currentTime;
  const last=taps.at(-1);
  if(last!==undefined&&t-last<.15){if(t<last)cancelTap('播放位置变了，请重新点四下。');return;}
  if(last!==undefined&&t-last>3){taps=[t];hit('tap-sync',0);syncUI();speak('间隔太长，刚才那一下作为新的第 1 拍。');return;}
  taps.push(t);hit('tap-sync',taps.length-1);
  if(taps.length<4){syncUI();return;}
  const fit=fitFourTaps(taps);
  taps=null;
  if(fit){
    calibrated=fit;
    $('bpm').value=String(fit.bpm);
    $('downbeat').value=seconds(fit.downbeat);
    $('grid').checked=true;
    list();
    speak('校准完成。原音拍点没有变化。');
  }else speak('四下间隔不够接近，请重新跟着同样快慢的四拍。'+(calibrated?'已保留上一次校准。':''));
  syncUI();
}
$('tap-sync').addEventListener('click',()=>{
  if(!ready())return;
  if(taps){tapPoint();return;}
  if(audio.ended){
    const arm=()=>{if(audio.paused)return;taps=[];syncUI();};
    audio.addEventListener('playing',arm,{once:true});
    play();return;
  }
  taps=[];
  if(audio.paused){play().then(()=>{if(audio.paused)cancelTap('未能开始播放，无法校准。');});}
  syncUI();
});
$('tap-cancel').addEventListener('click',()=>{$('tap-sync').focus();cancelTap('已取消校准。');});
function paintTime(){
  const at=audio.currentTime||0;
  $('current').textContent=timecode(at);
  if(ready())$('seek').value=String(at);
  paintLights();paintWave();
}
function frame(){
  paintTime();
  animation=audio.paused||audio.ended?0:requestAnimationFrame(frame);
}
function toggleControls(){
  controls.forEach(id=>$(id).disabled=!ready());
  $('undo').disabled=!model.history.length;
  ['copy','csv','json','clear'].forEach(id=>$(id).disabled=!model.items.length);
  const active=ready()&&!audio.paused&&!audio.ended;
  $('play-symbol').textContent=active?'Ⅱ':'▶';
  $('play-label').textContent=active?'暂停':'播放';
  $('play').setAttribute('aria-label',active?'暂停':'播放');
}
function list(scrollId){
  const log=$('markerlist'), before=log.scrollTop, {bpm,downbeat,subdivision}=gridSettings();
  $('count').textContent=String(model.items.length).padStart(2,'0');
  log.replaceChildren();
  if(!model.items.length){
    const empty=document.createElement('div');empty.className='empty';
    empty.innerHTML='<span aria-hidden="true">✳</span><p>还没有拍点</p><small>按 '+hitKey()+' 键或点击「记一个拍点」。</small>';log.append(empty);
  }
  for(const [i,{id,time}] of model.items.entries()){
    const row=document.createElement('div');row.className='row';row.id='row-'+id;
    const jump=document.createElement('button');jump.type='button';jump.className='jump';
    const index=document.createElement('b');index.textContent=String(i+1).padStart(2,'0');index.setAttribute('aria-hidden','true');
    const t=document.createElement('strong');t.textContent=timecode(time);jump.append(index,t);
    const beat=nearestBeat(time,bpm,downbeat,subdivision);
    if(beat){
      const p=document.createElement('small');p.textContent=(beat.delta>=0?'+':'')+seconds(beat.delta)+'s';p.title='最近网格：'+timecode(beat.time);jump.append(p);
    }
    jump.setAttribute('aria-label','跳到拍点 '+(i+1)+'，'+seconds(time)+' 秒');
    jump.addEventListener('click',()=>seek(time));
    const del=document.createElement('button');del.type='button';del.className='del';del.textContent='×';
    del.setAttribute('aria-label','删除拍点 '+(i+1));del.addEventListener('click',()=>{
      update({type:'delete',id});speak('已删除拍点，可撤销。');
      (log.querySelectorAll('.del')[Math.min(i,model.items.length-1)]||$('mark')).focus({preventScroll:true});
    });
    row.append(jump,del);log.append(row);
  }
  log.scrollTop=before;
  if(scrollId){
    const row=$('row-'+scrollId);
    if(row && (row.offsetHeight>0)){
      const rr=row.getBoundingClientRect(),lr=log.getBoundingClientRect();
      if(rr.bottom>lr.bottom)log.scrollTop+=rr.bottom-lr.bottom;
      if(rr.top<lr.top)log.scrollTop-=lr.top-rr.top;
    }
  }
  toggleControls();paintWave();
}
function update(action){model=reduceMarks(model,action);list(action.type==='add'?action.id:0);}
function seek(t){
  if(!ready())return;
  audio.currentTime=Math.min(audio.duration,Math.max(0,t));paintTime();
}
function mark(){
  if(!ready())return;
  const instant=audio.currentTime;
  hit('mark');
  update({type:'add',id:++serial,time:instant});
  speak('已记录 '+seconds(instant)+' 秒');
}
function undo(){
  if(model.history.length){update({type:'undo'});speak('已撤销上一步。');}
}
async function play(){
  if(!ready())return;
  if(audio.ended)seek(0);
  pulsePad($('play'));
  try{await audio.play();}catch{ speak('浏览器无法播放这份文件。试试 WAV 或 MP3。'); }
}
async function load(f){
  if(!f)return;
  if(model.items.length&&!confirm('打开另一条音频会清空当前拍点。确定继续吗？'))return;
  const ticket=++token;
  audio.pause();
  if(mediaUrl)URL.revokeObjectURL(mediaUrl);
  mediaUrl=URL.createObjectURL(f);peaks=[];source=null;model={items:[],history:[]};
  if(calibrated){$('grid').checked=false;$('bpm').value='120';$('downbeat').value='0';}
  taps=null;calibrated=null;syncUI();
  $('wave-message').hidden=false;$('wave-message').textContent='正在读取音频…';
  $('track').textContent=f.name;$('track').title=f.name;$('duration').textContent='/ 00:00.000';$('scale-end').textContent='00:00';$('seek').value='0';
  audio.src=mediaUrl;audio.load();list();
  source={name:f.name,sizeBytes:f.size,type:f.type||null};
  toggleControls();paintTime();
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC||f.size>150*1024*1024){$('wave-message').textContent='此文件不生成波形，仍可播放和打点';return;}
  let decoder;
  try{
    decoder=new AC({sampleRate:11025});
    const samples=await decoder.decodeAudioData(await f.arrayBuffer());
    if(ticket!==token)return;
    const channels=Array.from({length:samples.numberOfChannels},(_,i)=>waveformBins(samples.getChannelData(i),1200));
    peaks=channels[0]?.map((v,i)=>Math.max(v,...channels.slice(1).map(a=>a[i])))||[];
    $('wave-message').hidden=!!peaks.length;paintWave();
  }catch{
    if(ticket===token)$('wave-message').textContent='无法生成波形，仍可使用下方进度条';
  }finally{if(decoder)decoder.close().catch(()=>{});}
}
file.addEventListener('change',()=>{load(file.files[0]);file.value='';});
const drop=$('drop');drop.tabIndex=0;drop.setAttribute('role','button');
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();file.click();}});
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');load(e.dataTransfer.files[0]);});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',e=>e.preventDefault());
audio.addEventListener('loadedmetadata',()=>{
  if(!ready())return;
  $('seek').max=String(audio.duration);
  $('duration').textContent='/ '+timecode(audio.duration);$('scale-end').textContent=timecode(audio.duration).split('.')[0];
  toggleControls();paintTime();speak('音频已在本机打开。');
});
audio.addEventListener('error',()=>{
  if(audio.src){$('wave-message').hidden=false;$('wave-message').textContent='无法播放格式，试试 WAV 或 MP3';toggleControls();speak('浏览器无法解码这份文件。');}
});
audio.addEventListener('play',()=>{toggleControls();if(!animation)animation=requestAnimationFrame(frame);});
for(const name of ['pause','ended'])audio.addEventListener(name,()=>{
  cancelTap('播放停止，需重新点四下。');
  if(animation){cancelAnimationFrame(animation);animation=0;}toggleControls();paintTime();
});
audio.addEventListener('seeking',()=>cancelTap('播放位置变了，请重新点四下。'));
audio.addEventListener('seeked',paintTime);
$('play').addEventListener('click',()=>{
  if(audio.paused)play();
  else{pulsePad($('play'));audio.pause();}
});
$('back').addEventListener('click',()=>seek(audio.currentTime-2));
$('forward').addEventListener('click',()=>seek(audio.currentTime+2));
$('seek').addEventListener('input',e=>seek(Number(e.target.value)));
$('mark').addEventListener('click',mark);
$('undo').addEventListener('click',undo);
$('clear').addEventListener('click',()=>{update({type:'clear'});speak('已清空拍点，可撤销。');});
wave.addEventListener('pointerdown',e=>{
  if(!ready()||e.button!==0)return;cursorId=e.pointerId;wave.setPointerCapture(e.pointerId);
  const r=wave.getBoundingClientRect();seek((e.clientX-r.left)/r.width*audio.duration);
});
wave.addEventListener('pointermove',e=>{
  if(e.pointerId===cursorId&&wave.hasPointerCapture(e.pointerId)){
    const r=wave.getBoundingClientRect();seek((e.clientX-r.left)/r.width*audio.duration);
  }
});
wave.addEventListener('lostpointercapture',()=>cursorId=0);
for(const id of ['grid','bpm','downbeat','subdivision'])$(id).addEventListener('input',()=>{
  if(id==='bpm'||id==='downbeat')calibrated=null;
  list();syncUI();
});
$('set-downbeat').addEventListener('click',()=>{
  if(!ready())return;
  $('downbeat').value=seconds(audio.currentTime);$('grid').checked=true;calibrated=null;list();syncUI();speak('以当前源时间作为网格首拍。');
});
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.repeat||e.isComposing||e.altKey||e.target.closest('input,textarea,select,[contenteditable],summary'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){if(model.history.length){e.preventDefault();undo();}return;}
  if(e.ctrlKey||e.metaKey||e.shiftKey||!ready())return;
  if(!isHitKey(e.code,e.key,hitKey()))return;
  e.preventDefault();
  taps?tapPoint():mark();
});
$('hit-key').addEventListener('change',()=>{
  syncUI();if(!model.items.length)list();
  if(ready())(taps?$('tap-sync'):$('mark')).focus({preventScroll:true});
});
const exportSource=()=>source?{...source,durationSeconds:Number(seconds(audio.duration))}:{};
const data=()=>exportMarks(model.items,gridSettings(),exportSource());
function save(extension,content,mime){
  if(!model.items.length)return;
  const link=document.createElement('a');const url=URL.createObjectURL(new Blob([content],{type:mime}));
  link.href=url;link.download='AXIOM_手打拍点.'+extension;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);speak('已请求下载 '+extension.toUpperCase()+'。');
}
$('json').addEventListener('click',()=>save('json',JSON.stringify(data(),null,2),'application/json;charset=utf-8'));
$('csv').addEventListener('click',()=>{
  const {grid,markers}=data();
  const lines=['index,source_seconds'+(grid?',grid_seconds,delta_seconds':'')];
  for(const x of markers)lines.push([x.index,seconds(x.sourceSeconds),...(grid?[seconds(x.gridSeconds),seconds(x.deltaSeconds)]:[])].join(','));
  save('csv','\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');
});
$('copy').addEventListener('click',async()=>{
  const lines=model.items.map(x=>seconds(x.time)).join('\n');
  try{await navigator.clipboard.writeText(lines);speak('已复制 '+model.items.length+' 个原音时间（秒）。');}
  catch{
    const ta=document.createElement('textarea');ta.value=lines;ta.setAttribute('aria-label','拍点原音时间');
    const dialog=document.createElement('dialog');const label=document.createElement('p');label.textContent='复制下方的原音时间（秒）';
    const close=document.createElement('button');close.textContent='关闭';
    ta.readOnly=true;ta.style.cssText='display:block;min-width:min(65vw,24rem);min-height:35vh;margin-bottom:10px;';
    close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());
    dialog.append(label,ta,close);document.body.append(dialog);dialog.showModal();ta.focus();ta.select();
  }
});
if(typeof ResizeObserver==='function')new ResizeObserver(paintWave).observe(wave);else window.addEventListener('resize',paintWave);
window.addEventListener('beforeunload',e=>{if(model.items.length){e.preventDefault();e.returnValue=true;}});
paintWave();
