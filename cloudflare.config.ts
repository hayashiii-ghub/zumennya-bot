import { bindings, defineConfig } from 'cf/config'
import * as entrypoint from './src/index.ts' with { type: 'cf-worker' }

export default defineConfig(() => ({
  worker: {
    name: 'zumennya-bot',
    compatibilityDate: '2026-10-06',
    entrypoint,
    observability: { enabled: true },
    env: {
      DB: bindings.d1({ id: '4953b8de-7363-417b-b9ed-dcbc3456ced4', name: 'zumennya-bot' }),
      IMAGES: bindings.r2({ name: 'zumennya-bot' }),
      BOT_API_KEY: bindings.secret(),
    },
  },
}))
