import json,subprocess,pathlib,hashlib
root=pathlib.Path('/mnt/c/projects/Inspection-isolated-v111-20261111')
def sql(container,q):
    socket='/tmp' if container=='inspection_v111_db_v2' else '/var/run/postgresql'
    return subprocess.check_output(['docker','exec','-i',container,'psql','-h',socket,'-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-At'],input=q,text=True,stderr=subprocess.PIPE).strip()
db='inspection_v111_db_v2'
accounts=json.loads((root/'.local/accounts.json').read_text())
ids=','.join("'"+a['auth_id']+"'" for a in accounts.values())
fingerprint="select md5(string_agg(id::text||coalesce(encrypted_password,''),'|' order by id)) from auth.users"
before=(root/'.local/original-local-auth-fingerprint.txt').read_text().strip()
source_ok=sql('supabase_db_Inspection-supabase-e2e-20261028',fingerprint)==before
clone_ok=sql(db,fingerprint+' where id not in ('+ids+')')==before
indexes=json.loads(sql(db,"select json_agg(t) from (select c.relname,i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) definition from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid in ('google_calendar_connections'::regclass,'guard_handover_attachments'::regclass) and i.indisunique) t"))
acl=json.loads(sql(db,"select json_agg(t) from (select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('meeting_bookings','business_handover_entries','guard_handover_attachments') and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type) t"))
network=json.loads(subprocess.check_output(['docker','network','inspect','inspection_v111_v2']))[0]
containers=[]
for n in ['inspection_v111_db_v2','inspection_v111_auth_v2','inspection_v111_rest_v2','inspection_v111_storage_v2']:
    i=json.loads(subprocess.check_output(['docker','inspect',n]))[0]
    assert set(i['NetworkSettings']['Networks'])=={'inspection_v111_v2'}
    containers.append({'name':n,'image':i['Config']['Image'],'running':i['State']['Running']})
result={'status':'pass' if source_ok and clone_ok and network['Internal'] else 'fail','original_local_auth_credentials_unchanged':source_ok,'clone_existing_50_auth_credentials_unchanged':clone_ok,'new_synthetic_auth_accounts':2,'network_internal':network['Internal'],'containers':containers,'unique_indexes':indexes,'actual_table_grants':acl,'fault_trigger_remaining':int(sql(db,"select count(*) from pg_trigger where tgname='v111_attachment_fault'"))}
assert result['status']=='pass' and result['fault_trigger_remaining']==0
(root/'results/final-environment-audit.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps({'status':result['status'],'original_and_clone_existing_passwords_unchanged':True,'valid_unique_indexes':len(indexes),'grant_records':len(acl),'network_internal':True}))
