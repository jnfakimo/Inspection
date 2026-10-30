import expo.modules.inspectionstoragelock.StorageFileLock;
import java.io.File;
import java.util.concurrent.TimeoutException;

public final class StorageLockProbe {
  public static void main(String[] args) throws Exception {
    StorageFileLock lock = StorageFileLock.forFile(new File(args[0]));
    if (args[1].equals("wait")) {
      try {
        String token = lock.acquire("waiter", 150);
        lock.release("waiter", token);
        System.out.println("GRANTED");
      } catch (TimeoutException expected) { System.out.println("TIMEOUT"); }
      return;
    }
    String token = lock.acquire("holder", 1000);
    if (args[1].equals("identity")) {
      if (lock != StorageFileLock.forFile(new File(args[0]))) throw new AssertionError("channel not shared");
      try { lock.release("other", token); throw new AssertionError("wrong owner released"); }
      catch (SecurityException expected) { /* must remain locked */ }
      try { lock.release("holder", "wrong"); throw new AssertionError("wrong token released"); }
      catch (SecurityException expected) { /* must remain locked */ }
      try { lock.acquire("other", 50); throw new AssertionError("overlap granted"); }
      catch (TimeoutException expected) { /* not a TTL on the owner */ }
    }
    System.out.println("HELD"); System.out.flush();
    // Parent can kill the process here, or explicitly release over stdin.
    if (System.in.read() < 0) throw new AssertionError("unexpected stdin closure");
    lock.release("holder", token);
    try { lock.release("holder", token); throw new AssertionError("stale release accepted"); }
    catch (SecurityException expected) { /* consumed tokens are not reusable */ }
    String next = lock.acquire("next", 1000);
    if (next.equals(token)) throw new AssertionError("token reused");
    lock.release("next", next);
    System.out.println("RELEASED");
  }
}
