const ms = n => Math.round(n * 1000) / 1000;
export function timecode(n) {
  const v = Math.round(Math.max(0, Number.isFinite(n) ? n : 0) * 1000);
  return `${String(Math.floor(v / 60000)).padStart(2,'0')}:${String(Math.floor(v / 1000)%60).padStart(2,'0')}.${String(v%1000).padStart(3,'0')}`;
}
export function nearestBeat(time,bpm,downbeat,subdivision=1) {
  if (!Number.isFinite(bpm)||bpm<20||bpm>400||!Number.isFinite(downbeat)||downbeat<0) return null;
  const step=60/bpm/([1,2,4].includes(subdivision)?subdivision:1);
  const ref=downbeat+Math.max(0,Math.round((time-downbeat)/step))*step;
  return {time:ms(ref),delta:ms(time-ref)};
}
export function reduceMarks(state, action) {
  const {items,history}=state;
  if (action.type==='undo') return history.length ? {items:history.at(-1),history:history.slice(0,-1)}:state;
  let next;
  if (action.type==='add' && Number.isFinite(action.time) && action.time>=0)
    next=items.concat({id:action.id,time:ms(action.time)}).sort((a,b)=>a.time-b.time||a.id-b.id);
  else if(action.type==='delete') next=items.filter(x=>x.id!==action.id);
  else if(action.type==='clear') next=[];
  return !next || (action.type!=='add' && next.length===items.length) ? state:{items:next,history:history.concat([items]).slice(-100)};
}
export function exportMarks(items,{bpm,downbeat,subdivision=1}={},source={}) {
  const grid=nearestBeat(0,bpm,downbeat)? {bpm,firstDownbeatSeconds:downbeat,divisionsPerBeat:subdivision}:null;
  return {timebase:'seconds_from_source_start',precisionSeconds:0.001,source,grid,markers:items.map(({time},i)=>{
    const beat=grid?nearestBeat(time,bpm,downbeat,subdivision):null;
    return {index:i+1,sourceSeconds:time,...(beat?{gridSeconds:beat.time,deltaSeconds:beat.delta}:{})};
  })};
}
export function waveformBins(samples,count) {
  if (!samples.length || count<1) return [];
  const n=Math.min(count,samples.length), r=[];
  for(let i=0;i<n;i++){
    const a=Math.floor(i*samples.length/n), b=Math.floor((i+1)*samples.length/n);
    let p=0, hop=Math.max(1,Math.floor((b-a)/1400));
    for(let j=a;j<b;j+=hop) p=Math.max(p,Math.abs(samples[j]));
    r.push(p);
  }
  return r;
}

// The four taps establish pace and phase; they do not detect or edit markers.
export function fitFourTaps(taps) {
  if(taps.length!==4||taps.some(t=>!Number.isFinite(t)||t<0))return null;
  const gaps=taps.slice(1).map((t,i)=>t-taps[i]);
  if(gaps.some(d=>d<.15||d>3))return null;
  const step=(taps[3]-taps[0])/3;
  if(gaps.some(d=>Math.abs(d-step)>Math.max(.065,step*.23)))return null;
  return {bpm:Math.round(6000/step)/100,downbeat:ms(taps[0])};
}
export function beatLight(time,bpm,downbeat){
  if(!Number.isFinite(time)||!Number.isFinite(bpm)||bpm<20||bpm>400||!Number.isFinite(downbeat)||downbeat<0||time<downbeat)return -1;
  return Math.floor((time-downbeat)*bpm/60+1e-9)%4;
}
