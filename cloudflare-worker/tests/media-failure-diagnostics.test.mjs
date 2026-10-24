import assert from 'node:assert/strict';
import {recentMediaFailures,providerHealthSummary} from '../src/provider-health.mjs';
const now=2000000,record=(status,at=now-100)=>({ok:false,httpStatus:status,at,credentialKey:'never-return',probeId:'private-lease'});
const health={
 'channel|live|ccf|143375|ts|private-account-one':record(404),
 'channel|live|ccf|143375|ts|private-account-two':record(502,now-50),
 'channel|movie|ccf|18|mp4|private-account-one':record(503,now-200),
 'account|private-account-one':record(403),
 'channel|live|ccf|19|ts|old-account':record(404,now-1800001),
 'channel|live|ccf|20|ts|future-account':record(404,now+1),
 'channel|live|ccf|21|ts|healthy-account':{...record(404),ok:true},
 'channel|live|https://secret.example|22|ts|private-account':record(404),
 'channel|live|ccf|secret-token|ts|private-account':record(404),
 'channel|live|ccf|23|https://secret.example|private-account':record(404),
 'channel|live|ccf|24|ts|private-account':record('404'),
 'channel|live|ccf|25|ts|':record(404),
};
const before=structuredClone(health),rows=recentMediaFailures(health,now);
assert.deepEqual(rows,[
 {type:'live',server:'ccf',id:'143375',ext:'ts',lastObservedAt:now-50,httpStatuses:[404,502],sourcesObserved:2},
 {type:'movie',server:'ccf',id:'18',ext:'mp4',lastObservedAt:now-200,httpStatuses:[503],sourcesObserved:1}
]);
assert.deepEqual(health,before,'reading diagnostics must not change allocation/circuit state');
assert.deepEqual(providerHealthSummary(health,now).recentMediaFailures,rows);
const serialized=JSON.stringify(rows);for(const privateValue of ['private-account','never-return','private-lease','secret.example','secret-token'])assert.ok(!serialized.includes(privateValue));
assert.deepEqual(recentMediaFailures(null,now),[]);
assert.deepEqual(recentMediaFailures(health,now+1800002),[],'expiration is a snapshot boundary, not a recovery claim');
const many=Object.fromEntries(Array.from({length:80},(_,i)=>['channel|series|ccf|'+(100+i)+'|mp4|private-account',record(502,now-i)]));
const limited=recentMediaFailures(many,now);assert.equal(limited.length,30);assert.equal(limited[0].id,'100');assert.equal(limited.at(-1).id,'129');
console.log('PASS: bounded administrator media-failure IDs, deduplication, HTTP status attribution, expiry, future-data rejection and secret isolation.');
