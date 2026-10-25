import test from 'node:test';
import assert from 'node:assert/strict';
import {captureTiles,RASTER_LIMIT} from '../test-support/capture-tiles.js';
test('bounded viewport tiles preserve gap-free full document coverage and overlap under16MiB',()=>{
 for(const [width,height,documentHeight]of[[1920,1080,3000],[1920,1080,2185],[375,800,4300],[160,160,160],[1920,1080,500]]){
  const ranges=captureTiles(width,height,documentHeight);assert.equal(ranges[0].start,0);assert.equal(ranges.at(-1).end,documentHeight);assert.ok(ranges.length<=8);
  ranges.forEach((r,i)=>{assert.ok(r.start>=0&&r.end<=documentHeight&&r.end-r.start<=height);assert.ok(width*height*4<RASTER_LIMIT);if(i){assert.ok(r.start<=ranges[i-1].end);assert.ok(r.start>ranges[i-1].start);assert.ok(ranges[i-1].end-r.start>=64);}});
 }
 assert.deepEqual(captureTiles(1920,1080,3000),[{start:0,end:1080},{start:1016,end:2096},{start:1920,end:3000}]);
});
test('oversized rasters/documents fail closed rather than truncate or weaken resource caps',()=>{
 for(const args of [[1920,1080,10000],[5000,1080,3000],[1920,2000,3000],[0,800,3000],[375,800,NaN]])assert.throws(()=>captureTiles(...args));
});
