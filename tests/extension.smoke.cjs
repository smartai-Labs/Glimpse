// Real MV3 extension, isolated temporary Chromium profile; never connects to the user's browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const server = http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Glimpse fixture '+req.url+'</title><body style="background:#385340;color:#fff;font:24px sans-serif;padding:40px"><h1>Local preview fixture</h1><p>'+req.url+'</p></body>');});
async function until(label,fn,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(200);}throw Error('Timed out: '+label);}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port, extension=path.resolve(__dirname,'../dist');
  let context;
  try{
    context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,executablePath:process.env.GLIMPSE_CHROMIUM_PATH||undefined,
      viewport:{width:1080,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
    const id=new URL(worker.url()).host, version=await worker.evaluate(()=>chrome.runtime.getManifest().version);
    assert.equal(version,require('../package.json').version);
    const page=context.pages()[0]||await context.newPage();await page.goto(base+'/original');await page.bringToFront();
    const original=await until('browser tab',()=>worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url),base+'/original').catch(()=>null));
    assert(original.id!==undefined);
    await until('automatic screenshot',()=>worker.evaluate(async tabId=>{const state=await chrome.storage.session.get('glimpse:preview:'+tabId);return state['glimpse:preview:'+tabId]?.capturedAt>0;},original.id));
    const overview=await context.newPage();await overview.goto('chrome-extension://'+id+'/overview/index.html');
    const errors=[];overview.on('pageerror',error=>errors.push(error.message));
    await overview.locator('[data-tab-id="'+original.id+'"] .tab-screenshot').waitFor();
    const request=(action,payload={})=>overview.evaluate(message=>chrome.runtime.sendMessage(message),{type:'glimpse:preview-control',action,...payload});
    let result=await request('stats');assert(result.ok&&result.value.images>0,'real capture persisted');
    result=await request('settings',{settings:{paused:true,excludedHosts:[],hoverPreview:true}});assert(result.ok);
    const before=await worker.evaluate(async tabId=>(await chrome.storage.session.get('glimpse:preview:'+tabId))['glimpse:preview:'+tabId]?.capturedAt,original.id);
    await page.bringToFront();await page.evaluate(()=>document.body.click());await delay(1200);
    const after=await worker.evaluate(async tabId=>(await chrome.storage.session.get('glimpse:preview:'+tabId))['glimpse:preview:'+tabId]?.capturedAt,original.id);assert.equal(before,after,'pause preserves capture time');
    await overview.bringToFront();result=await request('settings',{settings:{paused:true,excludedHosts:['127.0.0.1'],hoverPreview:true}});assert(result.ok);
    result=await request('stats');assert.equal(result.value.images,0,'excluded host purges real Blob cache');
    await overview.locator('[data-tab-id="'+original.id+'"] .placeholder-status').getByText('已排除预览').waitFor();
    result=await request('settings',{settings:{paused:false,excludedHosts:[],hoverPreview:true}});assert(result.ok);
    await page.bringToFront();await until('recapture after resume',()=>worker.evaluate(async tabId=>(await chrome.storage.session.get('glimpse:preview:'+tabId))['glimpse:preview:'+tabId]?.capturedAt>0,original.id));
    await overview.bringToFront();
    const fixture=await worker.evaluate(async ({windowId,base,originalId})=>{
      const a=await chrome.tabs.create({windowId,url:base+'/group-a',active:false}),b=await chrome.tabs.create({windowId,url:base+'/group-b',active:false});
      const groupId=await chrome.tabs.group({tabIds:[a.id,b.id]});await chrome.tabGroups.update(groupId,{title:'Smoke group',color:'grey',collapsed:false});
      await chrome.tabs.update(originalId,{pinned:true});const target=await chrome.windows.create({url:base+'/destination',focused:false,type:'normal'});
      return {ids:[originalId,a.id,b.id],groupId,target:target.id};
    },{windowId:original.windowId,base,originalId:original.id});
    await overview.bringToFront();await overview.getByRole('button',{name:'多选',exact:true}).click();
    for(const tabId of fixture.ids)await overview.locator('[data-tab-id="'+tabId+'"]').getByRole('checkbox').click();
    await overview.getByRole('button',{name:'移动所选',exact:true}).click();
    let dialog=overview.getByRole('dialog',{name:'移动所选页面',exact:true});await dialog.getByLabel('目标窗口',{exact:true}).selectOption(String(fixture.target));
    await dialog.getByRole('button',{name:'移动页面',exact:true}).click();await dialog.waitFor({state:'detached'});
    const moved=await worker.evaluate(async ids=>Promise.all(ids.map(id=>chrome.tabs.get(id))),fixture.ids);
    assert(moved.every(tab=>tab.windowId===fixture.target));assert(moved[0].pinned);assert(moved[1].groupId===moved[2].groupId&&moved[1].groupId>=0,'group survives real cross-window move');
    const group=await worker.evaluate(groupId=>chrome.tabGroups.get(groupId),moved[1].groupId);assert.equal(group.title,'Smoke group');
    await overview.getByRole('button',{name:'取消',exact:true}).click();
    await worker.evaluate(async ({windowId,url})=>chrome.tabs.create({windowId,url,active:false}),{windowId:fixture.target,url:base+'/original'});
    await until('duplicate visible',()=>overview.locator('.tab-count').innerText().then(text=>parseInt(text)>=5));
    await overview.getByRole('button',{name:'更多选项',exact:true}).click();await overview.getByRole('button',{name:'检查重复页面',exact:true}).click();
    dialog=overview.getByRole('dialog',{name:'检查重复页面',exact:true});await dialog.locator('input:checked').waitFor();
    await dialog.getByRole('button',{name:'关闭所选副本',exact:true}).click();await dialog.waitFor({state:'detached'});
    await overview.getByRole('button',{name:/^撤销/}).click();await until('real undo',()=>worker.evaluate(async url=>(await chrome.tabs.query({})).filter(tab=>tab.url===url).length===2,base+'/original'));
    result=await request('clear');assert(result.ok);assert.equal(result.value.images,0);
    assert.deepEqual(errors,[]);
    console.log('PASS: real extension '+version+' on '+context.browser().version()+': auto capture, shared cache, pause/exclude/resume, pinned/group moves, duplicate close and native undo.');
  }finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
