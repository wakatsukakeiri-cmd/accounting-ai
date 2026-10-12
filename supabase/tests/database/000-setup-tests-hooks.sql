-- ============================================================================
-- dbdev + basejump-supabase_test_helpers 公式セットアップフック
-- 手順: pgtap → http → pg_tle
--       → supabase-dbdev / supabase@dbdev をクリーンアップ
--       → pgtle.install_extension で supabase@dbdev を登録
--       → CREATE EXTENSION "supabase@dbdev"
--       → dbdev.install('supabase@dbdev') でクリーン再生成
--       → DROP EXTENSION → CREATE EXTENSION "supabase@dbdev"
--       → dbdev.install('basejump-supabase_test_helpers')
--       → CREATE EXTENSION ... VERSION '0.0.6'
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_tle;

DROP EXTENSION IF EXISTS "supabase-dbdev";
SELECT pgtle.uninstall_extension_if_exists('supabase-dbdev');

DROP EXTENSION IF EXISTS "supabase@dbdev";
SELECT pgtle.uninstall_extension_if_exists('supabase@dbdev');

SELECT
  pgtle.install_extension(
    'supabase@dbdev',
    resp.contents ->> 'version',
    'PostgreSQL package manager',
    resp.contents ->> 'sql'
  )
FROM extensions.http(
  (
    'GET',
    'https://api.database.dev/rest/v1/'
      || 'package_versions?select=sql,version'
      || '&package_alias=eq.supabase@dbdev'
      || '&order=version.desc'
      || '&limit=1',
    ARRAY[
      ('apiKey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtdXB0cHBsZnZpaWZyYndtbXR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODk3NDAzMTksImV4cCI6MjAwNTMxNjMxOX0.z2CN0mvO2No8wSi46Gw59DFGCTJrzM0AQKsu_5k134s')::extensions.http_header
    ],
    NULL,
    NULL
  )
) x,
LATERAL (
  SELECT ((row_to_json(x) -> 'content') #>> '{}')::json -> 0
) resp(contents);

CREATE EXTENSION "supabase@dbdev";

SELECT dbdev.install('supabase@dbdev');

DROP EXTENSION IF EXISTS "supabase@dbdev";
CREATE EXTENSION "supabase@dbdev";

SELECT dbdev.install('basejump-supabase_test_helpers');

CREATE EXTENSION IF NOT EXISTS
  "basejump-supabase_test_helpers"
  VERSION '0.0.6';

-- セットアップ正常動作確認用 pgTAP テスト
BEGIN;
SELECT plan(1);
SELECT ok(true, 'Pre-test hook completed successfully');
SELECT * FROM finish();
ROLLBACK;
