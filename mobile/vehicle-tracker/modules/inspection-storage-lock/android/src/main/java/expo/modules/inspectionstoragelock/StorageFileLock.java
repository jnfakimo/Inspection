package expo.modules.inspectionstoragelock;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeoutException;

/** Process-wide channel plus OS lock. Never unlink the lock file or expire a live owner. */
public final class StorageFileLock {
  private static final Map<String, StorageFileLock> INSTANCES = new HashMap<>();
  private final RandomAccessFile file;
  private final FileChannel channel;
  private FileLock lock;
  private String owner;
  private String token;

  public static synchronized StorageFileLock forFile(File path) throws IOException {
    String canonical = path.getCanonicalPath();
    StorageFileLock instance = INSTANCES.get(canonical);
    if (instance == null) {
      instance = new StorageFileLock(new File(canonical));
      INSTANCES.put(canonical, instance);
    }
    return instance;
  }

  private StorageFileLock(File path) throws IOException {
    // One channel per inode per process: closing another descriptor can release POSIX locks.
    file = new RandomAccessFile(path, "rw");
    channel = file.getChannel();
  }

  public String acquire(String requestedOwner, long waitMillis) throws Exception {
    if (requestedOwner == null || waitMillis < 0 || waitMillis > 30_000) {
      throw new IllegalArgumentException("Invalid storage lock request");
    }
    long started = System.nanoTime();
    do {
      synchronized (this) {
        if (token == null) {
          FileLock candidate = channel.tryLock();
          if (candidate != null) {
            lock = candidate;
            owner = requestedOwner;
            token = UUID.randomUUID().toString();
            return token;
          }
        }
      }
      if ((System.nanoTime() - started) / 1_000_000 >= waitMillis) break;
      Thread.sleep(10);
    } while (true);
    throw new TimeoutException("Storage is busy; retry after the current operation completes");
  }

  public synchronized void release(String requestedOwner, String requestedToken) throws IOException {
    if (token == null || !token.equals(requestedToken) || !owner.equals(requestedOwner)) {
      throw new SecurityException("Invalid storage lock owner");
    }
    // Keep state occupied if releasing the OS lock fails. No unsafe fallback.
    lock.release();
    lock = null;
    token = null;
    owner = null;
  }
}
