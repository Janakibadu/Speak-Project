import { defineConfig } from 'vitest/config';
import { testEnv } from './test/testEnv.mjs';

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ['./test/globalSetup.mjs'],
    setupFiles: ['./test/setup.mjs'],
    // All files share one test database, so run them one at a time.
    fileParallelism: false,
  },
});
