// Read-only XUI reseller connector. Never logs credentials or modifies provider accounts.
const BASE="http://ccf.center:8444/NYzkggyG/";
const PANEL_PAGE_SIZE=1000,PANEL_MAX_PAGES=10;
const plain=s=>String(s||'').replace(/<[^>]*>/g,'').trim().replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
// Administrator metadata never contains a subscription password.
export function parseInventory(data,now=Date.now()){
 if(!Array.isArray(data?.data))throw Error('panel_format_changed');
 return data.data.flatMap(r=>{if(!Array.isArray(r)||r.length<12||!/^\d+$/.test(plain(r[0]))||!plain(r[1]))return [];
  const date=plain(r[11]).match(/^\d{4}-\d{2}-\d{2}/)?.[0],expiresAt=date?Date.parse(date+'T23:59:59Z'):null;
  const label=String(r[4]).match(/title=["']([^"']+)["']/)?.[1]||'';
  const status=(expiresAt&&expiresAt<now)||/expired/i.test(label)?'expired':/^active$/i.test(label)?'active':/disabled|banned|suspend/i.test(label)?'suspended':'unavailable';
  return [{id:plain(r[0]),username:plain(r[1]),status,expiresAt:Number.isFinite(expiresAt)?expiresAt:null,maxConnections:Math.min(3,Math.max(0,Number(plain(r[8]))||0)),reported:Math.max(0,Number(plain(r[7]))||0)}];
 });
}
export function parseLines(data,now=Date.now()){
 if(!Array.isArray(data?.data))throw Error('panel_format_changed');
 return data.data.flatMap(r=>{if(!Array.isArray(r)||r.length<12||!/^\d+$/.test(plain(r[0])))return [];
 const username=plain(r[1]),password=plain(String(r[2]).match(/class="table-trunc-copy-cell__text[^"]*"[^>]*title="([^"]+)"/)?.[1]||String(r[2]).match(/<span[^>]*class="table-trunc-copy-cell__text[^"]*"[^>]*>([^<]*)/)?.[1]||r[2]);
 const active=/title=["']Active["']/i.test(String(r[4]));const used=Number(plain(r[7])),max=Math.min(3,Number(plain(r[8])));const date=plain(r[11]).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
 if(!active||!username||!password||!Number.isFinite(used)||!Number.isInteger(max)||max<1||(date&&Date.parse(date+'T23:59:59Z')<now))return [];
 const expiresAt=date?Date.parse(date+'T23:59:59Z'):null;
 return [{id:plain(r[0]),username,password,maxConnections:max,external:used,expiresAt:Number.isFinite(expiresAt)?expiresAt:null}];});
}
export async function panelSession(username,password,base=BASE,options={}){
 base=validateServerUrl(base,true);
 const deadline=Date.now()+(options.timeoutMs||45000),fetcher=options.fetcher||fetch;
 let cookie='';async function request(path,body){let url=new URL(path,base),method=body?'POST':'GET';for(let i=0;i<5;i++){
  if(url.origin!==new URL(base).origin||!url.pathname.startsWith(new URL(base).pathname))throw Error('panel_redirect_denied');
  const remaining=deadline-Date.now();if(remaining<=0)throw new DOMException('Panel request deadline exceeded','TimeoutError');
  const r=await fetcher(url,{method,redirect:'manual',headers:{'User-Agent':'SnapMovieNow/1.0',...(cookie?{Cookie:cookie}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},...(body?{body}:{}),signal:AbortSignal.timeout(Math.min(12000,remaining))});
  const sc=r.headers.get('set-cookie');if(sc){const m=sc.match(/(?:^|,\s*)PHPSESSID=([^;]+)/);if(m)cookie='PHPSESSID='+m[1]}
  if([301,302,303,307,308].includes(r.status)){url=new URL(r.headers.get('location'),url);if([301,302,303].includes(r.status)){method='GET';body=undefined}continue}
  if(!r.ok)throw Object.assign(Error('panel_unavailable'),{failureCode:'http_error'});if(options.maxBytes){const reader=r.body?.getReader();if(!reader)return '';const parts=[];let size=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>options.maxBytes){await reader.cancel();throw Error('panel_response_size');}parts.push(chunk.value);}}finally{reader.releaseLock();}const raw=new Uint8Array(size);let at=0;for(const part of parts){raw.set(part,at);at+=part.byteLength;}return new TextDecoder().decode(raw);}return r.text();}throw Error('panel_redirect_failed');}
 await request('login');const text=await request('login',new URLSearchParams({username,password,login:'',referrer:''}).toString());
 if(/name=["']password["']/.test(text)||!text.includes('dashboard'))throw Error('panel_invalid');
 return {request,base};
}
function inventoryTotal(data){
 const raw=Object.hasOwn(data??{},'recordsFiltered')?data.recordsFiltered:data?.recordsTotal;
 const total=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
 if(!Number.isSafeInteger(total)||total<0||(total===0&&Number(data?.recordsTotal)>0))throw Error('panel_inventory_incomplete');
 if(total>PANEL_PAGE_SIZE*PANEL_MAX_PAGES)throw Error('panel_too_many_lines');
 return total;
}

export async function readPanel(username,password,base=BASE,options={}){
 const {request}=await panelSession(username,password,base);
 options.onProgress?.({receivedRows:null,acceptedRows:null});
 // Provider-side filters can exclude usable idle active lines. Read the full
 // authenticated inventory and validate status and expiry locally. Playback
 // also validates the selected account before use.
 // A replacement can revoke reservations. Reject any page whose contents
 // cannot account for every row in the reported inventory.
 const lines=[],inventory=[],seen=new Set(),now=Date.now();let total,start=0,receivedRows=0;
 const report=()=>options.onProgress?.({receivedRows,acceptedRows:lines.length});
 for(let page=0;page<PANEL_MAX_PAGES;page++){
  const query=new URLSearchParams({id:'lines',filter:'',reseller:'',draw:'1',start:String(start),length:String(PANEL_PAGE_SIZE),'search[value]':'','order[0][column]':'0','order[0][dir]':'asc'});
  const body=await request('table?'+query);
  let data;try{data=JSON.parse(body)}catch{throw Error('panel_format_changed')}
  if(Array.isArray(data?.data)){receivedRows+=data.data.length;report()}
  const count=inventoryTotal(data);total??=count;
  if(!Array.isArray(data.data)||count!==total||data.data.length>Math.min(PANEL_PAGE_SIZE,total-start)||(!data.data.length&&start<total))throw Error('panel_inventory_incomplete');
  const pageInventory=parseInventory(data,now),pageLines=parseLines(data,now),activeIds=new Set(pageLines.map(line=>line.id));
  if(pageInventory.length!==data.data.length)throw Error('panel_inventory_incomplete');
  for(const item of pageInventory){
   if(seen.has(item.id)||item.status==='unavailable'||(item.status==='active')!==activeIds.has(item.id))throw Error('panel_inventory_incomplete');
   seen.add(item.id);
  }
  lines.push(...pageLines);inventory.push(...pageInventory);start+=data.data.length;report();
  if(start===total)break;
 }
 if(start!==total)throw Error('panel_inventory_incomplete');
 if(!lines.length&&!options.inventory)throw Error('panel_no_active_lines');return options.inventory?{lines,inventory}:lines;
}

export function validateServerUrl(value,panel=false){
 let u;try{u=new URL(String(value))}catch{throw Error('invalid_server_url')}
 const h=u.hostname.toLowerCase();if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!h.includes('.')||h==='localhost'||h.endsWith('.local')||h.endsWith('.internal')||h.startsWith('[')||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h)||/^(?:0|10|127|169\.254|192\.168)\./.test(h)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(h))throw Error('invalid_server_url');
 if(!panel&&u.pathname!=='/')throw Error('invalid_server_url');if(panel){u.pathname=u.pathname.replace(/\/?$/,'/');return u.href}return u.origin;
}

export async function readPanelRecord(username,password,base,target){
 if(typeof target!=='string'||!/^[A-Za-z0-9_.@-]{3,80}$/.test(target))throw Error('panel_record_input');
 const session=await panelSession(username,password,base),rows=[];
 // Some provider tables ignore the DataTables search field. Scan every page and
 // match the exact username locally, as the normal inventory connector does.
 for(let start=0;start<10000;start+=1000){const query=new URLSearchParams({id:'lines',filter:'',reseller:'',draw:'1',start:String(start),length:'1000','search[value]':'','order[0][column]':'0','order[0][dir]':'asc'}),data=JSON.parse(await session.request('table?'+query));if(!Array.isArray(data.data))throw Error('panel_format_changed');rows.push(...data.data.filter(r=>Array.isArray(r)&&plain(r[1]).toLowerCase()===target.toLowerCase()));if(!data.data.length||data.data.length<1000||start+1000>=Number(data.recordsFiltered??data.recordsTotal))break;if(start===9000)throw Error('panel_too_many_lines');}
 if(rows.length!==1)throw Error(rows.length?'panel_record_ambiguous':'panel_record_missing');
 const row=rows[0],id=plain(row[0]);if(!/^\d+$/.test(id))throw Error('panel_record_format');
 const links=row.join(' ').matchAll(/href=["']([^"']+)["']/g);let detail;
 for(const match of links){const url=new URL(plain(match[1]),session.base),last=url.pathname.split('/').at(-1);if(url.origin===new URL(session.base).origin&&url.pathname.startsWith(new URL(session.base).pathname)&&['line','line.php','edit_line','edit_line.php'].includes(last)&&[url.searchParams.get('edit'),url.searchParams.get('id')].includes(id)&&[...url.searchParams.keys()].every(k=>['edit','id'].includes(k))){detail=url.pathname.slice(new URL(session.base).pathname.length)+url.search;break;}}
 if(!detail)throw Error('panel_record_detail');
 const form=await session.request(detail);if(/name=["']password["']/.test(form)&&!form.includes('max_connections')&&!form.includes('exp_date'))throw Error('panel_invalid');
 return {id,row,form,base:session.base};
}
