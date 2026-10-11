import { Hono } from 'hono'
import { html, raw } from 'hono/html'
import { botNames, type App } from '../core/types'
import { setCookie } from 'hono/cookie'
import { current, jst, page, tag, themeOf } from '../core/ui'
import * as q from './queries'

type Row = Record<string, any>
type Detail = NonNullable<Awaited<ReturnType<typeof q.candidate>>>
const who = (bot: unknown) => botNames[String(bot)] ?? String(bot)
const place = (c: Row) => [c.room_no, c.room_name].filter(Boolean).join(' ') || '部屋は要確認'
const where = (c: Row) =>
  html`${place(c)} ·
  ${c.surface}${c.range_text && c.range_text !== c.surface ? html`<small>${c.range_text}</small>` : ''}`

export const pages = new Hono<App>()

pages.get('/', async (c) => {
  const list = await q.projects(c.env.DB)
  return c.html(
    page(
      '案件一覧',
      html`<h1 class="sr-only">案件一覧</h1>
        ${
          list.length
            ? html`<ul class="projects">
                ${list.map(
                  (p) =>
                    html`<li>
                      <a class="card project" href="/p/${p.id}">
                        <strong>${p.name}</strong>
                        <span class="progress">
                          <progress
                            max="${p.total || 1}"
                            value="${p.decided}"
                            aria-label="決定の進み具合"
                          ></progress>
                          <small>${p.decided} / ${p.total} 件 決定</small>
                        </span>
                        <span class="tags">
                          ${tag('あなたの番', p.lanes.you)} ${tag('待ち', p.lanes.wait)}
                          ${tag('ボットの番', p.lanes.bot)} ${tag('重大', p.open_critical_findings)}
                        </span>
                      </a>
                    </li>`,
                )}
              </ul>`
            : html`<p class="lede">
                まだ案件はありません。おやかたに「このフォルダをお願い」と頼むと、ここに並びます。
              </p>`
        }`,
      { home: true, theme: themeOf(c) },
    ),
  )
})

pages.get('/p/:p', async (c) => {
  const id = c.req.param('p')
  const data = await q.project(c.env.DB, id)
  if (!data) return c.notFound()
  const selected = c.req.query('c')
  const [detail, extras] = await Promise.all([
    selected ? q.candidate(c.env.DB, id, selected) : null,
    q.cardExtras(c.env.DB, id),
  ])
  const base = `/p/${id}`
  const loose = data.open_findings.filter((f) => !f.candidate_id)
  const ex = data.exports[0]
  // 最終版のあとで候補が変わったら、書き出しは今の中身と合わない
  const stale =
    ex?.kind === '最終版' && (data.decided < data.total || data.open_critical_findings > 0)
  return c.html(
    page(
      data.project.name,
      html`<h1>${data.project.name}</h1>
        <div class="links">
          <span class="progress">
            <progress
              max="${data.total || 1}"
              value="${data.decided}"
              aria-label="決定の進み具合"
            ></progress>
            <small>${data.decided} / ${data.total} 件 決定</small>
          </span>
          ${
            ex
              ? html`<span class="tags"
                    >書き出し 版 ${ex.version} ${tag(String(ex.kind))}
                    ${ex.verify_result ? tag(String(ex.verify_result)) : ''}
                    ${stale ? tag('その後に変更あり') : ''} · ${jst(ex.created_at)}</span
                  >${
                    ex.sheet_url
                      ? html`<a href="${ex.sheet_url}" target="_blank" rel="noopener noreferrer"
                          >シートを開く<span aria-hidden="true"> ↗</span
                          ><span class="sr-only">（新しいタブで開きます）</span></a
                        >`
                      : ''
                  }`
              : ''
          }
          ${
            data.project.drive_folder_url
              ? html`<a
                  href="${data.project.drive_folder_url}"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Drive のフォルダ<span aria-hidden="true"> ↗</span
                  ><span class="sr-only">（新しいタブで開きます）</span></a
                >`
              : ''
          }
        </div>
        ${
          loose.length
            ? html`<section class="banner" aria-label="候補に紐づかない指摘">
                <h2>候補に紐づかない指摘</h2>
                ${loose.map(finding)}
              </section>`
            : ''
        }
        <div class="board-wrap${detail ? ' has-panel' : ''}">
          <div class="board">
            ${q.LANES.map((lane) => {
              const cards = data.candidates.filter((x) => q.laneOf(x.state).key === lane.key)
              const open = cards.some((x) => x.candidate_id === selected)
              return html`<details class="lane lane-${lane.key}" ${open ? raw('open') : ''}>
                <summary>
                  <span class="lane-title">${lane.label} <b>${cards.length}</b></span>
                  <span class="hint">${lane.hint}</span>
                </summary>
                ${
                  cards.length
                    ? html`<ol>
                        ${cards.map((x) =>
                          card(
                            x,
                            base,
                            x.candidate_id === selected,
                            extras.last.get(x.candidate_id),
                            extras.discontinued.has(x.candidate_id),
                          ),
                        )}
                      </ol>`
                    : html`<p class="empty">なし</p>`
                }
              </details>`
            })}
          </div>
          ${detail ? html`<aside class="panel" aria-label="候補の詳細">${panel(detail, base)}</aside>` : ''}
        </div>`,
      { theme: themeOf(c) },
    ),
  )
})

function card(
  x: q.CandidateState & { state: q.State },
  base: string,
  selected: boolean,
  last: { actor: string; at: string; what: string } | undefined,
  discontinued: boolean,
) {
  return html`<li>
    <a class="kcard" href="${base}?c=${x.candidate_id}" ${current(selected)}>
      <span class="top"><span class="id">${x.candidate_id}</span>${tag(x.state)}</span>
      <span class="what">${where(x)}</span>
      <span class="code">${x.code ?? '品番なし'}</span>
      <span class="tags">
        ${x.status === '要確認' && x.state !== '要確認' ? tag('要確認') : ''}
        ${x.open_critical ? tag('重大', x.open_critical) : ''}
        ${x.open_minor ? tag('軽微', x.open_minor) : ''}
        ${x.match_result && x.match_result !== '一致' ? tag(x.match_result) : ''}
        ${discontinued ? tag('廃番') : ''}
        ${x.reviewed && !x.reviewed_current ? html`<span class="tag t-todo">版${x.version} レビュー前</span>` : ''}
      </span>
      ${last ? html`<small>${who(last.actor)} · ${jst(last.at)} · ${last.what}</small>` : ''}
    </a>
  </li>`
}

function finding(f: Row) {
  return html`<div class="finding">
    ${tag(String(f.severity))} <strong>${f.id}</strong> ${f.finding}
    <small>${who(f.created_by)} · ${jst(f.created_at)}</small>
  </div>`
}

function panel(d: Detail, base: string) {
  const c = d.candidate
  const resolutions = d.reviews.filter((r) => r.resolves_id)
  const findings = d.reviews.filter((r) => !r.resolves_id)
  const history = [
    ...d.decisions.map((x) => ({ at: x.created_at, kind: 'decision', x })),
    ...d.holds.map((x) => ({ at: x.created_at, kind: 'hold', x })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return html`<a class="close" href="${base}"><span aria-hidden="true">✕</span> 閉じる</a>
    <div class="panel-body">
      <h2><span class="id">${c.candidate_id}</span> ${where(c)}</h2>
      <p class="meta">
        ${tag(c.state)} 版
        ${c.version}${c.reviewed && !c.reviewed_current ? '（この版はレビュー前）' : ''}
      </p>
      <dl class="facts">
        ${
          c.symbol
            ? html`<dt>記号</dt>
                <dd>${c.symbol}</dd>`
            : ''
        }
        <dt>仕上げ</dt>
        <dd>${c.finish ?? '―'}</dd>
        <dt>品番</dt>
        <dd>${c.code ?? '品番なし'}</dd>
        ${
          c.needs_check_reason
            ? html`<dt>要確認の理由</dt>
                <dd>${c.needs_check_reason}</dd>`
            : ''
        }
        ${
          c.note
            ? html`<dt>メモ</dt>
                <dd>${c.note}</dd>`
            : ''
        }
      </dl>

      <h3>根拠</h3>
      ${
        d.evidence.length
          ? html`<div class="evidence">
              ${d.evidence.map(
                (e) =>
                  html`<figure>
                    ${
                      e.image_key
                        ? html`<img
                            src="/img/${e.image_key}"
                            alt="${e.drawing_no ?? e.source_name} ${e.page}ページ ${e.kind}の切り出し"
                            loading="lazy"
                          />`
                        : html`<div class="noimage">画像はまだありません</div>`
                    }
                    <figcaption>
                      <strong>${e.id}</strong> ${e.drawing_no ?? e.source_name}
                      ${e.revision_label ? `（${e.revision_label}）` : ''} · ${e.page}ページ ·
                      ${e.kind}
                      <q>${e.text}</q>
                      ${e.room_method ? html`<small>部屋の決め方：${e.room_method}</small>` : ''}
                      ${
                        e.source_url
                          ? html`<a href="${e.source_url}" target="_blank" rel="noopener noreferrer"
                              >原本を開く<span aria-hidden="true"> ↗</span
                              ><span class="sr-only"
                                >（${e.drawing_no ?? e.source_name}、新しいタブで開きます）</span
                              ></a
                            >`
                          : ''
                      }
                    </figcaption>
                  </figure>`,
              )}
            </div>`
          : html`<p class="note">根拠はまだありません。</p>`
      }

      <h3>照合</h3>
      ${
        d.matches.length
          ? html`<ul class="plain">
              ${d.matches.map(
                (m) =>
                  html`<li>
                    ${tag(String(m.result))} 版 ${m.candidate_version}
                    ${
                      m.catalog_code
                        ? html`${m.catalog_code} ${m.item_name ?? ''}（${m.maker} ${m.catalog_title}
                          ${m.edition}）`
                        : ''
                    }
                    ${m.discontinued ? tag('廃番') : ''}
                    ${m.note ? html`<small>${m.note}</small>` : ''}
                  </li>`,
              )}
            </ul>`
          : html`<p class="note">まだ照合していません。</p>`
      }

      <h3>レビュー</h3>
      ${
        d.checks.length
          ? html`<p class="note">
              かくにんが見た版：${[...new Set(d.checks.map((k) => k.candidate_version))].join('・')}
            </p>`
          : html`<p class="note">まだレビューしていません。</p>`
      }
      ${findings.map((f) => {
        const done = resolutions.find((r) => r.resolves_id === f.id)
        return html`<div class="finding${done ? ' done' : ''}">
          ${tag(String(f.severity))} <strong>${f.id}</strong>（版
          ${f.candidate_version}）${f.finding}
          <small>${who(f.created_by)} · ${jst(f.created_at)}</small>
          ${
            done
              ? html`<p class="resolution">
                  閉じた：${done.resolution_note}
                  <small
                    >${done.decided_by ? `${done.decided_by}（本人確認なし・${who(done.created_by)}が記録）` : who(done.created_by)}
                    · ${jst(done.created_at)}</small
                  >
                </p>`
              : html`<p class="resolution open">まだ閉じていません</p>`
          }
        </div>`
      })}

      <h3>判定と保留</h3>
      ${
        history.length
          ? html`<ol class="timeline">
              ${history.map(({ kind, x }) =>
                kind === 'decision'
                  ? html`<li>
                      ${tag(String(x.decision))} 版 ${x.candidate_version} を ${x.decided_by}
                      が${x.decision}
                      <small
                        >${jst(x.created_at)} · チャットで受けたもの（本人確認なし） ·
                        ${x.id}${x.batch_id ? ` · まとめて：${x.batch_id}` : ''}</small
                      >
                      ${
                        x.pattern_id
                          ? html`<p class="pattern">
                              判断パターン
                              ${x.pattern_id}${x.pattern_title ? `「${x.pattern_title}」` : ''}
                              ${x.pattern_rule ? html`<small>${x.pattern_rule}</small>` : ''}
                            </p>`
                          : ''
                      }
                      ${x.note ? html`<p>${x.note}</p>` : ''}
                    </li>`
                  : html`<li>
                      ${tag('保留')}
                      ${x.releases_id ? html`${x.releases_id} を解除：${x.release_note}` : x.reason}
                      <small
                        >${x.decided_by}（本人確認なし） · ${jst(x.created_at)} · ${x.id}</small
                      >
                    </li>`,
              )}
            </ol>`
          : html`<p class="note">まだ判定していません。</p>`
      }

      <h3>版の履歴</h3>
      <ol class="timeline">
        ${d.versions.map(
          (v) =>
            html`<li>
              版 ${v.version}：${v.finish ?? '―'} / ${v.code ?? '品番なし'}
              ${v.status === '要確認' ? tag('要確認') : ''}
              <small>${who(v.created_by)} · ${jst(v.created_at)}</small>
              ${v.reason ? html`<p>${v.reason}</p>` : ''}
            </li>`,
        )}
      </ol>
    </div>`
}

// 明るさの切り替え。押した画面へそのまま戻る。
pages.post('/theme', async (c) => {
  const { theme } = await c.req.parseBody()
  if (theme === 'light' || theme === 'dark')
    setCookie(c, 'theme', theme, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax',
      path: '/',
      maxAge: 365 * 86400,
    })
  let back = '/'
  try {
    const from = new URL(c.req.header('referer') ?? '')
    if (from.origin === new URL(c.req.url).origin) back = from.pathname + from.search
  } catch {}
  return c.redirect(back, 303)
})

pages.get('/img/*', async (c) => {
  let key: string
  try {
    key = decodeURIComponent(c.req.path.slice('/img/'.length))
  } catch {
    return c.notFound()
  }
  if (!key.startsWith('p/')) return c.notFound()
  const object = await c.env.IMAGES.get(key)
  if (!object) return c.notFound()
  c.header('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream')
  c.header('Cache-Control', 'private, max-age=31536000, immutable')
  c.header('X-Content-Type-Options', 'nosniff')
  return c.body(object.body)
})
