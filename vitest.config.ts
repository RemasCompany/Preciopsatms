import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    // DB-backed tests run against a separate database; see README "Tests".
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://preci:preci@localhost:5432/preciops_test' },
    fileParallelism: false,
  },
});
