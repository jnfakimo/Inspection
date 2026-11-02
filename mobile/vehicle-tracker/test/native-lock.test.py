"""Real JVM processes using the product Java lock; synthetic private temporary files only."""
import pathlib
import queue
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CORE = ROOT / 'modules/inspection-storage-lock/android/src/main/java/expo/modules/inspectionstoragelock/StorageFileLock.java'


def wait_for_holder_ready(process, timeout=5):
    """Read one readiness line without select(), which rejects Windows pipes.

    The reader finishes before communicate() takes ownership of stdout. On any
    readiness failure kill/reap the child and include both streams in the error.
    """
    result = queue.Queue()

    def read_line():
        try:
            result.put((process.stdout.readline(), None))
        except Exception as error:
            result.put(('', error))

    reader = threading.Thread(target=read_line, daemon=True)
    reader.start()
    first = ''
    try:
        first, error = result.get(timeout=timeout)
        reader.join(timeout=5)
        if error is not None:
            raise RuntimeError(f'readiness read failed: {error}')
        if first.strip() != 'HELD':
            raise RuntimeError(f'expected HELD, received {first!r}')
        return process
    except (queue.Empty, RuntimeError) as error:
        reason = 'holder readiness timed out' if isinstance(error, queue.Empty) else str(error)
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        reader.join(timeout=5)
        if reader.is_alive():
            raise AssertionError(f'{reason}; readiness reader failed to stop') from error
        if not first and not result.empty():
            first, _ = result.get_nowait()
        output, stderr = process.communicate(timeout=5)
        raise AssertionError(f'{reason}; exit={process.returncode}; stdout={first + output!r}; stderr={stderr!r}') from error


class NativeLockTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiled = tempfile.TemporaryDirectory(prefix='inspection-native-lock-classes-')
        cls.addClassCleanup(cls.compiled.cleanup)
        subprocess.run(['javac', '-d', cls.compiled.name, str(CORE), str(ROOT / 'test/native/StorageLockProbe.java')], check=True, timeout=30)

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
        return wait_for_holder_ready(process)

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


class NativeProcessHarnessTest(unittest.TestCase):
    """Python child processes exercise the harness only, never JVM/FileLock."""

    def child(self, source):
        process = subprocess.Popen([sys.executable, '-u', '-c', source],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        def stop():
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
        self.addCleanup(stop)
        return process

    def test_ready_then_input_and_both_output_streams(self):
        process = self.child("import sys; print('HELD'); input(); print('RELEASED'); print('diagnostic',file=sys.stderr)")
        self.assertIs(wait_for_holder_ready(process), process)
        output, error = process.communicate('\n', timeout=5)
        self.assertEqual(process.returncode, 0)
        self.assertEqual(output.strip(), 'RELEASED')
        self.assertEqual(error.strip(), 'diagnostic')

    def test_early_failure_reports_exit_and_stderr(self):
        process = self.child("import sys; print('synthetic failure',file=sys.stderr); sys.exit(7)")
        with self.assertRaisesRegex(AssertionError, 'exit=7.*synthetic failure'):
            wait_for_holder_ready(process)

    def test_timeout_kills_child_and_collects_partial_line(self):
        process = self.child("import sys,time; sys.stdout.write('partial'); sys.stdout.flush(); time.sleep(30)")
        with self.assertRaisesRegex(AssertionError, 'timed out.*partial'):
            wait_for_holder_ready(process, timeout=0.5)
        self.assertIsNotNone(process.poll())

    def test_wrong_readiness_kills_child(self):
        process = self.child("import time; print('WRONG'); time.sleep(30)")
        with self.assertRaisesRegex(AssertionError, 'expected HELD.*WRONG'):
            wait_for_holder_ready(process)
        self.assertIsNotNone(process.poll())

    def test_stderr_backpressure_times_out_and_is_collected(self):
        process = self.child("import sys,time; sys.stderr.write('x'*200000); sys.stderr.flush(); time.sleep(30)")
        with self.assertRaisesRegex(AssertionError, 'timed out.*stderr='):
            wait_for_holder_ready(process, timeout=0.5)
        self.assertIsNotNone(process.poll())


if __name__ == '__main__':
    unittest.main(verbosity=2)
