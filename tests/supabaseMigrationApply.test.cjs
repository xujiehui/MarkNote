const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const tempDir = mkdtempSync(join(tmpdir(),'marknote-sync-apply-'));
const preloadPath = join(tempDir,'management-preload.cjs');
const gates = ['tables','authenticated grants','rls','legacy writes disabled','internal tables private','quota tables private',
  'versioned RPC security','quota policy helper','public policies','attachments bucket','storage rls','storage grants',
  'storage immutable','storage policies'];
writeFileSync(preloadPath,`
const assert=require('node:assert/strict');
let applied=false;
globalThis.fetch=async(input,init={})=>{
  const url=String(input);
  assert.equal(init.headers.authorization,'Bearer dummy-management-token');
  assert.ok(init.signal instanceof AbortSignal,'management requests must have a timeout');
  if(url.endsWith('/database/migrations') && init.method==='GET') return response(200,[{version:'20261015114235',name:'user_storage_quota'}]);
  if(url.endsWith('/database/migrations') && init.method==='POST') {
    const body=JSON.parse(init.body);
    assert.equal(body.name,'user_storage_quota');
    assert.match(body.query,/^begin;/);
    assert.match(body.query,/commit;$/);
    assert.match(body.query,/create table if not exists public.notes/);
    assert.match(body.query,/marknote_sync_push_v2/);
    assert.match(body.query,/revoke insert, update, delete on public.folders/);
    assert.match(body.query,/marknote_sync_reserve_storage_v2/);
    assert.doesNotMatch(body.query,/dummy-management-token/);
    if(process.env.MARKNOTE_TEST_APPLY_MODE==='post-failure') return response(403,{message:'Forbidden'});
    applied=true; process.stdout.write('[apply-ok]'); return response(201,{id:'test-migration'});
  }
  if(url.endsWith('/database/query/read-only')) {
    const body=JSON.parse(init.body);
    assert.equal(body.read_only,true);
    assert.match(body.query,/unsafe_legacy_writes/);
    assert.match(body.query,/has_function_privilege/);
    if(process.env.MARKNOTE_TEST_APPLY_MODE==='invalid-result') return response(200,[]);
    const ready=process.env.MARKNOTE_TEST_APPLY_MODE==='ready' || applied;
    return response(200,${JSON.stringify(gates)}.map(check_name=>({check_name,ok:ready,detail:ready?'ok':'missing prerequisite'})));
  }
  throw new Error('Unexpected URL '+url);
};
function response(status,body){return{status,async text(){return JSON.stringify(body)}};}
`);
function run(args=[],mode='ready',extra={}) {
  return spawnSync(process.execPath,['--require',preloadPath,'scripts/apply-supabase-migration.mjs',...args],{
    cwd:process.cwd(),encoding:'utf8',env:{...process.env,SUPABASE_PROJECT_REF:'test-project',SUPABASE_MANAGEMENT_TOKEN:'dummy-management-token',
      SUPABASE_API_ACCESS_TOKEN:'',SUPABASE_PAT:'',SUPABASE_MANAGEMENT_API_URL:'https://management.test',MARKNOTE_TEST_APPLY_MODE:mode,...extra},
  });
}
const ready=run();
assert.equal(ready.status,0,ready.stderr);
assert.match(ready.stdout,/Migration history: found 20261015114235/);
assert.match(ready.stdout,/Sync schema already appears ready/);
assert.match(ready.stdout,/verify:release:online:manual/);
assert.doesNotMatch(ready.stdout,/dummy-management-token/);
const missing=run([],'missing');
assert.equal(missing.status,1);
assert.match(missing.stderr,/Dry run only: no migration was applied/);
assert.doesNotMatch(missing.stdout,/\[apply-ok\]/);
const applied=run(['--apply'],'missing');
assert.equal(applied.status,0,applied.stderr);
assert.match(applied.stdout,/\[apply-ok\]/);
assert.match(applied.stdout,/Supabase sync schema: ready/);
const forced=run(['--apply','--force']);
assert.equal(forced.status,0,forced.stderr);
assert.match(forced.stdout,/\[apply-ok\]/);
const forceDry=run(['--force']);
assert.equal(forceDry.status,1);
assert.doesNotMatch(forceDry.stdout,/\[apply-ok\]/);
const failed=run(['--apply'],'post-failure');
assert.equal(failed.status,1);
assert.match(failed.stderr,/HTTP 403/);
const malformed=run(['--apply'],'invalid-result');
assert.equal(malformed.status,1);
assert.match(malformed.stderr,/schema readiness check is still incomplete/);
const noToken=run([], 'ready',{SUPABASE_MANAGEMENT_TOKEN:''});
assert.equal(noToken.status,1);
assert.match(noToken.stderr,/SUPABASE_MANAGEMENT_TOKEN is missing/);
console.log('Supabase migration apply tests passed (quota gates, dry run, atomic apply, blocked credentials).');
