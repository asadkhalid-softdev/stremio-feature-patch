// Optional integration check. Open Discover through the patched launcher first.
// Restores the original filter settings after testing.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const pages=await (await fetch('http://127.0.0.1:19247/json/list')).json();
  const page=pages.find(p=>p.type==='page'&&p.url.startsWith('https://web.stremio.com/'));
  assert(page,'Open Stremio first');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let id=0;
  function command(method,params){return new Promise((resolve,reject)=>{
    const current=++id,timer=setTimeout(()=>reject(new Error('CDP timeout')),20000);
    const receive=e=>{const r=JSON.parse(e.data);if(r.id!==current)return;clearTimeout(timer);ws.removeEventListener('message',receive);r.error?reject(new Error(r.error.message)):resolve(r.result);};
    ws.addEventListener('message',receive);ws.send(JSON.stringify({id:current,method,params}));
  });}
  try {
    const result=await command('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(${async function(){
      const patch=window.__stremioDiscoverPatch;
      if(!patch||!document.querySelector('.sfp-toolbar'))throw new Error('Open Discover first');
      const previous=patch.state(),checks=[];
      const control=k=>document.querySelector('.sfp-toolbar [data-control="'+k+'"]');
      const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const expect=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
      const change=(key,value)=>{const e=control(key);e.value=String(value);e.dispatchEvent(new Event(key==='sort'?'change':'input',{bubbles:true}));};
      const year=(value,kind='enter')=>{const e=control('year');e.focus();e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));if(kind==='enter')e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));else e.blur();};
      const watched=value=>{if(control('watched').checked!==value)control('watched').click();};
      const direction=value=>{if(patch.state().direction!==value)document.querySelector('.sfp-direction').click();};
      let fake;
      try {
        watched(false);change('min',0);change('max',10);year('');
        const y=control('year');y.focus();y.value='a20b26c999';y.dispatchEvent(new Event('input',{bubbles:true}));
        expect(y.value==='2026','Year strips non-digits and caps at four');
        expect(patch.state().year==='','Year does not apply while typing');
        y.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        expect(patch.state().year==='2026','Enter applies four-digit year');
        year('202');expect(patch.state().year==='2026'&&y.getAttribute('aria-invalid')==='true','Incomplete year does not replace active filter');
        year('2025','blur');expect(patch.state().year==='2025','Blur applies year');
        year('','blur');expect(patch.state().year==='','Empty year removes filter');

        // Obtain the current catalog's raw response for independent expectations.
        const root=document.querySelector('[class*="discover-container-"]');
        let request;
        for(let f=root[Object.keys(root).find(k=>k.startsWith('__reactFiber'))],i=0;f&&i<6;f=f.return,i++)for(let h=f.memoizedState,j=0;h&&j<120;h=h.next,j++)if(h.memoizedState?.catalog&&h.memoizedState.selected?.request?.path?.resource==='catalog'){request=h.memoizedState.selected.request;break;}
        if(!request)throw new Error('Catalog request not found');
        const u=new URL(request.base),p=request.path;
        const extra=(p.extra||[]).map(e=>encodeURIComponent(e.name)+'='+encodeURIComponent(e.value)).join('&');
        u.pathname=u.pathname.replace(/\/manifest\.json$/,'')+'/catalog/'+encodeURIComponent(p.type)+'/'+encodeURIComponent(p.id)+(extra?'/'+extra:'')+'.json';u.search='';u.hash='';
        const body=await (await fetch(u.href)).json();patch.ingest(body);await tick();
        const metas=new Map(body.metas.map(m=>[m.id,m]));
        const cards=()=>[...root.querySelectorAll('[class*="meta-items-container-"] > [class*="meta-item-container-"]')];
        const cardId=c=>decodeURIComponent(c.querySelector('a').getAttribute('href').split('/')[3]);
        change('min',7.5);change('max',8);await tick();
        for(const c of cards()) {
          const raw=metas.get(cardId(c));if(!raw)continue;
          const rating=raw.imdbRating==null||raw.imdbRating===''?null:Number(raw.imdbRating);
          const expected=rating!==null&&Number.isFinite(rating)&&rating>=7.5&&rating<=8;
          if((getComputedStyle(c).display!=='none')!==expected)throw new Error('Rating visibility mismatch: '+cardId(c));
        }
        checks.push('Actual catalog ratings obey inclusive range');
        change('min',9);expect(patch.state().min===8,'Lower slider cannot cross upper');
        change('min',0);change('max',10);

        const grid=root.querySelector('[class*="meta-items-container-"]');
        fake=cards()[0].cloneNode(true);const link=fake.querySelector('a');link.setAttribute('href','#/detail/movie/local-patch-test/local-patch-test');link.setAttribute('data-index','-1');
        fake.querySelectorAll('[class*="watched-icon-layer-"]').forEach(e=>e.remove());grid.append(fake);
        patch.ingest({metas:[{id:'local-patch-test',type:'movie'}]});year('1900');change('min',9.9);change('max',10);await tick();
        expect(getComputedStyle(fake).display==='none','Missing year and IMDb rating are hidden under active filters');
        year('');await tick();
        expect(getComputedStyle(fake).display==='none','Missing IMDb rating stays hidden when only rating is active');
        change('min',0);change('max',10);year('1900');await tick();
        expect(getComputedStyle(fake).display==='none','Missing year stays hidden when only year is active');
        year('');await tick();
        expect(getComputedStyle(fake).display!=='none','Missing values return when both filters are inactive');
        fake.remove();fake=null;year('');change('min',0);change('max',10);

        for(const key of ['year','rating','popularity'])for(const dir of ['asc','desc']) {
          change('sort',key);direction(dir);await tick();
          const rows=cards().filter(c=>metas.has(cardId(c))).sort((a,b)=>Number(a.style.order)-Number(b.style.order));
          let prev=null;
          for(const c of rows) {
            const m=metas.get(cardId(c));
            const raw=key==='year'?String(m.releaseInfo||m.year||m.released||'').slice(0,4):key==='rating'?m.imdbRating:(m.popularity??m.popularities?.stremio??m.popularities?.moviedb??m.popularities?.trakt);
            if(raw==null||String(raw).trim()==='')continue;
            const value=Number(raw);
            if(!Number.isFinite(value))continue;
            if(prev!==null && (dir==='asc'?value<prev:value>prev))throw new Error('Sort failed: '+key+' '+dir);
            prev=value;
          }
          expect(document.querySelector('.sfp-direction').textContent===(dir==='asc'?'↑':'↓'),key+' '+dir+' order and icon');
        }
        change('sort','default');await tick();
        expect(cards().every(c=>c.style.order===''),'Default restores catalog order');
        expect(document.querySelector('.sfp-direction').disabled,'Default direction toggle disabled');
        return checks;
      } finally {
        fake?.remove();year('');change('min',0);change('max',10);change('min',previous.min);change('max',previous.max);year(previous.year);watched(previous.hideWatched);change('sort',previous.sort==='default'?'rating':previous.sort);direction(previous.direction);change('sort',previous.sort);document.activeElement?.blur();
      }
    }.toString()})()`});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    console.log(result.result.value.join('\n'));
    const screenshot=await command('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(__dirname,'..','preview.png'),Buffer.from(screenshot.data,'base64'));
  } finally {ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
