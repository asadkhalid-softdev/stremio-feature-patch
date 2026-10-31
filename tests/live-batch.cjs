// Run against a paginated Cinemeta Discover catalog through the patched launcher.
const assert=require('node:assert/strict');
(async()=>{
  const page=(await(await fetch('http://127.0.0.1:19247/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith('https://web.stremio.com/'));
  assert(page,'Open Stremio first');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let id=0;
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function evaluate(expression){
    const request=++id;
    const r=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('CDP timeout')),15000);
      const receive=e=>{const data=JSON.parse(e.data);if(data.id!==request)return;clearTimeout(timer);ws.removeEventListener('message',receive);resolve(data.result);};
      ws.addEventListener('message',receive);ws.send(JSON.stringify({id:request,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  }
  async function settled(){for(let i=0;i<180;i++){const state=await evaluate(`(()=>{const b=document.querySelector('.sfp-more');return b&&!b.disabled?{status:document.querySelector('.sfp-status').textContent,total:Number(document.querySelector('.sfp-status').textContent.match(/of ([0-9]+)/)?.[1]),native:document.querySelectorAll('[class*="discover-container-"] [class*="meta-item-container-"]').length}:null})()`);if(state)return state;await delay(100);}throw new Error('Preload did not settle');}
  try {
    await evaluate(`(()=>{if(!location.hash.startsWith('#/discover'))document.querySelector('a[href="#/discover"]').click()})()`);
    const first=await settled();
    assert.equal(first.total,Math.min(100,first.native));
    assert(first.native>=100,'This test needs a catalog with at least 100 results');
    console.log('Initial batch:',JSON.stringify(first));
    const before=await evaluate(`(()=>{const g=document.querySelector('[class*="discover-container-"] [class*="meta-items-container-"]');const snapshot=[...g.children].map(c=>[c.querySelector('a')?.getAttribute('href'),c.style.order,c.dataset.discoverHidden]);g.scrollTop=g.scrollHeight;g.dispatchEvent(new Event('scroll'));return snapshot})()`);
    await delay(1500);
    const after=await evaluate(`(()=>{const g=document.querySelector('[class*="discover-container-"] [class*="meta-items-container-"]');return [...g.children].map(c=>[c.querySelector('a')?.getAttribute('href'),c.style.order,c.dataset.discoverHidden])})()`);
    assert.deepEqual(after,before);console.log('Scrolling preserves cards, visibility, and sorting; no automatic next page');
    await evaluate(`document.querySelector('.sfp-more').click()`);
    const expanded=await settled();
    assert.equal(expanded.total,Math.min(200,expanded.native));
    assert(expanded.total>first.total);
    assert.equal(await evaluate(`document.querySelector('[class*="discover-container-"] [class*="meta-items-container-"]').scrollTop`),0);
    console.log('Explicit Load more:',JSON.stringify(expanded),'and returned to top');
  } finally {ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
