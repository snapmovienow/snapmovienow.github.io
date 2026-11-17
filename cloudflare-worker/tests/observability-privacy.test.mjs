import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('production observability redacts query credentials while retaining sanitized diagnostic events',()=>{
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.observability.enabled,true);
 assert.equal(config.observability.redact_query_string,true);
 assert.equal(config.observability.logs.invocation_logs,false);
 assert.equal(config.vars.PRIVATE_DIAGNOSTIC_REPORTS_ENABLED,'true');
 assert.ok(config.triggers.crons.includes('*/5 * * * *'));
});
