const KEY='admin-login-alert';
const WINDOW=5*60_000;
const DAY=24*60*60_000;
const THRESHOLD=10;

// One account, one aggregate. Neither submitted names nor client addresses
// enter this record. The most recent alert survives the start of a new window.
export async function recordRejectedAdminLogin(store,now=Date.now()){
 try{
  const windowStart=Math.floor(now/WINDOW)*WINDOW;
  await store.transaction(async tx=>{
   const previous=await tx.get(KEY);
   if(previous?.windowStart>windowStart)return;
   const count=(previous?.windowStart===windowStart?previous.count:0)+1;
   if(count>THRESHOLD)return;
   const alertedAt=count===THRESHOLD?now:previous?.alertedAt??null;
   await tx.put(KEY,{windowStart,count,alertedAt});
  });
 }catch{console.error('admin_login_alert_counter_unavailable');}
}

export async function readAdminLoginAlert(store,now=Date.now()){
 try{
  const at=(await store.get(KEY))?.alertedAt;
  const recent=Number.isSafeInteger(at)&&at<=now&&at>=now-DAY;
  return {available:true,last:recent?{detectedAt:at,minimumCount:THRESHOLD,windowMinutes:5}:null};
 }catch{return {available:false,last:null};}
}
