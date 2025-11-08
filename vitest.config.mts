import { coverageConfigDefaults, defineConfig } from "vitest/config";

// @internal
// noinspection JSUnusedGlobalSymbols
export default defineConfig({
  test: {
    fakeTimers: {
      toFake: ["nextTick", "queueMicrotask"],
    },
    coverage: {
      all: false,
      exclude: [...coverageConfigDefaults.exclude],
    },
  },
});
