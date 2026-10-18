const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../src/lib/organizeTabs.ts')], bundle: true, format: 'iife', globalName: 'Organize', write: false }).outputFiles[0].text;
function fixture() {
  const tab = (id, windowId, index, extra={}) => ({ id, windowId, index, title: 'Page '+id, url: 'https://example.test/'+id, groupId: -1, pinned: false, active: false, incognito: windowId === 4, ...extra });
  const state = { tabs: [tab(1,1,0),tab(2,1,1,{groupId:10}),tab(3,1,2,{groupId:10}),tab(4,2,0,{pinned:true}),tab(5,4,0)], windows: [1,2,4].map(id=>({id,type:'normal',incognito:id===4})), moves: [], removed: [], sessions: [], fail: new Set(), next: 100 };
  const get = async id => { const tab=state.tabs.find(tab=>tab.id===id); if(!tab)throw Error('gone');return {...tab}; };
  const query = async (filter={}) => state.tabs.filter(tab=>Object.entries(filter).every(([key,value])=>tab[key]===value)).map(tab=>({...tab}));
  const move = async (ids, target, group=false) => { for(const id of ids) { if(state.fail.has(id))throw Error('failed'); }
    for(const id of ids){ const tab=state.tabs.find(tab=>tab.id===id), window=state.windows.find(w=>w.id===target.windowId); assert.equal(!!tab.incognito,!!window.incognito);
      if(tab.pinned)assert.equal(target.index,state.tabs.filter(t=>t.windowId===target.windowId&&t.pinned).length);
      tab.windowId=target.windowId; if(!group){tab.groupId=-1;tab.pinned=false;} }
    state.moves.push({ids,target,group}); return get(ids[0]); };
  const chrome={ runtime:{getURL:()=> 'chrome-extension://glimpse/'}, tabs:{get,query,update:async(id,changes)=>{Object.assign(state.tabs.find(tab=>tab.id===id),changes);return get(id);},move:(id,props)=>move([id],props),remove:async id=>{const tab=await get(id);state.tabs=state.tabs.filter(t=>t.id!==id);state.removed.push(id);state.sessions.unshift({tab:{...tab,sessionId:'closed-'+id}});}},
    windows:{getAll:async()=>state.windows,get:async id=>{const w=state.windows.find(w=>w.id===id);if(!w)throw Error('Window gone');return w;},create:async options=>{const id=state.next++,blank=state.next++;const w={id,type:'normal',incognito:!!options.incognito};state.windows.push(w);state.tabs.push(tab(blank,id,0,{url:'about:blank',incognito:!!options.incognito}));return {...w,tabs:[await get(blank)]};}},
    tabGroups:{move:async(id,props)=>move(state.tabs.filter(t=>t.groupId===id).map(t=>t.id),props,true)},sessions:{getRecentlyClosed:async()=>state.sessions}};
  const context=vm.createContext({chrome,crypto,Date,setTimeout,clearTimeout});vm.runInContext(code,context);
  return {api:context.Organize,state,chrome};
}
(async()=>{
  let f=fixture();let selected=f.state.tabs.slice(0,3).map(tab=>({...tab}));
  assert.equal(f.api.partialGroupCount(selected,f.state.tabs),0);
  let result=await f.api.moveTabs(selected.map(tab=>({tab,target:2})),()=>{});
  assert.equal(result.moved,3);assert.equal(result.failedIds.length,0);assert.deepEqual(f.state.moves.find(m=>m.group).ids,[2,3]);
  assert.equal(f.state.tabs.find(t=>t.id===4).pinned,true);
  f=fixture();selected=[{...f.state.tabs[1]}];assert.equal(f.api.partialGroupCount(selected,f.state.tabs),1);
  result=await f.api.moveTabs(selected.map(tab=>({tab,target:2})),()=>{});
  assert.equal(result.moved,1);assert.equal(f.state.tabs.find(t=>t.id===2).groupId,-1);assert.equal(f.state.tabs.find(t=>t.id===3).windowId,1,'unselected group member stays');
  f=fixture();result=await f.api.moveTabs([{tab:{...f.state.tabs[3]},target:1}],()=>{});assert.equal(result.moved,1);assert.equal(f.state.tabs.find(t=>t.id===4).pinned,true);
  f=fixture();result=await f.api.moveTabs([{tab:{...f.state.tabs[4]},target:1}],()=>{});assert.equal(result.failedIds.length,1);assert.equal(f.state.moves.length,0,'private tabs cannot cross context');
  f=fixture();selected=f.state.tabs.map(tab=>({...tab}));result=await f.api.moveTabs(selected.map(tab=>({tab,target:'new'})),()=>{});
  assert.equal(result.moved,5);assert.equal(f.state.windows.length,5,'mixed selection creates separate normal/private windows');assert(f.state.moves.some(m=>m.group));assert(f.state.tabs.every(t=>t.url!=='about:blank'),'only owned placeholders removed');
  f=fixture();selected=[{...f.state.tabs[0]}];f.state.tabs[0].windowId=2;result=await f.api.moveTabs(selected.map(tab=>({tab,target:4})),()=>{});assert.equal(result.failedIds.length,1);assert.equal(f.state.moves.length,0);
  f=fixture();result=await f.api.moveTabs([{tab:{...f.state.tabs[0]},target:999}],()=>{});assert.equal(result.failedIds.length,1,'vanished destination');
  f=fixture();f.state.fail.add(2);result=await f.api.moveTabs(f.state.tabs.slice(0,3).map(tab=>({tab:{...tab},target:2})),()=>{});assert.equal(result.moved,1);assert.deepEqual(Array.from(result.failedIds),[2,3]);
  f=fixture();selected=f.state.tabs.slice(1,3).map(tab=>({...tab}));f.state.tabs.push({...f.state.tabs[1],id:9});result=await f.api.moveTabs(selected.map(tab=>({tab,target:2})),()=>{});assert.equal(f.state.tabs.find(t=>t.id===9).windowId,1,'new group arrivals never swept in');
  f=fixture();selected=[{...f.state.tabs[0]}];f.state.tabs=f.state.tabs.filter(t=>t.id!==1);result=await f.api.moveTabs(selected.map(tab=>({tab,target:2})),()=>{});assert.equal(result.skipped,1);
  f=fixture();const url='https://same.test/path?q=1#hash';f.state.tabs.forEach(tab=>{tab.url=url;});f.state.tabs[0].pinned=true;f.state.tabs[1].audible=true;
  const groups=f.api.duplicateGroups(f.state.tabs);assert.equal(groups.length,1,'private single copy stays separate');assert.equal(groups[0].keepId,1);assert.deepEqual(Array.from(groups[0].suggestedIds),[3],'pinned and audible copies never default-selected');
  assert.equal(f.api.duplicateGroups([{...f.state.tabs[0],url:url+'x'},f.state.tabs[1]]).length,0,'query and hash differences preserved');
  selected=f.state.tabs.slice(0,4).map(tab=>({...tab}));result=await f.api.closeDuplicateTabs(selected,()=>{});assert.equal(result.closed.length,3);assert.equal(result.failedIds.length,1,'always retains last same-context copy');
  f=fixture();f.state.tabs[0].url=url;f.state.tabs[1].url=url;selected=[{...f.state.tabs[1]}];f.state.tabs[1].url='https://changed.test';result=await f.api.closeDuplicateTabs(selected,()=>{});assert.equal(result.closed.length,0,'navigated duplicate never closed');
  f=fixture();f.state.tabs[0].url=url;f.state.tabs[1].url=url;selected=[{...f.state.tabs[1]}];f.state.tabs[1].audible=true;result=await f.api.closeDuplicateTabs(selected,()=>{});assert.equal(result.closed.length,0,'newly playing copy is retained');
  f=fixture();f.state.tabs[0].url=url;f.state.tabs[1].url=url;selected=[{...f.state.tabs[1]}];f.chrome.sessions.getRecentlyClosed=async()=>{f.state.tabs[1].url='https://late-navigation.test';return[];};result=await f.api.closeDuplicateTabs(selected,()=>{});assert.equal(result.closed.length,0,'validation happens after asynchronous undo lookup');
  console.log('PASS: explicit move scope, whole/partial groups, pinned/private/new windows, destination/race/partial failures, duplicate matching/protected defaults and close-time guards.');
})().catch(error=>{console.error(error);process.exitCode=1;});
