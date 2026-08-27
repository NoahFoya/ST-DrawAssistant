import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        exclude: ['src_legacy_backup/**', 'node_modules/**', 'dist/**'],
        environment: 'node'
    }
});
