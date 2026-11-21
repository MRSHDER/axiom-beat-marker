import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timecode, exportMarks, nearestBeat, reduceMarks, waveformBins, fitFourTaps, beatLight, isHitKey} from '../core.mjs';

test('uses original media seconds and a separate BPM comparison',()=>{
  assert.deepEqual(nearestBeat(9.47, 120, 9.04), {time:9.54,delta:-0.07});
  const markers=[{id:1,time:9.04},{id:2,time:9.47}];
  assert.equal(exportMarks(markers,{bpm:120,downbeat:9.04}).markers[1].sourceSeconds,9.47);
});

test('deletion and undo restore the same timestamp and order',()=>{
  let m={items:[],history:[]};
  m=reduceMarks(m,{type:'add',id:1,time:38.16});
  m=reduceMarks(m,{type:'add',id:2,time:9.04});
  m=reduceMarks(m,{type:'delete',id:1});
  m=reduceMarks(m,{type:'undo'});
  assert.deepEqual(m.items.map(x=>x.time),[9.04,38.16]);
  m=reduceMarks(m,{type:'clear'}); assert.equal(m.items.length,0);
  assert.equal(reduceMarks(m,{type:'undo'}).items.length,2);
});

test('minute rollover and sampled audio peaks are useful on a long waveform',()=>{
  assert.equal(timecode(59.9999),'01:00.000');
  assert.deepEqual(waveformBins(new Float32Array([0,-1,0.5,0]),2),[1,0.5]);
});

test('one quarter of a beat is optional, with raw times unaffected',()=>{
  const markers=[{id:1,time:9.47}];
  assert.deepEqual(nearestBeat(9.47,120,9.04,4),{time:9.415,delta:0.055});
  const exported=exportMarks(markers,{bpm:120,downbeat:9.04,subdivision:4});
  assert.equal(exported.grid.divisionsPerBeat,4);
  assert.deepEqual(exported.markers[0],{index:1,sourceSeconds:9.47,gridSeconds:9.415,deltaSeconds:0.055});
});

test('four steady manual taps set tempo and the first beat',()=>{
  assert.deepEqual(fitFourTaps([1.2,1.7,2.205,2.7]),{bpm:120,downbeat:1.2});
  assert.equal(fitFourTaps([1,1.02,2,3]),null);
  assert.equal(fitFourTaps([1,1.5,2.5,3]),null);
  assert.equal(fitFourTaps([1,1.5,2]),null);
  assert.equal(fitFourTaps([1,2,1.5,3]),null);
});

test('cue loops 1 through 4 using source time, independently of grid subdivision',()=>{
  assert.equal(beatLight(1.19,120,1.2),-1);
  assert.deepEqual([1.2,1.7,2.2,2.7,3.2,3.7].map(t=>beatLight(t,120,1.2)),[0,1,2,3,0,1]);
  assert.equal(beatLight(3.1,120,1.2),3);
  assert.equal(beatLight(1.2,undefined,1.2),-1);
});

test('F is the default; switch to J/D/K without allowing Space or M',()=>{
  assert.equal(isHitKey('KeyF','f'),true);
  assert.equal(isHitKey('Space',' '),false);
  assert.equal(isHitKey('KeyM','m'),false);
  assert.equal(isHitKey('KeyF','f','J'),false);
  assert.equal(isHitKey('KeyJ','j','J'),true);
  assert.equal(isHitKey('KeyD','d','D'),true);
  assert.equal(isHitKey('KeyK','k','K'),true);
  assert.equal(isHitKey('Unidentified','j','J'),true);
});
