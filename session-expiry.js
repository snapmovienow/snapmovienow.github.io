// Use elapsed time rather than the device's wall clock; check again when a
// backgrounded page becomes visible because browser timers may be suspended.
function createSessionExpiry(options){
 const now=options.now||(()=>performance.now()),schedule=options.schedule||setTimeout,unschedule=options.unschedule||clearTimeout;
 let timer,deadline=null;
 function cancel(){unschedule(timer);timer=undefined;deadline=null}
 function check(){
  if(deadline===null)return;
  unschedule(timer);const remaining=deadline-now();
  if(remaining<=0){deadline=null;timer=undefined;options.expire();return}
  timer=schedule(check,Math.min(remaining,2147483647));
 }
 return {cancel,check,start(expiresAt,serverTime,networkAge=0){cancel();if(!Number.isFinite(expiresAt)||!Number.isFinite(serverTime))return;deadline=now()+expiresAt-serverTime-Math.max(0,networkAge);check()}};
}
