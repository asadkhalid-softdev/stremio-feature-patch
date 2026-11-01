const test=require('node:test');
const assert=require('node:assert/strict');
const {libraryMatches,normalRoute}=require('../payload/library-filters.js');
test('watched and unwatched are exclusive filters, with all as the clear state',()=>{
  assert.equal(libraryMatches(true,'watched'),true);
  assert.equal(libraryMatches(false,'watched'),false);
  assert.equal(libraryMatches(true,'unwatched'),false);
  assert.equal(libraryMatches(false,'unwatched'),true);
  assert.equal(libraryMatches(true,'all'),true);
  assert.equal(libraryMatches(false,'all'),true);
});
test('changing a legacy watched sort preserves the type and other route options',()=>{
  assert.equal(normalRoute('#/library/movie?sort=notwatched','name'),'#/library/movie?sort=name');
  assert.equal(normalRoute('#/library?sort=watched&other=1','timeswatched'),'#/library?sort=timeswatched&other=1');
  assert.equal(normalRoute('#/library','invalid'),'#/library?sort=lastwatched');
});
