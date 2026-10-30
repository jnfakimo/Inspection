package expo.modules.inspectionstoragelock

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class InspectionStorageLockModule : Module() {
  private val owner = UUID.randomUUID().toString()
  private val storageLock by lazy {
    val context = appContext.reactContext ?: error("Storage context unavailable")
    StorageFileLock.forFile(File(context.noBackupFilesDir, "inspection-encrypted-storage-v1.lock"))
  }

  override fun definition() = ModuleDefinition {
    Name("InspectionStorageLock")
    Constants("protocolVersion" to 1)
    AsyncFunction("acquire") { promise: Promise ->
      // Do not block Expo's module queue: the holder must still be able to release.
      waiters.execute {
        try {
          promise.resolve(storageLock.acquire(owner, 30_000))
        } catch (error: Exception) {
          promise.reject("ERR_STORAGE_LOCK", "裝置儲存忙碌或協調失敗，請重試", error)
        }
      }
    }
    Function("release") { token: String -> storageLock.release(owner, token) }
    // Intentionally no OnDestroy/TTL release: outstanding AsyncStorage writes may still run.
    // A destroyed runtime holding the lock requires a process restart; process death releases it.
  }

  companion object {
    private val waiters = Executors.newFixedThreadPool(4)
  }
}
