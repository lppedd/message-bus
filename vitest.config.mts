import { defineConfig } from "vitest/config";

// @internal
// noinspection JSUnusedGlobalSymbols
export default defineConfig({
  test: {
    fakeTimers: {
      toFake: ["nextTick", "queueMicrotask"],
    },
    coverage: {
      include: ["src/**.{js,ts}"],
    },
  },
});
