import assert from 'node:assert/strict';
import {mountSecurityLogCanary} from '../admin-security-log-canary.js';
class Element{constructor(){this.children=[];this.disabled=false;this.textContent='';}append(...children){this.children.push(...children);}setAttribute(){}}
const document={createElement:()=>new Element()},container=new Element();let accepted=false,calls=[];
const state={id:'snap-public-header-canary-20261026-v1',state:'ready',consumed:false};
const ui=mountSecurityLogCanary({document,container,now:()=>Date.parse('2026-10-26T20:00:00Z'),confirm:()=>accepted,api:async(action,data)=>{calls.push({action,data});return action.endsWith('-status')?state:{...state,state:'complete',consumed:true,httpStatus:404};}});
assert.equal(calls.length,0);assert.equal(ui.run.disabled,true);await ui.run.onclick();assert.equal(calls.length,0);
await ui.inspect.onclick();assert.equal(calls.length,1);assert.equal(ui.run.disabled,false);
await ui.run.onclick();assert.equal(calls.length,1,'cancel sends no request');
accepted=true;await Promise.all([ui.run.onclick(),ui.run.onclick()]);assert.equal(calls.filter(x=>x.action.endsWith('-run')).length,1);assert.equal(ui.run.disabled,true);assert.ok(ui.status.textContent.includes('NO demuestra redacción'));
await ui.inspect.onclick();await ui.run.onclick();assert.equal(calls.filter(x=>x.action.endsWith('-run')).length,1,'status refresh never re-enables an attempted button');
ui.clear();assert.equal(ui.run.disabled,true);
const expired=mountSecurityLogCanary({document,container,now:()=>Date.parse('2026-10-28T00:00:00Z'),confirm:()=>true,api:async()=>state});await expired.inspect.onclick();assert.equal(expired.run.disabled,true);
let attempts=0;const uncertain=mountSecurityLogCanary({document,container,now:()=>Date.parse('2026-10-26T20:00:00Z'),confirm:()=>true,api:async action=>{if(action.endsWith('-status'))return state;attempts++;throw Error('synthetic network uncertainty');}});await uncertain.inspect.onclick();await uncertain.run.onclick();await uncertain.run.onclick();assert.equal(attempts,1);assert.equal(uncertain.run.disabled,true);
console.log('PASS: no auto-probe, explicit confirmation/cancel, double-click prevention, expired UI, uncertainty fail-closed, read-only status refresh.');
