type LatestOnlyTaskContext = {
  isCurrent: () => boolean;
};

export function createLatestOnlyTaskScheduler<
  TKey extends object,
  THandle,
>(options: {
  schedule: (key: TKey, run: () => void) => THandle;
  cancel: (key: TKey, handle: THandle) => void;
  onError?: (error: unknown) => void;
}) {
  const generations = new WeakMap<TKey, number>();
  const pendingHandles = new WeakMap<TKey, THandle>();

  const nextGeneration = (key: TKey): number => {
    const generation = (generations.get(key) || 0) + 1;
    generations.set(key, generation);
    return generation;
  };

  const clearPending = (key: TKey): void => {
    const pendingHandle = pendingHandles.get(key);
    if (pendingHandle === undefined) return;
    pendingHandles.delete(key);
    options.cancel(key, pendingHandle);
  };

  return {
    schedule(
      key: TKey,
      task: (context: LatestOnlyTaskContext) => void | Promise<void>,
    ): number {
      const generation = nextGeneration(key);
      clearPending(key);
      let handle: THandle;
      const run = () => {
        if (pendingHandles.get(key) === handle) {
          pendingHandles.delete(key);
        }
        if (generations.get(key) !== generation) return;
        Promise.resolve(
          task({
            isCurrent: () => generations.get(key) === generation,
          }),
        ).catch((error) => {
          options.onError?.(error);
        });
      };
      handle = options.schedule(key, run);
      pendingHandles.set(key, handle);
      return generation;
    },
    invalidate(key: TKey): number {
      const generation = nextGeneration(key);
      clearPending(key);
      return generation;
    },
  };
}
