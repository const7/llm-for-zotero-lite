import { assert } from "chai";
import { createLatestOnlyTaskScheduler } from "../src/modules/contextPanel/latestOnlyTaskScheduler";

describe("latestOnlyTaskScheduler", function () {
  it("runs only the latest queued task for the same key", function () {
    const scheduled: Array<() => void> = [];
    const scheduler = createLatestOnlyTaskScheduler<object, number>({
      schedule: (_key, run) => {
        scheduled.push(run);
        return scheduled.length - 1;
      },
      cancel: (_key, handle) => {
        scheduled[handle] = () => {};
      },
    });
    const key = {};
    const seen: string[] = [];

    scheduler.schedule(key, () => {
      seen.push("first");
    });
    scheduler.schedule(key, () => {
      seen.push("second");
    });

    scheduled[0]?.();
    scheduled[1]?.();

    assert.deepEqual(seen, ["second"]);
  });

  it("marks an in-flight task stale once a newer one is scheduled", async function () {
    const scheduled: Array<() => void> = [];
    const scheduler = createLatestOnlyTaskScheduler<object, number>({
      schedule: (_key, run) => {
        scheduled.push(run);
        return scheduled.length - 1;
      },
      cancel: (_key, handle) => {
        scheduled[handle] = () => {};
      },
    });
    const key = {};
    let resolveFirstTask: (() => void) | null = null;
    let beforeReplacement = false;
    let afterReplacement = true;

    scheduler.schedule(key, async ({ isCurrent }) => {
      beforeReplacement = isCurrent();
      await new Promise<void>((resolve) => {
        resolveFirstTask = resolve;
      });
      afterReplacement = isCurrent();
    });

    scheduled[0]?.();

    scheduler.schedule(key, () => {});

    resolveFirstTask?.();
    await Promise.resolve();

    assert.isTrue(beforeReplacement);
    assert.isFalse(afterReplacement);
  });

  it("keeps separate keys independent", function () {
    const scheduled: Array<() => void> = [];
    const scheduler = createLatestOnlyTaskScheduler<object, number>({
      schedule: (_key, run) => {
        scheduled.push(run);
        return scheduled.length - 1;
      },
      cancel: (_key, handle) => {
        scheduled[handle] = () => {};
      },
    });
    const firstKey = {};
    const secondKey = {};
    const seen: string[] = [];

    scheduler.schedule(firstKey, () => {
      seen.push("first-key");
    });
    scheduler.schedule(secondKey, () => {
      seen.push("second-key");
    });

    scheduled[0]?.();
    scheduled[1]?.();

    assert.deepEqual(seen, ["first-key", "second-key"]);
  });
});
