// Rotation is an allocation preference, never a timer that revokes playback.
// The caller owns authorization, atomic capacity and the safe playback boundary.
import {rankProviderCandidates,providerCircuitState} from './provider-health.mjs';

export const ROTATION_MIN_MS=24*3600000;
export const ROTATION_TARGET_MS=36*3600000;
export const ROTATION_MAX_MS=48*3600000;
const DAY_MS=24*3600000;
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000-366*DAY_MS;
const nonnegative=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const zones=new Map(),schedules=new Map();
function boundedCache(cache,key,value,maximum){if(cache.size>=maximum)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}

function canonicalTimezone(value){
 if(typeof value!=='string'||!value||value.length>100)return null;
 if(zones.has(value))return zones.get(value);
 try{return boundedCache(zones,value,new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone,128);}catch{return boundedCache(zones,value,null,128);}
}

// The first real start of a local calendar day also handles a DST transition
// at midnight. Binary search avoids assuming that every local day is 24 hours.
function nextLocalMidnight(at,timeZone){
 const format=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const localDate=time=>{
  const parts=Object.fromEntries(format.formatToParts(new Date(time)).filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,Number(p.value)]));
  return parts.year*10000+parts.month*100+parts.day;
 };
 const today=localDate(at);
 if(at>0&&localDate(at-1)!==today)return at;
 let low=at,high=at+2*DAY_MS;
 if(localDate(high)===today)return null;
 while(high-low>1){const middle=low+Math.floor((high-low)/2);if(localDate(middle)===today)low=middle;else high=middle;}
 return high;
}

export function logicalMediaKey(value){
 if(typeof value!=='string')return null;
 const [kind,server,id]=value.split('|');
 return ['live','movie','series'].includes(kind)&&server&&id?[kind,server,id].join('|'):null;
}

export function sameLogicalVod(previous,current){
 const first=logicalMediaKey(previous),second=logicalMediaKey(current);
 return !!first&&first===second&&/^(?:movie|series)\|/.test(first);
}

export function rotationPlan({binding,primary,now=Date.now(),timeZone,active=false,lastMediaKey,mediaKey}={}){
 const selectedAt=validTime(binding?.selectedAt)&&binding.selectedAt>0?binding.selectedAt:null;
 const zone=canonicalTimezone(binding?.timeZone)||canonicalTimezone(timeZone)||'UTC';
 const base={due:false,eligible:false,selectedAt,dueAt:null,preferredAt:null,targetAt:null,overdueAt:null,timeZone:zone,status:'unassigned',overdue:false};
 if(!primary||selectedAt===null||!validTime(now))return base;
 const cacheKey=selectedAt+'|'+zone;
 let schedule=schedules.get(cacheKey);
 if(!schedule){
  const dueAt=selectedAt+ROTATION_MIN_MS,targetAt=selectedAt+ROTATION_TARGET_MS,overdueAt=selectedAt+ROTATION_MAX_MS;
  const midnight=nextLocalMidnight(dueAt,zone),preferredAt=midnight!==null&&midnight<=targetAt?midnight:dueAt;
  schedule=boundedCache(schedules,cacheKey,{dueAt,preferredAt,targetAt,overdueAt},256);
 }
 const {dueAt,overdueAt}=schedule;
 const plan={...base,...schedule,overdue:now>=overdueAt};
 if(now<selectedAt)return {...plan,status:'clock-skew'};
 if(now<dueAt)return {...plan,status:'not-due'};
 const due={...plan,due:true};
 if(active)return {...due,status:'active-playback'};
 if(sameLogicalVod(lastMediaKey??binding?.lastMediaKey,mediaKey))return {...due,status:'same-title'};
 return {...due,eligible:true,status:'ready'};
}

function calendarMonthsAfter(now,months){
 const date=new Date(now),day=date.getUTCDate();
 date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
 const last=new Date(date.getTime());last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 date.setUTCDate(Math.min(day,last.getUTCDate()));return date.getTime();
}

function sourceIds(provider){
 const values=Array.isArray(provider?.sourceIds)?provider.sourceIds:typeof provider?.source==='string'?[provider.source]:[];
 return [...new Set(values.filter(value=>typeof value==='string'&&value.length>0))].sort();
}

const sameProvider=(a,b)=>!!a&&!!b&&(String(a.id)===String(b.id)||!!a.key&&!!b.key&&a.key===b.key);
const countFor=(counts,id)=>nonnegative(counts instanceof Map?counts.get(String(id)):counts?.[String(id)]);
const occupancy=(provider,counts)=>Number.isFinite(provider.occupied)?Math.max(0,provider.occupied):nonnegative(provider.external)+countFor(counts,provider.id);
const finiteExpiry=provider=>Number.isFinite(Number(provider?.expiresAt))&&Number(provider.expiresAt)>0?Number(provider.expiresAt):null;
const usable=(provider,now)=>provider&&(!provider.status||provider.status==='active')&&(!provider.expiresAt||!Number.isFinite(Number(provider.expiresAt))||Number(provider.expiresAt)>now);

function sourceLoads(lines,counts,normalOnly,normalAfter,now,server,health,mediaKey){
 const physical=new Map();
 for(const line of lines){
  if(!usable(line,now)||String(line.server||'ccf')!==server||normalOnly&&!(finiteExpiry(line)>=normalAfter)||providerCircuitState(health,line.id,mediaKey,now).blocked||health?.['account|'+line.id]?.busyUntil>now)continue;
  const capacity=nonnegative(line.maxConnections);if(!capacity)continue;
  const identity=line.key||String(line.id),old=physical.get(identity),sources=sourceIds(line);
  if(old){old.capacity=Math.min(old.capacity,capacity);old.occupied=Math.max(old.occupied,occupancy(line,counts));old.sources=[...new Set([...old.sources,...sources])];}
  else physical.set(identity,{capacity,occupied:occupancy(line,counts),sources});
 }
 const totals=new Map();
 for(const row of physical.values())for(const source of row.sources){
  // A credential shared by multiple panels remains one physical capacity row.
  const share=row.sources.length,total=totals.get(source)||{occupied:0,capacity:0};
  total.occupied+=row.occupied/share;total.capacity+=row.capacity/share;totals.set(source,total);
 }
 return totals;
}

export function rankRotationCandidates(candidates,{primary,lines=candidates,counts=new Map(),health={},mediaKey='',now=Date.now()}={}){
 if(!Array.isArray(candidates)||!validTime(now))return [];
 const available=candidates.filter(provider=>usable(provider,now)&&!providerCircuitState(health,provider.id,mediaKey,now).blocked&&!(health?.['account|'+provider.id]?.busyUntil>now)&&(!Number.isFinite(provider.maxConnections)||occupancy(provider,counts)<provider.maxConnections));
 const twoMonths=calendarMonthsAfter(now,2);
 const normal=available.filter(provider=>finiteExpiry(provider)>=twoMonths);
 let preferred=normal.length?normal:available;
 const alternatives=preferred.filter(provider=>!sameProvider(provider,primary));
 if(alternatives.length)preferred=alternatives;
 const previousSources=sourceIds(primary),different=preferred.filter(provider=>{const sources=sourceIds(provider);return previousSources.length&&sources.length&&!sources.some(source=>previousSources.includes(source));});
 if(different.length)preferred=different;
 const ranked=rankProviderCandidates(preferred,health,mediaKey,now),order=new Map(ranked.map((provider,index)=>[provider,index]));
 const loads=sourceLoads(Array.isArray(lines)?lines:available,counts,normal.length>0,twoMonths,now,String(preferred[0]?.server||'ccf'),health,mediaKey);
 const load=provider=>{
  const values=sourceIds(provider).map(source=>loads.get(source)).filter(total=>total?.capacity>0).map(total=>total.occupied/total.capacity);
  return values.length?Math.min(...values):null;
 };
 return [...ranked].sort((a,b)=>{
  const first=load(a),second=load(b);
  // Unknown membership is not an empty/new panel and gains no load advantage.
  const balance=first!==null&&second!==null?first-second:0;
  // Existing health/capacity ranking already prefers the later expiry when
  // conditions are equal; an unproven three-month account cannot displace a
  // proven two-month account solely because its date is farther away.
  return balance||order.get(a)-order.get(b);
 });
}
