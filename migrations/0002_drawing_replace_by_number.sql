-- 改訂版は別のファイルになることが多いので、差し替えは同じ図面番号どうしで決める
DROP TRIGGER drawing_replace_once;
CREATE TRIGGER drawing_replace_once BEFORE INSERT ON drawing_versions
WHEN NEW.replaces_id IS NOT NULL AND (
  EXISTS (SELECT 1 FROM drawing_versions d WHERE d.project_id = NEW.project_id AND d.replaces_id = NEW.replaces_id)
  OR NOT EXISTS (SELECT 1 FROM drawing_versions o WHERE o.project_id = NEW.project_id AND o.id = NEW.replaces_id AND o.drawing_no IS NEW.drawing_no))
BEGIN SELECT RAISE(ABORT, 'rule: 差し替えられるのは、同じ図面番号の、まだ差し替えられていない版だけです'); END;
