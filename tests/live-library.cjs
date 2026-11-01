// Optional live check. Open Library through the patched launcher first.
// Reads watched indicators and restores filter/sort preferences; never marks titles.
const assert=require('node:assert/strict');
(async()=>{
  const page=(await(await fetch('http://127.0.0.1:19247/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith('https://web.stremio.com/'));
  assert(page,'Open Stremio first');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  try{
    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Live Library test timeout')),20000);
      ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.id===1){clearTimeout(timer);resolve(r.result);}});
      ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{awaitPromise:true,returnByValue:true,expression:`(${async function(){
        const patch=window.__stremioLibraryPatch,root=document.querySelector('[class*="library-container-"]');
        if(!patch||!root)throw new Error('Open Library first');
        const previous=patch.state(),checks=[];
        const wait=async()=>{
          await new Promise(r=>setTimeout(r,200));
          for(let i=0;i<40&&root.querySelector('.slp-library-count')?.textContent.includes('Loading more');i++)await new Promise(r=>setTimeout(r,100));
        };
        const chip=filter=>root.querySelector('[data-library-watch-filter="'+filter+'"]');
        const sortChip=sort=>[...root.querySelectorAll('[data-value]')].find(e=>new URLSearchParams(e.dataset.value.split('?')[1]).get('sort')===sort);
        const expect=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
        const inspect=()=>[...root.querySelectorAll('[class*="meta-item-container-"]')].map(c=>({href:c.querySelector('a')?.getAttribute('href'),watched:!!c.querySelector('[class*="watched-icon-layer-"]'),visible:getComputedStyle(c).display!=='none'}));
        const initial=new Map(inspect().map(c=>[c.href,c.watched]));
        try{
          root.querySelector('.slp-library-clear')?.click();sortChip('name').click();await wait();
          chip('unwatched').click();await wait();
          expect(patch.state().filter==='unwatched'&&patch.state().sort==='name','Not Watched filters while preserving A–Z sort');
          expect(!location.hash.includes('sort=notwatched'),'Not Watched no longer selects native watched sorting');
          expect(inspect().every(c=>c.visible===!c.watched),'Not Watched hides every watched tick and keeps unticked loaded cards');
          chip('watched').click();await wait();
          expect(patch.state().filter==='watched'&&chip('watched').getAttribute('aria-pressed')==='true'&&chip('unwatched').getAttribute('aria-pressed')==='false','Watched and Not Watched are mutually exclusive');
          expect(inspect().every(c=>c.visible===c.watched),'Watched keeps only ticked cards');
          chip('watched').click();await wait();
          expect(patch.state().filter==='all'&&inspect().every(c=>c.visible),'Clicking the active filter again restores all loaded cards');
          chip('unwatched').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait();
          expect(patch.state().filter==='unwatched','Keyboard Enter activates the filter');
          sortChip('timeswatched').click();await wait();
          expect(patch.state().filter==='unwatched'&&patch.state().sort==='timeswatched'&&inspect().every(c=>c.visible===!c.watched),'Native sort changes preserve the active filter');
          const saved=JSON.parse(localStorage.getItem('local.library.watchFilter.v1'));
          expect(saved.filter==='unwatched'&&saved.sort==='timeswatched','Library filter and sort preferences are saved locally');
          root.querySelector('.slp-library-clear').click();await wait();
          expect(patch.state().filter==='all'&&inspect().every(c=>c.visible),'Clear filter restores all loaded cards');
          expect(inspect().every(c=>!initial.has(c.href)||initial.get(c.href)===c.watched),'Watched indicators remain unchanged');
          return checks;
        }finally{
          root.querySelector('.slp-library-clear')?.click();sortChip(previous.sort)?.click();await wait();
          if(previous.filter!=='all')chip(previous.filter)?.click();
        }
      }.toString()})()`}}));
    });
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      console.log(result.result.value.join('\n'));
  }finally{ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
