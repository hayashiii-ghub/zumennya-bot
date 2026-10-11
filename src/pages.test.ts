import { describe, expect, it } from 'vitest'
import { api, reviewedProject, view } from './test-helpers'

describe('公開のデモ', () => {
  it('ログインなしで見られ、どの画面にもデモと出る', async () => {
    const res = await view('/')
    expect(res.status).toBe(200)
    const csp = res.headers.get('content-security-policy')!
    expect(csp).toContain("script-src 'none'")
    expect(csp).not.toContain('accounts.google.com')
    const body = await res.text()
    expect(body).toContain('デモ（架空のデータ）')
    expect(body).toContain('<meta name="robots" content="noindex,nofollow" />')
    expect(body).not.toContain('ログアウト')
    expect(await (await view('/p/nothing-here')).text()).toContain('デモ（架空のデータ）')
  })
  it('ほかのサイトからの明るさの送信は受け付けない', async () => {
    const res = await view('/theme', {
      method: 'POST',
      headers: { origin: 'https://evil.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'theme=light',
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})

describe('画面', () => {
  it('案件一覧に件数、候補の画面に根拠と履歴が出る', async () => {
    const p = await reviewedProject()
    await api('oyakata', 'POST', `/projects/${p}/holds`, {
      id: 'HD-001',
      candidate_id: 'C-002',
      reason: '品番が切れているので設計者に確認',
      decided_by: '担当の人',
    })
    await api('hiroidashi', 'POST', `/projects/${p}/evidence`, {
      id: 'E-001',
      candidate_id: 'C-001',
      drawing_version_id: 'DV-001',
      page: 1,
      kind: '仕上表',
      text: '床 KT-F401',
      image: { content_type: 'image/png', base64: btoa('png') },
    })

    const home = await (await view('/')).text()
    expect(home).toContain(`試験 ${p}`)
    expect(home).toContain('待ち <b>1</b>')
    expect(home).toContain('あなたの番 <b>1</b>')

    // 看板は「いま誰の番か」の列に分かれ、保留は「待ち」の列に入る
    const board = await (await view(`/p/${p}`)).text()
    const lanes = Object.fromEntries(
      [...board.matchAll(/<details class="lane lane-(\w+)"[\s\S]*?<\/details>/g)].map((m) => [
        m[1],
        m[0],
      ]),
    )
    expect(Object.keys(lanes)).toEqual(['bot', 'you', 'wait', 'done'])
    expect(lanes.wait).toContain('C-002')
    expect(lanes.you).toContain('C-001')
    expect(board).not.toContain('class="panel"')
    // 列は最初は閉じていて、選んだカードがある列だけ開いた状態で出す
    for (const lane of Object.values(lanes))
      expect(lane).toMatch(/^<details class="lane lane-\w+"\s*>/)
    expect(board).not.toContain('最近の動き')

    const detail = await (await view(`/p/${p}?c=C-001`)).text()
    expect(detail).toContain('class="panel"')
    expect(detail).toMatch(/<details class="lane lane-you"\s+open>/)
    expect(detail).toMatch(/<details class="lane lane-wait"\s*>/)
    expect(detail).toContain('床 KT-F401')
    expect(detail).toContain('原本を開く')
    const src = detail.match(/src="(\/img\/[^"]+)"/)![1]!
    const image = await view(src)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(new TextDecoder().decode(await image.arrayBuffer())).toBe('png')
  })
  it('レビュー前の要確認は、人に聞く前なのでボットの番に入る', async () => {
    const p = await reviewedProject()
    await api('hiroidashi', 'POST', `/projects/${p}/candidates`, {
      id: 'C-003',
      run_id: 'RUN-001',
      surface: '天井',
      code: '要確認',
      status: '要確認',
      needs_check_reason: '品番がかすれている',
    })
    const board = await (await view(`/p/${p}`)).text()
    const bot = board.match(/<details class="lane lane-bot"[\s\S]*?<\/details>/)![0]
    expect(bot).toContain('C-003')
    expect(bot).toContain('未レビュー')
  })
  it('明るさを切り替えると覚えて、押した画面へ戻る', async () => {
    const res = await view('/theme', {
      method: 'POST',
      headers: {
        origin: 'https://zumen.test',
        referer: 'https://zumen.test/p/sazanami?c=C-006',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'theme=light',
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/p/sazanami?c=C-006')
    expect(res.headers.get('set-cookie')).toContain('theme=light')
    const light = await (await view('/', { headers: { cookie: 'theme=light' } })).text()
    expect(light).toContain('data-theme="light"')
    expect(light).toContain('<meta name="color-scheme" content="light" />')
    const auto = await (await view('/')).text()
    expect(auto).not.toContain('data-theme=')
    expect(auto).toContain('<h1 class="sr-only">案件一覧</h1>')
  })
  it('書き出しがあれば、最新の版と結果とシートが出る', async () => {
    const p = await reviewedProject()
    expect(await (await view(`/p/${p}`)).text()).not.toContain('書き出し')
    await api('oyakata', 'POST', `/projects/${p}/decisions`, [
      {
        id: 'DC-001',
        candidate_id: 'C-001',
        candidate_version: 1,
        decision: '承認',
        decided_by: '担当の人',
      },
      {
        id: 'DC-002',
        candidate_id: 'C-002',
        candidate_version: 1,
        decision: '対象外',
        decided_by: '担当の人',
      },
    ])
    await api('kakidashi', 'POST', `/projects/${p}/exports`, {
      id: 'EX-001',
      version: 1,
      kind: '最終版',
      verify_result: '一致',
      sheet_url: 'https://docs.google.com/spreadsheets/d/x',
    })
    const board = await (await view(`/p/${p}`)).text()
    expect(board).toContain('書き出し 版 1')
    expect(board).toContain('最終版')
    expect(board).toContain('シートを開く')
    expect(board).not.toContain('その後に変更あり')
    await api('hiroidashi', 'POST', `/projects/${p}/candidates/C-001/versions`, {
      base_version: 1,
      surface: '床',
      code: 'KT-F401',
      status: '候補',
      reason: '範囲を追記',
    })
    expect(await (await view(`/p/${p}`)).text()).toContain('その後に変更あり')
  })
  it('ないものは見つからないと出る', async () => {
    expect((await view('/p/nothing-here')).status).toBe(404)
    expect((await view('/img/p/nothing/evidence/E-1/x')).status).toBe(404)
    expect((await view('/img/p/%E0')).status).toBe(404)
    for (const gone of ['/catalog', '/patterns', '/p/nothing-here/log', '/login', '/privacy'])
      expect((await view(gone)).status).toBe(404)
  })
})
