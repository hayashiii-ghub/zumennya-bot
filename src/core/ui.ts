import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { html, raw } from 'hono/html'

// 表示の明るさは、押すまで端末に合わせる。押したら cookie に覚える。
export type Theme = 'light' | 'dark'
export const themeOf = (c: Context): Theme | undefined => {
  const t = getCookie(c, 'theme')
  return t === 'light' || t === 'dark' ? t : undefined
}

export const current = (on: boolean) => (on ? raw(' aria-current="page"') : '')

const listIcon = html`<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
  <path
    d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
  />
</svg>`
export function page(title: string, body: unknown, opts: { home?: boolean; theme?: Theme } = {}) {
  const theme = opts.theme
  return html`<!doctype html>
    <html lang="ja" ${theme ? raw(`data-theme="${theme}"`) : ''}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <meta name="color-scheme" content="${theme ?? 'dark light'}" />
        ${
          theme
            ? html`<meta
                name="theme-color"
                content="${theme === 'light' ? '#fffcf0' : '#1a1513'}"
              />`
            : html`<meta
                  name="theme-color"
                  content="#1a1513"
                  media="(prefers-color-scheme: dark)"
                />
                <meta name="theme-color" content="#fffcf0" media="(prefers-color-scheme: light)" />`
        }
        <meta name="robots" content="noindex,nofollow" />
        <title>${title === '図面帳' ? title : `${title} · 図面帳`}</title>
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32" />
        <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Yusei+Magic&family=Zen+Maru+Gothic:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>
        <div class="grid" aria-hidden="true"></div>
        <header class="bar">
          <a class="home" href="/" ${current(!!opts.home)}>${listIcon}案件一覧</a>
          <div class="bar-end">
            <span class="tag t-check">デモ（架空のデータ）</span>
            <form class="theme" method="post" action="/theme">
              <button class="link to-light" type="submit" name="theme" value="light">
                ライト表示
              </button>
              <button class="link to-dark" type="submit" name="theme" value="dark">
                ダーク表示
              </button>
            </form>
          </div>
        </header>
        <main id="main">${body}</main>
      </body>
    </html>`
}

const stateClass: Record<string, string> = {
  承認待ち: 'wait',
  要確認: 'check',
  重大あり: 'crit',
  重大: 'crit',
  保留: 'hold',
  未レビュー: 'todo',
  承認済み: 'ok',
  承認: 'ok',
  対象外: 'out',
  軽微: 'minor',
  一致: 'ok',
  不一致: 'crit',
  未登録: 'check',
  品番なし: 'todo',
  照合保留: 'hold',
  廃番: 'crit',
  最終版: 'ok',
  ずれあり: 'crit',
  その後に変更あり: 'check',
  あなたの番: 'wait',
  待ち: 'hold',
  ボットの番: 'todo',
}
export const tag = (label: string, count?: number) =>
  html`<span class="tag t-${stateClass[label] ?? 'todo'}${count === 0 ? ' zero' : ''}"
    >${label}${count === undefined ? '' : html` <b>${count}</b>`}</span
  >`

const jstFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
export const jst = (iso: unknown) =>
  typeof iso === 'string' ? jstFormat.format(new Date(iso)) : ''
