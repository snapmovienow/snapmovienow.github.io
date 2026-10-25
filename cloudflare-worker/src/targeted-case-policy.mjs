// Separate authorization from the already consumed 2026-10-24 case. Never
// reset its key or turn these manual cases into a scheduled monitor.
export const CASE_ACCOUNT='dieguito2026';
export const CASE_APPROVED_AT=Date.parse('2026-10-25T17:11:44Z');
export const CASE_EXPIRES_AT=CASE_APPROVED_AT+86400000;
export const CASE_TIMEOUT_MS=30000;
const cases=Object.freeze([
 Object.freeze({key:'movie_223085',type:'movie',server:'ccf',id:'223085',ext:null,expected:416}),
 Object.freeze({key:'movie_231252',type:'movie',server:'ccf',id:'231252',ext:'mkv',expected:502}),
 Object.freeze({key:'live_8471',type:'live',server:'ccf',id:'8471',ext:'ts',expected:404})
]);
export const TARGETED_CASES=cases;
export const targetedCase=key=>cases.find(item=>item.key===key)||null;
export const targetedWindow=(env,now=Date.now())=>env?.ENVIRONMENT==='production'&&env.PLAYBACK_CANARY_USERNAME===CASE_ACCOUNT&&now>=CASE_APPROVED_AT&&now<CASE_EXPIRES_AT;
export const targetedSession=(session,env)=>targetedWindow(env)&&session?.canary===true&&session.comparison===true&&session.username===CASE_ACCOUNT?targetedCase(session.targetedCase):null;
export const targetExtension=value=>typeof value==='string'&&['mp4','mkv','webm','avi','mov','m4v','ts'].includes(value)?value:null;
export function targetedTicket(ticket,env){
 const item=targetedCase(ticket?.targetedCase);
 return item&&item.ext&&targetedWindow(env)&&ticket.canary===true&&ticket.comparison===true&&!ticket.resource&&ticket.type===item.type&&String(ticket.id)===item.id&&targetExtension(ticket.ext)&&ticket.ext===item.ext?item:null;
}
