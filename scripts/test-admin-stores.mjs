import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync(new URL('../server/adminStores.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let email = 'botservicesco@gmail.com', confirmed = true, authError = false, row = { plan: 'pro', subscription_status: 'active', subscription_end_at: '2027-01-01' };
let writes = [], queries = [], listRows = [];
const admin = {
  auth: { getUser: async () => ({ data: { user: authError ? null : { email, email_confirmed_at: confirmed ? '2026-01-01' : null } }, error: authError ? {} : null }) },
  from(table) {
    const query = { table, columns: '', payload: null, filters: [] };
    queries.push(query);
    const chain = {
      update(payload) { writes.push({ table, payload }); query.payload = payload; return chain; },
      select(columns) { query.columns = columns; return chain; },
      eq(...args) { query.filters.push(args); return chain; },
      gt(...args) { query.filters.push(['gt', ...args]); return chain; }, or() { return chain; }, order() { return chain; }, range() { return chain; }, limit() { return chain; },
      async maybeSingle() { return { data: row, error: null }; },
      then(resolve, reject) {
        const count = table === 'subscriptions' ? listRows.flatMap(store => store.subscriptions).filter(sub => query.filters.every(([key, value, cutoff]) => key === 'gt' ? Date.parse(sub[value]) > Date.parse(cutoff) : sub[key] === value)).length : listRows.length;
        return Promise.resolve({ data: query.columns.includes('subscriptions(') || query.columns.includes('subscriptions!inner(') ? listRows : [], count, error: null }).then(resolve, reject);
      },
    };
    return chain;
  },
};
const exports = {};
vm.runInNewContext(source, { exports, process, Date, console, require: name => name === '@supabase/supabase-js' ? { createClient: () => admin } : name === 'ws' ? {} : { SUPER_ADMIN_EMAIL: 'botservicesco@gmail.com' } });
const action = (input, token = 'Bearer valid') => exports.adminStoresAction(input, token, { VITE_PUBLIC_SUPABASE_URL: 'https://example.com', SUPABASE_SERVICE_ROLE_KEY: 'test' });
const id = '11111111-1111-4111-8111-111111111111';
assert.equal((await action({}, '')).status, 401);
authError = true; assert.equal((await action({})).status, 401); authError = false;
email = 'other@example.com'; assert.equal((await action({ action: 'update-plan', storeId: id, plan: 'pro' })).status, 403);
email = 'botservicesco@gmail.com'; confirmed = false; assert.equal((await action({})).status, 403); confirmed = true;
assert.equal(writes.length, 0);
for (const input of [{ action: 'unknown' }, { page: 'NaN' }, { page: 0 }, { pageSize: 51 }, { status: 'bad' }, { plan: 'bad' }, { action: 'update-plan', storeId: 'bad', plan: 'pro' }, { action: 'update-plan', storeId: id, plan: 'bad' }, { action: 'update-status', storeId: id, isActive: 'false' }]) assert.equal((await action(input)).status, 400);
assert.equal((await action({ action: 'update-plan', storeId: id, plan: 'pro' })).status, 200);
assert.deepEqual(Object.keys(writes[0].payload).sort(), ['plan', 'updated_at']);
row = null; assert.equal((await action({ action: 'update-plan', storeId: id, plan: 'basic' })).status, 404);
assert.equal((await action({ action: 'update-status', storeId: id, isActive: false })).status, 404);
row = { id, status: 'inactive' }; assert.equal((await action({ action: 'update-status', storeId: id, isActive: false })).status, 200);
assert.equal(writes.at(-1).payload.status, 'inactive');
queries = [];
const result = await action({ search: 'shop@example.com', plan: 'pro' });
assert.equal(result.status, 200);
assert.equal(result.summary.orders, 0);
assert.ok(queries.find(q => q.table === 'stores' && q.columns.includes('!inner') && q.filters.some(f => f[0] === 'subscriptions.plan' && f[1] === 'pro')));
listRows = [{ id, name: 'Demo', slug: 'demo', status: 'active', contact_email: 'demo@example.com', subscriptions: [{ plan: 'basic', registration_type: 'token', subscription_status: 'active', subscription_end_at: '2999-01-01' }] }];
const populated = await action({});
assert.equal(populated.stores.length, 1);
assert.equal(populated.stores[0].plan, 'basic');
assert.equal(populated.stores[0].ownerEmail, 'demo@example.com');
assert.equal(populated.stores[0].hasActiveSubscription, false);
assert.equal(populated.hasNext, false);
listRows[0].subscriptions[0].registration_type = 'paid';
const activePaid = await action({});
assert.equal(activePaid.stores[0].hasActiveSubscription, true);
assert.equal(activePaid.summary.paid, 1);
assert.equal(activePaid.summary.paidActive, 1);
listRows[0].subscriptions[0].subscription_end_at = '2000-01-01';
const expiredPaid = await action({});
assert.equal(expiredPaid.stores[0].hasActiveSubscription, false);
assert.equal(expiredPaid.summary.paid, 1);
assert.equal(expiredPaid.summary.paidActive, 0);
console.log('Admin checks passed: authentication, authorization, validation, safe plan updates, missing rows, status, global list.');
