importScripts('/offline/localforage.min.js','/offline/snapshot-engine.js','/offline/run-playback.js','/offline/journey-engine.js');
const VERSION='real-snapshot-20261028-v4';
const db=localforage.createInstance({name:'saiyan_browser_data',storeName:'records'});
const uploads=localforage.createInstance({name:'saiyan_browser_data',storeName:'media'});
const events=new BroadcastChannel('saiyan-browser-events');
const uuid=()=>crypto.randomUUID();
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const text=(data,status=200)=>new Response(data,{status,headers:{'Content-Type':'text/plain; charset=utf-8'}});
let snapshot,tasks=[],state,empty,journey;
let pending=Promise.resolve();
const pages=new Map();
const byTask=id=>tasks.find(t=>t.id===id);
const emit=(type,data)=>events.postMessage({type,data});
const botEmit=(event,data)=>emit('comfyart-bot',{event,...data});
const save=()=>db.setItem('state',structuredClone(state));
const fullTask=t=>structuredClone(t.fullTask);
const goal=t=>`创作主题\n${t.fullTask.themeTask||t.title}\n\n要完成什么\n${t.fullTask.creativeContent||''}\n\n最终交付物与提交要求\n${t.fullTask.finalSubmissionFormat||''}`;
async function projectId(taskId){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('saiyan:'+taskId));return 'pi-'+Array.from(new Uint8Array(data),b=>b.toString(16).padStart(2,'0')).join('');}
function shape(id,type,x,y,props,index='a1') {return {id:'shape:'+id,typeName:'shape',type,x,y,rotation:0,index,parentId:'page:page',isLocked:false,opacity:1,meta:{},props};}
function textShape(id,value,x,y,w=620,size=26,index='a1') {return shape(id,'ca-text',x,y,{w,h:600,text:value,font:'Arial',weight:400,size,color:'var(--ca-text)',stroke:'',align:'left',letter:0,line:1.3,autoSize:false,decoration:'none',transform:'none',rich:null},index);}
function makeSnapshot(t) {
 const value=structuredClone(empty),store=value.document.store;
 store['document:document'].name=t.title;
 store['document:document'].meta={competition:{title:t.title,goal:goal(t),fullTask:fullTask(t)}};
 const target=textShape('competition-goal','创作目标\n\n'+goal(t),80,80);store[target.id]=target;
 const generator=shape('starting-point','generator',780,80,{w:480,h:720,prompt:goal(t),ratio:'2:3',resolution:'1K',count:1,workflow:'saiyan-codex-image',duration:5,transparent:false,quality:'standard',style:'',cw:1024,ch:1536},'a2');store[generator.id]=generator;
 return value;
}
async function ensureProject(t) {
 const previous=Object.values(state.projects).find(p=>p.taskId===t.id);
 if(previous)return previous;
 const id=await projectId(t.id);
 state.projects[id]={id,name:t.title,updated:Date.now(),taskId:t.id,covers:[],snapshot:makeSnapshot(t)};
 state.handoffs[id]={projectId:id,title:t.title,goal:goal(t),fullTask:fullTask(t)};
 return state.projects[id];
}
function createChat(project,provider='codex') {const now=Date.now();const chat={id:uuid(),user:'visitor',project,title:'新对话',provider,run_mode:'auto',pinned:false,archived:false,busy:false,created_at:now,updated_at:now};state.chats[chat.id]=chat;state.messages[chat.id]=[];return chat;}
function message(chatId,role,value) {return {id:uuid(),chat_id:chatId,parent_id:null,role,blocks:[{type:'text',text:value}],status:'complete',usage:null,created_at:Date.now()};}
function makeRun(body){
 const now=new Date().toISOString(),sessionId=body.sessionId||uuid();
 const session=state.sessions[sessionId]||(state.sessions[sessionId]={id:sessionId,title:body.question||'发现竞赛',createdAt:now,updatedAt:now,runs:[]});
 if(session.runs.some(run=>RunPlayback.view(run).settled===false))throw new Error('请等待本轮完成，或先停止。');
 const result=SnapshotEngine.query(body.question||'',session.runs.at(-1));
 const artifacts=SnapshotEngine.artifacts(result.items);
 const run={runId:uuid(),sessionId,question:body.question||'查看竞赛任务',answer:result.answer,status:'completed',settled:true,createdAt:now,updatedAt:now,events:[],artifacts,
  usageAccounting:{status:'not_requested',knownTokens:0,unreportedRequests:0},_snapshotQuery:result.context,
  answerReview:{records:[...new Set(result.items.map(t=>t.competitionId))].map(competitionId=>({competitionId,revision:snapshot.competitions.find(c=>c.id===competitionId)?.revision})),reviewedAt:now,path:''}};
 if(artifacts.length)run.answerReview.candidateList={entries:artifacts.map(a=>({artifactId:a.id,competitionId:a.data.competitionId,title:a.title,taskCount:a.data.preview.tasks.length,status:'ready',markdown:'',facts:{}})),introduction:result.answer,footer:result.hasMore?'还有后续候选，可以继续询问。':''};
 if(result.items.length===1&&JourneyEngine.isTask(result.items[0]))run._preparedJourney=journey.id;
 RunPlayback.start(run);session.runs.push(run);session.updatedAt=now;state.runs[run.runId]=run;
 return run;
}
const projectEntry=p=>({id:p.id,name:p.name,updated:p.updated,covers:p.covers||[],pinned:!!p.pinned});
function taskForProject(id){return byTask(state.projects[id]?.taskId);}
function reply(t,input){return t?SnapshotEngine.reply(t,input):'先从发现竞赛选择一项任务，再围绕它推敲方案。';}
const ready=(async()=>{
 [empty,snapshot,journey]=await Promise.all([fetch('/offline/empty-canvas.json').then(r=>r.json()),fetch('/offline/snapshot.json',{cache:'no-cache'}).then(r=>r.json()),fetch('/offline/journey.json',{cache:'no-cache'}).then(r=>r.json())]);
 if(snapshot.version!==2||snapshot.today!=='2026-10-28')throw new Error('切片数据无法读取');
 tasks=snapshot.tasks;SnapshotEngine.initialize(snapshot);JourneyEngine.initialize(journey);
 const journeyTask=byTask(journey.taskId);if(!journeyTask?.ready||journey.assets.length!==3)throw new Error('创作流程资料尚未完整');
 journeyTask.imageAssets=journey.assets.map(asset=>asset.path);journeyTask.imageRole='prepared_iteration_images';
 const saved=await db.getItem('state');
 if(saved?.version===2&&saved.snapshotId===snapshot.id){state=saved;for(const original of snapshot.scenarios){const existing=state.sessions[original.id];if(!existing)state.sessions[original.id]=structuredClone(original);else for(const r of original.runs){const index=existing.runs.findIndex(old=>old.runId===r.runId);if(index>=0)existing.runs[index]=structuredClone(r);else existing.runs.unshift(structuredClone(r));}for(const r of state.sessions[original.id].runs)state.runs[r.runId]=r;}JourneyEngine.install(state);await save();return;}
 if(saved)await db.setItem('previous-experience-state-'+Date.now(),saved);
 state={version:2,snapshotId:snapshot.id,projects:{},handoffs:{},sessions:{},runs:{},chats:{},messages:{},files:{},settings:{'bot-provider':'codex','enable-bot':true,'generation-backend':'local'},jobs:{}};
 for(const seed of snapshot.seeds){
  state.projects[seed.id]={id:seed.id,name:seed.name,updated:seed.updated,taskId:seed.taskId,covers:seed.covers,snapshot:seed.snapshot};
  const t=byTask(seed.taskId);state.handoffs[seed.id]={projectId:seed.id,title:t.title,goal:goal(t),fullTask:fullTask(t)};
  for(const c of seed.chats){const chat=createChat(seed.id);chat.title=c.title;chat.created_at=c.createdAt||chat.created_at;chat.updated_at=c.updatedAt||chat.updated_at;state.messages[chat.id]=c.messages.map(m=>({...m,chat_id:chat.id,parent_id:null,usage:null}));}
 }
 // Old fabricated answers leave the active experience. Preserve their private
 // backup without mixing fictional entries into the real product slice.
 for(const session of snapshot.scenarios){state.sessions[session.id]=structuredClone(session);for(const run of state.sessions[session.id].runs)state.runs[run.runId]=run;}
 JourneyEngine.install(state);
 await save();
})();
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function bodyOf(request){const type=request.headers.get('content-type')||'';return /json/.test(type)?request.json():/multipart/.test(type)?request.formData():request.text();}
async function imageResponse(name){const blob=await uploads.getItem(name);if(blob)return new Response(blob,{headers:{'Content-Type':blob.type||'image/png'}});if(!/^(real-[a-f0-9]+|(?:proposal|journey)-[a-f0-9]{64})\.(png|svg|webp|jpg)$/.test(name))return json({error:'图片不存在'},404);return fetch('/media/'+name);}
function runStream(id,signal){
 let closed=false,lastRevision=-1;
 const encoder=new TextEncoder();
 const stream=new ReadableStream({
  async pull(controller){
   if(closed)return;
   if(signal.aborted){closed=true;controller.close();return;}
   const run=RunPlayback.view(state.runs[id]);
   const revision=run.presentation?.revision||0;
   if(revision!==lastRevision||run.settled!==false){
    lastRevision=revision;
    const type=run.settled===false?'snapshot':'final';
    controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({type,run,revision})}\n\n`));
   }
   if(run.settled!==false){closed=true;controller.close();return;}
   await new Promise(resolve=>setTimeout(resolve,120));
  },
  cancel(){closed=true;}
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store'}});
}
async function apiRoute(request,url,clientId){
  await ready;
  const path=decodeURIComponent(url.pathname);const method=request.method;const body=method==='GET'||method==='HEAD'?null:await bodyOf(request);
  if(path==='/__workbench/bootstrap')return json({projects:[],assets:[],files:[],competitionEngine:'pi',agent:{url:self.location.origin.replace(/^http/,'ws')+'/ws',token:''}});
  if(path==='/__workbench/competitions')return json({version:1,source:'library',sourceUrl:'',fetchedAt:null,items:snapshot.competitions.filter(c=>c.status==='items').map(c=>({id:c.id,title:c.title,sourceUrl:c.sourceUrl})),pending:snapshot.competitions.filter(c=>c.status==='pending'),recognizedNames:[],checking:false,updating:false});
  if(path==='/__workbench/pi/status')return json({oauth:{available:true},preset:{available:true},library:snapshot.library});
  if(path==='/__workbench/pi/sessions')return json({sessions:Object.values(state.sessions).map(s=>({id:s.id,title:s.title,createdAt:s.createdAt,updatedAt:s.updatedAt,runCount:s.runs.length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
  if(path.startsWith('/__workbench/pi/sessions/')){const session=state.sessions[path.split('/').at(-1)];return json(session?{...session,runs:session.runs.map(run=>RunPlayback.view(run))}:{id:path.split('/').at(-1),title:'新对话',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),runs:[]});}
  if(path==='/__workbench/pi/runs'&&method==='POST'){const run=makeRun(body);await save();return json(RunPlayback.view(run));}
  const runMatch=path.match(/^\/__workbench\/pi\/runs\/([^/]+)(?:\/(.*))?$/);
  if(runMatch){const run=state.runs[runMatch[1]];if(!run)return json({error:'记录不存在'},404);
   if(runMatch[2]==='stream'&&method==='GET')return runStream(run.runId,request.signal);
   if(runMatch[2]==='cancel'&&method==='POST'){
    const cancelled=structuredClone(RunPlayback.cancel(run));
    state.runs[run.runId]=cancelled;
    const session=state.sessions[run.sessionId];session.runs=session.runs.map(item=>item.runId===run.runId?cancelled:item);session.updatedAt=cancelled.updatedAt;
    await save();return json(cancelled);
   }
   return json(RunPlayback.view(run));}
  if(path==='/__workbench/pi/comfyart'&&method==='POST'){const run=state.runs[body.runId];const artifact=run?.artifacts.find(a=>a.id===body.artifactId);const t=tasks.find(t=>t.competitionId===artifact?.data?.competitionId&&t.scopePointer===body.scopePointer&&(t.choiceId||undefined)===(body.choiceId||undefined));if(!t||!t.ready||SnapshotEngine.expired(t))return json({error:'请重新选择可用任务'},400);const p=run._preparedJourney===journey.id&&state.projects[journey.project.id]?state.projects[journey.project.id]:await ensureProject(t);await save();return json({projectId:p.id,url:'/comfyart/?project='+p.id});}
  if(path.startsWith('/__workbench/pi/comfyart/handoffs/'))return json(state.handoffs[path.split('/').at(-1)]||{});
  if(path==='/api/settings/Comfy.Locale')return json('zh');
  if(path==='/api/view')return imageResponse(url.searchParams.get('filename')||'');
  if(path==='/comfyart/thumb'){const source=new URL(url.searchParams.get('url')||'/logo.svg',url.origin);return source.pathname==='/api/view'?imageResponse(source.searchParams.get('filename')||''):fetch(source.href);}
  if(path==='/api/upload/image'){const file=body.get('image');const name=uuid()+'.png';await uploads.setItem(name,file);return json({name,subfolder:'comfyart',type:'input'});}
  if(path==='/comfyart/model-paths')return json({});
  if(path==='/api/models/diffusion_models')return json([]);
  if(path==='/api/comfyart/instances')return json({instances:[]});
  if(path==='/api/comfyart/instances/status')return json({statuses:[]});
  if(path==='/api/comfyart/settings'){if(method!=='GET'){Object.assign(state.settings,body);await save();}return json(state.settings);}
  if(path==='/api/comfyart/bot/status')return json({enabled:true,user:'visitor',providers:[{id:'codex',label:'Codex',available:true,version:'',detail:'',logged_in:null,stateful:true,attachments:true,branch:true,models:[],model_options:[]}]});
  if(path==='/api/comfyart/projects')return json({projects:Object.values(state.projects).map(projectEntry)});
  const pm=path.match(/^\/api\/comfyart\/projects\/([^/]+)(?:\/(.*))?$/);
  if(pm){let p=state.projects[pm[1]];
    if(pm[2]==='versions'||pm[2]?.startsWith('versions/')){
      if(!p)return json({error:'作品不存在'},404);
      const versions=state.versions?.[p.id]||[];
      if(method==='GET'){
        if(pm[2]==='versions')return json({versions:versions.map(({time,count,label})=>({time,count,label})).sort((a,b)=>b.time-a.time)});
        const version=versions.find(version=>String(version.time)===pm[2].slice(9));
        return version?json(version.snapshot):json({error:'画布版本不存在'},404);
      }
      if(method==='POST'&&pm[2]==='versions'&&body.snapshot?.document?.store){
        let time=Date.now();while(versions.some(version=>version.time===time))time++;
        const version={time,count:Object.values(body.snapshot.document.store).filter(record=>record.typeName==='shape').length,snapshot:body.snapshot};
        state.versions||={};state.versions[p.id]=[...versions,version];await save();return json({time,count:version.count});
      }
      return json({error:'画布版本未保存，请保留当前内容。'},400);
    }
    if(pm[2]==='duplicate'&&p){const copy={...structuredClone(p),id:body.id,name:body.name,updated:Date.now()};state.projects[copy.id]=copy;await save();return json(projectEntry(copy));}
    if(method==='GET')return p?json(p.snapshot):json({error:'作品不存在'},404);
    if(method==='DELETE'){delete state.projects[pm[1]];await save();return json({});}
    const newImages=method==='PUT'?Object.values(body.snapshot?.document?.store||{}).filter(r=>r.typeName==='shape'&&r.type==='image'&&!p?.snapshot?.document?.store?.[r.id]).map(r=>r.id):[];
    if(method==='PUT'){p=state.projects[pm[1]]={...p,id:pm[1],name:body.name||p?.name||'新作品',snapshot:body.snapshot,covers:body.covers||[],updated:Date.now()};}
    if(method==='PATCH'&&p)Object.assign(p,body,{updated:Date.now()});await save();
    if(newImages.length)emit('comfyart-mcp-command',{id:uuid(),action:'focus',project:p.id,args:{ids:newImages}});
    return json(p?projectEntry(p):{});
  }
  if(path==='/api/comfyart/bot/chats'){
    if(method==='GET')return json({chats:Object.values(state.chats).filter(c=>c.project===url.searchParams.get('project'))});
    const chat=createChat(body.project,body.provider);await save();return json({chat});
  }
  const cm=path.match(/^\/api\/comfyart\/bot\/chats\/([^/]+)(?:\/(.*))?$/);
  if(cm){const chat=state.chats[cm[1]];if(!chat)return json({error:'对话不存在'},404);
    if(!cm[2]){if(method==='PATCH'){Object.assign(chat,body);await save();}if(method==='DELETE'){delete state.chats[chat.id];delete state.messages[chat.id];await save();return json({});}return json({chat,messages:state.messages[chat.id]||[]});}
    if(cm[2]==='send'||cm[2]==='log'){
      const t=taskForProject(chat.project);const user=message(chat.id,'user',body.text||'继续创作');
      const wantsImage=/生成.*图|画一|做.*图|设计.*海报|出.*图|帮我生成/.test(body.text||'');
      const prepared=cm[2]==='send'?JourneyEngine.response(t,body.text||''):null;
      const hasImage=!!t?.imageAssets?.length;const answer=message(chat.id,'assistant',prepared?.text||(wantsImage&&hasImage?(t.imageRole==='supplemental_proposal_sheet'?'我会把这项任务的构图草案放到画布，便于继续推敲。':'我会把这项任务已有的视觉方案放到画布，便于继续推敲。'):reply(t,body.text||'')));
      if(prepared?.asset)answer.blocks.push({type:'task',label:'海报版本 · V'+prepared.version,srcs:[prepared.asset],detail:{tool:'generate_image'}});
      if(cm[2]==='log')answer.blocks=body.blocks||[];
      state.messages[chat.id].push(user,answer);chat.title=chat.title==='新对话'?(body.text||'创作讨论').slice(0,24):chat.title;chat.updated_at=Date.now();await save();
      botEmit('messages_logged',{chat_id:chat.id,messages:[user,answer]});botEmit('chat_updated',{chat});
      if(prepared?.version){const project=state.projects[chat.project];const ids=Object.values(project?.snapshot?.document?.store||{}).filter(shape=>shape.typeName==='shape'&&shape.type==='image'&&project.snapshot.document.store[shape.props.assetId]?.props?.src===prepared.asset).map(shape=>shape.id);if(ids.length)emit('comfyart-mcp-command',{id:uuid(),action:'focus',project:chat.project,args:{ids}});}
      else if(cm[2]==='send'&&wantsImage&&hasImage)emit('comfyart-mcp-command',{id:uuid(),action:'generate_image',project:chat.project,chat:chat.id,args:{prompt:t.fullTask.creativeContent,ratio:'2:3',model:'saiyan-codex-image'}});
      return json({chat});
    }
    if(cm[2]==='branch'){const branch=createChat(chat.project,chat.provider);state.messages[branch.id]=structuredClone(state.messages[chat.id]).map(m=>({...m,chat_id:branch.id}));await save();return json({chat:branch,messages:state.messages[branch.id]});}
    if(cm[2].startsWith('messages/')){const m=state.messages[chat.id].find(m=>m.id===cm[2].slice(9));if(m)Object.assign(m,body);await save();return json({});}
    return json({});
  }
  if(path==='/api/comfyart/mcp_page'){pages.set(clientId,body.project);return json({ok:true});}
  if(path==='/api/comfyart/mcp_command_result')return json({ok:true});
  if(path==='/api/comfyart/saiyan-images'&&method==='POST'){
    const id=uuid();const promptId='codex:'+id;const projectId=pages.get(clientId)||new URL(request.referrer||self.location.origin).searchParams.get('project');const t=taskForProject(projectId);if(!t?.imageAssets?.length)return json({error:'这项任务还没有可展示的图片，可以先讨论方案。'},400);const index=Object.values(state.jobs).filter(j=>j.taskId===t.id).length%t.imageAssets.length;state.jobs[id]={promptId,taskId:t.id,asset:t.imageAssets[index].split('/').at(-1)};await save();emit('execution_success',{prompt_id:promptId});return json({prompt_id:promptId});
  }
  const jm=path.match(/^\/api\/comfyart\/saiyan-images\/([^/]+)/);
  if(jm){const job=state.jobs[jm[1]];return json(job?{[job.promptId]:{status:{completed:true,status_str:'success',messages:[]},outputs:{codex:{images:[{filename:job.asset,subfolder:'',type:'output'}]}}}}:{});}
  const userFile=path.match(/^\/api\/(?:comfyart\/)?userdata\/(.+)$/);
  if(userFile){const key=userFile[1];if(method==='GET')return key in state.files?text(state.files[key]):new Response(null,{status:204});if(method==='DELETE')delete state.files[key];else state.files[key]=typeof body==='string'?body:JSON.stringify(body);await save();return json({});}
  if(path==='/api/userdata')return json(Object.keys(state.files).filter(k=>k.startsWith(url.searchParams.get('dir')||'')));
  if(path==='/api/queue')return json({queue_running:[],queue_pending:[]});
  if(path==='/api/system_stats')return json({system:{os:'browser',python_version:'',comfyui_version:''},devices:[]});
  if(path.startsWith('/api/settings'))return json({});
  return json({error:'这项操作暂时无法完成，请保留当前内容。'},404);
}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin){event.respondWith(new Response('External connections disabled',{status:403}));return;}
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__workbench/')||url.pathname==='/comfyart/thumb'||url.pathname==='/comfyart/model-paths'){
    const work=pending.then(async()=>{await ready;const before=event.request.method==='GET'?null:structuredClone(state);try{return await apiRoute(event.request,url,event.clientId);}catch(error){if(before)state=before;throw error;}});pending=work.catch(()=>{});
    event.respondWith(work.catch(()=>json({error:'保存或读取未完成，请保留当前页面后重试。'},503)));return;
  }
  if(event.request.mode==='navigate'){
    const target=url.pathname.startsWith('/comfyart')?'/comfyart/index.html':'/index.html';
    event.respondWith(fetch(target,{cache:'no-store'}));return;
  }
  if(event.request.method==='GET')event.respondWith((async()=>{const cache=await caches.open(VERSION);const response=await fetch(event.request).catch(()=>cache.match(event.request));if(response?.ok)await cache.put(event.request,response.clone());return response||new Response('',{status:404});})());
});

// snapshot-data-sha256: dcc513ca5822d8a706f7df9235b1668a24e58943fa30bccbef68b5040c5b1447
// journey-data-sha256: 6aca1cdd2083adf60949a6b6bf69623e675daf480db848b2970fbf18df977585
