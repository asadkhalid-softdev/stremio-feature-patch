'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {metadata,matches,compare,selectBatch} = require('../payload/hide-watched.js');
const defaults = {year:'',min:0,max:10,hideWatched:false,sort:'default',direction:'desc'};
test('extracts premiere years from ranges and dates, and rating/popularity numbers',()=>{
  assert.deepEqual(metadata({releaseInfo:'2019–2026',imdbRating:'8.1',popularities:{stremio:2}}),{year:2019,rating:8.1,popularity:2});
  assert.equal(metadata({released:'2024-01-01T00:00:00Z'}).year,2024);
  assert.equal(metadata({year:'2023'}).year,2023);
});
test('missing, blank, malformed, and out-of-range ratings remain unknown',()=>{
  for(const value of [undefined,null,'',' ','N/A',11,-1])assert.equal(metadata({imdbRating:value}).rating,null);
  assert.equal(metadata({imdbRating:'0'}).rating,0);
  assert.equal(metadata({}).year,null);
});
test('active filters exclude missing values independently; inactive filters keep them',()=>{
  const state={...defaults,year:'2020',min:7,max:8};
  assert.equal(matches(metadata({}),state),false);
  assert.equal(matches(metadata({}),defaults),true);
  assert.equal(matches(metadata({year:2020}),{...defaults,year:'2020'}),true);
  assert.equal(matches(metadata({imdbRating:7.5}),{...defaults,min:7,max:8}),true);
  assert.equal(matches(metadata({imdbRating:7.5}),{...defaults,year:'2020'}),false);
  assert.equal(matches(metadata({year:2020}),{...defaults,min:7}),false);
  assert.equal(matches(metadata({year:2020}),{...defaults,max:9}),false);
  assert.equal(matches(metadata({year:2020,imdbRating:7}),state),true);
  assert.equal(matches(metadata({year:2020,imdbRating:8}),state),true);
  assert.equal(matches(metadata({year:2021,imdbRating:7.5}),state),false);
  assert.equal(matches(metadata({year:2020,imdbRating:8.1}),state),false);
  assert.equal(matches(metadata({year:2021}),{...state,year:''}),false);
  assert.equal(matches(metadata({year:2021}),defaults),true);
  assert.equal(matches(metadata({}),{...state,hideWatched:true},true),false);
});
test('all sort keys support both directions, stable ties, and unknowns last',()=>{
  for(const key of ['year','rating','popularity']) {
    const rows=[{index:0,meta:{[key]:2}},{index:1,meta:{[key]:null}},{index:2,meta:{[key]:1}},{index:3,meta:{[key]:2}}];
    assert.deepEqual([...rows].sort((a,b)=>compare(a,b,{...defaults,sort:key,direction:'asc'})).map(r=>r.index),[2,0,3,1]);
    assert.deepEqual([...rows].sort((a,b)=>compare(a,b,{...defaults,sort:key,direction:'desc'})).map(r=>r.index),[0,3,2,1]);
    assert.deepEqual([...rows].reverse().sort((a,b)=>compare(a,b,defaults)).map(r=>r.index),[0,1,2,3]);
  }
});
test('batch admits exactly 100 in catalog order, then expands only explicitly',()=>{
  const rows=Array.from({length:149},(_,index)=>({index})).reverse();
  const first=selectBatch(rows,100).map(r=>r.index);
  assert.equal(first.length,100);assert.equal(first[0],0);assert.equal(first.at(-1),99);
  assert.deepEqual(selectBatch([...rows,{index:149}],100).map(r=>r.index),first);
  assert.equal(selectBatch(rows,200).length,149);
  assert.equal(selectBatch(rows.slice(0,20),100).length,20);
});
