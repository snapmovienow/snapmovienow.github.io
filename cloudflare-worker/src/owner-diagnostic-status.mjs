// Project only the private timer's read-only freshness. Site responses may
// also come from an older release that does not report diagnostic status.
const states=new Set(['never','running','ok','attention','failed']);
const staleMs=15*60000;

export function cleanOwnerDiagnostic(value,now=Date.now()){
 const validTime=at=>at===null||Number.isSafeInteger(at)&&at>0&&at<=now+1000;
 if(!states.has(value?.state)||!validTime(value.attemptedAt)||!validTime(value.lastValidAt))return null;
 const {state,attemptedAt,lastValidAt}=value;
 if((state==='never')!==(attemptedAt===null)||state==='never'&&lastValidAt!==null)return null;
 if((state==='ok'||state==='attention')&&(lastValidAt===null||lastValidAt<attemptedAt))return null;
 return {state,attemptedAt,lastValidAt};
}

export function retainOwnerDiagnostic(previous,sample,now){
 if(previous&&(sample.attemptedAt<previous.attemptedAt||
  sample.attemptedAt===previous.attemptedAt&&sample.state==='running'&&previous.state!=='running'))return previous;
 return {...sample,lastValidAt:Math.max(previous?.lastValidAt||0,sample.lastValidAt||0)||null,firstObservedAt:previous?.firstObservedAt??now};
}

export function ownerDiagnosticStatus(value,now){
 if(!value)return null;
 const {firstObservedAt,...status}=value;
 return {...status,stale:now-Math.max(firstObservedAt,status.lastValidAt||0)>=staleMs};
}
