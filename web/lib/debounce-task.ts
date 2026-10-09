export function debounceTask<T extends (...args: any[]) => unknown>(task: T, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const delay = Math.max(0, delayMs);

  return {
    schedule(...args: Parameters<T>) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void task(...args);
      }, delay);
    },
    cancel() {
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
