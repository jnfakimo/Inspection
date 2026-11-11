import sys,json,base64,http.client,subprocess
req=json.load(sys.stdin)
mapping={'auth':('inspection_v111_auth_v2',9999),'rest':('inspection_v111_rest_v2',3000),'storage':('inspection_v111_storage_v2',5000)}
name,port=mapping[req['service']]
info=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
assert set(info['NetworkSettings']['Networks'])=={'inspection_v111_v2'}
ip=info['NetworkSettings']['Networks']['inspection_v111_v2']['IPAddress']
assert ip.startswith('172.') and req['path'].startswith('/') and not req['path'].startswith('//')
headers={k:v for k,v in req['headers'].items() if k.lower() not in ('host','connection','content-length')}
con=http.client.HTTPConnection(ip,port,timeout=45)
con.request(req['method'],req['path'],base64.b64decode(req['body']),headers)
r=con.getresponse()
json.dump({'status':r.status,'headers':dict(r.getheaders()),'body':base64.b64encode(r.read()).decode()},sys.stdout)
con.close()
