export const BOTS = ['oyakata', 'hiroidashi', 'katarogu', 'kakunin', 'kakidashi'] as const
export type Bot = (typeof BOTS)[number]
export const botNames: Record<string, string> = {
  oyakata: 'おやかた',
  hiroidashi: 'ひろいだし',
  katarogu: 'かたろぐ',
  kakunin: 'かくにん',
  kakidashi: 'かきだし',
}
export type App = { Bindings: Env; Variables: { bot: Bot } }
