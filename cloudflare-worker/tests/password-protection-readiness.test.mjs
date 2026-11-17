import assert from 'node:assert/strict';
import {passwordProtectionReadiness} from '../src/password-verifier.mjs';

const generatedAt=1_800_000_000_000;
for (const [env,upgradeEnabled,keyReady] of [
  [{},false,false],
  [{TICKET_SECRET:'short',PASSWORD_UPGRADE_ENABLED:'true'},true,false],
  [{TICKET_SECRET:'synthetic-test-value-only-'.repeat(2)},false,true],
  [{TICKET_SECRET:'synthetic-test-value-only-'.repeat(2),PASSWORD_UPGRADE_ENABLED:'true'},true,true],
]) {
  assert.deepEqual(await passwordProtectionReadiness(env,generatedAt),{
    event:'password_protection_readiness_v1',schema:'SNAP-password-protection-readiness-v1',
    generatedAt,upgradeEnabled,keyReady,
  });
}
console.log('PASS: readiness checks actual key derivation and only emits the five allowed fields.');
