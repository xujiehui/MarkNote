const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
// The override permits a standalone local run before installing devDependencies.
const { PGlite } = require(process.env.MARKNOTE_POSTGRES_TEST_MODULE || '@electric-sql/pglite');
const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create schema storage;
      create table storage.buckets(
        id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]
      );
      create table storage.objects(
        id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb not null default '{}'::jsonb
      );
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      grant usage on schema auth to authenticated,anon;
      grant usage on schema storage to authenticated;
      grant execute on function auth.uid() to authenticated,anon;
    `);
    await db.exec(readFileSync('supabase/migrations/202606190001_marknote_sync_schema.sql','utf8'));
    await db.query('insert into auth.users(id) values($1),($2)',[USER_A,USER_B]);
    // Existing remote rows must survive upgrade and be visible once, even when
    // old clients used a future clock and arbitrary client versions.
    await db.query("insert into public.folders(id,user_id,name,updated_at,version) values('legacy',$1,'Existing folder','2099-01-01',1000)",[USER_A]);
    await db.query("insert into public.notes(id,user_id,folder_id,title,content) values('old-note',$1,'legacy','Old title','SECRET legacy content')",[USER_A]);
    const { readinessCheckSql, REQUIRED_READINESS_CHECKS } = await import('../scripts/supabase-schema.mjs');
    const beforeGate = (await db.query(readinessCheckSql)).rows;
    assert.equal(beforeGate.find(row => row.check_name === 'legacy writes disabled').ok,false);
    assert.equal(beforeGate.find(row => row.check_name === 'versioned RPC security').ok,false);
    const migration = [
      readFileSync('supabase/migrations/202610130001_marknote_sync_v2.sql','utf8'),
      readFileSync('supabase/migrations/20261015114235_user_storage_quota.sql','utf8'),
    ].join('\n');
    await db.exec(migration);
    const readyRows = (await db.query(readinessCheckSql)).rows;
    assert.equal(readyRows.length,REQUIRED_READINESS_CHECKS.length);
    assert.ok(readyRows.every(row=>row.ok),JSON.stringify(readyRows.filter(row=>!row.ok)));
    await db.exec(migration); // Idempotent apply cannot reset any migrated data.
    async function actor(id, role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']);
      await db.exec(`set role ${role}`);
    }
    async function call(sql,args=[]) { return (await db.query(sql,args)).rows[0].result; }
    async function push(...mutations) { return call('select public.marknote_sync_push_v2($1::jsonb) as result',[JSON.stringify(mutations)]); }
    async function pull(after=0,bound=null,limit=200) { return call('select public.marknote_sync_pull_v2($1,$2,$3) as result',[after,bound,limit]); }
    const folder = (id,mutationId,expectedRevision=0,localRevision=1) => ({ mutationId, entity:'folder',entityId:id,operation:'upsert',expectedRevision,localRevision,value:{ id,name:'Folder',sortOrder:0,createdAt:1,updatedAt:9999999999999 } });
    const purge = (entity,id,mutationId,expectedRevision) => ({ mutationId, entity,entityId:id,operation:'delete',expectedRevision,localRevision:1,value:null });

    await actor(USER_A);
    const bootstrapped = await pull();
    assert.equal(bootstrapped.changes.length,2);
    assert.equal(bootstrapped.changes[0].entity,'folder');
    assert.equal(bootstrapped.changes[1].entity,'note');
    assert.equal(bootstrapped.changes[0].revision,1);
    assert.equal(bootstrapped.upperBound,2);
    assert.equal((await pull()).upperBound,2);
    const checked = await call('select public.marknote_sync_check_v2() as result');
    assert.equal(checked.protocolVersion,2);
    assert.ok(checked.capabilities.includes('storage-quota'));
    assert.equal((await pull()).upperBound,2,'readiness canary must roll back its mutations and counter increment');
    await assert.rejects(() => db.exec("insert into public.folders(id,user_id,name) values('bypass','"+USER_A+"','unsafe')"),/permission denied/);
    await assert.rejects(() => db.exec('select * from public.marknote_sync_entities'),/permission denied/);
    await assert.rejects(() => db.exec('select public.marknote_sync_lock_v2()'),/permission denied/);

    const quotaPath = USER_A + '/quota-note/quota-file/' + 'd'.repeat(64);
    const initialUsage = await call('select public.marknote_sync_storage_usage_v2() as result');
    assert.deepEqual(
      {usedBytes:initialUsage.usedBytes,quotaBytes:initialUsage.quotaBytes,objectCount:initialUsage.objectCount,objectLimit:initialUsage.objectLimit,maxFileBytes:initialUsage.maxFileBytes},
      {usedBytes:0,quotaBytes:104857600,objectCount:0,objectLimit:1000,maxFileBytes:20971520},
    );
    await assert.rejects(
      () => db.query("insert into storage.objects(bucket_id,name,metadata) values('attachments',$1,$2::jsonb)",[
        quotaPath, JSON.stringify({size:12,mimetype:'image/png'}),
      ]),
      /row-level security|policy/i,
    );
    const reserved = await call(
      'select public.marknote_sync_reserve_storage_v2($1,$2,$3) as result',
      [quotaPath,12,'image/png'],
    );
    assert.equal(reserved.reservedBytes,12);
    await assert.rejects(
      () => db.query("insert into storage.objects(bucket_id,name,metadata) values('attachments',$1,$2::jsonb)",[
        quotaPath, JSON.stringify({size:13,mimetype:'image/png'}),
      ]),
      /row-level security|policy/i,
    );
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('attachments',$1,$2::jsonb)",[
      quotaPath, JSON.stringify({size:12,mimetype:'image/png'}),
    ]);
    const used = await call('select public.marknote_sync_storage_usage_v2() as result');
    assert.equal(used.usedBytes,12);
    assert.equal(used.objectCount,1);
    assert.equal(used.reservedBytes,0,'uploaded paths are not double-counted while the reservation is active');
    await db.query("update storage.objects set metadata=$2::jsonb where name=$1",[
      quotaPath,JSON.stringify({size:1,mimetype:'image/png'}),
    ]);
    const immutableObject = await db.query(
      "select metadata from storage.objects where bucket_id='attachments' and name=$1",
      [quotaPath],
    );
    assert.equal(immutableObject.rows[0].metadata.size,12,'restrictive RLS must make attachment updates a no-op');
    await db.query('select public.marknote_sync_release_storage_v2($1)',[quotaPath]);
    await db.query("delete from storage.objects where bucket_id='attachments' and name=$1",[quotaPath]);

    for (let index=0; index<5; index+=1) {
      const path = USER_A + '/quota-note/quota-' + index + '/' + String(index).repeat(64);
      await call('select public.marknote_sync_reserve_storage_v2($1,$2,$3) as result',[path,20971520,'image/png']);
      await db.query("insert into storage.objects(bucket_id,name,metadata) values('attachments',$1,$2::jsonb)",[
        path, JSON.stringify({size:20971520,mimetype:'image/png'}),
      ]);
      await db.query('select public.marknote_sync_release_storage_v2($1)',[path]);
    }
    const fullUsage = await call('select public.marknote_sync_storage_usage_v2() as result');
    assert.equal(fullUsage.usedBytes,104857600);
    assert.equal(fullUsage.objectCount,5);
    await assert.rejects(
      () => call('select public.marknote_sync_reserve_storage_v2($1,$2,$3) as result',[
        USER_A + '/quota-note/overflow/' + 'e'.repeat(64),1,'image/png',
      ]),
      /quota exceeded/i,
    );
    await assert.rejects(
      () => call('select public.marknote_sync_reserve_storage_v2($1,$2,$3) as result',[
        USER_A + '/quota-note/too-large/' + 'f'.repeat(64),20971521,'image/png',
      ]),
      /20 MiB size limit/i,
    );

    const mutation = folder('new-folder','create-folder');
    const accepted = (await push(mutation))[0];
    assert.equal(accepted.status,'applied');
    assert.equal(accepted.revision,1);
    assert.equal(accepted.sequence,3);
    assert.equal(accepted.localRevision,1);
    assert.ok(accepted.value.updatedAt < 9999999999999,'client clocks cannot decide update order');
    const replay = (await push(mutation))[0];
    assert.equal(replay.replayed,true);
    assert.equal(replay.sequence,accepted.sequence);
    assert.equal((await pull()).upperBound,3,'replay does not allocate a second sequence');
    await assert.rejects(() => push({...mutation,value:{...mutation.value,name:'altered retry'}}),/different payload/);
    const stale = (await push(folder('new-folder','stale-device',0)))[0];
    assert.equal(stale.status,'conflict');
    assert.equal(stale.revision,1);
    assert.equal(stale.value.name,'Folder');
    assert.equal((await pull()).upperBound,3,'conflicts do not allocate committed change sequences');
    const missing = (await push(folder('missing','missing-stale',10)))[0];
    assert.equal(missing.status,'conflict');
    assert.equal(missing.revision,0);
    assert.equal(missing.value,null);
    const updated = (await push({...folder('new-folder','update-folder',1,2),value:{...mutation.value,name:'Changed'}}))[0];
    assert.equal(updated.revision,2);
    assert.equal(updated.sequence,4);
    const oldReplay = (await push(mutation))[0];
    assert.equal(oldReplay.revision,1,'idempotency returns the original acknowledgement, never a newer generation');
    const noteMutation = {mutationId:'create-note',entity:'note',entityId:'note',operation:'upsert',expectedRevision:0,localRevision:1,value:{id:'note',folderId:'new-folder',title:'Note',content:'SECRET new content',rawContent:'private',tags:[],pinned:false,createdAt:1}};
    const note = (await push(noteMutation))[0];
    assert.equal(note.sequence,5);
    await assert.rejects(() => push({...noteMutation,mutationId:'bad-parent',entityId:'bad-note',value:{...noteMutation.value,id:'bad-note',folderId:'not-there'}}),/parent folder/);
    const attachmentPath = USER_A + '/note/image/' + 'a'.repeat(64);
    const attachmentMutation = {mutationId:'create-image',entity:'attachment',entityId:'image',operation:'upsert',expectedRevision:0,localRevision:1,value:{id:'image',noteId:'note',storagePath:attachmentPath,mimeType:'image/png',sizeBytes:12,createdAt:1,data:'NEVER save raw bytes'}};
    const attachment = (await push(attachmentMutation))[0];
    assert.equal(attachment.value.data,undefined);
    await assert.rejects(() => push({...attachmentMutation,mutationId:'wrong-owner',entityId:'x',value:{...attachmentMutation.value,id:'x',storagePath:USER_B+'/note/x/'+'b'.repeat(64)}}),/storage owner/);
    await assert.rejects(() => push({...attachmentMutation,mutationId:'reuse-path',entityId:'x',value:{...attachmentMutation.value,id:'x'}}),/identity-scoped hash path/);
    await push({...noteMutation,mutationId:'literal-note',entityId:'note_%',value:{...noteMutation.value,id:'note_%',content:'Literal identifiers',rawContent:null}});
    await assert.rejects(() => push({...attachmentMutation,mutationId:'wildcard-alias',entityId:'image_%',value:{...attachmentMutation.value,id:'image_%',noteId:'note_%',storagePath:USER_A+'/note-X/image-X/'+'c'.repeat(64)}}),/identity-scoped hash path/);
    await push({...attachmentMutation,mutationId:'literal-path',entityId:'image_%',value:{...attachmentMutation.value,id:'image_%',noteId:'note_%',storagePath:USER_A+'/note_%/image_%/'+'c'.repeat(64)}});
    await assert.rejects(() => push({...folder('invalid','invalid'),value:{id:'invalid',name:'x',sortOrder:0,deletedAt:'yesterday'}}),/Invalid deletion time/);

    // A full page fixes its snapshot bound. Later concurrent commits appear in
    // the next sync, including rows that share a server timestamp.
    const firstPage = await pull(0,null,2);
    const fixedBound = firstPage.upperBound;
    assert.equal(firstPage.hasMore,true);
    await push(folder('later','later-create'));
    let page = firstPage;
    const seen = [...page.changes];
    while (page.hasMore) { page = await pull(page.nextSequence,fixedBound,2); seen.push(...page.changes); }
    assert.equal(page.nextSequence,fixedBound);
    assert.equal(seen.length,fixedBound);
    assert.equal(seen.some(change=>change.entityId==='later'),false);
    assert.equal((await pull(fixedBound)).changes[0].entityId,'later');
    await assert.rejects(()=>pull(fixedBound+100),/Invalid sync cursor/);
    await assert.rejects(()=>pull(1,0),/Invalid sync cursor/);

    // Failed batches and abandoned transactions allocate no visible sequence.
    const beforeFailure = (await pull()).upperBound;
    await assert.rejects(()=>push(folder('rolled-back','rolled-back'),{...noteMutation,mutationId:'broken',entityId:'broken-note',value:{...noteMutation.value,id:'wrong-id'}}),/does not match/);
    assert.equal((await pull()).upperBound,beforeFailure);
    await db.exec('begin');
    await push(folder('uncommitted','uncommitted'));
    await db.exec('rollback');
    assert.equal((await pull()).upperBound,beforeFailure);
    assert.equal((await push(folder('after-abort','after-abort')))[0].sequence,beforeFailure+1);

    await actor(USER_B);
    assert.equal((await pull()).changes.length,0);
    assert.equal((await call('select public.marknote_sync_storage_usage_v2() as result')).usedBytes,0);
    const other = (await push(folder('new-folder','create-folder')))[0];
    assert.equal(other.revision,1);
    assert.equal(other.sequence,1,'counters and mutation ids are independently scoped by auth.uid');
    await db.query("select public.marknote_sync_ack_storage_v2($1::text[])",[[attachmentPath]]);
    assert.deepEqual(await call('select public.marknote_sync_collect_storage_v2() as result'),[]);
    await actor(null);
    await assert.rejects(()=>pull(),/Authentication required/);
    await assert.rejects(()=>call('select public.marknote_sync_storage_usage_v2() as result'),/Authentication required/);
    await actor(USER_A,'anon');
    await assert.rejects(()=>pull(),/permission denied/);
    await assert.rejects(()=>call('select public.marknote_sync_storage_usage_v2() as result'),/permission denied/);
    await assert.rejects(()=>push(mutation),/permission denied/);

    await actor(USER_A);
    await assert.rejects(() => push(purge('folder','new-folder','purge-nonempty-folder',2)),/every remote note/);
    const deletedNote = (await push(purge('note','note','purge-note',note.revision)))[0];
    assert.equal(deletedNote.value,null);
    assert.equal(deletedNote.status,'applied');
    const staleResurrection = (await push({...noteMutation,mutationId:'resurrection',expectedRevision:deletedNote.revision}))[0];
    assert.equal(staleResurrection.status,'conflict','permanently deleted ids cannot be revived even using their tombstone revision');
    assert.equal(staleResurrection.value,null);
    assert.equal((await push(noteMutation))[0].value,null,'old ACK payloads are scrubbed by purge');
    const deletedImage = (await push(purge('attachment','image','purge-image',attachment.revision)))[0];
    assert.equal(deletedImage.status,'conflict','note-only server purge cascades unknown attachments');
    assert.equal(deletedImage.value,null);
    assert.equal(deletedImage.revision,attachment.revision + 1);
    assert.deepEqual(await call('select public.marknote_sync_collect_storage_v2() as result'),[attachmentPath]);
    await actor(USER_B);
    assert.deepEqual(await call('select public.marknote_sync_collect_storage_v2() as result'),[]);
    await db.query("select public.marknote_sync_ack_storage_v2($1::text[])",[[attachmentPath]]);
    await actor(USER_A);
    assert.deepEqual(await call('select public.marknote_sync_collect_storage_v2() as result'),[attachmentPath],'another user cannot acknowledge cleanup');
    await db.query("select public.marknote_sync_ack_storage_v2($1::text[])",[[attachmentPath]]);
    assert.deepEqual(await call('select public.marknote_sync_collect_storage_v2() as result'),[]);
    await push(purge('note','old-note','purge-old-note',1));
    const purgedChanges = (await pull()).changes.filter(change=>change.entityId==='note'||change.entityId==='old-note');
    assert.ok(purgedChanges.every(change=>change.value===null && change.operation==='delete'));
    await db.exec('reset role');
    assert.equal((await db.query("select content from public.notes where user_id=$1 and id='old-note'",[USER_A])).rows[0].content,'');
    assert.equal((await db.query("select count(*)::integer as count from public.marknote_sync_changes where user_id=$1 and document::text like '%SECRET%'",[USER_A])).rows[0].count,0);
    assert.equal((await db.query("select count(*)::integer as count from public.marknote_sync_receipts where user_id=$1 and receipt::text like '%SECRET%'",[USER_A])).rows[0].count,0);
    await actor(USER_A);
    const counterBeforeReapply = (await pull()).upperBound;
    await db.exec('reset role');
    await db.exec(migration);
    await actor(USER_A);
    assert.equal((await pull()).upperBound,counterBeforeReapply);
    console.log('Sync protocol PostgreSQL tests passed (CAS, replay, paging, auth, rollback, quota, purge, storage GC).');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
