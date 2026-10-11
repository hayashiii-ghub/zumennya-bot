import { all, one } from '../core/db'

const STATES = [
  '承認待ち',
  '要確認',
  '重大あり',
  '保留',
  '未レビュー',
  '承認済み',
  '対象外',
] as const
export type State = (typeof STATES)[number]

export type CandidateState = {
  project_id: string
  candidate_id: string
  version: number
  room_no: string | null
  room_name: string | null
  surface: string
  range_text: string | null
  symbol: string | null
  finish: string | null
  code: string | null
  status: '候補' | '要確認'
  needs_check_reason: string | null
  note: string | null
  open_critical: number
  open_minor: number
  reviewed: number
  reviewed_current: number
  hold_id: string | null
  decision: '承認' | '対象外' | null
  match_result: string | null
}

// 判定は今の版に対するものだけを見る。版が変わったら、前の承認は引き継がない。
// レビュー前の候補は、要確認でもまずボットの番として扱う（人へ聞くのはレビューのあと）。
function stateOf(c: CandidateState): State {
  if (c.hold_id) return '保留'
  if (c.decision === '承認') return '承認済み'
  if (c.decision === '対象外') return '対象外'
  if (c.open_critical) return '重大あり'
  if (!c.reviewed) return '未レビュー'
  if (c.status === '要確認') return '要確認'
  return '承認待ち'
}

// 看板の列は「いま誰の番か」。細かい状態はカードの札で見せる。
export const LANES = [
  {
    key: 'bot',
    label: 'ボットの番',
    states: ['未レビュー', '重大あり'],
    hint: 'ボットが作業中',
  },
  {
    key: 'you',
    label: 'あなたの番',
    states: ['承認待ち', '要確認'],
    hint: 'おやかたが聞きます',
  },
  { key: 'wait', label: '待ち', states: ['保留'], hint: '回答待ち' },
  { key: 'done', label: '決定', states: ['承認済み', '対象外'], hint: '承認・対象外' },
] as const satisfies readonly {
  key: string
  label: string
  states: readonly State[]
  hint: string
}[]
export const laneOf = (s: State) => LANES.find((l) => (l.states as readonly State[]).includes(s))!

function summarize(list: CandidateState[], openCritical: number) {
  const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<State, number>
  for (const c of list) counts[stateOf(c)]++
  const lanes = Object.fromEntries(
    LANES.map((l) => [l.key, l.states.reduce((n, s) => n + counts[s], 0)]),
  ) as Record<(typeof LANES)[number]['key'], number>
  return {
    total: list.length,
    decided: lanes.done,
    counts,
    lanes,
    open_critical_findings: openCritical,
  }
}

export async function projects(db: D1Database) {
  const [list, states, critical] = await Promise.all([
    all<{ id: string; name: string; drive_folder_url: string | null; created_at: string }>(
      db,
      'SELECT id,name,drive_folder_url,created_at FROM projects ORDER BY created_at DESC',
    ),
    all<CandidateState>(db, 'SELECT * FROM v_candidate_state ORDER BY project_id, candidate_id'),
    all<{ project_id: string; n: number }>(
      db,
      "SELECT project_id, count(*) AS n FROM v_open_findings WHERE severity='重大' GROUP BY project_id",
    ),
  ])
  return list.map((p) => ({
    ...p,
    ...summarize(
      states.filter((s) => s.project_id === p.id),
      critical.find((c) => c.project_id === p.id)?.n ?? 0,
    ),
  }))
}

export async function project(db: D1Database, id: string) {
  const p = await one<{
    id: string
    name: string
    drive_folder_url: string | null
    created_at: string
  }>(db, 'SELECT * FROM projects WHERE id=?', id)
  if (!p) return null
  const [candidates, findings, sources, references, drawings, exportRows] = await Promise.all([
    all<CandidateState>(
      db,
      'SELECT * FROM v_candidate_state WHERE project_id=? ORDER BY candidate_id',
      id,
    ),
    all<Record<string, unknown>>(
      db,
      'SELECT * FROM v_open_findings WHERE project_id=? ORDER BY created_at, id',
      id,
    ),
    all<Record<string, unknown>>(
      db,
      'SELECT * FROM sources WHERE project_id=? ORDER BY kind DESC, name',
      id,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT r.*, e.image_key, e.page, e.text AS evidence_text, s.name AS source_name, s.url AS source_url
       FROM reference_items r
       LEFT JOIN evidence e ON e.project_id=r.project_id AND e.id=r.evidence_id
       LEFT JOIN drawing_versions d ON d.project_id=e.project_id AND d.id=e.drawing_version_id
       LEFT JOIN sources s ON s.project_id=d.project_id AND s.id=d.source_id
       WHERE r.project_id=? ORDER BY r.id`,
      id,
    ),
    all<Record<string, unknown>>(
      db,
      'SELECT * FROM drawing_versions WHERE project_id=? ORDER BY drawing_no, created_at',
      id,
    ),
    all<Record<string, unknown>>(
      db,
      'SELECT * FROM exports WHERE project_id=? ORDER BY version DESC',
      id,
    ),
  ])
  return {
    project: p,
    ...summarize(candidates, findings.filter((f) => f.severity === '重大').length),
    candidates: candidates.map((c) => ({ ...c, state: stateOf(c) })),
    open_findings: findings,
    sources,
    references,
    drawings,
    exports: exportRows,
  }
}

export async function candidate(db: D1Database, projectId: string, id: string) {
  const current = await one<CandidateState>(
    db,
    'SELECT * FROM v_candidate_state WHERE project_id=? AND candidate_id=?',
    projectId,
    id,
  )
  if (!current) return null
  const args = [projectId, id]
  const [versions, evidence, matches, checks, reviews, decisions, holds] = await Promise.all([
    all<Record<string, unknown>>(
      db,
      'SELECT * FROM candidate_versions WHERE project_id=? AND candidate_id=? ORDER BY version',
      ...args,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT e.*, d.drawing_no, d.title AS drawing_title, d.revision_label, d.drive_revision,
              s.name AS source_name, s.url AS source_url
       FROM evidence e
       JOIN drawing_versions d ON d.project_id=e.project_id AND d.id=e.drawing_version_id
       JOIN sources s ON s.project_id=d.project_id AND s.id=d.source_id
       WHERE e.project_id=? AND e.candidate_id=? ORDER BY e.id`,
      ...args,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT m.*, i.name AS item_name, i.page AS catalog_page, i.use, i.spec, i.color, i.discontinued,
              k.maker, k.title AS catalog_title, k.edition
       FROM catalog_matches m
       LEFT JOIN catalog_items i ON i.catalog_id=m.catalog_id AND i.code=m.catalog_code
       LEFT JOIN catalogs k ON k.id=m.catalog_id
       WHERE m.project_id=? AND m.candidate_id=? ORDER BY m.created_at, m.rowid`,
      ...args,
    ),
    all<Record<string, unknown>>(
      db,
      'SELECT * FROM review_checks WHERE project_id=? AND candidate_id=? ORDER BY created_at',
      ...args,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT * FROM reviews WHERE project_id=?1 AND (candidate_id=?2 OR resolves_id IN
         (SELECT id FROM reviews WHERE project_id=?1 AND candidate_id=?2)) ORDER BY created_at, rowid`,
      ...args,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT d.*, p.title AS pattern_title, p.rule AS pattern_rule
       FROM decisions d LEFT JOIN judgment_patterns p ON p.id=d.pattern_id
       WHERE d.project_id=? AND d.candidate_id=? ORDER BY d.created_at, d.rowid`,
      ...args,
    ),
    all<Record<string, unknown>>(
      db,
      'SELECT * FROM holds WHERE project_id=? AND candidate_id=? ORDER BY created_at, rowid',
      ...args,
    ),
  ])
  return {
    candidate: { ...current, state: stateOf(current) },
    versions,
    evidence,
    matches,
    checks,
    reviews,
    decisions,
    holds,
  }
}

// 看板のカードに載せる、候補ごとの最後の動きと廃番の印。
// D1 は UNION でつなげる SELECT の数に上限があるので、表ごとに読んでから合わせる。
const activitySql = [
  `SELECT candidate_id, created_at AS at, created_by AS actor,
          CASE WHEN version=1 THEN '候補を追加' ELSE '版' || version || 'に更新' END AS what
   FROM candidate_versions WHERE project_id=?`,
  `SELECT candidate_id, created_at AS at, created_by AS actor, 'レビューで確認' AS what
   FROM review_checks WHERE project_id=?`,
  `SELECT candidate_id, created_at AS at, created_by AS actor, severity || 'の指摘' AS what
   FROM reviews WHERE project_id=? AND candidate_id IS NOT NULL`,
  `SELECT f.candidate_id, r.created_at AS at, r.created_by AS actor, '指摘を閉じた' AS what
   FROM reviews r JOIN reviews f ON f.project_id=r.project_id AND f.id=r.resolves_id
   WHERE r.project_id=? AND f.candidate_id IS NOT NULL`,
  `SELECT candidate_id, created_at AS at, created_by AS actor, '照合：' || result AS what
   FROM catalog_matches WHERE project_id=?`,
  `SELECT candidate_id, created_at AS at, created_by AS actor, decision AS what
   FROM decisions WHERE project_id=?`,
  `SELECT candidate_id, created_at AS at, created_by AS actor,
          CASE WHEN releases_id IS NULL THEN '保留' ELSE '保留を解除' END AS what
   FROM holds WHERE project_id=?`,
]
type Activity = { candidate_id: string; at: string; actor: string; what: string }

export async function cardExtras(db: D1Database, projectId: string) {
  const [discontinued, ...activity] = await Promise.all([
    all<{ candidate_id: string }>(
      db,
      `SELECT DISTINCT m.candidate_id FROM catalog_matches m
       JOIN v_current v ON v.project_id=m.project_id AND v.candidate_id=m.candidate_id AND v.version=m.candidate_version
       JOIN catalog_items i ON i.catalog_id=m.catalog_id AND i.code=m.catalog_code
       WHERE m.project_id=? AND i.discontinued=1`,
      projectId,
    ),
    ...activitySql.map((sql) => all<Activity>(db, sql, projectId)),
  ])
  const last = new Map(
    activity
      .flat()
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((a) => [a.candidate_id, a]),
  )
  return { last, discontinued: new Set(discontinued.map((d) => d.candidate_id)) }
}

export const log = (db: D1Database, projectId: string, after = 0, limit = 200) =>
  all<{
    seq: number
    at: string
    actor: string
    action: string
    target_id: string | null
    detail: string
  }>(
    db,
    // after を付けたら、その次から古い順に読み進める。付けなければ新しい順。
    `SELECT * FROM event_log WHERE project_id=? AND seq>? ORDER BY seq ${after > 0 ? 'ASC' : 'DESC'} LIMIT ?`,
    projectId,
    after,
    limit,
  )

export async function catalog(db: D1Database, search: string) {
  const like = `%${search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`
  const [catalogs, items, unregistered] = await Promise.all([
    all<Record<string, unknown>>(db, 'SELECT * FROM catalogs ORDER BY maker, title, edition'),
    all<Record<string, unknown>>(
      db,
      `SELECT i.*, k.maker, k.title AS catalog_title, k.edition,
              (SELECT group_concat(DISTINCT m.project_id) FROM catalog_matches m
               WHERE m.catalog_id=i.catalog_id AND m.catalog_code=i.code) AS projects
       FROM catalog_items i JOIN catalogs k ON k.id=i.catalog_id
       WHERE ?1='' OR i.code LIKE ?2 ESCAPE '\\' OR i.name LIKE ?2 ESCAPE '\\' OR k.maker LIKE ?2 ESCAPE '\\'
       ORDER BY i.code, k.edition`,
      search,
      like,
    ),
    all<Record<string, unknown>>(
      db,
      `SELECT s.project_id, s.candidate_id, s.code, s.finish, s.room_name, s.surface, p.name AS project_name
       FROM v_candidate_state s JOIN projects p ON p.id=s.project_id
       WHERE s.match_result='未登録' AND (?1='' OR s.code LIKE ?2 ESCAPE '\\' OR s.finish LIKE ?2 ESCAPE '\\')
       ORDER BY s.code, s.project_id`,
      search,
      like,
    ),
  ])
  return { catalogs, items, unregistered }
}

export async function patterns(db: D1Database) {
  const list = await all<{
    id: string
    title: string
    rule: string
    decision: string
    source_decisions: string
    retired_at: string | null
    created_at: string
  }>(db, 'SELECT * FROM judgment_patterns ORDER BY retired_at IS NOT NULL, created_at DESC')
  const sources = await all<{
    project_id: string
    id: string
    candidate_id: string
    decision: string
  }>(
    db,
    `SELECT d.project_id, d.id, d.candidate_id, d.decision FROM decisions d
     WHERE d.project_id || '/' || d.id IN (SELECT value FROM judgment_patterns, json_each(source_decisions))`,
  )
  return list.map((p) => ({
    ...p,
    sources: (JSON.parse(p.source_decisions) as string[]).map((ref) => ({
      ref,
      decision: sources.find((d) => `${d.project_id}/${d.id}` === ref) ?? null,
    })),
  }))
}
