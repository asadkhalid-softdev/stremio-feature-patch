(function bootstrap() {
  'use strict';
  const VERSION = '2.1.4';
  function number(value) {
    if (value == null || (typeof value === 'string' && !value.trim())) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function metadata(meta = {}) {
    let year = null;
    for (const value of [meta.releaseInfo, meta.year, meta.released]) {
      const match = String(value ?? '').match(/^(\d{4})(?:\D|$)/);
      if (match) { year = Number(match[1]); break; }
    }
    const rawRating = number(meta.imdbRating ?? meta.links?.find(link => link.category?.toLowerCase() === 'imdb')?.name);
    let popularity = null;
    for (const value of [meta.popularity, meta.popularities?.stremio, meta.popularities?.moviedb, meta.popularities?.trakt]) {
      const n = number(value);
      if (n !== null) { popularity = n; break; }
    }
    return {year, rating:rawRating !== null && rawRating >= 0 && rawRating <= 10 ? rawRating : null, popularity};
  }
  function matches(meta, state, watched = false) {
    return !(state.hideWatched && watched) &&
      (!state.year || meta.year === Number(state.year)) &&
      ((state.min === 0 && state.max === 10) ||
        (meta.rating !== null && meta.rating >= state.min && meta.rating <= state.max));
  }
  function compare(a, b, state) {
    if (state.sort === 'default') return a.index - b.index;
    const x = a.meta[state.sort], y = b.meta[state.sort];
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    if (x !== null && y !== null && x !== y) return (x - y) * (state.direction === 'asc' ? 1 : -1);
    return a.index - b.index;
  }
  function selectBatch(rows, limit) { return [...rows].sort((a,b)=>a.index-b.index).slice(0,limit); }
  const engine = {metadata, matches, compare, selectBatch};
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!document.documentElement) { document.addEventListener('DOMContentLoaded', bootstrap, {once:true}); return; }
  if (location.origin !== 'https://web.stremio.com') return;
  if (window.__stremioDiscoverPatch?.version === VERSION) return;
  window.__stremioDiscoverPatch?.dispose();
  // The original patch has no teardown. The launcher reloads once on upgrade.
  if (window.__stremioWatchedFilter && !window.__stremioDiscoverPatch) return;

  const ROOT = '[class*="discover-container-"]';
  const CARD = '[class*="meta-item-container-"]';
  const WATCHED = '[class*="watched-icon-layer-"]';
  const KEY = 'local.discover.filters.v2';
  const defaults = {hideWatched:false, year:'', min:0, max:10, sort:'default', direction:'desc'};
  let state = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) state = {...state, ...saved};
    else state.hideWatched = localStorage.getItem('local.discover.hideWatched.v1') === 'true';
  } catch (_) {}
  state.year = /^\d{4}$/.test(String(state.year)) ? String(state.year) : '';
  state.min = Math.max(0, Math.min(10, number(state.min) ?? 0));
  state.max = Math.max(state.min, Math.min(10, number(state.max) ?? 10));
  if (!['default','year','rating','popularity'].includes(state.sort)) state.sort = 'default';
  if (!['asc','desc'].includes(state.direction)) state.direction = 'desc';
  const cache = new Map(), requested = new Set(), pending = new Set();
  const batches = new Map();
  const originalFetch = window.fetch;
  let disposed = false, frame = 0, resourceObserver;
  function save() {
    // A control change is an explicit request to refresh and reorder the list.
    for(const [root,batch] of batches) {
      batch.snapshot.clear();
      const grid=root.querySelector('[class*="meta-items-container-"]');
      if(grid&&!batch.loading)grid.scrollTop=0;
    }
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }
  function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(update); }
  function catalogUrl(value) {
    try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) && /\/catalog\/[^/]+\/[^/]+(?:\/.*)?\.json$/.test(u.pathname); } catch (_) { return false; }
  }
  function ingest(body) {
    if (!Array.isArray(body?.metas)) return;
    for (const meta of body.metas) if (meta.id && meta.type) cache.set(`${meta.type}:${meta.id}`, metadata(meta));
    schedule();
  }
  function capture(response) {
    if (response.ok) response.clone().json().then(ingest).catch(() => {});
  }
  function readCatalog(root) {
    // Read only the catalog hook, not account/profile state. The core's worker
    // may have served a cached catalog without a fresh network request.
    const key=Object.keys(root).find(k=>k.startsWith('__reactFiber'));
    for(let fiber=root[key],level=0;fiber&&level<6;fiber=fiber.return,level++) {
      for(let hook=fiber.memoizedState,i=0;hook&&i<120;hook=hook.next,i++) {
        const value=hook.memoizedState;
        if(!value?.catalog || value.selected?.request?.path?.resource!=='catalog')continue;
        const metas=value.catalog.content?.content;
        if(Array.isArray(metas))for(const meta of metas) {
          const id=`${meta.type}:${meta.id}`, normalized=metadata(meta), existing=cache.get(id);
          cache.set(id,existing?Object.fromEntries(Object.keys(normalized).map(k=>[k,existing[k]??normalized[k]])):normalized);
        }
        const request=value.selected.request, path=request.path;
        try {
          const base=new URL(request.base);
          const extra=(path.extra||[]).map(e=>`${encodeURIComponent(e.name)}=${encodeURIComponent(e.value)}`).join('&');
          base.pathname=base.pathname.replace(/\/manifest\.json$/,'')+`/catalog/${encodeURIComponent(path.type)}/${encodeURIComponent(path.id)}`+(extra?'/'+extra:'')+'.json';
          base.search='';base.hash='';
          if(!requested.has(base.href)) {
            requested.add(base.href);
            originalFetch.call(window,base.href).then(capture).catch(()=>{});
          }
        } catch(_) {}
        return {key:JSON.stringify({...request,path:{...path,extra:(path.extra||[]).filter(e=>e.name!=='skip')}}),ready:Array.isArray(metas)};
      }
    }
  }
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function gridRows(grid) { return [...grid.children].filter(c=>c.matches(CARD)).map(cardInfo); }
  async function preload(root,batch) {
    if(batch.loading)return;
    batch.loading=true;batch.started=true;batch.snapshot.clear();schedule();
    const active=()=>!disposed && batches.get(root)===batch && location.hash.startsWith('#/discover');
    try {
      await delay(120);
      // Use Stremio's own pagination, preserving add-on offsets and watched state.
      // No more than 25 pages per user action, even for very small page sizes.
      for(let page=0;page<25&&active();page++) {
        const grid=root.querySelector('[class*="meta-items-container-"]');
        if(!grid)break;
        const count=gridRows(grid).length;
        if(count>=batch.limit) { await delay(400);break; }
        // Stremio latches its bottom-of-list callback until scrolling away.
        grid.scrollTop=0;grid.dispatchEvent(new Event('scroll'));
        grid.scrollTop=grid.scrollHeight;
        grid.dispatchEvent(new Event('scroll'));
        const start=Date.now();let lastTrigger=start;
        while(active()&&gridRows(grid).length<=count&&Date.now()-start<6000) {
          await delay(100);
          if(!active())break;
          // The DOM can update before the core releases its loading flag.
          // Retry its normal scroll signal after that transition settles.
          if(Date.now()-lastTrigger>600) {
            grid.scrollTop=0;grid.dispatchEvent(new Event('scroll'));
            grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event('scroll'));lastTrigger=Date.now();
          }
        }
        if(!active()||gridRows(grid).length<=count)break;
        await delay(300);
      }
    } finally {
      batch.loading=false;
      if(active()) {
        batch.complete=true;
        const grid=root.querySelector('[class*="meta-items-container-"]');
        if(grid){grid.scrollTop=0;for(const row of selectBatch(gridRows(grid),batch.limit))batch.snapshot.set(row.key,{...row.meta});}
        schedule();
      } else {batch.started=false;}
    }
  }
  function guardPagination(event) {
    const grid=event.target;
    if(!(grid instanceof Element)||!grid.matches('[class*="meta-items-container-"]'))return;
    const batch=batches.get(grid.closest(ROOT));
    // Scrolling through the settled batch must not start another native page.
    if(batch&&!batch.loading)event.stopImmediatePropagation();
  }
  document.addEventListener('scroll',guardPagination,true);
  function wrappedFetch(...args) {
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    const relevant = catalogUrl(url);
    if (relevant) requested.add(new URL(url, location.href).href);
    const result = originalFetch.apply(this, args);
    if (relevant) result.then(capture).catch(() => {});
    return result;
  }
  window.fetch = wrappedFetch;
  // Recover requests made before attachment. Later responses need no extra request.
  function recover(entries) {
    for (const entry of entries) {
      if (!catalogUrl(entry.name) || requested.has(entry.name) || pending.has(entry.name)) continue;
      requested.add(entry.name); pending.add(entry.name);
      originalFetch.call(window, entry.name).then(capture).catch(() => {}).finally(() => pending.delete(entry.name));
    }
  }
  try {
    resourceObserver = new PerformanceObserver(list => recover(list.getEntries()));
    resourceObserver.observe({type:'resource', buffered:true});
    recover(performance.getEntriesByType('resource'));
  } catch (_) {}

  const style = document.createElement('style');
  style.id = 'local-discover-filter-style';
  style.textContent = `
    ${ROOT} [data-discover-hidden="true"] { display:none !important; }
    ${ROOT} [data-discover-preloading="true"] { visibility:hidden; }
    ${ROOT} [class*="selectable-inputs-container-"]:has(.sfp-toolbar) { flex-wrap:wrap; height:auto !important; padding-bottom:16px; row-gap:12px; }
    .sfp-toolbar { flex:1 0 100%; display:flex; align-items:center; flex-wrap:wrap; gap:12px; color:#fff; font:inherit; min-width:0; }
    .sfp-toolbar * { box-sizing:border-box; }
    .sfp-control { display:flex; align-items:center; gap:10px; min-height:42px; padding:0 16px; border:1px solid transparent; border-radius:23px; background:rgba(255,255,255,.055); white-space:nowrap; }
    .sfp-toolbar input,.sfp-toolbar select,.sfp-toolbar button { font:inherit; color:inherit; }
    .sfp-toolbar input:focus-visible,.sfp-toolbar select:focus-visible,.sfp-toolbar button:focus-visible { outline:2px solid #b8a0ff; outline-offset:3px; }
    .sfp-watched { cursor:pointer; }
    .sfp-watched input { appearance:none; display:grid; place-content:center; width:18px; height:18px; margin:0; border:2px solid #a8a4ba; border-radius:50%; cursor:pointer; }
    .sfp-watched input:checked { border-color:#8256ff; background:#8256ff; }
    .sfp-watched input:checked::after { content:'✓'; color:white; font:bold 12px sans-serif; }
    .sfp-year input { width:57px; padding:4px 0; border:0; border-bottom:1px solid #69617d; border-radius:0; background:transparent; text-align:center; }
    .sfp-year input::placeholder { color:#a9a3ba; }
    .sfp-year input[aria-invalid="true"] { border-color:#ffb3bc; }
    .sfp-label { color:#c9c3d9; font-size:.9em; }
    .sfp-rating { gap:12px; }
    .sfp-range { position:relative; width:156px; height:30px; touch-action:none; }
    .sfp-track,.sfp-fill { position:absolute; height:4px; top:13px; border-radius:4px; background:#544b6b; left:0; right:0; }
    .sfp-fill { background:#946aff; }
    .sfp-range input { position:absolute; inset:0; width:100%; height:30px; margin:0; appearance:none; background:transparent; pointer-events:none; }
    .sfp-range input::-webkit-slider-thumb { appearance:none; width:16px; height:16px; background:#b799ff; border:2px solid #fff; border-radius:50%; pointer-events:auto; cursor:ew-resize; }
    .sfp-range input::-moz-range-thumb { width:13px; height:13px; background:#b799ff; border:2px solid #fff; border-radius:50%; pointer-events:auto; cursor:ew-resize; }
    .sfp-values { min-width:65px; text-align:right; font-variant-numeric:tabular-nums; font-size:.9em; }
    .sfp-sort { padding-right:5px; gap:8px; }
    .sfp-sort select { max-width:145px; border:0; background:transparent; padding:8px 1px; cursor:pointer; }
    .sfp-chevron { color:#aaa3ba; font-size:12px; pointer-events:none; }
    .sfp-sort option { color:white; background:#252039; }
    .sfp-direction { border:0; border-radius:50%; background:transparent; width:34px; height:34px; font-size:23px !important; cursor:pointer; }
    .sfp-direction:hover:enabled { background:rgba(255,255,255,.09); }
    .sfp-direction:disabled { opacity:.35; cursor:default; }
    .sfp-status { color:#b6aecb; font-size:.82em; }
    .sfp-more { border:1px solid #746097; border-radius:22px; min-height:36px; padding:0 13px; background:transparent; cursor:pointer; white-space:nowrap; }
    .sfp-more:hover:enabled { background:rgba(130,86,255,.15); }
    .sfp-more:disabled { opacity:.5; cursor:wait; }
    .sfp-toolbar [hidden] { display:none !important; }
    @media(max-width:850px) { .sfp-toolbar { gap:8px; } .sfp-control { padding:0 12px; } .sfp-range { width:120px; } }
  `;
  function buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'sfp-toolbar';
    bar.setAttribute('aria-label','Discover filters and sorting');
    bar.innerHTML = `<label class="sfp-control sfp-watched"><input type="checkbox" data-control="watched"><span>Hide watched</span></label>
      <label class="sfp-control sfp-year"><span class="sfp-label">Year</span><input data-control="year" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="Any" aria-label="Release year" title="Enter four digits, then press Enter or click outside. Empty means any year."></label>
      <div class="sfp-control sfp-rating"><span class="sfp-label">IMDb</span><div class="sfp-range"><div class="sfp-track"></div><div class="sfp-fill"></div><input data-control="min" type="range" min="0" max="10" step="0.1" aria-label="Minimum IMDb rating"><input data-control="max" type="range" min="0" max="10" step="0.1" aria-label="Maximum IMDb rating"></div><output class="sfp-values" aria-live="polite"></output></div>
      <div class="sfp-control sfp-sort"><span class="sfp-label">Sort by</span><select data-control="sort" aria-label="Sort by"><option value="default">Default</option><option value="year">Release year</option><option value="rating">IMDb rating</option><option value="popularity">Popularity</option></select><span class="sfp-chevron" aria-hidden="true">▾</span><button class="sfp-direction" type="button" aria-label="Sort descending" title="Descending">↓</button></div>
      <span class="sfp-status" aria-live="polite"></span><button type="button" class="sfp-more">Load 100 more</button>`;
    bar.addEventListener('keydown', e => e.stopPropagation());
    bar.querySelector('[data-control="watched"]').addEventListener('change', e => { state.hideWatched=e.target.checked; save(); update(); });
    const year = bar.querySelector('[data-control="year"]');
    year.value = state.year;
    year.addEventListener('input', () => {
      year.value = year.value.replace(/[^0-9]/g,'').slice(0,4);
      year.removeAttribute('aria-invalid'); year.setCustomValidity('');
    });
    function commitYear() {
      if (year.value && !/^\d{4}$/.test(year.value)) {
        year.setAttribute('aria-invalid','true');
        year.setCustomValidity('Enter exactly four digits, or leave empty.');
        year.title='Enter exactly four digits, or leave empty. The previous year filter is still active.';
        return;
      }
      year.removeAttribute('aria-invalid'); year.setCustomValidity('');
      year.title='Enter four digits, then press Enter or click outside. Empty means any year.';
      state.year=year.value; save(); update();
    }
    year.addEventListener('blur', commitYear);
    year.addEventListener('keydown', e => { if(e.key==='Enter') {e.preventDefault();commitYear();} });
    for (const key of ['min','max']) bar.querySelector(`[data-control="${key}"]`).addEventListener('input', e => {
      const n=Number(e.target.value);
      state[key]=key==='min'?Math.min(n,state.max):Math.max(n,state.min);
      save(); update();
    });
    const range=bar.querySelector('.sfp-range');
    range.addEventListener('pointerdown', e => {
      if(e.target.tagName==='INPUT')return;
      e.preventDefault();
      const rect=range.getBoundingClientRect();
      const n=Math.round(Math.max(0,Math.min(10,(e.clientX-rect.left)/rect.width*10))*10)/10;
      const key=Math.abs(n-state.min)<Math.abs(n-state.max)?'min':'max';
      state[key]=key==='min'?Math.min(n,state.max):Math.max(n,state.min);
      bar.querySelector(`[data-control="${key}"]`).focus();save();update();
    });
    bar.querySelector('[data-control="sort"]').addEventListener('change', e => { state.sort=e.target.value;save();update(); });
    bar.querySelector('.sfp-direction').addEventListener('click', () => {state.direction=state.direction==='asc'?'desc':'asc';save();update();});
    bar.querySelector('.sfp-more').addEventListener('click',()=>{
      const root=bar.closest(ROOT),batch=batches.get(root);
      if(!batch||batch.loading)return;
      const grid=root.querySelector('[class*="meta-items-container-"]');
      batch.limit=Math.min(batch.limit,grid?gridRows(grid).length:0)+100;
      batch.complete=false;preload(root,batch);
    });
    return bar;
  }
  const initialIndices=new WeakMap();
  let nextIndex=0;
  function cardInfo(card) {
    const link=card.querySelector('a[href^="#/detail/"]');
    const parts=link?.getAttribute('href').split('/') || [];
    let key='';
    try {key=`${decodeURIComponent(parts[2])}:${decodeURIComponent(parts[3])}`;} catch (_) {}
    const rawIndex=link?.getAttribute('data-index');
    if(!initialIndices.has(card))initialIndices.set(card,nextIndex++);
    const index=rawIndex!==null&&rawIndex!==undefined&&Number.isFinite(Number(rawIndex))?Number(rawIndex):initialIndices.get(card);
    return {card,key,index,meta:cache.get(key)||metadata(),watched:!!card.querySelector(WATCHED),known:cache.has(key)};
  }
  function update() {
    frame=0;
    if(disposed)return;
    observer.disconnect();
    if(!style.isConnected)(document.head||document.documentElement).append(style);
    for(const root of document.querySelectorAll(ROOT)) {
      const catalog=readCatalog(root);
      let batch=batches.get(root);
      if(catalog&&(!batch||batch.key!==catalog.key)) {
        batch={key:catalog.key,limit:100,loading:false,started:false,complete:false,snapshot:new Map()};batches.set(root,batch);
      }
      if(batch&&catalog?.ready&&!batch.started&&location.hash.startsWith('#/discover')&&root.getBoundingClientRect().width)preload(root,batch);
      const host=root.querySelector('[class*="selectable-inputs-container-"]');
      if(!host)continue;
      let bar=host.querySelector('.sfp-toolbar');
      if(!bar){bar=buildToolbar();host.append(bar);}
      bar.querySelector('[data-control="watched"]').checked=state.hideWatched;
      for(const key of ['min','max','sort'])bar.querySelector(`[data-control="${key}"]`).value=state[key];
      const year=bar.querySelector('[data-control="year"]');
      if(document.activeElement!==year && !year.hasAttribute('aria-invalid'))year.value=state.year;
      bar.querySelector('.sfp-fill').style.left=`${state.min*10}%`;
      bar.querySelector('.sfp-fill').style.right=`${100-state.max*10}%`;
      bar.querySelector('[data-control="min"]').style.zIndex=state.min>=9.5?'2':'0';
      bar.querySelector('.sfp-values').value=`${state.min.toFixed(1)}–${state.max.toFixed(1)}`;
      const direction=bar.querySelector('.sfp-direction');
      direction.disabled=state.sort==='default';
      direction.textContent=state.sort==='default'?'↕':state.direction==='asc'?'↑':'↓';
      const directionText=state.direction==='asc'?'Ascending':'Descending';
      direction.setAttribute('aria-label',state.sort==='default'?'Catalog order':`Sort ${directionText.toLowerCase()}`);
      direction.title=state.sort==='default'?'Default preserves the catalog order':directionText;
      let total=0,shown=0;
      for(const grid of root.querySelectorAll('[class*="meta-items-container-"]')) {
        const allRows=gridRows(grid);
        const admitted=new Set(selectBatch(allRows,batch?.limit??100).map(row=>row.card));
        const rows=allRows;
        grid.dataset.discoverPreloading=String(Boolean(batch?.loading));
        if(batch&&!batch.loading)for(const row of rows) {
          if(!batch.snapshot.has(row.key))batch.snapshot.set(row.key,{...row.meta});
          row.meta=batch.snapshot.get(row.key);
        }
        rows.sort((a,b)=>compare(a,b,state));
        for(const [rank,row] of rows.entries()) {
          const visible=batch?.loading||admitted.has(row.card)&&matches(row.meta,state,row.watched);
          if(!visible && row.card.contains(document.activeElement))document.activeElement.blur();
          row.card.dataset.discoverHidden=String(!visible);
          if(state.sort==='default'||batch?.loading)row.card.style.removeProperty('order');else row.card.style.order=rank;
          if(admitted.has(row.card)){total++;if(visible)shown++;}
        }
      }
      const status=bar.querySelector('.sfp-status');
      status.textContent=batch?.loading?`Loading ${batch.limit} results…`:`${shown} of ${total} results`;
      status.title='The current batch stays fixed while you browse. Load more explicitly to expand and re-sort from the top.';
      const more=bar.querySelector('.sfp-more');
      more.disabled=!batch||batch.loading;
      more.textContent=batch?.loading?'Loading…':'Load 100 more';
      more.title='Load up to 100 more results, reapply filters and sorting, and return to the top';
    }
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','href','data-index']});
  }
  const observer=new MutationObserver(schedule);
  function onStorage(e) {if(e.key===KEY){try{state={...defaults,...JSON.parse(e.newValue||'null')};schedule();}catch(_){}}}
  window.addEventListener('hashchange',schedule);
  window.addEventListener('storage',onStorage);
  window.__stremioDiscoverPatch={version:VERSION, engine, state:()=>({...state}), cacheSize:()=>cache.size, ingest,
    dispose() {
      disposed=true;observer.disconnect();resourceObserver?.disconnect();cancelAnimationFrame(frame);
      document.removeEventListener('scroll',guardPagination,true);
      window.removeEventListener('hashchange',schedule);window.removeEventListener('storage',onStorage);
      if(window.fetch===wrappedFetch)window.fetch=originalFetch;
      style.remove();document.querySelectorAll('.sfp-toolbar').forEach(e=>e.remove());
      document.querySelectorAll('[data-discover-hidden]').forEach(e=>{e.removeAttribute('data-discover-hidden');e.style.removeProperty('order');});
      document.querySelectorAll('[data-discover-preloading]').forEach(e=>e.removeAttribute('data-discover-preloading'));
      delete window.__stremioDiscoverPatch;
    }};
  update();
})();
