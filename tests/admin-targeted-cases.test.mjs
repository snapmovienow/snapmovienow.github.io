import assert from 'node:assert/strict';
import {targetedCasePresentation,mountTargetedCases} from '../admin-targeted-cases.js';
const data={expiresAt:1793034704000,cases:[{caseKey:'movie_223085',state:'blocked_extension'},{caseKey:'movie_231252',state:'ready'},{caseKey:'live_8471',state:'complete',result:{reason:'https://private.invalid/password',origin:{httpStatus:404,bytes:0,observation:{method:'GET'}},relay:{httpStatus:404,bytes:0,observation:{method:'GET'}}}},{caseKey:'unknown-secret',state:'ready'}]};
const view=targetedCasePresentation(data);assert.equal(view.length,3);assert.equal(view[0].ready,false);assert.equal(view[1].ready,true);assert.ok(!/https|password|unknown-secret/.test(JSON.stringify(view)));assert.match(view[2].state,/no equivale a reparación/);
class Element{children=[];value='';disabled=false;map=new Map();append(x){this.children.push(x);if(!this.value&&x.value)this.value=x.value}replaceChildren(){this.children=[];this.value=''}querySelector(key){if(!this.map.has(key))this.map.set(key,new Element());return this.map.get(key)}}
const previous=globalThis.document;globalThis.document={createElement:()=>new Element()};
try{
 const calls=[],container=new Element();let finish;
 const widget=mountTargetedCases({container,notice:()=>{},api:async(action,body)=>{calls.push({action,body});if(action==='targeted-cases-status')return data;return new Promise(r=>{finish=r})}});
 await widget.refresh();const section=container.children[0],button=section.querySelector('[data-run]'),select=section.querySelector('select');assert.equal(select.value,'movie_231252');assert.equal(button.disabled,false);
 const run=button.onclick();assert.equal(button.disabled,true);await button.onclick();assert.equal(calls.filter(x=>x.action==='targeted-cases-run').length,1,'double click must not repeat');
 widget.clear();finish({cases:[{caseKey:'movie_231252',state:'complete'}]});await run;assert.equal(select.children.length,0,'late completion cannot repopulate a cleared session');assert.equal(button.disabled,true);
 await widget.refresh();select.value='movie_223085';select.onchange();assert.equal(button.disabled,true);await button.onclick();assert.equal(calls.filter(x=>x.action==='targeted-cases-run').length,1);
 console.log('PASS: fixed case UI, blocked extension, safe labels, no repair claim, duplicate-click guard and late completion/session-clear isolation.');
}finally{globalThis.document=previous}
