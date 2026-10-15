// These records live inside the authenticated main administrator's session DO.
// A launch is consumed atomically; logging out deletes its launches and gates.
export const OWNER_ADMIN_ORIGIN='https://snaptvnow-resellers.juancanta89.chatgpt.site';
const denied=()=>Response.json({error:'bridge_owner_access'},{status:403});
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u0020\u007f]/.test(value);
export async function ownerAccessState(storage,path,body,exp,admin,now=Date.now()){
 if(!admin||!Number.isFinite(exp)||exp<=now)return denied();
 return storage.transaction(async tx=>{
  const value=await tx.get('owner-access')||{launches:[],gates:[],window:0,count:0};
  value.launches=value.launches.filter(x=>x.exp>now);value.gates=value.gates.filter(x=>x.exp>now&&x.idle>now);
  if(path==='/owner-access/issue'){
   const window=Math.floor(now/60000);if(value.window!==window){value.window=window;value.count=0;}
   if(value.count>=6)return Response.json({error:'owner_launch_limited'},{status:429,headers:{'Retry-After':'60'}});
   value.count++;const launch={nonce:crypto.randomUUID(),exp:Math.min(exp,now+120000)};value.launches.push(launch);value.launches=value.launches.slice(-6);await tx.put('owner-access',value);return Response.json({ok:true,...launch});
  }
  if(!identity(body.identityId))return denied();
  if(path==='/owner-access/consume'){
   const at=value.launches.findIndex(x=>x.nonce===body.nonce);if(at<0)return denied();
   value.launches.splice(at,1);const gate={id:crypto.randomUUID(),identityId:body.identityId,exp:Math.min(exp,now+1800000),idle:now+900000};value.gates.push(gate);value.gates=value.gates.slice(-5);await tx.put('owner-access',value);return Response.json({ok:true,gateId:gate.id,exp:gate.exp});
  }
  const gate=value.gates.find(x=>x.id===body.gateId&&x.identityId===body.identityId);if(!gate)return denied();
  if(path==='/owner-access/revoke')value.gates=value.gates.filter(x=>x!==gate);
  else if(path==='/owner-access/check')gate.idle=now+900000;
  else return denied();
  await tx.put('owner-access',value);return Response.json({ok:true,exp:gate.exp});
 });
}
export function createOwnerAdminAccess({ticket,unticket,sessionCall}){
 return {
  async issue(env,session){
   const r=await sessionCall(env,session.sid,'/owner-access/issue',{});if(!r.ok)return r;
   const launch=await r.json(),code=await ticket(env,{kind:'owner_launch',sid:session.sid,nonce:launch.nonce,exp:launch.exp});
   return Response.json({ok:true,url:OWNER_ADMIN_ORIGIN+'/api/owner-access?code='+encodeURIComponent(code)},{headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  },
  async bridge(env,action,body){
   if(!identity(body.identityId)||typeof body.token!=='string'||body.token.length>2000)return denied();
   const value=await unticket(env,body.token),consume=action==='owner.consume';
   if(!value||value.kind!==(consume?'owner_launch':'owner_gate')||!consume&&value.identityId!==body.identityId)return denied();
   const path=consume?'/owner-access/consume':action==='owner.check'?'/owner-access/check':action==='owner.revoke'?'/owner-access/revoke':null;if(!path)return denied();
   const r=await sessionCall(env,value.sid,path,{nonce:value.nonce,gateId:value.gateId,identityId:body.identityId});if(!r.ok)return r;
   const result=await r.json();if(!consume)return Response.json(result);
   const token=await ticket(env,{kind:'owner_gate',sid:value.sid,gateId:result.gateId,identityId:body.identityId,exp:result.exp});
   return Response.json({ok:true,token,exp:result.exp});
  }
 };
}
