import json,pathlib,subprocess,time,re,hashlib
root=pathlib.Path('/mnt/c/projects/Inspection-isolated-v111-20261111');private=root/'.local'
base='Inspection-supabase-e2e-20261028';source='supabase_db_'+base
network='inspection_v111_v2';db='inspection_v111_db_v2';names={'auth':'inspection_v111_auth_v2','rest':'inspection_v111_rest_v2','storage':'inspection_v111_storage_v2'}
def run(args,input=None):
 return subprocess.check_output(args,input=input,stderr=subprocess.PIPE)
def sql(container,query):
 args=['docker','exec','-i',container,'psql','-h','/tmp' if container==db else '/var/run/postgresql','-U','supabase_admin' if container==db else 'supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-At']
 return run(args,query.encode()).decode().strip()
def inspect(n):return json.loads(run(['docker','inspect',n]))[0]
for n in [db,*names.values()]:
 assert subprocess.run(['docker','inspect',n],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0,'Existing container preserved'
assert subprocess.run(['docker','network','inspect',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0,'Existing network preserved'
info=inspect(source);assert info['Config']['Image']=='public.ecr.aws/supabase/postgres:17.11.0.006'
fingerprint="select md5(string_agg(id::text||coalesce(encrypted_password,''),'|' order by id)) from auth.users"
before=sql(source,fingerprint)
roles=run(['docker','exec',source,'pg_dumpall','-U','supabase_admin','--roles-only'])
dump=run(['docker','exec',source,'pg_dump','-U','supabase_admin','-d','postgres','-Fc','--exclude-extension=pg_cron','--exclude-schema=cron'])
(private/'source-local.dump').write_bytes(dump)
(private/'roles-local.sql').write_bytes(roles)
run(['docker','network','create','--internal',network])
command="initdb -D /tmp/review-db -U supabase_admin --auth=trust --no-locale >/tmp/review-init.log && echo 'host all all 0.0.0.0/0 trust' >> /tmp/review-db/pg_hba.conf && exec postgres -D /tmp/review-db -c listen_addresses='*' -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_stat_statements"
run(['docker','run','-d','--name',db,'--network',network,'--user','postgres','--entrypoint','sh',info['Config']['Image'],'-c',command])
for _ in range(60):
 try:
  if sql(db,'select 1')=='1':break
 except subprocess.CalledProcessError:time.sleep(.3)
else:raise RuntimeError('Dedicated clone not ready')
sql(db,roles.decode().replace('CREATE ROLE supabase_admin;', ''))
try:
 run(['docker','exec','-i',db,'pg_restore','-h','/tmp','-U','supabase_admin','-d','postgres','--exit-on-error'],dump)
except subprocess.CalledProcessError as e:
 (private/'restore-error.log').write_bytes(e.stderr);raise RuntimeError('Restore failed; private diagnostic saved')
assert sql(db,fingerprint)==before,'Local Auth credential hashes did not match'
assert sql(source,fingerprint)==before,'Source local Auth changed'
# Validate and apply only the missing security migration to the clone.
fix=root/'source/supabase/migrations/20261106050736_codex_security_boundary_fixes.sql'
sql(db,fix.read_text(encoding='utf-8-sig'))
sql(db,"select pg_notify('pgrst','reload schema')")
counts=json.loads(sql(db,"select json_build_object('public_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),'public_functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),'rls_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity),'auth_users',(select count(*) from auth.users),'cron_extension',(select count(*) from pg_extension where extname='pg_cron'))"))
for service,name in names.items():
 original=inspect('supabase_'+service+'_'+base)
 env={}
 for item in original['Config']['Env']:
  k,v=item.split('=',1)
  if k in ['PATH','NODE_VERSION','YARN_VERSION']:continue
  for old,new in [('supabase_db_'+base,db),('supabase_auth_'+base,names['auth']),('supabase_rest_'+base,names['rest']),('supabase_storage_'+base,names['storage'])]:v=v.replace(old,new)
  env[k]=v
 if service=='auth':
  env.update(API_EXTERNAL_URL='http://127.0.0.1:55440/auth/v1',GOTRUE_SITE_URL='http://127.0.0.1:55440',GOTRUE_URI_ALLOW_LIST='http://127.0.0.1:55440/**',GOTRUE_JWT_ISSUER='http://127.0.0.1:55440/auth/v1')
 if service=='storage':
  env.update(FILE_STORAGE_BACKEND_PATH='/mnt/v111',ENABLE_IMAGE_TRANSFORMATION='false',IMAGE_TRANSFORMATION_ENABLED='false',VECTOR_ENABLED='false',VECTOR_STORE_MIGRATIONS_ENABLED='false')
 port={'auth':(55441,9999),'rest':(55442,3000),'storage':(55443,5000)}[service]
 args=['docker','run','-d','--name',name,'--network',network,'-p',f'127.0.0.1:{port[0]}:{port[1]}']
 for k,v in env.items():args.extend(['-e',k+'='+v])
 if service=='storage':args.extend(['--mount','type=volume,source=inspection_v111_storage_files,target=/mnt'])
 args.append(original['Config']['Image'])
 run(args)
original_cfg=json.loads(pathlib.Path('/mnt/c/projects/Inspection-supabase-e2e-20261028/.local/status.json').read_text())
(private/'config.json').write_text(json.dumps({'API_URL':'http://127.0.0.1:55440','ANON_KEY':original_cfg['ANON_KEY'],'SERVICE_ROLE_KEY':original_cfg['SERVICE_ROLE_KEY']}))
(private/'original-local-auth-fingerprint.txt').write_text(before)
result={'status':'ready','source':'Existing LOCAL synthetic Supabase stack; no production dump or connection','network_internal':True,'ports_bound_to_loopback':[55441,55442,55443],'full_database_dump_sha256':hashlib.sha256(dump).hexdigest(),'clone_auth_hashes_match':True,'source_auth_unchanged':True,'counts':counts,'applied_migration':fix.name,'migration_sha256':hashlib.sha256(fix.read_bytes()).hexdigest(),'excluded':'pg_cron extension/schema to avoid scheduled jobs; existing Storage object bytes not cloned, test uses newly uploaded synthetic objects','containers':[db,*names.values()]}
(root/'results/environment.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
