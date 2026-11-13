import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DEFAULT_POLICY,PROFILES,validatePolicy,validateCatalog,selectedChannel,publicChannel} from './policy.mjs';
import {startEncoder} from './encoder.mjs';

class PilotError extends Error {constructor(code,status=400){super(code);this.status=status;}}
const error=(code,status)=>{throw new PilotError(code,status);};
const equal=(a,b)=>{const x=createHash('sha256').update(a).digest(),y=createHash('sha256').update(b).digest();return timingSafeEqual(x,y);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') error('json_required',415);
  let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>32768)error('body_too_large',413);}
  try{return JSON.parse(text);}catch{error('invalid_json',400);}
}
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};

export async function createPilot({adminToken,grantSecret=adminToken,catalog=[],allowedOrigins=[],demo=false,policyFile=null,
  initialPolicy=DEFAULT_POLICY,logoPath=null,ffmpeg='ffmpeg',threads=2,fps=30,now=Date.now,encoder=startEncoder,sweepMs=1000,startTimeoutMs=20000}={}) {
  if (typeof adminToken!=='string'||!/^[-_A-Za-z0-9]{32,256}$/.test(adminToken)||typeof grantSecret!=='string'||grantSecret.length<32) throw Error('private_tokens_required');
  const channels=validateCatalog(catalog,{demo,allowedOrigins}),byId=new Map(channels.map(c=>[c.id,c]));
  let policy=validatePolicy(initialPolicy),closed=false,queue=Promise.resolve();
  if (policyFile) try{policy=validatePolicy(JSON.parse(await readFile(policyFile,'utf8')));}catch(e){if(e.code!=='ENOENT')throw Error('policy_read_failed');}
  const root=await mkdtemp(path.join(os.tmpdir(),'snaptvnow-live-'));
  const jobs=new Map(),cooldown=new Map();let starts=0;
  const transaction=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  const stop=async id=>{const job=jobs.get(id);if(!job)return;job.stopping=true;try{await job.ready?.catch(()=>{});await job.process?.stop();}finally{jobs.delete(id);}};
  const sign=payload=>{const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');return encoded+'.'+createHmac('sha256',grantSecret).update(encoded).digest('base64url');};
  const grant=id=>sign({aud:'owner-pilot',id,revision:policy.revision,exp:now()+600000,nonce:randomBytes(12).toString('hex')});
  const verify=(value,id)=>{
    if(typeof value!=='string'||value.length>1000)error('preview_required',401);
    const parts=value.split('.');if(parts.length!==2||!equal(parts[1],createHmac('sha256',grantSecret).update(parts[0]).digest('base64url')))error('preview_required',401);
    let p;try{p=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{error('preview_required',401);}
    if(!p||p.aud!=='owner-pilot'||p.id!==id||p.revision!==policy.revision||!Number.isSafeInteger(p.exp)||p.exp<=now()||p.exp>now()+600000)error('preview_expired',401);
  };
  const ensure=async id=>transaction(async()=>{
    if(closed)error('pilot_stopping',503);
    const channel=byId.get(id);if(!channel||!selectedChannel(policy,channel,now()))error('channel_not_selected',403);
    const prior=jobs.get(id);if(prior&&!prior.stopping&&!prior.process?.exited){prior.touched=now();return prior;}
    if(prior)await stop(id);
    if((cooldown.get(id)||0)>now())error('encoder_retry_later',503);
    if(jobs.size>=policy.maxChannels)error('channel_limit',503);
    const job={id,touched:now(),startedAt:now(),startupUntil:now()+startTimeoutMs,directory:path.join(root,createHash('sha256').update(id).digest('hex')),stopping:false};
    jobs.set(id,job);starts++;
    job.ready=encoder({channel,policy,directory:job.directory,logoPath,ffmpeg,threads,fps,onExit:result=>{if(!result.stopped)cooldown.set(id,now()+15000);}}).then(process=>{job.process=process;return process;});
    try{await job.ready;}catch{jobs.delete(id);await rm(job.directory,{recursive:true,force:true});cooldown.set(id,now()+15000);error('encoder_unavailable',503);}
    return job;
  });
  const sweep=()=>transaction(async()=>{for(const [id,job]of jobs){if(job.process?.exited||now()>=job.startupUntil&&now()-job.touched>=policy.idleSeconds*1000||!selectedChannel(policy,byId.get(id),now()))await stop(id);}});
  const timer=setInterval(()=>sweep().catch(()=>{}),sweepMs);timer.unref();
  const server=http.createServer(async(req,res)=>{
    try {
      const u=new URL(req.url,'http://private');
      if (req.method==='GET'&&u.pathname==='/health') return json(res,200,{ok:true,mode:'private-pilot',customerRouting:false});
      if (u.pathname.startsWith('/api/')) {
        if (!equal(req.headers.authorization||'','Bearer '+adminToken)) error('admin_required',401);
        if (req.headers.origin && req.headers.origin!=='http://'+req.headers.host && req.headers.origin!=='https://'+req.headers.host) error('origin_not_allowed',403);
      }
      if(req.method==='GET'&&['/','/panel.js','/panel.css'].includes(u.pathname)) {
        const name=u.pathname==='/'?'panel.html':u.pathname.slice(1),type=name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'text/css';
        res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});
        return res.end(await readFile(new URL(name,import.meta.url)));
      }
      if(req.method==='GET'&&u.pathname==='/api/config')return json(res,200,{policy,catalog:channels.map(publicChannel),customerRouting:false});
      if(req.method==='GET'&&u.pathname==='/api/status')return json(res,200,{mode:'private-pilot',customerRouting:false,starts,maxChannels:policy.maxChannels,active:[...jobs.values()].map(j=>({id:j.id,state:j.process?.exited?'failed':j.stopping?'stopping':'running',startedAt:j.startedAt,lastRequestAt:j.touched})),host:{cpuCount:os.availableParallelism(),load:os.loadavg(),memoryBytes:os.totalmem()}});
      if(req.method==='PUT'&&u.pathname==='/api/config') {
        const input=await body(req);
        const result=await transaction(async()=>{
          let proposed;try{proposed=validatePolicy(input.policy);}catch(e){error(e.message,400);}
          if(input.expectedRevision!==policy.revision||proposed.revision!==policy.revision)error('edit_conflict',409);
          if(proposed.channels.some(id=>!byId.has(id))||proposed.categories.some(id=>!channels.some(c=>c.categoryId===id)))error('unknown_selection',400);
          if(proposed.enabled&&proposed.logo&&!logoPath)error('logo_required',400);
          const next={...proposed,revision:policy.revision+1};
          if(policyFile){const temporary=policyFile+'.tmp';await mkdir(path.dirname(policyFile),{recursive:true});await writeFile(temporary,JSON.stringify(next)+'\n',{mode:0o600});await rename(temporary,policyFile);}
          policy=next;for(const id of [...jobs.keys()])await stop(id);
          return {ok:true,policy,customerRouting:false};
        });return json(res,200,result);
      }
      if(req.method==='POST'&&u.pathname==='/api/preview') {
        const input=await body(req),channel=byId.get(input.channelId);
        if(!channel||!selectedChannel(policy,channel,now()))error('channel_not_selected',403);
        return json(res,200,{url:`/hls/${channel.id}/master.m3u8?token=${grant(channel.id)}`,expiresInSeconds:600,customerRouting:false});
      }
      const m=u.pathname.match(/^\/hls\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,79})\/(master\.m3u8|[01]\/(?:index\.m3u8|seg\d{9,15}\.ts))$/);
      if(!m||!['GET','HEAD'].includes(req.method))error('not_found',404);
      const [,id,asset]=m,token=u.searchParams.get('token');
      verify(token,id);
      if(!selectedChannel(policy,byId.get(id),now()))error('channel_not_selected',403);
      // HEAD, stale segments and random paths must not start or keep an encoder alive.
      if(req.method==='HEAD') {
        if(!jobs.has(id))error('not_ready',404);
        res.writeHead(200,{'Content-Type':asset.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl','Cache-Control':'no-store'});return res.end();
      }
      const job=asset==='master.m3u8'?await ensure(id):jobs.get(id);
      if(!job||job.stopping)error('not_ready',404);
      const revision=policy.revision;
      if(asset==='master.m3u8') {
        const deadline=Date.now()+startTimeoutMs;
        while(!await job.process.mediaReady()){
          if(job.stopping||job.process.exited||revision!==policy.revision||!selectedChannel(policy,byId.get(id),now())||Date.now()>=deadline)error('encoder_not_ready',503);
          await wait(100);
        }
      }
      // Recheck after async startup/file IO: a disable or expired grant takes effect immediately.
      verify(token,id);
      if(job.stopping||revision!==policy.revision||!selectedChannel(policy,byId.get(id),now()))error('preview_expired',401);
      let data;
      if(asset==='master.m3u8') data=Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n'+policy.profiles.map((id,i)=>{const p=PROFILES[id];return `#EXT-X-STREAM-INF:BANDWIDTH=${Math.ceil((p.videoKbps+p.audioKbps)*1100)},RESOLUTION=${p.width}x${p.height}\n${i}/index.m3u8?token=${token}\n`;}).join(''));
      else {
        if(Number(asset[0])>=policy.profiles.length)error('not_found',404);
        try{data=await readFile(path.join(job.directory,asset));}catch{error('not_found',404);}
        if(asset.endsWith('.m3u8'))data=Buffer.from(data.toString().split('\n').map(line=>/^seg\d{9,15}\.ts$/.test(line)?line+'?token='+token:line).join('\n'));
      }
      verify(token,id);if(job.stopping||revision!==policy.revision)error('preview_expired',401);
      job.touched=now();job.startupUntil=0;res.writeHead(200,{'Content-Type':asset.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl','Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
    } catch(e) {
      if(!res.headersSent)json(res,e instanceof PilotError?e.status:503,{error:e instanceof PilotError?e.message:'pilot_unavailable'});else res.destroy();
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  return {server,root,sweep,async close(){closed=true;clearInterval(timer);server.closeAllConnections();if(server.listening)await new Promise(r=>server.close(r));await transaction(async()=>{for(const id of [...jobs.keys()])await stop(id);});await rm(root,{recursive:true,force:true});}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const demo=process.argv.includes('--demo'),adminToken=process.env.SNAP_PILOT_ADMIN_TOKEN,port=Number(process.env.PORT||8789);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('invalid_port');
  const catalog=demo?[{id:'demo-sports',name:'SNAPTVNOW - señal de prueba',categoryId:'demo',categoryName:'Prueba privada',demo:true}]:JSON.parse(await readFile(process.env.SNAP_PILOT_CATALOG_FILE,'utf8'));
  const pilot=await createPilot({adminToken,grantSecret:process.env.SNAP_PILOT_GRANT_SECRET||adminToken,catalog,demo,
    allowedOrigins:(process.env.SNAP_PILOT_ALLOWED_ORIGINS||'').split(',').filter(Boolean),policyFile:process.env.SNAP_PILOT_POLICY_FILE||null,
    logoPath:process.env.SNAP_PILOT_LOGO_FILE||null,threads:Number(process.env.SNAP_PILOT_THREADS||2),fps:Number(process.env.SNAP_PILOT_FPS||30)});
  pilot.server.listen(port,process.env.SNAP_PILOT_BIND||'127.0.0.1',()=>console.log(JSON.stringify({event:'pilot_listening',port,mode:'private-pilot',customerRouting:false})));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>pilot.close().then(()=>process.exit(0)));
}
