(function bootstrapLocalSubtitles() {
  'use strict';
  const VERSION='1.0.1',MAX_BYTES=10*1024*1024;
  function validateFileInfo(name,size) {
    if(typeof name!=='string'||!/\.srt$/i.test(name))throw new Error('Choose a .srt subtitle file.');
    if(!Number.isFinite(size)||size<=0)throw new Error('The subtitle file is empty.');
    if(size>MAX_BYTES)throw new Error('Choose an SRT file smaller than 10 MB.');
  }
  function inspectSrt(name,buffer) {
    if(!(buffer instanceof ArrayBuffer))throw new Error('The subtitle file could not be read.');
    validateFileInfo(name,buffer.byteLength);
    const bytes=new Uint8Array(buffer);
    const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';
    // Inspect timing syntax only. Original bytes go to Stremio unchanged so its
    // own subtitle decoder, styling, selection, and delay remain in charge.
    const text=new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    const cue=/^[ \t]*(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{3})[ \t]*-->[ \t]*(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{3})[^\n]*\n([^\n]+(?:\n(?![ \t]*\n)[^\n]+)*)/gm;
    let count=0,match;
    while((match=cue.exec(text))) {
      const start=((Number(match[1])*60+Number(match[2]))*60+Number(match[3]))*1000+Number(match[4]);
      const end=((Number(match[5])*60+Number(match[6]))*60+Number(match[7]))*1000+Number(match[8]);
      if(end>start&&match[9].trim())count++;
    }
    if(!count)throw new Error('The file does not contain a valid SRT subtitle cue.');
    return {cueCount:count};
  }
  const engine={MAX_BYTES,validateFileInfo,inspectSrt};
  if(typeof module!=='undefined'&&module.exports)module.exports=engine;
  if(typeof window==='undefined'||typeof document==='undefined')return;
  if(!document.documentElement){document.addEventListener('DOMContentLoaded',bootstrapLocalSubtitles,{once:true});return;}
  if(location.origin!=='https://web.stremio.com'||window.__stremioLocalSubtitles?.version===VERSION)return;
  window.__stremioLocalSubtitles?.dispose();
  const PLAYER='[class*="player-container-"]',MENU='[class*="subtitles-menu-container-"]';
  let disposed=false,frame=0,busy=false,message='',isError=false,sessionStream=null,generation=0;
  let chooserContext=null,cancelPending=null;
  const style=document.createElement('style');style.id='local-subtitle-picker-style';
  style.textContent=`
    .ssp-local-subtitles{margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid rgba(255,255,255,.12);}
    .ssp-load-subtitles{width:100%;min-height:38px;padding:8px 12px;border:1px solid #8e6aca;border-radius:20px;background:rgba(130,86,255,.17);color:#fff;font:inherit;font-size:14px;cursor:pointer;}
    .ssp-load-subtitles:hover:enabled{background:rgba(130,86,255,.3);}
    .ssp-load-subtitles:focus-visible{outline:2px solid #c6b0ff;outline-offset:3px;}
    .ssp-load-subtitles:disabled{opacity:.55;cursor:wait;}
    .ssp-subtitle-status{margin-top:7px;color:#bcb4cd;font-size:12px;line-height:1.4;overflow-wrap:anywhere;max-height:5.6em;overflow:auto;}
    .ssp-subtitle-status[data-error="true"]{color:#ffb3bc;}
  `;
  function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(update);}
  function findPlayer() {
    if(!location.hash.startsWith('#/player'))return null;
    for(const root of document.querySelectorAll(PLAYER)) {
      const key=Object.keys(root).find(k=>k.startsWith('__reactFiber'));
      for(let f=root[key],depth=0;f&&depth<4;f=f.return,depth++)for(let h=f.memoizedState,i=0;h&&i<320;h=h.next,i++) {
        const api=h.memoizedState?.current;
        if(api?.state&&typeof api.addLocalSubtitles==='function'&&typeof api.setExtraSubtitlesTrack==='function'&&typeof api.setSubtitlesDelay==='function')return {root,api,stream:api.state.stream};
      }
    }
    return null;
  }
  function menuProps() {
    const menu=document.querySelector(MENU);if(!menu)return null;
    const key=Object.keys(menu).find(k=>k.startsWith('__reactFiber'));
    for(let f=menu[key],depth=0;f&&depth<5;f=f.return,depth++)if(typeof f.memoizedProps?.onExtraSubtitlesTrackSelected==='function')return f.memoizedProps;
    return null;
  }
  function supported(context) {
    return !!context?.stream&&context.api.state.manifest?.commands?.includes('addLocalSubtitles')&&context.api.state.manifest.external!==true;
  }
  function samePlayback(context) {
    const current=findPlayer();return !disposed&&current?.root===context.root&&current.stream===context.stream;
  }
  function nativeLoad(context,name,buffer,token) {
    const api=context.api,events=api.events;
    if(typeof events?.on!=='function'||typeof events?.off!=='function')return Promise.reject(new Error('This player cannot confirm local subtitle loading.'));
    const previousIds=new Set(api.state.extraSubtitlesTracks.map(t=>t.id));
    const previousEmbedded=api.state.subtitlesTracks.find(t=>t.id===api.state.selectedSubtitlesTrackId)||null;
    const previousExtra=api.state.extraSubtitlesTracks.find(t=>t.id===api.state.selectedExtraSubtitlesTrackId)||null;
    const delay=typeof api.state.extraSubtitlesDelay==='number'?api.state.extraSubtitlesDelay:0;
    return new Promise((resolve,reject)=>{
      let track=null,finished=false;
      const finish=(error)=>{
        if(finished)return;finished=true;clearTimeout(timeout);clearInterval(watch);
        events.off('extraSubtitlesTrackAdded',added);events.off('extraSubtitlesTrackLoaded',loaded);events.off('error',failed);
        if(cancelPending===cancel)cancelPending=null;
        if(error&&track&&samePlayback(context)) {
          const current=findPlayer().api;
          if(current.state.selectedExtraSubtitlesTrackId===track.id) {
            const props=menuProps();
            if(previousEmbedded) {
              if(props)props.onSubtitlesTrackSelected(previousEmbedded);else current.setSubtitlesTrack(previousEmbedded.id);
            } else if(previousExtra) {
              if(props)props.onExtraSubtitlesTrackSelected(previousExtra);else current.setExtraSubtitlesTrack(previousExtra.id);
            } else {
              if(props)props.onExtraSubtitlesTrackSelected(null);else current.setExtraSubtitlesTrack(null);
            }
            current.setSubtitlesDelay(delay);
          }
        }
        if(error)reject(error);else resolve({id:track.id,name});
      };
      const cancel=()=>finish(new Error('The video changed. Load your subtitle file again.'));
      const added=candidate=>{
        if(!candidate.local||previousIds.has(candidate.id))return;
        track=candidate;
        // Use the native selector to lock this choice against later add-on
        // responses. It also makes the normal Delay/Size/Position controls apply.
        const props=menuProps();
        if(props?.onExtraSubtitlesTrackSelected)props.onExtraSubtitlesTrackSelected(track);
        else api.setExtraSubtitlesTrack(track.id);
      };
      const loaded=candidate=>{
        if(!track||candidate.id!==track.id)return;
        const current=findPlayer();
        if(!samePlayback(context)||token!==generation){cancel();return;}
        const props=menuProps();
        if(props?.onExtraSubtitlesDelayChanged)props.onExtraSubtitlesDelayChanged(delay);
        else current.api.setSubtitlesDelay(delay);
        finish();
      };
      const failed=()=>{if(track)finish(new Error('Stremio could not load this subtitle file. Try another SRT file.'));};
      const timeout=setTimeout(()=>finish(new Error('Subtitle loading timed out. Try another SRT file.')),12000);
      const watch=setInterval(()=>{if(!samePlayback(context)||token!==generation)cancel();},150);
      cancelPending=cancel;
      events.on('extraSubtitlesTrackAdded',added);events.on('extraSubtitlesTrackLoaded',loaded);events.on('error',failed);
      try{api.addLocalSubtitles(name,buffer);}catch(_){failed();if(!track)finish(new Error('Stremio could not load this subtitle file.'));}
    });
  }
  async function loadFile(file,context=findPlayer()) {
    if(busy)throw new Error('A subtitle file is already loading.');
    try {
      validateFileInfo(file?.name,file?.size);
      if(!supported(context)||!samePlayback(context))throw new Error('Open a video in Stremio’s built-in player before loading subtitles.');
      busy=true;message='Loading local subtitles…';isError=false;update();
      const token=++generation,buffer=await file.arrayBuffer();
      if(!samePlayback(context)||token!==generation)throw new Error('The video changed. Load your subtitle file again.');
      inspectSrt(file.name,buffer);
      const loaded=await nativeLoad(context,file.name,buffer,token);
      message='Loaded '+file.name+'. Use the delay controls below.';return loaded;
    }catch(error){message=error.message||'The subtitle file could not be loaded.';isError=true;throw error;}
    finally{busy=false;schedule();}
  }
  function buildPanel() {
    const panel=document.createElement('div');panel.className='ssp-local-subtitles';
    const button=document.createElement('button');button.type='button';button.className='ssp-load-subtitles';button.textContent='Load .srt file';
    const input=document.createElement('input');input.type='file';input.accept='.srt,application/x-subrip';input.hidden=true;input.className='ssp-subtitle-file';input.setAttribute('aria-label','Choose an SRT subtitle file');
    const status=document.createElement('div');status.className='ssp-subtitle-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    button.addEventListener('click',()=>{chooserContext=findPlayer();input.value='';input.click();});
    input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)loadFile(file,chooserContext).catch(()=>{});});
    panel.addEventListener('mousedown',e=>{e.subtitlesMenuClosePrevented=true;e.stopPropagation();});
    panel.addEventListener('keydown',e=>e.stopPropagation());
    panel.append(button,input,status);return panel;
  }
  function update() {
    frame=0;if(disposed)return;observer.disconnect();
    if(!style.isConnected)(document.head||document.documentElement).append(style);
    const context=findPlayer();
    if(sessionStream!==context?.stream){
      sessionStream=context?.stream;generation++;cancelPending?.();message='';isError=false;
    }
    for(const menu of document.querySelectorAll(MENU)) {
      const list=menu.querySelector('[class*="settings-list-"]');if(!list)continue;
      let panel=menu.querySelector('.ssp-local-subtitles');
      if(!panel){panel=buildPanel();list.prepend(panel);}
      const button=panel.querySelector('button');button.disabled=busy||!supported(context);
      button.textContent=busy?'Loading…':'Load .srt file';
      const status=panel.querySelector('.ssp-subtitle-status');
      status.textContent=message||(supported(context)?'Local file · uses the delay controls below.':'Local subtitles are unavailable for this player.');
      status.dataset.error=String(isError);
    }
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  }
  const observer=new MutationObserver(schedule);
  window.addEventListener('hashchange',schedule);
  window.__stremioLocalSubtitles={version:VERSION,engine,loadFile,findPlayer,menuProps,dispose(){
    disposed=true;generation++;cancelPending?.();observer.disconnect();cancelAnimationFrame(frame);style.remove();
    window.removeEventListener('hashchange',schedule);document.querySelectorAll('.ssp-local-subtitles').forEach(e=>e.remove());
    delete window.__stremioLocalSubtitles;
  }};
  update();
})();
