import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { BOTS, type App, type Bot } from '../core/types'
import { all, dbError, fail, one, stmt } from '../core/db'
import * as q from './queries'

// ボットの鍵は1つで、どのボットかは X-Bot の申告。下の actors は書き間違いを防ぐためのもので、本人確認ではない。
type Rule =
  | 'id'
  | 'id?'
  | 'text'
  | 'text?'
  | 'long'
  | 'long?'
  | 'int'
  | 'int?'
  | 'url'
  | 'url?'
  | 'list?'
  | 'bbox?'
  | { oneOf: readonly string[]; optional?: true }
type Spec = { table: string; actors: readonly Bot[]; action: string; fields: Record<string, Rule> }

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_IMAGE = 5 * 1024 * 1024

function check(key: string, rule: Rule, raw: unknown): unknown {
  const optional = typeof rule === 'string' ? rule.endsWith('?') : rule.optional
  if (raw === undefined || raw === null || raw === '') {
    if (optional) return rule === 'list?' ? '[]' : null
    fail(`${key} を入れてください。`)
  }
  if (typeof rule === 'object') {
    if (typeof raw !== 'string' || !rule.oneOf.includes(raw))
      fail(`${key} は ${rule.oneOf.join('・')} のどれかにしてください。`)
    return raw
  }
  const base = rule.replace('?', '')
  if (base === 'int') {
    if (!Number.isSafeInteger(raw) || (raw as number) < 1)
      fail(`${key} は1以上の整数にしてください。`)
    return raw
  }
  if (base === 'list') {
    if (
      !Array.isArray(raw) ||
      raw.length > 100 ||
      !raw.every((v) => typeof v === 'string' && v.length <= 200)
    )
      fail(`${key} は文字の配列にしてください。`)
    return JSON.stringify(raw)
  }
  if (base === 'bbox') {
    const b = raw as number[]
    if (
      !Array.isArray(b) ||
      b.length !== 4 ||
      !b.every((v) => typeof v === 'number' && v >= 0 && v <= 1) ||
      b[2]! <= b[0]! ||
      b[3]! <= b[1]!
    )
      fail(`${key} は 0〜1 の [左, 上, 右, 下] にしてください。`)
    return JSON.stringify(b)
  }
  if (typeof raw !== 'string' || !raw.trim()) fail(`${key} は文字で入れてください。`)
  const text = raw.trim()
  if (base === 'id' && !ID.test(text)) fail(`${key} は英数字と - _ . だけの ID にしてください。`)
  if (base === 'url' && !/^https:\/\/\S+$/.test(text))
    fail(`${key} は https の URL にしてください。`)
  if (text.length > (base === 'long' ? 5000 : 500)) fail(`${key} が長すぎます。`)
  return text
}

function rows(body: unknown, fields: Record<string, Rule>) {
  const list = Array.isArray(body) ? body : [body]
  if (!list.length || list.length > 200) fail('1回に送れるのは1〜200件です。')
  return list.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      fail('JSON のオブジェクトを送ってください。')
    const unknown = Object.keys(item).filter((k) => !(k in fields))
    if (unknown.length) fail(`知らない項目があります: ${unknown.join(', ')}`)
    return Object.fromEntries(
      Object.entries(fields).map(([k, r]) => [
        k,
        check(k, r, (item as Record<string, unknown>)[k]),
      ]),
    )
  })
}

const insert = (db: D1Database, table: string, row: Record<string, unknown>) => {
  const keys = Object.keys(row)
  return stmt(
    db,
    `INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ...keys.map((k) => row[k]),
  )
}
const event = (
  db: D1Database,
  project: string | null,
  actor: Bot,
  action: string,
  target: unknown,
  detail: unknown,
) =>
  insert(db, 'event_log', {
    project_id: project,
    actor,
    action,
    target_id: target == null ? null : String(target),
    detail: JSON.stringify(detail),
  })

async function run(db: D1Database, statements: D1PreparedStatement[]) {
  try {
    await db.batch(statements)
  } catch (e) {
    dbError(e)
  }
}

const versionFields = {
  room_no: 'text?',
  room_name: 'text?',
  surface: 'text',
  range_text: 'text?',
  symbol: 'text?',
  finish: 'long?',
  code: 'text?',
  status: { oneOf: ['候補', '要確認'] },
  needs_check_reason: 'long?',
  note: 'long?',
} as const satisfies Record<string, Rule>

const projectSpecs: Record<string, Spec> = {
  sources: {
    table: 'sources',
    actors: ['oyakata', 'hiroidashi', 'katarogu'],
    action: 'source.added',
    fields: { id: 'id', name: 'text', kind: { oneOf: ['drawing', 'catalog'] }, url: 'url?' },
  },
  'drawing-versions': {
    table: 'drawing_versions',
    actors: ['hiroidashi'],
    action: 'drawing_version.recorded',
    fields: {
      id: 'id',
      source_id: 'id',
      drawing_no: 'text?',
      title: 'text?',
      revision_label: 'text?',
      drive_revision: 'text',
      page_count: 'int?',
      replaces_id: 'id?',
    },
  },
  runs: {
    table: 'runs',
    actors: ['hiroidashi', 'katarogu', 'kakunin'],
    action: 'run.started',
    fields: { id: 'id', kind: { oneOf: ['extract', 'match', 'review'] }, method: 'long?' },
  },
  matches: {
    table: 'catalog_matches',
    actors: ['katarogu'],
    action: 'match.recorded',
    fields: {
      id: 'id',
      run_id: 'id',
      candidate_id: 'id',
      candidate_version: 'int',
      result: { oneOf: ['一致', '不一致', '未登録', '品番なし', '照合保留'] },
      catalog_id: 'id?',
      catalog_code: 'text?',
      note: 'long?',
    },
  },
  'review-checks': {
    table: 'review_checks',
    actors: ['kakunin'],
    action: 'review.checked',
    fields: { run_id: 'id', candidate_id: 'id', candidate_version: 'int' },
  },
  reviews: {
    table: 'reviews',
    actors: ['kakunin', 'oyakata'],
    action: 'review.recorded',
    fields: {
      id: 'id',
      run_id: 'id?',
      candidate_id: 'id?',
      candidate_version: 'int?',
      severity: { oneOf: ['重大', '軽微'], optional: true },
      finding: 'long?',
      evidence_refs: 'list?',
      resolves_id: 'id?',
      resolution_note: 'long?',
      decided_by: 'text?',
    },
  },
  holds: {
    table: 'holds',
    actors: ['oyakata'],
    action: 'hold.recorded',
    fields: {
      id: 'id',
      candidate_id: 'id',
      reason: 'long?',
      releases_id: 'id?',
      release_note: 'long?',
      decided_by: 'text',
    },
  },
  decisions: {
    table: 'decisions',
    actors: ['oyakata'],
    action: 'decision.recorded',
    fields: {
      id: 'id',
      candidate_id: 'id',
      candidate_version: 'int',
      decision: { oneOf: ['承認', '対象外'] },
      decided_by: 'text',
      batch_id: 'text?',
      pattern_id: 'id?',
      note: 'long?',
    },
  },
  exports: {
    table: 'exports',
    actors: ['kakidashi'],
    action: 'export.recorded',
    fields: {
      id: 'id',
      version: 'int',
      kind: { oneOf: ['最終版', '作業版'] },
      sheet_url: 'url',
      xlsx_url: 'url?',
      verify_result: { oneOf: ['一致', 'ずれあり'], optional: true },
      note: 'long?',
    },
  },
  references: {
    table: 'reference_items',
    actors: ['hiroidashi', 'kakunin', 'oyakata'],
    action: 'reference.added',
    fields: {
      id: 'id',
      category: 'text',
      room_no: 'text?',
      room_name: 'text?',
      surface: 'text?',
      range_text: 'text?',
      text: 'long',
      evidence_id: 'id?',
      related_review_id: 'id?',
      note: 'long?',
    },
  },
}

function allow(bot: Bot, actors: readonly Bot[]) {
  if (!actors.includes(bot))
    fail(`この記録は ${actors.join('・')} が書きます（X-Bot: ${bot}）。`, 403)
}
// 1件ずつしか受けないところで、配列の2件目以降を黙って捨てないようにする
const single = (input: unknown) => {
  if (Array.isArray(input)) fail('ここは1件ずつ送ってください（配列は使えません）。')
  return input
}
async function body(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json()
  } catch {
    fail('JSON を送ってください。')
  }
}
async function digest(text: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
}
async function saveImage(
  env: Env,
  project: string,
  evidenceId: string,
  type: unknown,
  bytes: Uint8Array,
) {
  if (typeof type !== 'string' || !IMAGE_TYPES.includes(type))
    fail('画像は png・jpeg・webp にしてください。')
  if (!bytes.length || bytes.length > MAX_IMAGE) fail('画像は5MBまでです。', 413)
  const key = `p/${project}/evidence/${evidenceId}/${crypto.randomUUID()}`
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type } })
  return key
}

export const api = new Hono<App>()
api.use(
  '*',
  bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json({ error: '送る内容が大きすぎます。' }, 413),
  }),
)
api.use('*', async (c, next) => {
  const given = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1]
  const key = c.env.BOT_API_KEY
  if (!key || !given || !crypto.subtle.timingSafeEqual(await digest(given), await digest(key)))
    return c.json({ error: 'API の鍵が違います。' }, 401)
  const bot = c.req.header('x-bot')
  if (!BOTS.includes(bot as Bot))
    return c.json({ error: `X-Bot に ${BOTS.join('・')} のどれかを入れてください。` }, 400)
  c.set('bot', bot as Bot)
  await next()
})

api.get('/projects', async (c) => c.json(await q.projects(c.env.DB)))
api.post('/projects', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['oyakata'])
  const [row] = rows(single(await body(c)), { id: 'text', name: 'text', drive_folder_url: 'url?' })
  if (!PROJECT_ID.test(String(row!.id)))
    fail('案件の ID は小文字の英数字と - にしてください（例: sazanami）。')
  await run(c.env.DB, [
    insert(c.env.DB, 'projects', { ...row, created_by: bot }),
    event(c.env.DB, String(row!.id), bot, 'project.created', row!.id, row),
  ])
  return c.json({ ok: true, id: row!.id }, 201)
})

api.get('/projects/:p', async (c) => {
  const detail = await q.project(c.env.DB, c.req.param('p'))
  if (!detail) fail('案件が見つかりません。', 404)
  return c.json(detail)
})
api.get('/projects/:p/candidates/:c', async (c) => {
  const detail = await q.candidate(c.env.DB, c.req.param('p'), c.req.param('c'))
  if (!detail) fail('候補が見つかりません。', 404)
  return c.json(detail)
})
api.get('/projects/:p/log', async (c) => {
  const after = Number(c.req.query('after') ?? 0)
  return c.json(await q.log(c.env.DB, c.req.param('p'), Number.isSafeInteger(after) ? after : 0))
})
api.post('/projects/:p/log', async (c) => {
  const bot = c.get('bot')
  const p = c.req.param('p')
  const input = (await body(c)) as Record<string, unknown>
  const [row] = rows(
    { action: input?.action, target_id: input?.target_id },
    { action: 'text', target_id: 'text?' },
  )
  if (!/^[a-z_]+(\.[a-z_]+)+$/.test(String(row!.action)))
    fail('action は backup.saved のような形にしてください。')
  if (input.detail !== undefined && (typeof input.detail !== 'object' || input.detail === null))
    fail('detail はオブジェクトにしてください。')
  await run(c.env.DB, [
    event(c.env.DB, p, bot, String(row!.action), row!.target_id, input.detail ?? {}),
  ])
  return c.json({ ok: true }, 201)
})

api.post('/projects/:p/candidates', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['hiroidashi'])
  const p = c.req.param('p')
  const list = rows(await body(c), { id: 'id', run_id: 'id', ...versionFields })
  await run(
    c.env.DB,
    list.flatMap(({ id, run_id, ...fields }) => [
      insert(c.env.DB, 'candidates', { project_id: p, id, run_id, created_by: bot }),
      insert(c.env.DB, 'candidate_versions', {
        project_id: p,
        candidate_id: id,
        version: 1,
        ...fields,
        created_by: bot,
      }),
      event(c.env.DB, p, bot, 'candidate.created', id, { run_id, ...fields }),
    ]),
  )
  return c.json({ ok: true, ids: list.map((r) => r.id) }, 201)
})
api.post('/projects/:p/candidates/:c/versions', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['hiroidashi', 'oyakata'])
  const p = c.req.param('p')
  const id = c.req.param('c')
  const [{ base_version, ...fields }] = rows(single(await body(c)), {
    base_version: 'int',
    ...versionFields,
    reason: 'long',
  }) as [Record<string, unknown>]
  const version = (base_version as number) + 1
  await run(c.env.DB, [
    insert(c.env.DB, 'candidate_versions', {
      project_id: p,
      candidate_id: id,
      version,
      ...fields,
      created_by: bot,
    }),
    event(c.env.DB, p, bot, 'candidate.revised', id, { version, ...fields }),
  ])
  return c.json({ ok: true, id, version }, 201)
})

api.post('/projects/:p/evidence', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['hiroidashi'])
  const p = c.req.param('p')
  const input = await body(c)
  const list = Array.isArray(input) ? input : [input]
  const images = list.map((item) => (item as Record<string, unknown>)?.image)
  const parsed = rows(
    list.map((item) => {
      const { image: _image, ...rest } = (item ?? {}) as Record<string, unknown>
      return rest
    }),
    {
      id: 'id',
      candidate_id: 'id?',
      drawing_version_id: 'id',
      page: 'int',
      kind: 'text',
      text: 'long',
      location: 'text?',
      bbox: 'bbox?',
      room_method: 'text?',
    },
  )
  const keys: string[] = []
  try {
    for (const [i, row] of parsed.entries()) {
      const image = images[i] as { content_type?: unknown; base64?: unknown } | undefined
      if (!image) continue
      if (typeof image.base64 !== 'string') fail('image.base64 を入れてください。')
      let bytes: Uint8Array
      try {
        bytes = Uint8Array.from(atob(image.base64), (ch) => ch.charCodeAt(0))
      } catch {
        fail('image.base64 を読み取れません。')
      }
      const key = await saveImage(c.env, p, String(row.id), image.content_type, bytes)
      keys.push(key)
      row.image_key = key
    }
    await run(
      c.env.DB,
      parsed.flatMap((row) => [
        insert(c.env.DB, 'evidence', { project_id: p, ...row, created_by: bot }),
        event(c.env.DB, p, bot, 'evidence.added', row.id, { ...row, text: undefined }),
      ]),
    )
  } catch (e) {
    await Promise.all(keys.map((k) => c.env.IMAGES.delete(k)))
    throw e
  }
  return c.json({ ok: true, ids: parsed.map((r) => r.id) }, 201)
})
// レビューのために、根拠画像を鍵つきで読む（画面の /img と同じものを返す）
api.get('/projects/:p/evidence/:e/image', async (c) => {
  const row = await one<{ image_key: string | null }>(
    c.env.DB,
    'SELECT image_key FROM evidence WHERE project_id=? AND id=?',
    c.req.param('p'),
    c.req.param('e'),
  )
  const object = row?.image_key ? await c.env.IMAGES.get(row.image_key) : null
  if (!object) fail('根拠画像が見つかりません。', 404)
  c.header('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream')
  c.header('X-Content-Type-Options', 'nosniff')
  return c.body(object.body)
})
api.put('/projects/:p/evidence/:e/image', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['hiroidashi'])
  const p = c.req.param('p')
  const id = c.req.param('e')
  const key = await saveImage(
    c.env,
    p,
    id,
    c.req.header('content-type')?.split(';')[0],
    new Uint8Array(await c.req.arrayBuffer()),
  )
  try {
    const found = await one(
      c.env.DB,
      'SELECT 1 AS ok FROM evidence WHERE project_id=? AND id=?',
      p,
      id,
    )
    if (!found) fail('根拠が見つかりません。', 404)
    await run(c.env.DB, [
      stmt(c.env.DB, 'UPDATE evidence SET image_key=? WHERE project_id=? AND id=?', key, p, id),
      event(c.env.DB, p, bot, 'evidence.image_added', id, { image_key: key }),
    ])
  } catch (e) {
    await c.env.IMAGES.delete(key)
    throw e
  }
  return c.json({ ok: true, image_key: key }, 201)
})

for (const [path, spec] of Object.entries(projectSpecs))
  api.post(`/projects/:p/${path}`, async (c) => {
    const bot = c.get('bot')
    allow(bot, spec.actors)
    const p = c.req.param('p')
    const list = rows(await body(c), spec.fields)
    await run(
      c.env.DB,
      list.flatMap((row) => [
        insert(c.env.DB, spec.table, { project_id: p, ...row, created_by: bot }),
        event(c.env.DB, p, bot, spec.action, row.id ?? row.candidate_id, row),
      ]),
    )
    return c.json({ ok: true, count: list.length }, 201)
  })

api.get('/catalogs', async (c) => c.json(await q.catalog(c.env.DB, c.req.query('q') ?? '')))
api.post('/catalogs', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['katarogu'])
  const list = rows(await body(c), {
    id: 'id',
    maker: 'text',
    title: 'text',
    edition: 'text',
    url: 'url?',
  })
  await run(
    c.env.DB,
    list.flatMap((row) => [
      insert(c.env.DB, 'catalogs', { ...row, created_by: bot }),
      event(c.env.DB, null, bot, 'catalog.added', row.id, row),
    ]),
  )
  return c.json({ ok: true, count: list.length }, 201)
})
api.post('/catalogs/:cat/items', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['katarogu'])
  const cat = c.req.param('cat')
  const list = rows(await body(c), {
    code: 'text',
    name: 'text',
    use: 'text?',
    spec: 'text?',
    color: 'text?',
    page: 'int?',
  })
  await run(c.env.DB, [
    ...list.map((row) =>
      insert(c.env.DB, 'catalog_items', { catalog_id: cat, ...row, created_by: bot }),
    ),
    event(c.env.DB, null, bot, 'catalog.items_added', cat, { codes: list.map((r) => r.code) }),
  ])
  return c.json({ ok: true, count: list.length }, 201)
})
api.post('/catalogs/:cat/items/:code/discontinue', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['katarogu'])
  const [row] = rows(single(await body(c)), { note: 'long' })
  const { cat, code } = c.req.param()
  if (
    !(await one(
      c.env.DB,
      'SELECT 1 AS ok FROM catalog_items WHERE catalog_id=? AND code=?',
      cat,
      code,
    ))
  )
    fail('品番が見つかりません。', 404)
  await run(c.env.DB, [
    stmt(
      c.env.DB,
      'UPDATE catalog_items SET discontinued=1 WHERE catalog_id=? AND code=?',
      cat,
      code,
    ),
    event(c.env.DB, null, bot, 'catalog.item_discontinued', `${cat}/${code}`, row),
  ])
  return c.json({ ok: true }, 201)
})

api.get('/patterns', async (c) => c.json(await q.patterns(c.env.DB)))
api.post('/patterns', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['oyakata'])
  const list = rows(await body(c), {
    id: 'id',
    title: 'text',
    rule: 'long',
    decision: { oneOf: ['承認', '対象外', '保留'] },
    source_decisions: 'list?',
  })
  await run(
    c.env.DB,
    list.flatMap((row) => [
      insert(c.env.DB, 'judgment_patterns', { ...row, created_by: bot }),
      event(c.env.DB, null, bot, 'pattern.added', row.id, row),
    ]),
  )
  return c.json({ ok: true, count: list.length }, 201)
})
api.post('/patterns/:id/retire', async (c) => {
  const bot = c.get('bot')
  allow(bot, ['oyakata'])
  const [row] = rows(single(await body(c)), { note: 'long' })
  const id = c.req.param('id')
  if (!(await all(c.env.DB, 'SELECT 1 FROM judgment_patterns WHERE id=?', id)).length)
    fail('判断パターンが見つかりません。', 404)
  await run(c.env.DB, [
    stmt(
      c.env.DB,
      "UPDATE judgment_patterns SET retired_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      id,
    ),
    event(c.env.DB, null, bot, 'pattern.retired', id, row),
  ])
  return c.json({ ok: true }, 201)
})
