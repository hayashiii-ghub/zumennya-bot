-- 書き手（created_by）はボットの申告。oyakata・hiroidashi・katarogu・kakunin・kakidashi のいずれか。
-- 人の名前は decided_by に、おやかたが聞いたとおりに残す（本人確認はしていない）。

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  drive_folder_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL
);

-- 案件と原本
CREATE TABLE sources (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('drawing', 'catalog')),
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE TABLE drawing_versions (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  drawing_no TEXT,
  title TEXT,
  revision_label TEXT,
  drive_revision TEXT NOT NULL,
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 1),
  replaces_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, source_id) REFERENCES sources(project_id, id),
  FOREIGN KEY (project_id, replaces_id) REFERENCES drawing_versions(project_id, id)
);

-- カタログ（案件をまたいで使う）
CREATE TABLE catalogs (
  id TEXT PRIMARY KEY,
  maker TEXT NOT NULL,
  title TEXT NOT NULL,
  edition TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'katarogu'),
  UNIQUE (maker, title, edition)
);
CREATE TABLE catalog_items (
  catalog_id TEXT NOT NULL REFERENCES catalogs(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  use TEXT,
  spec TEXT,
  color TEXT,
  page INTEGER CHECK (page IS NULL OR page >= 1),
  discontinued INTEGER NOT NULL DEFAULT 0 CHECK (discontinued IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'katarogu'),
  PRIMARY KEY (catalog_id, code)
);

-- 読み取り
CREATE TABLE runs (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('extract', 'match', 'review')),
  method TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  CHECK ((kind = 'extract' AND created_by = 'hiroidashi')
      OR (kind = 'match' AND created_by = 'katarogu')
      OR (kind = 'review' AND created_by = 'kakunin'))
);
CREATE TABLE candidates (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'hiroidashi'),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, id)
);
-- 候補の中身は版ごとに追記する。最新の版が今の中身。
CREATE TABLE candidate_versions (
  project_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  room_no TEXT,
  room_name TEXT,
  surface TEXT NOT NULL,
  range_text TEXT,
  symbol TEXT,
  finish TEXT,
  code TEXT,
  status TEXT NOT NULL CHECK (status IN ('候補', '要確認')),
  needs_check_reason TEXT,
  note TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by IN ('hiroidashi', 'oyakata')),
  PRIMARY KEY (project_id, candidate_id, version),
  FOREIGN KEY (project_id, candidate_id) REFERENCES candidates(project_id, id),
  CHECK (status = '候補' OR length(trim(coalesce(needs_check_reason, ''))) > 0),
  CHECK (status = '要確認' OR instr(coalesce(room_no, '') || coalesce(room_name, '') || surface || coalesce(range_text, '') || coalesce(finish, '') || coalesce(code, ''), '要確認') = 0),
  CHECK (version = 1 OR length(trim(coalesce(reason, ''))) > 0)
);
CREATE TABLE evidence (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  candidate_id TEXT,
  drawing_version_id TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page >= 1),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  location TEXT,
  bbox TEXT CHECK (bbox IS NULL OR (json_valid(bbox) AND json_type(bbox) = 'array' AND json_array_length(bbox) = 4)),
  room_method TEXT,
  image_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'hiroidashi'),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, candidate_id) REFERENCES candidates(project_id, id),
  FOREIGN KEY (project_id, drawing_version_id) REFERENCES drawing_versions(project_id, id)
);

-- 照合
CREATE TABLE catalog_matches (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_version INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('一致', '不一致', '未登録', '品番なし', '照合保留')),
  catalog_id TEXT,
  catalog_code TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'katarogu'),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, id),
  FOREIGN KEY (project_id, candidate_id, candidate_version) REFERENCES candidate_versions(project_id, candidate_id, version),
  FOREIGN KEY (catalog_id, catalog_code) REFERENCES catalog_items(catalog_id, code),
  CHECK (result NOT IN ('一致', '不一致') OR (catalog_id IS NOT NULL AND catalog_code IS NOT NULL))
);

-- レビュー。指摘がなくても、見た候補の版を review_checks に残す。
CREATE TABLE review_checks (
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'kakunin'),
  PRIMARY KEY (project_id, run_id, candidate_id, candidate_version),
  FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, id),
  FOREIGN KEY (project_id, candidate_id, candidate_version) REFERENCES candidate_versions(project_id, candidate_id, version)
);
-- 指摘と、その解決（resolves_id 付きの行）を同じ表に追記する。
CREATE TABLE reviews (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  run_id TEXT,
  candidate_id TEXT,
  candidate_version INTEGER,
  severity TEXT CHECK (severity IN ('重大', '軽微')),
  finding TEXT,
  evidence_refs TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs) AND json_type(evidence_refs) = 'array'),
  resolves_id TEXT,
  resolution_note TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, run_id) REFERENCES runs(project_id, id),
  FOREIGN KEY (project_id, candidate_id, candidate_version) REFERENCES candidate_versions(project_id, candidate_id, version),
  FOREIGN KEY (project_id, resolves_id) REFERENCES reviews(project_id, id),
  CHECK ((candidate_id IS NULL) = (candidate_version IS NULL)),
  -- 指摘を出せるのはかくにんだけ。閉じられるのは、直った中身を見たかくにんか、人の判断を伝えるおやかた。
  CHECK ((resolves_id IS NULL AND created_by = 'kakunin' AND run_id IS NOT NULL AND severity IS NOT NULL AND length(trim(coalesce(finding, ''))) > 0 AND resolution_note IS NULL)
      OR (resolves_id IS NOT NULL AND candidate_id IS NULL AND severity IS NULL AND finding IS NULL AND length(trim(coalesce(resolution_note, ''))) > 0
          AND (created_by = 'kakunin' OR (created_by = 'oyakata' AND length(trim(coalesce(decided_by, ''))) > 0))))
);

-- 人の判断
CREATE TABLE judgment_patterns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  rule TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('承認', '対象外', '保留')),
  source_decisions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_decisions) AND json_type(source_decisions) = 'array'),
  retired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'oyakata')
);
CREATE TABLE decisions (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('承認', '対象外')),
  decided_by TEXT NOT NULL CHECK (length(trim(decided_by)) > 0),
  channel TEXT NOT NULL DEFAULT 'chat' CHECK (channel IN ('chat')),
  batch_id TEXT,
  pattern_id TEXT REFERENCES judgment_patterns(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'oyakata'),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, candidate_id, candidate_version) REFERENCES candidate_versions(project_id, candidate_id, version)
);
CREATE TABLE holds (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  reason TEXT,
  releases_id TEXT,
  release_note TEXT,
  decided_by TEXT NOT NULL CHECK (length(trim(decided_by)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'oyakata'),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, candidate_id) REFERENCES candidates(project_id, id),
  FOREIGN KEY (project_id, releases_id) REFERENCES holds(project_id, id),
  CHECK ((releases_id IS NULL AND length(trim(coalesce(reason, ''))) > 0 AND release_note IS NULL)
      OR (releases_id IS NOT NULL AND length(trim(coalesce(release_note, ''))) > 0))
);

-- 書き出し。直すときは上書きせず、次の版を足す。
CREATE TABLE exports (
  project_id TEXT NOT NULL REFERENCES projects(id),
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('最終版', '作業版')),
  sheet_url TEXT NOT NULL,
  xlsx_url TEXT,
  verify_result TEXT CHECK (verify_result IN ('一致', 'ずれあり')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL CHECK (created_by = 'kakidashi'),
  PRIMARY KEY (project_id, id),
  CHECK (kind = '作業版' OR verify_result IS '一致')
);

-- その他
CREATE TABLE reference_items (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  category TEXT NOT NULL,
  room_no TEXT,
  room_name TEXT,
  surface TEXT,
  range_text TEXT,
  text TEXT NOT NULL,
  evidence_id TEXT,
  related_review_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, evidence_id) REFERENCES evidence(project_id, id),
  FOREIGN KEY (project_id, related_review_id) REFERENCES reviews(project_id, id)
);
CREATE TABLE event_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail))
);
CREATE INDEX event_log_project ON event_log(project_id, seq);

CREATE VIEW v_current AS
SELECT v.* FROM candidate_versions v
WHERE v.version = (SELECT max(x.version) FROM candidate_versions x WHERE x.project_id = v.project_id AND x.candidate_id = v.candidate_id);
CREATE VIEW v_open_findings AS
SELECT r.* FROM reviews r
WHERE r.resolves_id IS NULL AND NOT EXISTS (SELECT 1 FROM reviews x WHERE x.project_id = r.project_id AND x.resolves_id = r.id);
CREATE VIEW v_active_holds AS
SELECT h.* FROM holds h
WHERE h.releases_id IS NULL AND NOT EXISTS (SELECT 1 FROM holds x WHERE x.project_id = h.project_id AND x.releases_id = h.id);
CREATE VIEW v_candidate_state AS
SELECT c.*,
  (SELECT count(*) FROM v_open_findings f WHERE f.project_id = c.project_id AND f.candidate_id = c.candidate_id AND f.severity = '重大') AS open_critical,
  (SELECT count(*) FROM v_open_findings f WHERE f.project_id = c.project_id AND f.candidate_id = c.candidate_id AND f.severity = '軽微') AS open_minor,
  EXISTS (SELECT 1 FROM review_checks k WHERE k.project_id = c.project_id AND k.candidate_id = c.candidate_id) AS reviewed,
  EXISTS (SELECT 1 FROM review_checks k WHERE k.project_id = c.project_id AND k.candidate_id = c.candidate_id AND k.candidate_version = c.version) AS reviewed_current,
  (SELECT h.id FROM v_active_holds h WHERE h.project_id = c.project_id AND h.candidate_id = c.candidate_id) AS hold_id,
  (SELECT d.decision FROM decisions d WHERE d.project_id = c.project_id AND d.candidate_id = c.candidate_id AND d.candidate_version = c.version ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1) AS decision,
  (SELECT m.result FROM catalog_matches m WHERE m.project_id = c.project_id AND m.candidate_id = c.candidate_id AND m.candidate_version = c.version ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS match_result
FROM v_current c;

-- 版は1つずつ増やす
CREATE TRIGGER candidate_version_sequence BEFORE INSERT ON candidate_versions
WHEN NEW.version != coalesce((SELECT max(version) FROM candidate_versions WHERE project_id = NEW.project_id AND candidate_id = NEW.candidate_id), 0) + 1
BEGIN SELECT RAISE(ABORT, 'rule: 版は最新の版の次の番号にしてください（ほかの更新と重なった可能性があります）'); END;

-- 指摘の解決は、まだ閉じていない指摘に対してだけ
CREATE TRIGGER review_resolution_target BEFORE INSERT ON reviews
WHEN NEW.resolves_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM v_open_findings f WHERE f.project_id = NEW.project_id AND f.id = NEW.resolves_id)
BEGIN SELECT RAISE(ABORT, 'rule: 閉じる指摘が見つからないか、すでに閉じています'); END;

-- 保留は候補ごとに1つまで。解除は同じ候補の、解除されていない保留に対してだけ
CREATE TRIGGER hold_one_active BEFORE INSERT ON holds
WHEN NEW.releases_id IS NULL AND EXISTS (SELECT 1 FROM v_active_holds h WHERE h.project_id = NEW.project_id AND h.candidate_id = NEW.candidate_id)
BEGIN SELECT RAISE(ABORT, 'rule: この候補にはすでに保留があります'); END;
CREATE TRIGGER hold_release_target BEFORE INSERT ON holds
WHEN NEW.releases_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM v_active_holds h WHERE h.project_id = NEW.project_id AND h.id = NEW.releases_id AND h.candidate_id = NEW.candidate_id)
BEGIN SELECT RAISE(ABORT, 'rule: 解除する保留が見つからないか、すでに解除されています'); END;

-- 承認の決まり
CREATE TRIGGER decision_latest_version BEFORE INSERT ON decisions
WHEN NEW.candidate_version != (SELECT max(version) FROM candidate_versions WHERE project_id = NEW.project_id AND candidate_id = NEW.candidate_id)
BEGIN SELECT RAISE(ABORT, 'rule: 最新の版ではありません。今の中身を確かめてから判定してください'); END;
CREATE TRIGGER decision_needs_check BEFORE INSERT ON decisions
WHEN NEW.decision = '承認' AND (SELECT status FROM candidate_versions WHERE project_id = NEW.project_id AND candidate_id = NEW.candidate_id AND version = NEW.candidate_version) = '要確認'
BEGIN SELECT RAISE(ABORT, 'rule: 要確認の版は承認できません。採用した値と根拠を新しい版として入れてから承認してください'); END;
CREATE TRIGGER decision_critical BEFORE INSERT ON decisions
WHEN NEW.decision = '承認' AND EXISTS (SELECT 1 FROM v_open_findings f WHERE f.project_id = NEW.project_id AND f.candidate_id = NEW.candidate_id AND f.severity = '重大')
BEGIN SELECT RAISE(ABORT, 'rule: 重大な指摘が残っている候補は承認できません'); END;
CREATE TRIGGER decision_hold BEFORE INSERT ON decisions
WHEN NEW.decision = '承認' AND EXISTS (SELECT 1 FROM v_active_holds h WHERE h.project_id = NEW.project_id AND h.candidate_id = NEW.candidate_id)
BEGIN SELECT RAISE(ABORT, 'rule: 保留中の候補は、保留を解除するまで承認できません'); END;
CREATE TRIGGER decision_reviewed BEFORE INSERT ON decisions
WHEN NEW.decision = '承認' AND NOT EXISTS (SELECT 1 FROM review_checks k WHERE k.project_id = NEW.project_id AND k.candidate_id = NEW.candidate_id)
BEGIN SELECT RAISE(ABORT, 'rule: かくにんのレビューを一度も通っていない候補は承認できません'); END;

-- 図面と照合の決まり
CREATE TRIGGER evidence_page_range BEFORE INSERT ON evidence
WHEN NEW.page > (SELECT page_count FROM drawing_versions WHERE project_id = NEW.project_id AND id = NEW.drawing_version_id)
BEGIN SELECT RAISE(ABORT, 'rule: 根拠のページが図面のページ数を超えています'); END;
CREATE TRIGGER drawing_replace_once BEFORE INSERT ON drawing_versions
WHEN NEW.replaces_id IS NOT NULL AND (
  EXISTS (SELECT 1 FROM drawing_versions d WHERE d.project_id = NEW.project_id AND d.replaces_id = NEW.replaces_id)
  OR NOT EXISTS (SELECT 1 FROM drawing_versions o WHERE o.project_id = NEW.project_id AND o.id = NEW.replaces_id AND o.source_id = NEW.source_id))
BEGIN SELECT RAISE(ABORT, 'rule: 差し替えられるのは、同じ原本の、まだ差し替えられていない版だけです'); END;
CREATE TRIGGER match_exact_code BEFORE INSERT ON catalog_matches
WHEN NEW.result = '一致' AND NEW.catalog_code IS NOT NULL AND NEW.catalog_code IS NOT (SELECT code FROM candidate_versions WHERE project_id = NEW.project_id AND candidate_id = NEW.candidate_id AND version = NEW.candidate_version)
BEGIN SELECT RAISE(ABORT, 'rule: 一致にできるのは、候補の品番とカタログの品番が文字どおり同じときだけです'); END;

-- 書き出しの版は1つずつ増やす。最終版は、候補が1件以上あり、全件が承認か対象外になり、保留と重大な指摘がなくなってから
CREATE TRIGGER export_version_sequence BEFORE INSERT ON exports
WHEN NEW.version != coalesce((SELECT max(version) FROM exports WHERE project_id = NEW.project_id), 0) + 1
BEGIN SELECT RAISE(ABORT, 'rule: 書き出しの版は最新の版の次の番号にしてください（ほかの書き出しと重なった可能性があります）'); END;
CREATE TRIGGER export_final_decided BEFORE INSERT ON exports
WHEN NEW.kind = '最終版' AND (
  NOT EXISTS (SELECT 1 FROM v_candidate_state s WHERE s.project_id = NEW.project_id)
  OR EXISTS (SELECT 1 FROM v_candidate_state s WHERE s.project_id = NEW.project_id AND (s.decision IS NULL OR s.hold_id IS NOT NULL))
  OR EXISTS (SELECT 1 FROM v_open_findings f WHERE f.project_id = NEW.project_id AND f.severity = '重大'))
BEGIN SELECT RAISE(ABORT, 'rule: 最終版は、候補がそろい、すべて承認か対象外になり、保留と重大な指摘がなくなってから出してください'); END;

-- 追記だけ。変えてよいのは、根拠画像の置き場所（最初の1回）、廃番の印、判断パターンの使用終了だけ
CREATE TRIGGER evidence_image_once BEFORE UPDATE ON evidence
WHEN OLD.image_key IS NOT NULL OR NEW.image_key IS NULL
  OR NEW.project_id IS NOT OLD.project_id OR NEW.id IS NOT OLD.id OR NEW.candidate_id IS NOT OLD.candidate_id
  OR NEW.drawing_version_id IS NOT OLD.drawing_version_id OR NEW.page IS NOT OLD.page OR NEW.kind IS NOT OLD.kind
  OR NEW.text IS NOT OLD.text OR NEW.location IS NOT OLD.location OR NEW.bbox IS NOT OLD.bbox
  OR NEW.room_method IS NOT OLD.room_method OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT, 'rule: 根拠は追記だけです（画像は最初の1回だけ登録できます）'); END;
CREATE TRIGGER catalog_item_discontinue_only BEFORE UPDATE ON catalog_items
WHEN NOT (OLD.discontinued = 0 AND NEW.discontinued = 1)
  OR NEW.catalog_id IS NOT OLD.catalog_id OR NEW.code IS NOT OLD.code OR NEW.name IS NOT OLD.name OR NEW.use IS NOT OLD.use
  OR NEW.spec IS NOT OLD.spec OR NEW.color IS NOT OLD.color OR NEW.page IS NOT OLD.page
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT, 'rule: カタログの品番は、廃番の印を付けることだけできます'); END;
CREATE TRIGGER pattern_retire_only BEFORE UPDATE ON judgment_patterns
WHEN OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.title IS NOT OLD.title OR NEW.rule IS NOT OLD.rule OR NEW.decision IS NOT OLD.decision
  OR NEW.source_decisions IS NOT OLD.source_decisions OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT, 'rule: 判断パターンは、使うのをやめる印を付けることだけできます'); END;

CREATE TRIGGER projects_no_update BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER projects_no_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER sources_no_update BEFORE UPDATE ON sources BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER sources_no_delete BEFORE DELETE ON sources BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER drawing_versions_no_update BEFORE UPDATE ON drawing_versions BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER drawing_versions_no_delete BEFORE DELETE ON drawing_versions BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER catalogs_no_update BEFORE UPDATE ON catalogs BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER catalogs_no_delete BEFORE DELETE ON catalogs BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER catalog_items_no_delete BEFORE DELETE ON catalog_items BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER runs_no_update BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER runs_no_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER candidates_no_update BEFORE UPDATE ON candidates BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER candidates_no_delete BEFORE DELETE ON candidates BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER candidate_versions_no_update BEFORE UPDATE ON candidate_versions BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER candidate_versions_no_delete BEFORE DELETE ON candidate_versions BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER catalog_matches_no_update BEFORE UPDATE ON catalog_matches BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER catalog_matches_no_delete BEFORE DELETE ON catalog_matches BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER review_checks_no_update BEFORE UPDATE ON review_checks BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER review_checks_no_delete BEFORE DELETE ON review_checks BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER reviews_no_update BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER reviews_no_delete BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER judgment_patterns_no_delete BEFORE DELETE ON judgment_patterns BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER holds_no_update BEFORE UPDATE ON holds BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER holds_no_delete BEFORE DELETE ON holds BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER exports_no_update BEFORE UPDATE ON exports BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER exports_no_delete BEFORE DELETE ON exports BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER reference_items_no_update BEFORE UPDATE ON reference_items BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER reference_items_no_delete BEFORE DELETE ON reference_items BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER event_log_no_update BEFORE UPDATE ON event_log BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
CREATE TRIGGER event_log_no_delete BEFORE DELETE ON event_log BEGIN SELECT RAISE(ABORT, 'rule: 追記だけです'); END;
