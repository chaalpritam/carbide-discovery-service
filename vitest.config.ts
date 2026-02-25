import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
    },
    env: {
      AUTH_ENABLED: 'false',
      DATABASE_PATH: ':memory:',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
