import { env } from 'cloudflare:test'
import app from './index'

export const testEnv = env as unknown as Env

export async function api(bot: string, method: string, path: string, body?: unknown) {
  const res = await app.request(
    `https://zumen.test/api${path}`,
    {
      method,
      headers: {
        authorization: 'Bearer test-bot-key',
        'x-bot': bot,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    testEnv,
  )
  return { status: res.status, json: (await res.json()) as any }
}

export const view = (path: string, init: RequestInit = {}) =>
  app.request(`https://zumen.test${path}`, init, testEnv)

// 案件の始めから、レビューまでを済ませた状態を作る。ID は試験ごとに変える。
export async function reviewedProject() {
  const p = `t${crypto.randomUUID().slice(0, 8)}`
  const ok = async (bot: string, path: string, body: unknown) => {
    const r = await api(bot, 'POST', path, body)
    if (r.status !== 201) throw new Error(`${path} ${r.status} ${JSON.stringify(r.json)}`)
  }
  await ok('oyakata', '/projects', { id: p, name: `試験 ${p}` })
  await ok('hiroidashi', `/projects/${p}/sources`, {
    id: 'file-1',
    name: 'F-101.pdf',
    kind: 'drawing',
    url: 'https://drive.google.com/file/d/file-1/view',
  })
  await ok('hiroidashi', `/projects/${p}/drawing-versions`, {
    id: 'DV-001',
    source_id: 'file-1',
    drawing_no: 'F-101',
    drive_revision: 'Drive v3',
    page_count: 2,
  })
  await ok('hiroidashi', `/projects/${p}/runs`, {
    id: 'RUN-001',
    kind: 'extract',
    method: 'テスト',
  })
  await ok('hiroidashi', `/projects/${p}/candidates`, [
    {
      id: 'C-001',
      run_id: 'RUN-001',
      room_no: 'R01',
      room_name: '受付',
      surface: '床',
      finish: 'ソフトタイル401',
      code: 'KT-F401',
      status: '候補',
    },
    {
      id: 'C-002',
      run_id: 'RUN-001',
      room_no: 'R02',
      room_name: '会議室',
      surface: '壁',
      finish: 'ビニル壁紙',
      code: '要確認',
      status: '要確認',
      needs_check_reason: '品番が途中で切れている',
    },
  ])
  await ok('kakunin', `/projects/${p}/runs`, { id: 'RV-RUN-001', kind: 'review' })
  await ok('kakunin', `/projects/${p}/review-checks`, [
    { run_id: 'RV-RUN-001', candidate_id: 'C-001', candidate_version: 1 },
    { run_id: 'RV-RUN-001', candidate_id: 'C-002', candidate_version: 1 },
  ])
  return p
}
