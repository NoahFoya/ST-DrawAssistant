import { defineConfig } from 'vitest/config';

const isLive = process.argv.some((a) => a.includes('integration')) || Boolean(process.env.TEST_LIVE);

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        include: ['tests/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**', ...(isLive ? [] : ['tests/integration/**'])]
    }
});
