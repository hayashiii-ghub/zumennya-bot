# zumennya-bot · 図面帳

図面から仕上げの候補を拾い、照合・独立レビューを経て、人が決めたものを仕上表に書き出す道具。
5体のボットが作業し、人はチャットで判断します。このアプリは記録と根拠を保存して見せます。

ログインなしの公開デモです。すべて架空のデータを使い、本物の図面や顧客資料は入れません。
画面は案件一覧 `/` と案件ごとの看板 `/p/<案件>`。デモ案件は `/p/komorebi` です。
書き込みは鍵を持つボットのAPIだけに限ります。

## 手元で試す

```sh
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
bun run db:local
bun run dev
```

`http://localhost:5173` で確認し、終わったらサーバーを停止します。
開発・ボットの操作・公開の決まりは [AGENTS.md](AGENTS.md)。
