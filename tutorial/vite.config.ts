import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    // App tests opt into jsdom per file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
