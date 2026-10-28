# エージェント向け

説明は `README.md`、作業指示は `AGENTS.md` に集約し、別の説明文書は作成前に確認する。

## 構成・制約

- Cloudflare Workers / Hono / D1 / R2 / Bun。開発・公開はcf（ベータ）。共通部は `src/core/`、図面業務は `src/workflow/`。
- Google Driveは原本・成果物、D1は状態・履歴の正本、R2は非公開の根拠画像。原本や共有設定を変更せず、バケットを公開しない。Driveを公開する場合はデモ専用アカウントを使う。
- リポジトリ・画面は公開。架空のデモだけを使い、顧客資料・生成物・秘密値・本番URL・メールアドレス・本名をGitに入れない。
- 画面は「見る」ことに絞り、色・書体はdedura-botに合わせる。読めない値を推測せず「要確認」にする。

## ボットの操作

- 書き込みは `/api` だけ。D1・R2を直接操作しない。定義は `src/workflow/api.ts`、型は `src/core/types.ts`、使用例は `src/api.test.ts`。
- 全呼び出しに `Authorization: Bearer <BOT_API_KEY>` と `X-Bot` を付ける。鍵は共通で、`X-Bot` は申告。役割制限を本人確認として扱わない。秘密値をチャットや作業フォルダに書かない。
- 役割は `hiroidashi`（候補・根拠）、`katarogu`（カタログ・照合）、`kakunin`（原本と根拠だけで独立レビュー）、`oyakata`（人への確認・判定・保留）、`kakidashi`（書き出し）。
- 記録は追記だけ。候補の修正は新しい版へ全項目を入れ、重大な指摘は独立した確認か人の判断で閉じる。人の返事を得てから判定を記録し、本人確認なしと画面に示す。
- 判定は最新の版だけ。「要確認」・重大な指摘・保留・レビューなしの候補は承認できない。修正版の再レビューはおやかたの運用判断に任せ、DBでは強制しない。
- 最終版は候補が1件以上あり、全件が承認か対象外、保留と重大な指摘（候補なしも含む）がなく、書き出し後の照合が `一致` のときだけ。次の版として記録する。制約は `migrations/` のD1トリガーとテストで守る。
- APIの `400` は入力を直し、`409` は読み直して判断する。配列は最大200件・本文8MB、根拠画像は5MBまで。候補を人に見せるリンクは `/p/<案件>?c=<候補ID>`。

## 検証・公開

- Bun 1.4.2を使い、`bun install --frozen-lockfile`。変更後は `bun run format:check`、`bun run test`、`bun run build`。画面変更時はスマホ・PCを確認し、確認用サーバーを停止する。
- 初回は `bunx cf auth login` 後、`bunx cf d1 create zumennya-bot` と `bunx cf r2 buckets create` で非公開のD1・R2を用意し、`cloudflare.config.ts` と `package.json` のIDを揃える。
- 本番への移行は `bunx cf d1 migrations apply <D1のID>`。初回の公開は `bunx cf deploy --secrets-file <秘密値のファイル>` で `BOT_API_KEY` を登録し、以後は `bun run deploy`。既存のリソースと秘密値を保持する。
- 本番URLは別に伝え、Gitに書かない。鍵は秘密値の入力欄で渡す。公開後は画面と認証を確認する。
