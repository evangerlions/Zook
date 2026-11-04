ALTER TABLE zook_frogsleep_personal_versions DROP CONSTRAINT IF EXISTS zook_frogsleep_personal_versions_kind_check;
ALTER TABLE zook_frogsleep_personal_versions ADD CONSTRAINT zook_frogsleep_personal_versions_kind_check CHECK(kind IN('sleep_report','report_preferences','sleep_session'));
