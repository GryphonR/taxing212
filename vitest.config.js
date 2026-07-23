import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for taxing212 tax-engine unit tests.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
