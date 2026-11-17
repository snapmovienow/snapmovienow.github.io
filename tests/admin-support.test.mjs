import assert from 'node:assert/strict';
import {clientSupportPresentation,supportTimestamp} from '../admin-support.js';

const now=Date.UTC(2026,10,17,2,30),base={checkedAt:now,recordingSince:now-10000,customer:{id:'account-1',username:'Demo01',name:'Cliente de ejemplo',expiresAt:now+86400000},lists:[{type:'live',lastRequestedAt:now-3*86400000,lastRespondedAt:now-3*86400000+500,status:'delivered',httpStatus:200,itemCount:300,selection:'all',access:'xtream'}],check:{checkedAt:now,access:'active',permissions:{tv:true,movies:true,series:false},connections:{status:'observed',reserved:2,limit:3},source:{status:'observed',observedAt:now-30000,usableAccounts:420}},incidents:{rows:[],total:0,page:1,pages:1,retentionDays:30}};
let view=clientSupportPresentation(base,now);
assert.deepEqual(view.lists.map(row=>row.type),['live','movie','series']);
assert.equal(view.lists[0].status,'Respuesta generada');
assert.equal(view.lists[0].itemCount,300);assert.equal(view.lists[0].httpStatus,200);assert.equal(view.lists[0].requestedAt,now-3*86400000);
assert.equal(view.lists[1].status,'Sin registro');assert.equal(view.lists[1].requestedAt,null);assert.equal(view.lists[1].itemCount,null);
assert.equal(view.check.access,'Cuenta activa');assert.equal(view.check.permissions,'TV, Películas');assert.match(view.check.connections,/2 reservas registradas/);assert.equal(view.check.sourceState,'Observación guardada');
assert.match(supportTimestamp(now-3*86400000,now),/hace 3 días/);assert.match(supportTimestamp(now-60000,now),/hace 1 min/);
for(const value of [undefined,null,0,-1,'2026-11-17',NaN,Infinity,now+60001,Number.MAX_SAFE_INTEGER])assert.equal(supportTimestamp(value,now),'Sin registro');

view=clientSupportPresentation({customer:{expiresAt:null},lists:[{type:'live',status:'<img src=x>',lastRequestedAt:now+100000,httpStatus:999,itemCount:-2,selection:'secret URL',access:'password'}],check:{access:'unverified',source:{status:'observed',observedAt:now+100000},connections:{status:'unknown',reserved:0},permissions:null}},now);
assert.equal(view.lists[0].status,'Sin registro');assert.equal(view.lists[0].requestedAt,null);assert.equal(view.lists[0].httpStatus,null);assert.equal(view.lists[0].itemCount,null);assert.equal(view.lists[0].selection,'Alcance sin registrar');assert.equal(view.lists[0].access,'Acceso sin registrar');assert.equal(view.check.access,'Estado de acceso sin comprobar');assert.equal(view.check.connections,'Reservas: sin comprobar');assert.equal(view.check.sourceState,'Sin comprobar');assert.equal(view.check.permissions,'Sin comprobar');assert.equal(view.check.noExpiry,true);
assert.ok(!JSON.stringify(view).includes('<img'));assert.ok(!JSON.stringify(view).includes('password'));

view=clientSupportPresentation({...base,check:{...base.check,access:'expired',source:{status:'stale',observedAt:now-2*86400000},connections:{status:'observed',reserved:null,limit:3},permissions:{tv:false,movies:false,series:false}}},now);
assert.equal(view.check.access,'Cuenta vencida');assert.equal(view.check.sourceState,'Observación antigua');assert.equal(view.check.sourceStatus,'stale');assert.equal(view.check.permissions,'Sin secciones habilitadas');assert.equal(view.check.connections,'Reservas: sin comprobar');
assert.equal(clientSupportPresentation({customer:{expiresAt:now-1}},now).check.expiry,now-1);
assert.equal(clientSupportPresentation({customer:{expiresAt:Number.MAX_SAFE_INTEGER}},now).check.expiry,null);
assert.equal(clientSupportPresentation({lists:[{type:'live',selection:'source'}]},now).lists[0].selection,'Lista de una fuente');
console.log('PASS: support UI preserves unknown evidence, labels server responses without device/playback proof, validates timestamps and presents saved source age.');
