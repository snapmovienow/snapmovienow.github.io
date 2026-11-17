import assert from 'node:assert/strict';
import { accountsFetch } from '../src/accounts.mjs';

class TestStorage {
  records = new Map();
  async get(key) { return structuredClone(this.records.get(key)); }
  async put(key, value) { this.records.set(key, structuredClone(value)); }
  async delete(key) { return this.records.delete(key); }
  async transaction(operation) {
    await this.beforeTransaction?.();
    return operation(this);
  }
}

const storage = new TestStorage();
const env = { ADMIN_SETUP_SECRET: 'synthetic-owner-setup-for-concurrency-test' };
const password = 'synthetic-password-for-unit-test';
function call(action, fields) {
  const request = new Request('https://private/accounts/' + action, {
    method: 'POST', body: JSON.stringify({ actor: 'owner', ...fields })
  });
  return accountsFetch({storage}, env, request);
}
assert.equal((await call('setup', { setupSecret: env.ADMIN_SETUP_SECRET, username: 'owner', password })).status, 200);
for (const action of ['mfa-disable', 'backup-export']) {
  let count = 0;
  storage.beforeTransaction = async () => {
    if (++count === 2) {
      const current = await storage.get('admin');
      await storage.put('admin', {...current, version: current.version + 1});
    }
  };
  const response = await call(action, {password});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'admin_required');
}
console.log('PASS: sensitive changes require the same administrator credentials at authorization and commit.');
