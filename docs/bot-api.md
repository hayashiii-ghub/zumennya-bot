# ボット向け API（Grok Bot 用）

図面帳の記録は、すべてこの API で書き込む。D1・R2 を直接さわらず、Cloudflare の鍵で SQL を書かない。画面は人が見るためのもので、ボットは使わない。

- 公開先: `<公開先>/api`（公開先の URL はこのリポジトリに書かない。別に伝える）
- ヘッダー（すべての呼び出し）
  - `Authorization: Bearer <BOT_API_KEY>`（秘密値。チャットや作業フォルダに書かない）
  - `X-Bot: oyakata | hiroidashi | katarogu | kakunin | kakidashi`（自分の名前）
  - `Content-Type: application/json`

鍵は全ボット共通で、`X-Bot` は申告にすぎない。役割ごとの書ける範囲は書き間違いを防ぐためのもので、本人確認ではない。

画面はログインなしで誰でも見られる公開デモ。架空のデモのデータだけを書く。本物の図面・顧客の資料・人の本名は入れない。人の名前は「デモの承認者」のような呼び名にする。

Drive とシートのリンクは画面に出る。共有の設定は変えない（誰でも見られる設定にしない）。公開したいときは、デモ専用の Google アカウントに置く。

## 決まり

- ID は自分で付ける。英数字と `- _ .`（例 `C-001`, `E-012`, `RV-001`, `DC-008`）。案件の ID は小文字の英数字と `-`（例 `sazanami`）。
- 一度書いた記録は直せない・消せない。直したいときは新しい行（候補なら新しい版、指摘なら解決の行、保留なら解除の行）を足す。
- まとめて送るときは配列で最大200件。1回の送信は全部成功か全部失敗のどちらか。本文は8MBまで。画像は `PUT …/evidence/<根拠>/image` で1枚ずつ送る。
- `POST /projects`・`…/candidates/<候補>/versions`・`…/discontinue`・`…/retire` は1件ずつ（配列は `400`）。
- 候補の新しい版は、前の版の中身を引き継がない。変わらない項目（部屋・記号・範囲など）も、毎回すべて入れ直す。
- 返事: 成功は `201`。失敗は `{ "error": "..." }` で、`400` 入力の形や項目の組み合わせ（例：一致なのにカタログの品番がない、最終版なのに `verify_result` が `一致` でない）、`401` 鍵が違う、`403` 役割違い、`404` 見つからない、`409` 決まりに合わない・ID の重複・参照先がない・ほかの更新と重なった、`413` 大きすぎる。`400` は送る中身を直す。`409` は読み直してから考える。
- 読めない値は推測しない。`status: "要確認"` と `needs_check_reason` を入れる。値に「要確認」と書いたまま `status: "候補"` にはできない。
- 人に見せるときは画面のリンクを添える: `<公開先>/p/<案件>?c=<候補ID>`

DB が止める承認の決まり:

1. 判定は候補の最新の版に対してだけ。
2. `要確認` の版は承認できない。人が決めた値は、おやかたが新しい版として入れ、その版を承認する。
3. 重大な指摘が開いている候補は承認できない。
4. 保留中の候補は承認できない（対象外にはできる）。
5. かくにんが一度もレビューしていない候補は承認できない。直した版のレビューをやり直すかは、おやかたの判断（DB では止めない）。
6. 書き出しの最終版は、候補が1件以上あり、すべての候補が承認か対象外になり、保留と重大な指摘（候補のない見落としも）がなくなってから。`verify_result` は `一致` にする。直すときは上書きせず、次の版の書き出しを足す。

## 読む（全員）

| 呼び出し                                 | 返すもの                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /projects`                          | 案件と状態ごとの件数                                                                   |
| `GET /projects/<案件>`                   | 候補の今の版と状態、開いている指摘、原本、図面の版、参考情報、書き出し（新しい版から） |
| `GET /projects/<案件>/candidates/<候補>` | 版の履歴、根拠、照合、レビュー、判定、保留                                             |
| `GET /projects/<案件>/log?after=<seq>`   | 記録の履歴。`after` なしは新しい順に200件、`after` ありはその次から古い順に200件まで   |
| `GET /catalogs?q=<品番など>`             | カタログ、品番、使っている案件、未登録の品番                                           |
| `GET /patterns`                          | 判断パターンと、もとになった判定                                                       |

根拠画像は API ではなく、画面側の `<公開先>/img/<image_key>` で取れます（鍵は要りません）。`image_key` は、候補の詳細の `evidence[].image_key` に入っています（例 `p/komorebi/evidence/E-012/…`）。

候補の状態は `承認待ち`・`要確認`・`重大あり`・`保留`・`未レビュー`・`承認済み`・`対象外`。

## おやかた（oyakata）

人との窓口。承認は必ず人の返事を受けてから記録する。人の名前は `decided_by` に入れる（本人確認はしていないと画面に出る）。公開デモでは本名を入れず、「デモの承認者」のような呼び名にする。

```http
POST /projects
{ "id": "sazanami", "name": "さざなみワークラウンジ 内装計画", "drive_folder_url": "https://drive.google.com/drive/folders/..." }

POST /projects/sazanami/decisions
[
  { "id": "DC-001", "candidate_id": "C-001", "candidate_version": 1, "decision": "承認",
    "decided_by": "人の名前", "batch_id": "2026-10-09 15:22 の返事", "note": "チャットで6件まとめて承認" }
]

// 同じ種類の判断が続いたら判断パターンにする。pattern_id は、先に登録したパターンの ID だけ使える
POST /patterns
{ "id": "PT-001", "title": "カタログ一致の床", "rule": "品番がカタログに一致し、要確認も指摘もない床", "decision": "承認",
  "source_decisions": ["sazanami/DC-001"] }
POST /projects/sazanami/decisions
{ "id": "DC-011", "candidate_id": "C-013", "candidate_version": 1, "decision": "承認",
  "decided_by": "人の名前", "pattern_id": "PT-001", "note": "PT-001 としてまとめて聞き、承認の返事を受けた" }

POST /projects/sazanami/holds
{ "id": "HD-001", "candidate_id": "C-006", "reason": "設計者に確認するまで判定しない", "decided_by": "人の名前" }
// 解除
{ "id": "HD-003", "candidate_id": "C-006", "releases_id": "HD-001", "release_note": "設計者から KT-W247 と回答", "decided_by": "人の名前" }

// 人が決めた値を新しい版にする（reason に採用した値と根拠）
POST /projects/sazanami/candidates/C-006/versions
{ "base_version": 1, "room_no": "R02", "room_name": "会議室", "surface": "壁", "range_text": "北壁",
  "finish": "ビニル壁紙 ファブリックライン247", "code": "KT-W247", "status": "候補",
  "reason": "設計者に確認し KT-W247 に決定（F-102 の E-013・E-015）。人の名前がチャットで回答" }

// 人の判断で指摘を閉じる
POST /projects/sazanami/reviews
{ "id": "RV-003-R1", "resolves_id": "RV-003", "resolution_note": "下地は仕上げ候補にしない", "decided_by": "人の名前" }

POST /patterns/PT-001/retire
{ "note": "使わなくなった理由" }
```

判断パターンは「まとめて聞く」ためのもので、パターンだけで承認を記録しない。

## ひろいだし（hiroidashi）

図面を読み、候補・根拠・根拠画像を入れる。品番は書いてあるとおり。カタログとの照合はしない。

```http
POST /projects/sazanami/sources
[{ "id": "<Drive のファイルID>", "name": "F-101_finish_plan.pdf", "kind": "drawing", "url": "https://drive.google.com/file/d/.../view" }]

POST /projects/sazanami/drawing-versions
{ "id": "DV-001", "source_id": "<Drive のファイルID>", "drawing_no": "F-101", "title": "仕上表",
  "revision_label": "A", "drive_revision": "Drive v3", "page_count": 2, "replaces_id": null }
// 発行日は revision_label に書く（例 "B（2026-09-30 発行）"）。page_count は原本のページ数で、根拠の page はそれを超えられない。
// 差し替え（replaces_id）は、同じ図面番号の最新の版に対して1回だけ。改訂版が別のファイルでもよい（先に sources に登録する）。

POST /projects/sazanami/runs
{ "id": "RUN-001", "kind": "extract", "method": "読み取りの方法（道具と版）" }

POST /projects/sazanami/candidates
[{ "id": "C-001", "run_id": "RUN-001", "room_no": "R01", "room_name": "受付", "surface": "床", "range_text": "床",
   "symbol": "FL-01", "finish": "ビニル床タイル / ソフトタイル401", "code": "KT-F401", "status": "候補" },
 { "id": "C-010", "run_id": "RUN-001", "room_no": "R03", "room_name": "休憩室", "surface": "壁",
   "finish": "ビニル壁紙・織物調", "code": "要確認", "status": "要確認", "needs_check_reason": "品番が「KT-」で切れている" }]

// bbox は任意。ページ全体を 0〜1 とした [左, 上, 右, 下]
POST /projects/sazanami/evidence
[{ "id": "E-001", "candidate_id": "C-001", "drawing_version_id": "DV-001", "page": 1, "kind": "仕上表",
   "text": "図面の文言をそのまま", "bbox": [0.03, 0.62, 0.71, 0.64], "room_method": "仕上表の室名列",
   "image": { "content_type": "image/png", "base64": "<切り出した画像>" } }]

// 画像だけ後から足す（1つの根拠に1回だけ。5MBまで）
PUT /projects/sazanami/evidence/E-001/image   （本文は画像そのもの、Content-Type: image/png）

// 直すときは新しい版（base_version は今の版の番号、reason は直した理由）。変わらない項目も全部入れ直す
POST /projects/sazanami/candidates/C-005/versions
{ "base_version": 1, "room_no": "R02", "room_name": "会議室", "surface": "壁", "range_text": "東西南壁・開口まわり",
  "symbol": "WA-01", "finish": "ビニル壁紙 / コットンベール221", "code": "KT-W221",
  "status": "候補", "reason": "RV-001 の指摘を受けて範囲を追記（F-102 E-032）" }

// 候補にならない記載（下地など）は、候補のない根拠を先に入れてから参考情報にする（evidence_id は任意）
POST /projects/sazanami/evidence
{ "id": "E-REF-001", "drawing_version_id": "DV-002", "page": 1, "kind": "詳細", "text": "石膏ボード下地 t=12.5" }
POST /projects/sazanami/references
{ "id": "REF-001", "category": "下地", "room_name": "会議室", "surface": "壁", "text": "石膏ボード下地 t=12.5", "evidence_id": "E-REF-001" }
```

## かたろぐ（katarogu）

カタログを登録・改訂し、廃番を管理する。候補の品番を照合し、未登録の品番はおやかたに知らせる。

```http
POST /catalogs
{ "id": "CAT-01", "maker": "澄織建材", "title": "内装材カタログ", "edition": "2026年版", "url": "https://drive.google.com/file/d/.../view" }
POST /catalogs/CAT-01/items
[{ "code": "KT-F401", "name": "ソフトタイル401", "use": "床 / ビニル床タイル", "spec": "450 × 450 mm", "color": "ライトグレー", "page": 1 }]
POST /catalogs/CAT-01/items/KT-F401/discontinue
{ "note": "2027年3月で廃番（メーカー通知）" }

POST /projects/sazanami/runs
{ "id": "MATCH-001", "kind": "match", "method": "CAT-01（2026年版）と照合" }
POST /projects/sazanami/matches
[{ "id": "M-001", "run_id": "MATCH-001", "candidate_id": "C-001", "candidate_version": 1, "result": "一致", "catalog_id": "CAT-01", "catalog_code": "KT-F401" },
 { "id": "M-007", "run_id": "MATCH-001", "candidate_id": "C-007", "candidate_version": 1, "result": "未登録", "note": "KT-C899 は CAT-01 にない" }]
```

`result` は `一致`・`不一致`（品番はカタログにあるが、名前・寸法・色が図面と違う。どこが違うかを `note` に書く）・`未登録`・`品番なし`（図面に品番が書いていない）・`照合保留`（品番が読めない・食い違う）。

一致は、候補の品番とカタログの品番が文字どおり同じときだけ。一致と不一致は、`catalog_id` と `catalog_code` を両方入れ、登録済みの品番を指す。照合は、その案件で使うカタログの版に対して行う（版が変わると、同じ品番でも色や寸法が変わることがある）。名前が似ているだけ・似た品番しかないときは `照合保留` にして、`note` に候補の品番を書く。廃番の後継品は、廃番の `note` に書く（例 `後継 KT-F482`）。

## かくにん（kakunin）

原本と根拠画像だけを見て、独立に確認する。ほかのボットの説明や作業フォルダのメモは使わない。修正も承認もしない。

```http
POST /projects/sazanami/runs
{ "id": "REVIEW-001", "kind": "review", "method": "原本の全ページと根拠画像を確認" }

// 指摘がなくても、見た候補の版はすべて記録する
POST /projects/sazanami/review-checks
[{ "run_id": "REVIEW-001", "candidate_id": "C-001", "candidate_version": 1 }]

POST /projects/sazanami/reviews
{ "id": "RV-001", "run_id": "REVIEW-001", "candidate_id": "C-005", "candidate_version": 1, "severity": "重大",
  "finding": "F-102 では開口まわりも同仕上とあるのに範囲に入っていない", "evidence_refs": ["E-032"] }
// 候補にない見落としは candidate_id と candidate_version を省く

// 直った版を確かめてから閉じる（直した側は閉じられない）
POST /projects/sazanami/reviews
{ "id": "RV-001-R1", "run_id": "REVIEW-002", "resolves_id": "RV-001", "resolution_note": "版2で範囲が直っているのを確認" }
```

## かきだし（kakidashi）

Drive とシートに書き出したら、書き出しを記録する。最終版は、全件が承認か対象外になってから。作業版は承認の前でも記録できるが、最終版ではない。`sheet_url` は必ず入れる。Excel も残したときは `xlsx_url` も入れる。最終版のあとで候補が変わると、画面に「その後に変更あり」と出る。

```http
POST /projects/sazanami/exports
{ "id": "EX-003", "version": 3, "kind": "最終版", "sheet_url": "https://docs.google.com/spreadsheets/d/...",
  "verify_result": "一致", "note": "シートを読み直して D1 と全件一致" }
```

`version` は今の最新の次（`GET /projects/<案件>` の `exports` の先頭の版 +1）。`409` なら読み直す。
