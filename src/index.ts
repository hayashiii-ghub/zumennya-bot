import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { html } from 'hono/html'
import type { App } from './core/types'
import { page, themeOf } from './core/ui'
import { api } from './workflow/api'
import { pages } from './workflow/pages'

const app = new Hono<App>()
app.use(
  '*',
  secureHeaders({
    xFrameOptions: 'DENY',
    referrerPolicy: 'same-origin',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
  }),
)
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  // 画面からの送信（明るさの切り替え）は同じ画面からだけ受け付ける。ボットの API は鍵で確かめる。
  if (!['GET', 'HEAD'].includes(c.req.method) && !c.req.path.startsWith('/api/')) {
    if (c.req.header('Origin') !== new URL(c.req.url).origin)
      return c.text('このアプリの画面から操作してください。', 403)
  }
  await next()
})
app.route('/api', api)
app.route('/', pages)

app.notFound((c) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: '見つかりません。' }, 404)
    : c.html(
        page(
          '見つかりません',
          html`<h1>見つかりません</h1>
            <p><a href="/">案件へ戻る</a></p>`,
          { theme: themeOf(c) },
        ),
        404,
      ),
)
app.onError((error, c) => {
  const known = error instanceof HTTPException
  const status = known ? error.status : 500
  const message = known
    ? error.message
    : '処理できませんでした。時間をおいてもう一度お試しください。'
  if (!known) console.error('request failed', { path: c.req.path, error: String(error) })
  if (c.req.path.startsWith('/api/')) return c.json({ error: message }, status)
  return c.html(
    page(
      '確認してください',
      html`<h1>確認してください</h1>
        <p class="alert">${message}</p>`,
      { theme: themeOf(c) },
    ),
    status,
  )
})

export default app
