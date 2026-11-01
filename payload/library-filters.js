(function bootstrapLibrary() {
  'use strict';
  const VERSION='1.0.0';
  const SORTS=['lastwatched','name','namereverse','timeswatched'];
  function libraryMatches(watched,filter) {
    return filter==='watched'?watched===true:filter==='unwatched'?watched!==true:true;
  }
  function normalRoute(hash,sort) {
    const [path,query='']=hash.split('?');
    const params=new URLSearchParams(query);
    params.set('sort',SORTS.includes(sort)?sort:'lastwatched');
    return path+'?'+params.toString();
  }
  const engine={libraryMatches,normalRoute};
  if(typeof module!=='undefined'&&module.exports)module.exports=engine;
  if(typeof window==='undefined'||typeof document==='undefined')return;
  if(!document.documentElement){document.addEventListener('DOMContentLoaded',bootstrapLibrary,{once:true});return;}
  if(location.origin!=='https://web.stremio.com'||window.__stremioLibraryPatch?.version===VERSION)return;
  window.__stremioLibraryPatch?.dispose();
  const ROOT='[class*="library-container-"]',CARD='[class*="meta-item-container-"]';
  const KEY='local.library.watchFilter.v1';
  let state={filter:'all',sort:'lastwatched'};
  try{state={...state,...JSON.parse(localStorage.getItem(KEY)||'null')};}catch(_){}
  if(!['all','watched','unwatched'].includes(state.filter))state.filter='all';
  if(!SORTS.includes(state.sort))state.sort='lastwatched';
  let disposed=false,frame=0;
  const originalAttributes=new Map(),filling=new Set(),attempts=new WeakMap();
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const style=document.createElement('style');
  style.id='local-library-filter-style';
  style.textContent=`
    ${ROOT} [data-library-hidden="true"]{display:none !important;}
    ${ROOT} [data-library-watch-filter][aria-pressed="true"]{background:#1948ad !important;color:white !important;}
    .slp-filter-label{display:inline-flex;align-items:center;align-self:center;margin-left:12px;padding-left:16px;border-left:1px solid #56506b;color:#aaa3be;font-size:.82em;white-space:nowrap;}
    .slp-library-status{display:flex;align-items:center;gap:12px;color:#b7aecb;font-size:.82em;margin:0 20px 12px;}
    .slp-library-clear{background:transparent;border:0;color:#bda3ff;font:inherit;cursor:pointer;padding:3px;}
    .slp-library-clear:hover{text-decoration:underline;}
    .slp-library-clear:focus-visible{outline:2px solid #bda3ff;outline-offset:3px;}
    .slp-library-status [hidden]{display:none !important;}
  `;
  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_) {}}
  function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(update);}
  function sortOf(value){try{return new URLSearchParams(value.split('?')[1]||'').get('sort')||'lastwatched';}catch(_){return 'lastwatched';}}
  function model(root){
    const key=Object.keys(root).find(k=>k.startsWith('__reactFiber'));
    for(let f=root[key],level=0;f&&level<6;f=f.return,level++)for(let h=f.memoizedState,i=0;h&&i<120;h=h.next,i++){
      const v=h.memoizedState;
      if(Array.isArray(v?.catalog)&&v.selected?.request&&v.selectable?.sorts)return v;
    }
    return null;
  }
  function hasMore(root,grid){const m=model(root);return !!m&&(m.catalog.length>grid.querySelectorAll(CARD).length||!!m.selectable.nextPage);}
  async function fillViewport(root,grid){
    if(filling.has(grid))return;
    const signature=state.filter+':'+grid.querySelectorAll(CARD).length+':'+location.hash;
    if(attempts.get(grid)===signature)return;
    attempts.set(grid,signature);filling.add(grid);schedule();
    try{
      // When filtering removes the scrollbar, ask the app for another page.
      // Stop once the viewport can scroll, rather than loading the whole library.
      for(let pages=0;pages<25&&!disposed&&state.filter!=='all'&&location.hash.startsWith('#/library');pages++){
        if(!grid.isConnected||grid.scrollHeight>grid.clientHeight+250||!hasMore(root,grid))break;
        const before=grid.querySelectorAll(CARD).length,previousTop=grid.scrollTop;
        const trigger=()=>{
          grid.scrollTop=0;grid.dispatchEvent(new Event('scroll'));
          grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event('scroll'));
          grid.scrollTop=previousTop;
        };
        trigger();let waited=0;
        while(!disposed&&grid.isConnected&&grid.querySelectorAll(CARD).length===before&&waited<2000){
          await delay(100);waited+=100;if(waited===700)trigger();
        }
        if(grid.querySelectorAll(CARD).length===before)break;
        await delay(100);
      }
    }finally{filling.delete(grid);schedule();}
  }
  function selectFilter(filter){
    state.filter=state.filter===filter?'all':filter;save();
    for(const root of document.querySelectorAll(ROOT)){
      const grid=root.querySelector('[class*="meta-items-container-"]');
      if(grid){grid.scrollTop=0;attempts.delete(grid);}
    }
    if(['watched','notwatched'].includes(sortOf(location.hash)))location.replace(normalRoute(location.hash,state.sort));
    update();
  }
  function activation(event){
    if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    if(event.type==='click'&&(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;
    const chip=event.target instanceof Element?event.target.closest('[data-value]'):null;
    if(!chip?.closest(ROOT))return;
    const sort=sortOf(chip.dataset.value||'');
    if(!['watched','notwatched'].includes(sort))return;
    event.preventDefault();event.stopImmediatePropagation();
    selectFilter(sort==='watched'?'watched':'unwatched');
  }
  document.addEventListener('click',activation,true);
  document.addEventListener('keydown',activation,true);
  function update(){
    frame=0;if(disposed)return;observer.disconnect();
    if(!style.isConnected)(document.head||document.documentElement).append(style);
    if(location.hash.startsWith('#/library')){
      const sort=sortOf(location.hash);
      if(sort==='watched'||sort==='notwatched'){
        state.filter=sort==='watched'?'watched':'unwatched';save();
        location.replace(normalRoute(location.hash,state.sort));
      }else if(SORTS.includes(sort)&&state.sort!==sort){state.sort=sort;save();}
    }
    for(const root of document.querySelectorAll(ROOT)){
      const chips=[...root.querySelectorAll('[data-value]')].filter(c=>['watched','notwatched'].includes(sortOf(c.dataset.value||'')));
      if(!chips.length)continue;
      if(!root.querySelector('.slp-filter-label')){
        const label=document.createElement('span');label.className='slp-filter-label';label.textContent='Filter';chips[0].before(label);
      }
      for(const chip of chips){
        if(!originalAttributes.has(chip))originalAttributes.set(chip,{title:chip.getAttribute('title'),role:chip.getAttribute('role'),'aria-pressed':chip.getAttribute('aria-pressed')});
        const filter=sortOf(chip.dataset.value)==='watched'?'watched':'unwatched';
        chip.dataset.libraryWatchFilter=filter;chip.setAttribute('role','button');
        chip.setAttribute('aria-pressed',String(state.filter===filter));
        chip.title=state.filter===filter?'Click again to show all titles':filter==='watched'?'Show only titles with a watched tick':'Show only titles without a watched tick';
      }
      const grid=root.querySelector('[class*="meta-items-container-"]');if(!grid)continue;
      let shown=0,total=0;
      for(const card of grid.querySelectorAll(CARD)){
        const visible=libraryMatches(!!card.querySelector('[class*="watched-icon-layer-"]'),state.filter);
        card.dataset.libraryHidden=String(!visible);total++;if(visible)shown++;
        if(!visible&&card.contains(document.activeElement))document.activeElement.blur();
      }
      let status=root.querySelector('.slp-library-status');
      if(!status){
        status=document.createElement('div');status.className='slp-library-status';
        const count=document.createElement('span');count.className='slp-library-count';count.setAttribute('aria-live','polite');
        const clear=document.createElement('button');clear.type='button';clear.className='slp-library-clear';clear.textContent='Clear filter';
        clear.addEventListener('click',()=>{state.filter='all';save();grid.scrollTop=0;update();});
        status.append(count,clear);grid.before(status);
      }
      status.hidden=state.filter==='all';status.style.display=state.filter==='all'?'none':'';
      status.querySelector('.slp-library-count').textContent=`${shown} of ${total} loaded${filling.has(grid)?' · Loading more…':''}`;
      if(state.filter!=='all'&&location.hash.startsWith('#/library')&&root.getBoundingClientRect().width&&grid.scrollHeight<=grid.clientHeight+250&&hasMore(root,grid))fillViewport(root,grid);
    }
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','href','data-value']});
  }
  const observer=new MutationObserver(schedule);
  function onStorage(e){if(e.key===KEY){try{const next=JSON.parse(e.newValue||'null');if(next&&['all','watched','unwatched'].includes(next.filter)){state.filter=next.filter;schedule();}}catch(_){}}}
  window.addEventListener('hashchange',schedule);window.addEventListener('storage',onStorage);
  window.__stremioLibraryPatch={version:VERSION,engine,state:()=>({...state}),dispose(){
    disposed=true;observer.disconnect();cancelAnimationFrame(frame);style.remove();
    document.removeEventListener('click',activation,true);document.removeEventListener('keydown',activation,true);
    window.removeEventListener('hashchange',schedule);window.removeEventListener('storage',onStorage);
    document.querySelectorAll('.slp-filter-label,.slp-library-status').forEach(e=>e.remove());
    document.querySelectorAll('[data-library-hidden]').forEach(e=>e.removeAttribute('data-library-hidden'));
    for(const [chip,attributes]of originalAttributes){chip.removeAttribute('data-library-watch-filter');for(const [key,value]of Object.entries(attributes))value===null?chip.removeAttribute(key):chip.setAttribute(key,value);}
    delete window.__stremioLibraryPatch;
  }};
  update();
})();
