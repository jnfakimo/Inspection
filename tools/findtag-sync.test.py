import copy
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('findtag_sync',Path(__file__).with_name('findtag-sync.py'))
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)

class SyncTests(unittest.TestCase):
    def state(self):return {'token':'a'*64,'pending':[]}
    def item(self):return {'hash':'synthetic','captured_at':'2026-09-08T12:00:00+00:00','rows':[{'device_label':'合成設備','address_text':'合成地址','source_time_text':'2026-09-08 20:00:00'}]}
    def test_network_failure_retains_pending(self):
        state=self.state();sync.enqueue(state,self.item())
        def fail(*args):raise sync.SyncError('斷線')
        with self.assertRaises(sync.SyncError):sync.upload_one(state,fail)
        self.assertEqual(len(state['pending']),1)
        sync.enqueue(state,self.item());self.assertEqual(len(state['pending']),1)
        self.assertTrue(sync.upload_one(state,lambda *args:{'accepted':True,'duplicate':True}))
        self.assertFalse(state['pending'])
    def test_unconfirmed_response_keeps_pending(self):
        state=self.state();sync.enqueue(state,self.item())
        with self.assertRaises(sync.SyncError):sync.upload_one(state,lambda *args:{'accepted':False})
        self.assertEqual(len(state['pending']),1)
    def test_queue_bounds_do_not_erase(self):
        state=self.state();state['pending']=[{'hash':str(n)} for n in range(sync.MAX_PENDING)]
        old=copy.deepcopy(state)
        with self.assertRaises(sync.SyncError):sync.enqueue(state,self.item())
        self.assertEqual(old,state)
    def test_payload_never_sends_coordinates(self):
        row={**self.item()['rows'][0],'latitude':25,'longitude':121,'external_device_id':'not-trusted'}
        item=sync.payload({'captured_at':self.item()['captured_at'],'observations':[row]})
        self.assertEqual(set(item['rows'][0]),{'device_label','address_text','source_time_text'})
    def test_reject_service_role_key(self):
        import json,base64
        val=base64.urlsafe_b64encode(json.dumps({'role':'service_role','ref':'qztffronusdhgxhjjubt'}).encode()).decode().rstrip('=')
        with self.assertRaises(sync.SyncError):sync.validate_public_key('x.'+val+'.x')
    def test_redirect_is_rejected(self):
        with self.assertRaises(sync.SyncError):sync.NoRedirect().redirect_request(None,None,307,'',{},'https://example.com')
    def test_reads_failure_still_retries_pending(self):
        state=self.state();sync.enqueue(state,self.item());calls=[]
        with patch.object(sync.probe,'collect',side_effect=sync.probe.ProbeError('非白名單')),patch.object(sync,'save_state'),patch.object(sync,'status_file'):
            result=sync.cycle(Path('.'),state,None,lambda *args:calls.append(args) or {'accepted':True})
        self.assertFalse(result);self.assertFalse(state['pending']);self.assertEqual(len(calls),1)
        self.assertIs(calls[0][2]['p_live_read'],False)
    def test_storage_failure_does_not_upload(self):
        state=self.state();sync.enqueue(state,self.item());calls=[]
        with patch.object(sync.probe,'collect',side_effect=sync.probe.ProbeError('非白名單')),patch.object(sync,'save_state',side_effect=sync.SyncError('磁碟錯誤')):
            with self.assertRaises(sync.SyncError):sync.cycle(Path('.'),state,None,lambda *args:calls.append(args))
        self.assertFalse(calls)
    def test_oversize_is_rejected_before_queue(self):
        snapshot={'captured_at':self.item()['captured_at'],'observations':[{'device_label':'名'*256,'address_text':'地'*1536,'source_time_text':'2026-09-08 12:00:00'}]*200}
        with self.assertRaises(sync.SyncError):sync.payload(snapshot)
    @unittest.skipUnless(os.name=='nt','Windows DPAPI only')
    def test_real_dpapi_and_worker_lock(self):
        raw=b'synthetic-token-only'
        encrypted=sync.protect(raw)
        self.assertNotIn(raw,encrypted);self.assertEqual(sync.protect(encrypted,True),raw)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)
            sync.save_state(path,{'synthetic':True});self.assertEqual(sync.load_state(path),{'synthetic':True})
            with sync.WorkerLock(path):
                with self.assertRaises(sync.SyncError):
                    with sync.WorkerLock(path):pass
            with sync.WorkerLock(path):pass

if __name__=='__main__':unittest.main()
