import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' }, // so pages can be rendered in tests
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    // DB-backed tests run against a separate database; see README "Tests".
    // Tests that store tokens, sign links or seal secrets need a key; a fixed test-only one keeps them self-contained.
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://preci:preci@localhost:5432/preciops_test', NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'test-only-secret-never-used-in-production' },
    fileParallelism: false,
  },
});
