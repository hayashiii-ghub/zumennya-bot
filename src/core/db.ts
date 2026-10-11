import { HTTPException } from 'hono/http-exception'

export const stmt = (db: D1Database, sql: string, ...args: unknown[]) =>
  db.prepare(sql).bind(...args)
export const one = <T>(db: D1Database, sql: string, ...args: unknown[]) =>
  stmt(db, sql, ...args).first<T>()
export const all = async <T>(db: D1Database, sql: string, ...args: unknown[]) =>
  (await stmt(db, sql, ...args).all<T>()).results

export function fail(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 503 = 400,
): never {
  throw new HTTPException(status, { message })
}

// D1 の制約と決まり（トリガー）のエラーを、ボットが読める説明に直す。
export function dbError(error: unknown): never {
  const text = String(error)
  const rule = text.match(/rule: ([\s\S]+?)(?:: SQLITE_|$)/)
  if (rule) fail(rule[1]!, 409)
  if (text.includes('UNIQUE constraint failed')) fail('同じ ID がすでにあります。', 409)
  if (text.includes('FOREIGN KEY constraint failed'))
    fail(
      '参照している ID が見つかりません（案件・候補・版・図面の版などを確かめてください）。',
      409,
    )
  const check = text.match(/CHECK constraint failed: ([\s\S]+?)(?:: SQLITE_|$)/)
  if (check) fail(`決まりに合わない内容です: ${check[1]!.replace(/\s+/g, ' ')}`)
  throw error
}
