import base64,hashlib,hmac,json,pathlib,secrets,subprocess,time,urllib.request,urllib.error
root=pathlib.Path('/mnt/c/projects/Inspection-evidence-v110-20261111')
db='inspection_evidence_v110_db_v2';rest='inspection_evidence_v110_rest_v2';network='inspection_evidence_v110_v2'
checks=[];created=[]
def cmd(args,input=None):
 return subprocess.check_output(args,input=input,text=True,stderr=subprocess.PIPE).strip()
def sql(s): return cmd(['docker','exec','-i',db,'psql','-h','/tmp','-U','review_owner','-d','postgres','-v','ON_ERROR_STOP=1','-At'],s)
def check(name,condition,detail=None):
 checks.append({'name':name,'pass':bool(condition),'detail':detail})
 if not condition: raise AssertionError(name)
def function(source,name):
 at=source.index('create or replace function public.'+name+'(')
 end=source.index('$$;',at)+3
 return source[at:end]
def read(p):return (root/'current'/p).read_text(encoding='utf-8-sig')
jwt_secret=secrets.token_hex(32)
u='00000000-0000-0000-0000-000000000001';v='00000000-0000-0000-0000-000000000002';adm='00000000-0000-0000-0000-000000000003'
def token(actor=u,expired=False,key=None):
 enc=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=').decode()
 body=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':'authenticated','sub':actor,'exp':int(time.time())+(-60 if expired else 600)})
 sig=base64.urlsafe_b64encode(hmac.new((key or jwt_secret).encode(),body.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
 return body+'.'+sig
origin=None
def request(path,method='GET',data=None,actor=u,expired=False,key=None,anonymous=False):
 assert origin and origin.startswith('http://172.') and path.startswith('/') and '://' not in path
 hdr={'Content-Type':'application/json','Prefer':'return=representation'}
 if not anonymous:hdr['Authorization']='Bearer '+token(actor,expired,key)
 req=urllib.request.Request(origin+path,data=json.dumps(data).encode() if data is not None else None,headers=hdr,method=method)
 try:
  with urllib.request.urlopen(req,timeout=8) as response:status=response.status;body=response.read()
 except urllib.error.HTTPError as e:status=e.code;body=e.read()
 return status,json.loads(body) if body else None
try:
 for n in [db,rest]:
  assert subprocess.run(['docker','inspect',n],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0,'Existing container preserved'
 assert subprocess.run(['docker','network','inspect',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0,'Existing network preserved'
 cmd(['docker','network','create','--internal',network])
 image='public.ecr.aws/supabase/postgres:17.11.0.006'
 start="initdb -D /tmp/review-db -U review_owner --auth=trust --no-locale >/tmp/review-init.log && echo 'host all all 0.0.0.0/0 trust' >> /tmp/review-db/pg_hba.conf && exec postgres -D /tmp/review-db -c listen_addresses='*' -c unix_socket_directories=/tmp"
 cmd(['docker','run','-d','--name',db,'--network',network,'--user','postgres','--entrypoint','sh',image,'-c',start]);created.append(db)
 for _ in range(60):
  try:
   if sql('select 1')=='1':break
  except subprocess.CalledProcessError:time.sleep(.25)
 else:raise RuntimeError('Dedicated DB not ready')
 sql(f"""
 create role anon nologin; create role authenticated nologin; create role service_role nologin;
 create role authenticator login noinherit; grant anon,authenticated to authenticator;
 create table fixture_users(id uuid primary key,status text,role_id text,session_valid boolean,markets jsonb);
 insert into fixture_users values('{u}','active','reporter',true,'["market_1"]'),('{v}','active','reporter',true,'["market_2"]'),('{adm}','active','sysadmin',true,'[]');
 create function active_user_id() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.fixture_users where id=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'
 $$;
 """.replace("where id=nullif","where id::text=nullif").replace("::jsonb->>'sub'\n","::jsonb->>'sub' and status='active' and session_valid\n"))
 sql("""
 create function active_rbac_role() returns text language sql stable security definer set search_path='' as $$select role_id from public.fixture_users where id=public.active_user_id()$$;
 create function is_admin() returns boolean language sql stable as $$ select public.active_rbac_role()='sysadmin' $$;
 create function handover_staff_markets(uuid,text) returns jsonb language sql stable security definer set search_path='' as $$select markets from public.fixture_users where id=$1$$;
 create table user_system_access(user_id uuid,system_key text,mode text);
 create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
 create table role_module_access(role_id text,system_key text,module_key text,mode text);
 create table role_permissions(role_id text,perm text,allowed boolean);
 insert into role_permissions values('reporter','sys_handover',true),('reporter','sys_meetingroom',true);
 create table meeting_bookings(booking_id int primary key,user_id uuid,note text);
 alter table meeting_bookings enable row level security;alter table meeting_bookings force row level security;
 create table business_probe(id int primary key,market_code text,note text);
 alter table business_probe enable row level security;alter table business_probe force row level security;
 create policy business_probe_policy on business_probe for all to authenticated using(public.active_user_id() is not null) with check(public.active_user_id() is not null);
 grant usage on schema public to anon,authenticated;
 grant select,insert,update on meeting_bookings,business_probe to authenticated;
 create table google_calendar_oauth_states(state_hash text);
 """)
 for name in ['has_system_access','has_module_access','has_handover_module_access']:
  sql(function(read('supabase/migrations/20260914220000_access_control_schema_reconciliation.sql'),name))
 old=read('supabase/migrations/20260808090000_non_admin_bulk_read_cutoff.sql')
 at=old.index('    create policy meeting_bookings_authenticated_read');end=old.index('  end if;',at)
 sql(old[at:end])
 sql(function(read('supabase/migrations/20260916132000_business_handover_market.sql'),'business_market_allowed'))
 sql("drop policy business_probe_policy on business_probe; create policy business_probe_policy on business_probe for all to authenticated using(public.business_market_allowed(market_code)) with check(public.business_market_allowed(market_code));")
 sql(f"insert into meeting_bookings values(1,'{u}','own'),(2,'{v}','other');insert into business_probe values(1,'market_1','one'),(2,'market_2','two');insert into user_module_access values('{u}','meetingroom','bookings','deny'),('{u}','handover','business','deny');")
 cmd(['docker','run','-d','--name',rest,'--network',network,'-e',f'PGRST_DB_URI=postgres://authenticator@{db}:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_PRE_REQUEST=','-e','PGRST_JWT_SECRET='+jwt_secret,'public.ecr.aws/supabase/postgrest:v16.5']);created.append(rest)
 ip=json.loads(cmd(['docker','inspect',rest]))[0]['NetworkSettings']['Networks'][network]['IPAddress'];origin='http://'+ip+':3000'
 for _ in range(40):
  try:
   status,body=request('/meeting_bookings?select=booking_id,note')
   if status==200:break
  except (urllib.error.URLError,ConnectionError):pass
  time.sleep(.25)
 check('original active+valid-session+module-deny can read bookings',status==200 and len(body)==2)
 status,body=request('/meeting_bookings?booking_id=eq.1','PATCH',{'note':'old-own-update'})
 check('original denied user can update own booking',status==200 and len(body)==1)
 status,body=request('/business_probe?select=id,market_code,note')
 check('original denied user can read qualified market only',status==200 and [x['market_code'] for x in body]==['market_1'])
 status,body=request('/rpc/business_market_allowed','POST',{'p_market':'market_1'})
 check('original direct RPC ignores business module deny',status==200 and body is True)
 status,body=request('/business_probe','POST',{'id':3,'market_code':'market_2','note':'blocked'})
 check('original market boundary remains enforced',status==403)
 sql(read('supabase/migrations/20261106050736_codex_security_boundary_fixes.sql'))
 # Policy/function changes are immediate; schema cache is not needed for existing request signatures.
 status,body=request('/meeting_bookings?select=booking_id,note')
 check('fixed denied user cannot read bookings',status==200 and body==[])
 status,body=request('/meeting_bookings?booking_id=eq.1','PATCH',{'note':'must-not-change'})
 check('fixed denied user cannot update own booking',status==200 and body==[])
 check('denied update leaves original row unchanged',sql('select note from meeting_bookings where booking_id=1')=='old-own-update')
 status,body=request('/meeting_bookings','POST',{'booking_id':3,'user_id':u,'note':'denied'})
 check('fixed denied user cannot insert own booking',status==403)
 status,body=request('/business_probe?select=id,market_code,note')
 check('fixed denied user cannot read business market',status==200 and body==[])
 status,body=request('/rpc/business_market_allowed','POST',{'p_market':'market_1'})
 check('fixed direct RPC enforces module deny',status==200 and body is False)
 status,body=request('/business_probe','POST',{'id':3,'market_code':'market_1','note':'denied'})
 check('fixed denied user cannot write qualified market',status==403)
 status,body=request('/meeting_bookings?select=booking_id',expired=True);check('expired JWT rejected by real PostgREST',status==401)
 status,body=request('/meeting_bookings?select=booking_id',key='invalid-signing-key-for-test-only');check('forged JWT rejected by real PostgREST',status==401)
 status,body=request('/meeting_bookings?select=booking_id',anonymous=True);check('anonymous table access denied',status==401)
 sql("update user_module_access set mode='allow'")
 status,body=request('/meeting_bookings?select=booking_id,note');check('fixed allowed user reads legitimate bookings',status==200 and len(body)==2)
 status,body=request('/meeting_bookings?booking_id=eq.1','PATCH',{'note':'legal-update'});check('fixed allowed user updates own booking',status==200 and len(body)==1)
 status,body=request('/meeting_bookings?booking_id=eq.2','PATCH',{'note':'other-update'});check('fixed allowed user cannot update others',status==200 and body==[])
 status,body=request('/meeting_bookings','POST',{'booking_id':3,'user_id':u,'note':'legal-insert'});check('fixed allowed user inserts own booking',status==201)
 status,body=request('/business_probe?select=id,market_code');check('fixed allowed user retains market boundary',status==200 and [x['market_code'] for x in body]==['market_1'])
 sql(f"insert into user_system_access values('{u}','meetingroom','deny'),('{u}','handover','deny')")
 for path in ['/meeting_bookings?select=booking_id','/business_probe?select=id']:
  status,body=request(path);check('system deny overrides module allow '+path,status==200 and body==[])
 sql('delete from user_system_access')
 for change,name in [("session_valid=false",'invalid session'),("status='inactive'",'inactive user')]:
  sql(f"update fixture_users set {change} where id='{u}'")
  for path in ['/meeting_bookings?select=booking_id','/business_probe?select=id']:
   status,body=request(path);check(name+' denied '+path,status==200 and body==[])
  sql(f"update fixture_users set session_valid=true,status='active' where id='{u}'")
 status,body=request('/meeting_bookings?booking_id=eq.2','PATCH',{'note':'admin-update'},actor=adm);check('fixed administrator legitimate update',status==200 and len(body)==1)
 net=json.loads(cmd(['docker','network','inspect',network]))[0]
 check('isolated network internal, no published ports',net['Internal'] and all(not json.loads(cmd(['docker','inspect',n]))[0]['HostConfig'].get('PortBindings') for n in created))
 check('authenticator cannot bypass RLS',sql("select rolsuper::text||','||rolbypassrls::text from pg_roles where rolname='authenticator'")=='false,false')
 result={'status':'pass','checks':checks,'count':len(checks),'environment':{'postgres':'17.11','postgrest':'16.5','db_schemas':'public','db_pre_request':'','network_internal':True,'published_ports':0,'real_http':True,'real_jwt_verification':True},'limitations':['Synthetic identity/session/market fixtures; not production active_user_id implementation or Auth login','Real source permission helpers and original meeting policy plus unmodified security migration; business_probe is synthetic minimal table, not full business schema/triggers','No proof of historical production grants, gateway configuration, identities or event history']}
except Exception as e:
 result={'status':'fail','checks':checks,'error':type(e).__name__+': '+str(e)[:300]}
finally:
 for name in reversed(created):
  subprocess.run(['docker','stop',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 result['created_containers_stopped']=created
 (root/'results/rest-boundary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'status':result['status'],'checks':len(checks),'error':result.get('error'),'stopped':created},ensure_ascii=False))
 if result['status']!='pass':raise SystemExit(1)
