// Separate authorization from the already consumed 2026-10-24 case. Never
// reset its key or turn these manual cases into a scheduled monitor.
export const CASE_ACCOUNT='dieguito2026';
export const CASE_APPROVED_AT=Date.parse('2026-10-25T17:11:44Z');
export const CASE_EXPIRES_AT=CASE_APPROVED_AT+86400000;
export const CASE_TIMEOUT_MS=30000;
const cases=Object.freeze([
 Object.freeze({key:'movie_223085',type:'movie',server:'ccf',id:'223085',ext:null,expected:416}),
 Object.freeze({key:'movie_231252',type:'movie',server:'ccf',id:'231252',ext:'mkv',expected:502}),
 Object.freeze({key:'live_8471',type:'live',server:'ccf',id:'8471',ext:'ts',expected:404}),
 // Independent authorization and claim: never extend the historical cases.
 Object.freeze({key:'live_225341_20261026',type:'live',server:'ccf',id:'225341',ext:'ts',expected:502,approvedAt:Date.parse('2026-10-26T17:40:30Z'),expiresAt:Date.parse('2026-10-27T17:40:30Z')})
]);
export const TARGETED_CASES=cases;
export const targetedCase=key=>cases.find(item=>item.key===key)||null;
export const targetedExpiresAt=key=>targetedCase(key)?.expiresAt??CASE_EXPIRES_AT;
export const targetedWindow=(env,now=Date.now(),key=null)=>{
 const item=key===null?null:targetedCase(key);if(key!==null&&!item)return false;
 return env?.ENVIRONMENT==='production'&&env.PLAYBACK_CANARY_USERNAME===CASE_ACCOUNT&&now>=(item?.approvedAt??CASE_APPROVED_AT)&&now<(item?.expiresAt??CASE_EXPIRES_AT);
};
export const targetedSession=(session,env)=>targetedWindow(env,Date.now(),session?.targetedCase)&&session?.canary===true&&session.comparison===true&&session.username===CASE_ACCOUNT?targetedCase(session.targetedCase):null;
export const targetExtension=value=>typeof value==='string'&&['mp4','mkv','webm','avi','mov','m4v','ts'].includes(value)?value:null;
export function targetedTicket(ticket,env){
 const item=targetedCase(ticket?.targetedCase);
 return item&&item.ext&&targetedWindow(env,Date.now(),item.key)&&ticket.canary===true&&ticket.comparison===true&&!ticket.resource&&ticket.type===item.type&&String(ticket.id)===item.id&&targetExtension(ticket.ext)&&ticket.ext===item.ext?item:null;
}
