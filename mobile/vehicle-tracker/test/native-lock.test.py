"""Real JVM processes using the product Java lock; synthetic private temporary files only."""
import pathlib
import select
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CORE = ROOT / 'modules/inspection-storage-lock/android/src/main/java/expo/modules/inspectionstoragelock/StorageFileLock.java'


class NativeLockTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiled = tempfile.TemporaryDirectory(prefix='inspection-native-lock-classes-')
        subprocess.run(['javac', '-d', cls.compiled.name, str(CORE), str(ROOT / 'test/native/StorageLockProbe.java')], check=True, timeout=30)

    @classmethod
    def tearDownClass(cls):
        cls.compiled.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='inspection-native-lock-data-')
        self.addCleanup(self.temp.cleanup)
        self.path = str(pathlib.Path(self.temp.name) / 'storage.lock')

    def command(self, mode):
        return ['java', '-cp', self.compiled.name, 'StorageLockProbe', self.path, mode]

    def start_holder(self, mode='hold'):
        process = subprocess.Popen(self.command(mode), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        def stop():
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
        self.addCleanup(stop)
        self.assertTrue(select.select([process.stdout], [], [], 5)[0], 'holder did not report readiness')
        self.assertEqual(process.stdout.readline().strip(), 'HELD')
        return process

    def wait_result(self):
        return subprocess.run(self.command('wait'), check=True, capture_output=True, text=True, timeout=5).stdout.strip()

    def test_two_processes_and_wait_timeout_never_steal_owner(self):
        owner = self.start_holder()
        for _ in range(3):
            self.assertEqual(self.wait_result(), 'TIMEOUT')
            self.assertIsNone(owner.poll())
        output, error = owner.communicate('\n', timeout=5)
        self.assertEqual(owner.returncode, 0, error)
        self.assertIn('RELEASED', output)
        self.assertEqual(self.wait_result(), 'GRANTED')

    def test_os_recovers_after_holder_process_is_killed(self):
        owner = self.start_holder()
        self.assertEqual(self.wait_result(), 'TIMEOUT')
        owner.kill()
        owner.communicate(timeout=5)
        self.assertNotEqual(owner.returncode, 0)
        self.assertEqual(self.wait_result(), 'GRANTED')

    def test_same_process_channels_bad_owner_and_stale_tokens(self):
        owner = self.start_holder('identity')
        # Internal failed contenders must not close a second descriptor and drop the OS lock.
        self.assertEqual(self.wait_result(), 'TIMEOUT')
        output, error = owner.communicate('\n', timeout=5)
        self.assertEqual(owner.returncode, 0, error)
        self.assertIn('RELEASED', output)
        self.assertEqual(self.wait_result(), 'GRANTED')


if __name__ == '__main__':
    unittest.main(verbosity=2)
