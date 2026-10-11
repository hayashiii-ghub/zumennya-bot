import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2026-10-06',
        d1Databases: ['DB'],
        r2Buckets: ['IMAGES'],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          BOT_API_KEY: 'test-bot-key',
        },
      },
    }),
  ],
  test: { include: ['src/**/*.test.ts'], setupFiles: ['./src/test-setup.ts'] },
}))
