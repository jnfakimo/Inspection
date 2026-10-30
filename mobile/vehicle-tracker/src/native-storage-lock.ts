import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type StorageCoordinator = { protocolVersion: number; acquire(): Promise<string>; release(token: string): void };
const coordinator = requireOptionalNativeModule<StorageCoordinator>('InspectionStorageLock');
// One queue per runtime avoids piling up native waiters; the OS lock spans all runtimes/processes.
let tail: Promise<unknown> = Promise.resolve();

export function withStorageCoordinator<T>(operation: (canCollect: boolean) => Promise<T>): Promise<T> {
  if (Platform.OS !== 'android') return operation(false);
  const result = tail.then(async () => {
    if (!coordinator || coordinator.protocolVersion !== 1) {
      throw new Error('請安裝含原生儲存協調模組的新版應用程式');
    }
    const token = await coordinator.acquire();
    try { return await operation(true); }
    finally { coordinator.release(token); }
  });
  tail = result.catch(() => undefined);
  return result;
}
