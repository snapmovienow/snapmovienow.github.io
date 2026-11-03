// Explicit opt-in only; caller shares one instance per isolate, never per request.
// Fixed ceiling: ten additional events per 60 seconds per isolate. Not a global cap.
// Retains only monotonic time and count: no resource or identity state.
export function createFastMediaFailureBudget(now=()=>performance.now()){
 let since=null,used=0;
 return {take(){const time=now();if(!Number.isFinite(time))return false;
 if(since===null||time-since>=60000){since=time;used=0;}
 if(time<since||used>=10)return false;
 used++;return true;}};
}
