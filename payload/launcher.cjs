'use strict';
// Runs only with Stremio. No downloads or account-data access.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const base = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(base, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
const exe = config.stremioExe;
const endpoint = 'http://127.0.0.1:19247';
const source = fs.readFileSync(path.join(base, 'hide-watched.js'), 'utf8');
const lock = net.createServer();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = e => fs.appendFileSync(path.join(base, 'launcher.log'), new Date().toISOString()+' '+String(e)+'\n');
async function pages() {
  const r = await fetch(endpoint+'/json/list', {signal:AbortSignal.timeout(2000)});
  return (await r.json()).filter(p => p.type==='page' && new URL(p.url).origin==='https://web.stremio.com');
}
async function attach(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{ws.close();reject(new Error('WebSocket connection timeout'));},5000);
    ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    ws.addEventListener('error',e=>{clearTimeout(timer);reject(e);},{once:true});
  });
  let id=0;
  async function command(method, params, sessionId) {
    const requestId=++id;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(()=>{ws.removeEventListener('message',onMessage);reject(new Error('CDP command timeout'));},5000);
      function onMessage(event) {
        const r=JSON.parse(event.data);
        if(r.id!==requestId) return;
        clearTimeout(timer);ws.removeEventListener('message',onMessage);
        if(r.error)reject(new Error(r.error.message));else resolve(r.result);
      }
      ws.addEventListener('message',onMessage);
      ws.send(JSON.stringify({id:requestId,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  const catalogRequests=new Map(), metadataCache=new Map();
  let dirty=false;
  async function flush() {
    if(!dirty || !metadataCache.size)return;
    const metas=[...metadataCache.values()];
    const result=await command('Runtime.evaluate',{expression:`Boolean(window.__stremioDiscoverPatch && (window.__stremioDiscoverPatch.ingest({metas:${JSON.stringify(metas)}}),true))`,returnByValue:true});
    if(result.result?.value)dirty=false;
  }
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data),p=message.params||{};
    if(message.method==='Target.attachedToTarget') {
      command('Network.enable',{},p.sessionId).catch(()=>{});
    } else if(message.method==='Page.frameNavigated') {
      dirty=true;
    } else if(message.method==='Network.responseReceived') {
      try {
        const url=new URL(p.response.url);
        if(/\/catalog\/[^/]+\/[^/]+(?:\/.*)?\.json$/.test(url.pathname) && p.response.status===200)catalogRequests.set(`${message.sessionId||''}:${p.requestId}`,message.sessionId);
      }catch(_){}
    } else if(message.method==='Network.loadingFinished') {
      const key=`${message.sessionId||''}:${p.requestId}`;
      if(!catalogRequests.has(key))return;
      const sessionId=catalogRequests.get(key);catalogRequests.delete(key);
      command('Network.getResponseBody',{requestId:p.requestId},sessionId).then(result=>{
        const body=JSON.parse(result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body);
        for(const m of body.metas||[])if(m.id&&m.type) {
          // Transfer only fields used by the filters, never URLs or account data.
          metadataCache.set(`${m.type}:${m.id}`,Object.fromEntries(['id','type','year','releaseInfo','released','imdbRating','popularity','popularities'].filter(k=>m[k]!==undefined).map(k=>[k,m[k]])));
        }
        dirty=true;return flush();
      }).catch(()=>{});
    } else if(message.method==='Network.loadingFailed') {
      catalogRequests.delete(`${message.sessionId||''}:${p.requestId}`);
    }
  });
  try {
    await command('Page.enable',{});
    await command('Network.enable',{});
    await command('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
    await command('Page.addScriptToEvaluateOnNewDocument',{source});
    const legacy = await command('Runtime.evaluate', {expression:'Boolean(window.__stremioWatchedFilter && !window.__stremioDiscoverPatch)',returnByValue:true});
    if (legacy.result?.value) {
      await command('Page.reload',{});
      return {ws,command,flush};
    }
    const result=await command('Runtime.evaluate',{expression:source});
    if(result.exceptionDetails)throw new Error('Filter script failed');
    return {ws,command,flush};
  } catch(e) { ws.close();throw e; }
}
lock.on('error', () => process.exit(0));
lock.listen(19248,'127.0.0.1',async()=>{
  const sessions=new Map();
  let child;
  try {
    let existing=[];
    try {existing=await pages();} catch(_) {}
    if(!existing.length) {
      child=spawn(exe,process.argv.slice(2),{cwd:path.dirname(exe),windowsHide:true,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19247 --remote-debugging-address=127.0.0.1'}});
      child.on('error',e=>{log(e);process.exit(1);});
    }
    let absent=0;
    while(absent<30) {
      try {
        const targets=await pages();
        absent=0;
        for(const page of targets) {
          const current=sessions.get(page.id);
          if(!current || current.ws.readyState!==WebSocket.OPEN) {
            const session=await attach(page);sessions.set(page.id,session);
          } else { await current.command('Runtime.evaluate',{expression:source}); await current.flush(); }
        }
        const active=new Set(targets.map(p=>p.id));
        for(const [id,session] of sessions) if(!active.has(id)){session.ws.close();sessions.delete(id);}
      } catch(_) { absent++; }
      await delay(1000);
    }
  } catch(e) {log(e);}
  finally {for(const session of sessions.values())session.ws.close();lock.close();process.exit(0);}
});
