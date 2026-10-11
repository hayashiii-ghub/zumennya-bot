import { describe, expect, it } from 'vitest'
import { api, reviewedProject, testEnv } from './test-helpers'

const decide = (p: string, id: string, candidate: string, version: number, decision = '承認') =>
  api('oyakata', 'POST', `/projects/${p}/decisions`, {
    id,
    candidate_id: candidate,
    candidate_version: version,
    decision,
    decided_by: '担当の人',
  })

describe('ボットの鍵', () => {
  it('鍵がないと読めず、ボット名がないと進めない', async () => {
    const { default: app } = await import('./index')
    const none = await app.request('https://zumen.test/api/projects', {}, testEnv)
    expect(none.status).toBe(401)
    const noBot = await app.request(
      'https://zumen.test/api/projects',
      { headers: { authorization: 'Bearer test-bot-key' } },
      testEnv,
    )
    expect(noBot.status).toBe(400)
    expect((await api('oyakata', 'GET', '/projects')).status).toBe(200)
  })
  it('役割の違う記録は書けない', async () => {
    const p = await reviewedProject()
    const r = await api('hiroidashi', 'POST', `/projects/${p}/decisions`, {
      id: 'DC-001',
      candidate_id: 'C-001',
      candidate_version: 1,
      decision: '承認',
      decided_by: '担当の人',
    })
    expect(r.status).toBe(403)
  })
  it('1件ずつのところに配列は送れない', async () => {
    const r = await api('oyakata', 'POST', '/projects', [
      { id: 'array-a', name: 'A' },
      { id: 'array-b', name: 'B' },
    ])
    expect(r.status).toBe(400)
  })
  it('知らない項目は受け付けない', async () => {
    const p = await reviewedProject()
    const r = await api('hiroidashi', 'POST', `/projects/${p}/runs`, {
      id: 'RUN-002',
      kind: 'extract',
      extra: 1,
    })
    expect(r.status).toBe(400)
    expect(r.json.error).toContain('extra')
  })
})

describe('承認の決まり', () => {
  it('レビューを通った候補を承認でき、状態が承認済みになる', async () => {
    const p = await reviewedProject()
    expect((await decide(p, 'DC-001', 'C-001', 1)).status).toBe(201)
    const state = await api('oyakata', 'GET', `/projects/${p}`)
    expect(state.json.candidates.find((c: any) => c.candidate_id === 'C-001').state).toBe(
      '承認済み',
    )
    expect(state.json.counts['承認済み']).toBe(1)
    expect(state.json.drawings.map((d: any) => d.id)).toEqual(['DV-001'])
    expect(state.json.exports).toEqual([])
  })

  it('一度もレビューされていない候補は承認できない', async () => {
    const p = await reviewedProject()
    await api('hiroidashi', 'POST', `/projects/${p}/candidates`, {
      id: 'C-003',
      run_id: 'RUN-001',
      surface: '天井',
      status: '候補',
    })
    const r = await decide(p, 'DC-001', 'C-003', 1)
    expect(r.status).toBe(409)
    expect(r.json.error).toContain('レビュー')
  })

  it('要確認の版は承認できず、採用値を新しい版にしてから承認する', async () => {
    const p = await reviewedProject()
    const blocked = await decide(p, 'DC-001', 'C-002', 1)
    expect(blocked.status).toBe(409)
    expect(blocked.json.error).toContain('要確認')
    const noReason = await api('oyakata', 'POST', `/projects/${p}/candidates/C-002/versions`, {
      base_version: 1,
      surface: '壁',
      code: 'KT-W247',
      status: '候補',
    })
    expect(noReason.status).toBe(400)
    const revised = await api('oyakata', 'POST', `/projects/${p}/candidates/C-002/versions`, {
      base_version: 1,
      room_no: 'R02',
      room_name: '会議室',
      surface: '壁',
      finish: 'ビニル壁紙',
      code: 'KT-W247',
      status: '候補',
      reason: '設計者に確認して KT-W247 に決めた（チャットで担当の人から）',
    })
    expect(revised.json).toEqual({ ok: true, id: 'C-002', version: 2 })
    expect((await decide(p, 'DC-001', 'C-002', 1)).status).toBe(409)
    expect((await decide(p, 'DC-002', 'C-002', 2)).status).toBe(201)
    const detail = await api('kakunin', 'GET', `/projects/${p}/candidates/C-002`)
    expect(detail.json.candidate.state).toBe('承認済み')
    expect(detail.json.candidate.reviewed_current).toBe(0)
  })

  it('要確認の文字を残したまま候補にはできない', async () => {
    const p = await reviewedProject()
    const r = await api('oyakata', 'POST', `/projects/${p}/candidates/C-002/versions`, {
      base_version: 1,
      surface: '壁',
      code: '要確認',
      status: '候補',
      reason: 'ためし',
    })
    expect(r.status).toBe(400)
  })

  it('古い版を土台にした更新は重なりとして止まる', async () => {
    const p = await reviewedProject()
    const body = {
      base_version: 1,
      surface: '床',
      code: 'KT-F401',
      status: '候補',
      reason: '範囲を追記',
    }
    expect(
      (await api('hiroidashi', 'POST', `/projects/${p}/candidates/C-001/versions`, body)).status,
    ).toBe(201)
    const stale = await api('hiroidashi', 'POST', `/projects/${p}/candidates/C-001/versions`, body)
    expect(stale.status).toBe(409)
    expect(stale.json.error).toContain('版')
  })

  it('重大な指摘が残る間は承認できず、閉じられるのはかくにんか人の判断だけ', async () => {
    const p = await reviewedProject()
    const finding = {
      id: 'RV-001',
      run_id: 'RV-RUN-001',
      candidate_id: 'C-001',
      candidate_version: 1,
      severity: '重大',
      finding: '品番の読み違い',
    }
    expect((await api('hiroidashi', 'POST', `/projects/${p}/reviews`, finding)).status).toBe(403)
    expect((await api('kakunin', 'POST', `/projects/${p}/reviews`, finding)).status).toBe(201)
    const blocked = await decide(p, 'DC-001', 'C-001', 1)
    expect(blocked.status).toBe(409)
    expect(blocked.json.error).toContain('重大')

    const byBotWithoutPerson = await api('oyakata', 'POST', `/projects/${p}/reviews`, {
      id: 'RV-001-R1',
      resolves_id: 'RV-001',
      resolution_note: '問題なし',
    })
    expect(byBotWithoutPerson.status).toBe(400)
    const closed = await api('kakunin', 'POST', `/projects/${p}/reviews`, {
      id: 'RV-001-R1',
      resolves_id: 'RV-001',
      resolution_note: '直った版を確かめた',
    })
    expect(closed.status).toBe(201)
    const again = await api('kakunin', 'POST', `/projects/${p}/reviews`, {
      id: 'RV-001-R2',
      resolves_id: 'RV-001',
      resolution_note: 'もう一度',
    })
    expect(again.status).toBe(409)
    expect((await decide(p, 'DC-001', 'C-001', 1)).status).toBe(201)
  })

  it('保留中は承認できず、解除すると承認できる', async () => {
    const p = await reviewedProject()
    const hold = {
      id: 'HD-001',
      candidate_id: 'C-001',
      reason: '設計者に確認',
      decided_by: '担当の人',
    }
    expect((await api('oyakata', 'POST', `/projects/${p}/holds`, hold)).status).toBe(201)
    expect(
      (await api('oyakata', 'POST', `/projects/${p}/holds`, { ...hold, id: 'HD-002' })).status,
    ).toBe(409)
    expect((await decide(p, 'DC-001', 'C-001', 1)).status).toBe(409)
    expect((await decide(p, 'DC-002', 'C-001', 1, '対象外')).status).toBe(201)
    const release = await api('oyakata', 'POST', `/projects/${p}/holds`, {
      id: 'HD-003',
      candidate_id: 'C-001',
      releases_id: 'HD-001',
      release_note: '設計者から回答あり',
      decided_by: '担当の人',
    })
    expect(release.status).toBe(201)
    expect((await decide(p, 'DC-003', 'C-001', 1)).status).toBe(201)
    const detail = await api('oyakata', 'GET', `/projects/${p}/candidates/C-001`)
    expect(detail.json.candidate.state).toBe('承認済み')
    expect(detail.json.decisions.map((d: any) => d.id)).toEqual(['DC-002', 'DC-003'])
  })
})

describe('追記だけ', () => {
  it('判定は書き換えも削除もできない', async () => {
    const p = await reviewedProject()
    await decide(p, 'DC-001', 'C-001', 1)
    await expect(
      testEnv.DB.prepare("UPDATE decisions SET decision='対象外' WHERE project_id=?").bind(p).run(),
    ).rejects.toThrow('追記だけ')
    await expect(
      testEnv.DB.prepare('DELETE FROM decisions WHERE project_id=?').bind(p).run(),
    ).rejects.toThrow('追記だけ')
    await expect(testEnv.DB.prepare('DELETE FROM event_log').run()).rejects.toThrow('追記だけ')
  })

  it('根拠画像は最初の1回だけ登録でき、R2 に残る', async () => {
    const p = await reviewedProject()
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47))
    const created = await api('hiroidashi', 'POST', `/projects/${p}/evidence`, {
      id: 'E-001',
      candidate_id: 'C-001',
      drawing_version_id: 'DV-001',
      page: 1,
      kind: '仕上表',
      text: '床 KT-F401',
      bbox: [0.1, 0.2, 0.5, 0.3],
      image: { content_type: 'image/png', base64: png },
    })
    expect(created.status).toBe(201)
    const row = await testEnv.DB.prepare('SELECT image_key FROM evidence WHERE project_id=?')
      .bind(p)
      .first<{ image_key: string }>()
    expect(row!.image_key).toMatch(new RegExp(`^p/${p}/evidence/E-001/`))
    expect(await (await testEnv.IMAGES.get(row!.image_key))!.text()).toHaveLength(4)

    const { default: app } = await import('./index')
    const again = await app.request(
      `https://zumen.test/api/projects/${p}/evidence/E-001/image`,
      {
        method: 'PUT',
        headers: {
          authorization: 'Bearer test-bot-key',
          'x-bot': 'hiroidashi',
          'content-type': 'image/png',
        },
        body: new Uint8Array([1, 2, 3]),
      },
      testEnv,
    )
    expect(again.status).toBe(409)
    const objects = await testEnv.IMAGES.list({ prefix: `p/${p}/` })
    expect(objects.objects).toHaveLength(1)
  })

  it('根拠のページは図面のページ数まで、図面の版の差し替えは1回だけ', async () => {
    const p = await reviewedProject()
    const r = await api('hiroidashi', 'POST', `/projects/${p}/evidence`, {
      id: 'E-001',
      drawing_version_id: 'DV-001',
      page: 3,
      kind: '注記',
      text: '下地',
    })
    expect(r.status).toBe(409)
    const dv = {
      source_id: 'file-1',
      drawing_no: 'F-101',
      drive_revision: 'Drive v4',
      replaces_id: 'DV-001',
    }
    await api('hiroidashi', 'POST', `/projects/${p}/sources`, {
      id: 'file-2',
      name: 'F-102.pdf',
      kind: 'drawing',
    })
    const self = { ...dv, id: 'DV-SELF', replaces_id: 'DV-SELF' }
    expect((await api('hiroidashi', 'POST', `/projects/${p}/drawing-versions`, self)).status).toBe(
      409,
    )
    const other = { ...dv, id: 'DV-OTHER', source_id: 'file-2' }
    expect((await api('hiroidashi', 'POST', `/projects/${p}/drawing-versions`, other)).status).toBe(
      409,
    )
    expect(
      (await api('hiroidashi', 'POST', `/projects/${p}/drawing-versions`, { ...dv, id: 'DV-002' }))
        .status,
    ).toBe(201)
    expect(
      (await api('hiroidashi', 'POST', `/projects/${p}/drawing-versions`, { ...dv, id: 'DV-003' }))
        .status,
    ).toBe(409)
  })

  it('範囲の外の bbox は受け付けない', async () => {
    const p = await reviewedProject()
    const r = await api('hiroidashi', 'POST', `/projects/${p}/evidence`, {
      id: 'E-001',
      drawing_version_id: 'DV-001',
      page: 1,
      kind: '注記',
      text: '下地',
      bbox: [0.5, 0.2, 0.4, 0.3],
    })
    expect(r.status).toBe(400)
  })
})

describe('カタログ・判断パターン・ログ', () => {
  it('品番は廃番の印だけ付けられ、照合結果から使っている案件が分かる', async () => {
    const p = await reviewedProject()
    const cat = `CAT-${p}`
    await api('katarogu', 'POST', '/catalogs', {
      id: cat,
      maker: '架空建材',
      title: '内装材',
      edition: `2026 ${p}`,
    })
    await api('katarogu', 'POST', `/catalogs/${cat}/items`, [
      { code: 'KT-F401', name: 'ソフトタイル401', page: 1 },
    ])
    await api('katarogu', 'POST', `/projects/${p}/runs`, { id: 'M-RUN-001', kind: 'match' })
    const match = await api('katarogu', 'POST', `/projects/${p}/matches`, {
      id: 'M-001',
      run_id: 'M-RUN-001',
      candidate_id: 'C-001',
      candidate_version: 1,
      result: '一致',
      catalog_id: cat,
      catalog_code: 'KT-F401',
    })
    expect(match.status).toBe(201)
    expect(
      (
        await api('katarogu', 'POST', `/catalogs/${cat}/items/KT-F401/discontinue`, {
          note: '2027年で廃番',
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await api('katarogu', 'POST', `/catalogs/${cat}/items/KT-F401/discontinue`, {
          note: 'もう一度',
        })
      ).status,
    ).toBe(409)
    const list = await api('oyakata', 'GET', `/catalogs?q=KT-F401`)
    const item = list.json.items.find((i: any) => i.catalog_id === cat)
    expect(item.discontinued).toBe(1)
    expect(item.projects).toBe(p)
    const detail = await api('oyakata', 'GET', `/projects/${p}/candidates/C-001`)
    expect(detail.json.matches[0].catalog_page).toBe(1)
  })

  it('一致は品番が文字どおり同じで、カタログの品番を指すときだけ', async () => {
    const p = await reviewedProject()
    const cat = `CAT-X-${p}`
    await api('katarogu', 'POST', '/catalogs', {
      id: cat,
      maker: '架空建材',
      title: '内装材',
      edition: `2026 ${p}`,
    })
    await api('katarogu', 'POST', `/catalogs/${cat}/items`, [
      { code: 'KT-F402', name: 'ソフトタイル402' },
    ])
    await api('katarogu', 'POST', `/projects/${p}/runs`, { id: 'M-RUN-001', kind: 'match' })
    const m = {
      id: 'M-001',
      run_id: 'M-RUN-001',
      candidate_id: 'C-001',
      candidate_version: 1,
      result: '一致',
    }
    const similar = await api('katarogu', 'POST', `/projects/${p}/matches`, {
      ...m,
      catalog_id: cat,
      catalog_code: 'KT-F402',
    })
    expect(similar.status).toBe(409)
    expect(similar.json.error).toContain('文字どおり')
    const noCatalog = await api('katarogu', 'POST', `/projects/${p}/matches`, {
      ...m,
      catalog_code: 'KT-F401',
    })
    expect(noCatalog.status).toBe(400)
    const noCode = await api('katarogu', 'POST', `/projects/${p}/matches`, {
      ...m,
      catalog_id: cat,
    })
    expect(noCode.status).toBe(400)
  })

  it('判断パターンは使うのをやめる印だけ付けられる', async () => {
    const p = await reviewedProject()
    await decide(p, 'DC-001', 'C-001', 1)
    const id = `PT-${p}`
    const created = await api('oyakata', 'POST', '/patterns', {
      id,
      title: 'カタログ一致の床',
      rule: '品番がカタログに一致した床はまとめて聞く',
      decision: '承認',
      source_decisions: [`${p}/DC-001`],
    })
    expect(created.status).toBe(201)
    const listed = await api('oyakata', 'GET', '/patterns')
    expect(listed.json.find((x: any) => x.id === id).sources[0].decision.candidate_id).toBe('C-001')
    expect(
      (await api('oyakata', 'POST', `/patterns/${id}/retire`, { note: '使わない' })).status,
    ).toBe(201)
    expect(
      (await api('oyakata', 'POST', `/patterns/${id}/retire`, { note: 'もう一度' })).status,
    ).toBe(409)
  })

  it('かきだしはバックアップしたことをログに残せる', async () => {
    const p = await reviewedProject()
    const r = await api('kakidashi', 'POST', `/projects/${p}/log`, {
      action: 'backup.saved',
      target_id: 'sheet',
      detail: { url: 'https://docs.google.com/spreadsheets/d/x' },
    })
    expect(r.status).toBe(201)
    const log = await api('oyakata', 'GET', `/projects/${p}/log`)
    expect(log.json[0]).toMatchObject({
      actor: 'kakidashi',
      action: 'backup.saved',
      target_id: 'sheet',
    })
    expect(
      log.json.some((e: any) => e.action === 'candidate.created' && e.actor === 'hiroidashi'),
    ).toBe(true)
    // after を付けると、その次から古い順に読み進められる
    const first = log.json.at(-1).seq
    const forward = await api('oyakata', 'GET', `/projects/${p}/log?after=${first}`)
    expect(forward.json[0].seq).toBe(first + 1)
    expect(forward.json[1].seq).toBeGreaterThan(forward.json[0].seq)
  })
})

describe('書き出し', () => {
  const ex = (p: string, body: Record<string, unknown>, bot = 'kakidashi') =>
    api(bot, 'POST', `/projects/${p}/exports`, {
      sheet_url: 'https://docs.google.com/spreadsheets/d/x',
      ...body,
    })

  it('最終版は全件が決まるまで出せず、直すときは版を上げる', async () => {
    const p = await reviewedProject()
    const early = await ex(p, { id: 'EX-001', version: 1, kind: '最終版', verify_result: '一致' })
    expect(early.status).toBe(409)
    expect(early.json.error).toContain('最終版')
    expect((await ex(p, { id: 'EX-001', version: 1, kind: '作業版' })).status).toBe(201)
    await decide(p, 'DC-001', 'C-001', 1)
    await decide(p, 'DC-002', 'C-002', 1, '対象外')
    const final = { id: 'EX-002', version: 2, kind: '最終版' }
    expect((await ex(p, { ...final, verify_result: 'ずれあり' })).status).toBe(400)
    expect((await ex(p, final)).status).toBe(400)
    expect((await ex(p, { ...final, verify_result: '一致' })).status).toBe(201)
    const twice = await ex(p, { ...final, id: 'EX-003', verify_result: '一致' })
    expect(twice.status).toBe(409)
    expect(twice.json.error).toContain('版')

    // 承認のあとで候補が直ると、最終版はまた出せなくなる
    await api('hiroidashi', 'POST', `/projects/${p}/candidates/C-001/versions`, {
      base_version: 1,
      surface: '床',
      code: 'KT-F401',
      status: '候補',
      reason: '範囲を追記',
    })
    const next = { id: 'EX-003', version: 3, kind: '最終版', verify_result: '一致' }
    expect((await ex(p, next)).status).toBe(409)
    expect((await ex(p, { ...next, kind: '作業版' }, 'oyakata')).status).toBe(403)
    await expect(
      testEnv.DB.prepare("UPDATE exports SET kind='作業版' WHERE project_id=?").bind(p).run(),
    ).rejects.toThrow('追記だけ')
    const state = await api('kakidashi', 'GET', `/projects/${p}`)
    expect(state.json.exports.map((x: any) => x.version)).toEqual([2, 1])
    const noSheet = await api('kakidashi', 'POST', `/projects/${p}/exports`, {
      id: 'EX-004',
      version: 3,
      kind: '作業版',
    })
    expect(noSheet.status).toBe(400)
  })

  it('候補がまだない案件には最終版を出せない', async () => {
    const p = `t${crypto.randomUUID().slice(0, 8)}`
    await api('oyakata', 'POST', '/projects', { id: p, name: `空の案件 ${p}` })
    const final = { id: 'EX-001', version: 1, kind: '最終版', verify_result: '一致' }
    expect((await ex(p, final)).status).toBe(409)
  })

  it('保留や、候補のない重大な指摘が残ると最終版は出せない', async () => {
    const p = await reviewedProject()
    await decide(p, 'DC-001', 'C-001', 1)
    await api('oyakata', 'POST', `/projects/${p}/holds`, {
      id: 'HD-001',
      candidate_id: 'C-002',
      reason: '設計者に確認',
      decided_by: '担当の人',
    })
    await decide(p, 'DC-002', 'C-002', 1, '対象外')
    const final = { id: 'EX-001', version: 1, kind: '最終版', verify_result: '一致' }
    expect((await ex(p, final)).status).toBe(409)
    await api('oyakata', 'POST', `/projects/${p}/holds`, {
      id: 'HD-002',
      candidate_id: 'C-002',
      releases_id: 'HD-001',
      release_note: '対応しない',
      decided_by: '担当の人',
    })
    await api('kakunin', 'POST', `/projects/${p}/reviews`, {
      id: 'RV-001',
      run_id: 'RV-RUN-001',
      severity: '重大',
      finding: '仕上表の R03 が候補にない',
    })
    expect((await ex(p, final)).status).toBe(409)
  })
})
