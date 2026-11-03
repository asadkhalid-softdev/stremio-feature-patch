// Optional integration test: open a paused video and its subtitle menu first.
// Imports a temporary, generated SRT through the real file picker, checks the
// native delay buttons, and restores the previous subtitle selection afterward.
// Stremio may retain the unselected test track until the current video closes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
(async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'stremio-subtitles-test-'));
  const file=path.join(folder,'Local subtitle check.srt');
  fs.writeFileSync(file,'1\n00:00:01,000 --> 00:00:04,000\nLocal subtitle check.\n\n2\n00:03:29,000 --> 00:03:40,000\nLocal subtitle delay check.\n','utf8');
  let ws,id=0,initialized=false,chooserResolve;
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function command(method,params){
    const request=++id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ws.removeEventListener('message',receive);reject(new Error('CDP timeout'));},18000);
      const receive=event=>{const r=JSON.parse(event.data);if(r.id!==request)return;clearTimeout(timer);ws.removeEventListener('message',receive);r.error?reject(new Error(r.error.message)):resolve(r.result);};
      ws.addEventListener('message',receive);ws.send(JSON.stringify({id:request,method,params}));
    });
  }
  async function evaluate(expression,userGesture=false){
    const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  }
  async function loaded(){
    for(let i=0;i<130;i++){
      const result=await evaluate(`(()=>{const p=window.__stremioLocalSubtitles,v=p.findPlayer()?.api.state;const track=v?.extraSubtitlesTracks.find(t=>t.id===v.selectedExtraSubtitlesTrackId);return {local:track?.local===true,label:track?.label,delay:v?.extraSubtitlesDelay,status:document.querySelector('.ssp-subtitle-status')?.textContent,error:document.querySelector('.ssp-subtitle-status')?.dataset.error}})()`);
      if(result.error==='true')throw new Error(result.status);
      if(result.local&&result.label==='Local subtitle check.srt'&&result.status?.startsWith('Loaded '))return result;
      await wait(100);
    }
    throw new Error('Local subtitle did not load');
  }
  async function clickDelay(side){
    const point=await evaluate(`(()=>{const list=document.querySelector('[class*="subtitles-menu-container-"] [class*="settings-list-"]');const step=[...list.children].find(e=>e.className.includes('stepper-'));const buttons=[...step.querySelectorAll('[tabindex]')];const b=buttons[${side==='plus'?1:0}];if(b.classList.contains('disabled'))throw new Error('Native delay control disabled');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    await wait(180);
    return evaluate('window.__stremioLocalSubtitles.findPlayer().api.state.extraSubtitlesDelay');
  }
  try{
    const page=(await(await fetch('http://127.0.0.1:19247/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith('https://web.stremio.com/'));
    assert(page,'Open Stremio first');ws=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.method==='Page.fileChooserOpened')chooserResolve?.(r.params);});
    await evaluate(`(()=>{const p=window.__stremioLocalSubtitles,v=p?.findPlayer()?.api.state;if(!v||!document.querySelector('.ssp-subtitle-file'))throw new Error('Open the subtitle menu on a paused video first');if(v.paused!==true)throw new Error('Pause playback before running this test');window.__localSubtitleCheck={embedded:v.subtitlesTracks.find(t=>t.id===v.selectedSubtitlesTrackId)||null,extra:v.extraSubtitlesTracks.find(t=>t.id===v.selectedExtraSubtitlesTrackId)||null,delay:v.extraSubtitlesDelay,time:v.time,paused:v.paused};})()`);
    initialized=true;
    await command('Page.enable',{});await command('Page.setInterceptFileChooserDialog',{enabled:true});
    const chooser=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('File picker did not open')),5000);chooserResolve=value=>{clearTimeout(timer);resolve(value);};});
    await evaluate(`document.querySelector('.ssp-load-subtitles').click()`,true);
    const picker=await chooser;
    await command('DOM.setFileInputFiles',{files:[file],backendNodeId:picker.backendNodeId});
    const local=await loaded();assert.equal(typeof local.delay,'number');
    console.log('Real .srt file picker loaded and selected a native Local subtitle track');
    const plus=await clickDelay('plus');assert(plus>local.delay,'Native plus button must increase local subtitle delay');
    const minus=await clickDelay('minus');assert(minus<plus,'Native minus button must decrease local subtitle delay');
    console.log('Existing Delay + and − buttons change the uploaded subtitle delay');
    const invalid=await evaluate(`(async()=>{const p=window.__stremioLocalSubtitles,before=p.findPlayer().api.state.selectedExtraSubtitlesTrackId;let rejected=false;try{await p.loadFile(new File(['not subtitles'],'invalid.txt'));}catch(_){rejected=true;}return rejected&&p.findPlayer().api.state.selectedExtraSubtitlesTrackId===before;})()`);
    assert(invalid,'Invalid upload must preserve current subtitles');console.log('Invalid file rejected without replacing current subtitle selection');
  }finally{
    if(ws?.readyState===WebSocket.OPEN){
      if(initialized){
        await evaluate(`(()=>{const s=window.__localSubtitleCheck,p=window.__stremioLocalSubtitles,a=p?.findPlayer()?.api,m=p?.menuProps();if(!s||!a)return;if(s.embedded){if(m)m.onSubtitlesTrackSelected(s.embedded);else a.setSubtitlesTrack(s.embedded.id);}else if(s.extra){if(m)m.onExtraSubtitlesTrackSelected(s.extra);else a.setExtraSubtitlesTrack(s.extra.id);}else {if(m)m.onExtraSubtitlesTrackSelected(null);else a.setExtraSubtitlesTrack(null);}if(s.delay!==null){if(m)m.onExtraSubtitlesDelayChanged(s.delay);else a.setSubtitlesDelay(s.delay);}if(a.state.paused!==s.paused||a.state.time!==s.time)throw new Error('Playback changed during integration test');delete window.__localSubtitleCheck;})()`);
        console.log('Original subtitle selection restored; playback stayed paused at the same position');
      }
      await command('Page.setInterceptFileChooserDialog',{enabled:false});ws.close();
    }
    if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(folder);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
