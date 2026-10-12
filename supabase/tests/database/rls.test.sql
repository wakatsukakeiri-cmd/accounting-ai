BEGIN;
SELECT plan(13);

-- ============================================================================
-- 1. テストユーザーの作成 (第1引数: identifier, 第2引数: email)
-- ============================================================================
SELECT tests.create_supabase_user('user_a', 'usera@example.com');
SELECT tests.create_supabase_user('user_b', 'userb@example.com');
SELECT tests.create_supabase_user('user_c', 'userc@example.com');
SELECT tests.create_supabase_user('user_d', 'userd@example.com'); -- Test 9 用 (Owner -> Admin追加)
SELECT tests.create_supabase_user('user_e', 'usere@example.com'); -- Test 10 用 (Admin -> Member追加)
SELECT tests.create_supabase_user('user_f', 'userf@example.com'); -- Test 11 用 (Admin -> Admin追加NG)

-- ============================================================================
-- 2. 一時テーブルの作成とフィクスチャデータの構築
-- ============================================================================
CREATE TEMP TABLE test_fixtures (
  key text PRIMARY KEY,
  id uuid NOT NULL
);

DO $$
DECLARE
  comp_a_id UUID := gen_random_uuid();
  comp_b_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO test_fixtures (key, id) VALUES
    ('comp_a', comp_a_id),
    ('comp_b', comp_b_id);

  -- ① public.profiles への登録
  INSERT INTO public.profiles (id, email, display_name) VALUES
    (tests.get_supabase_uid('user_a'), 'usera@example.com', 'User A'),
    (tests.get_supabase_uid('user_b'), 'userb@example.com', 'User B'),
    (tests.get_supabase_uid('user_c'), 'userc@example.com', 'User C'),
    (tests.get_supabase_uid('user_d'), 'userd@example.com', 'User D'),
    (tests.get_supabase_uid('user_e'), 'usere@example.com', 'User E'),
    (tests.get_supabase_uid('user_f'), 'userf@example.com', 'User F');

  -- ② public.companies への登録
  INSERT INTO public.companies (id, name, created_by) VALUES
    (comp_a_id, 'A株式会社', tests.get_supabase_uid('user_a')),
    (comp_b_id, 'B株式会社', tests.get_supabase_uid('user_b'));

  -- ③ public.company_members への登録
  INSERT INTO public.company_members (company_id, user_id, role) VALUES
    (comp_a_id, tests.get_supabase_uid('user_a'), 'owner'),
    (comp_b_id, tests.get_supabase_uid('user_b'), 'owner'),
    (comp_a_id, tests.get_supabase_uid('user_c'), 'admin');

  -- ④ public.journal_entries への登録
  INSERT INTO public.journal_entries (id, company_id, mode, date, payee, amount, debit_account, credit_account) VALUES
    (gen_random_uuid(), comp_a_id, 'receipt', '2026-09-22', 'A社仕入先', 1000, '消耗品費', '現金'),
    (gen_random_uuid(), comp_b_id, 'receipt', '2026-09-22', 'B社仕入先', 5000, '旅費交通費', '現金');

  -- ⑤ storage.objects への登録
  -- ⚠️ Storage RLSのローカルテスト用fixtureとしてのみ使用。
  -- 本番アプリではSupabase Storage API (supabase.storage.from(...).upload()) を使用すること。
  -- Supabase公式はstorage スキーマのテーブルをread-onlyとして扱い、
  -- アップロード・コピー・移動・削除はStorage API経由とする方針。
  -- ただしStorageアクセス制御自体は storage.objects のRLSで実装される。
  INSERT INTO storage.objects (id, bucket_id, name, owner_id) VALUES
    (gen_random_uuid(), 'receipt-files', comp_a_id::text || '/file1.pdf', tests.get_supabase_uid('user_a')),
    (gen_random_uuid(), 'receipt-files', comp_b_id::text || '/file2.pdf', tests.get_supabase_uid('user_b'))
  ON CONFLICT DO NOTHING;

  -- ⑥ public.company_invitations への登録
  -- 招待先メールアドレスを userd@example.com に設定。
  -- User A (usera@example.com) が受諾を試みるとメール不一致で拒否される。
  INSERT INTO public.company_invitations (company_id, email, role, token_hash, expires_at) VALUES
    (comp_b_id, 'userd@example.com', 'member', encode(extensions.digest('b_raw_token_xyz', 'sha256'), 'hex'), NOW() + INTERVAL '7 days');
END;
$$;

-- ============================================================================
-- 3. テストケース実行 (トップレベル SELECT ステートメントによる 13項目)
-- ============================================================================

-- Test 1: A社ユーザー ➔ A社SELECT = OK
SELECT tests.authenticate_as('user_a');
SELECT results_eq(
  'SELECT count(*)::int FROM public.journal_entries WHERE company_id = (SELECT id FROM test_fixtures WHERE key = ''comp_a'')',
  ARRAY[1],
  'Test 1: User A can read Company A journal entries'
);

-- Test 2: A社ユーザー ➔ B社SELECT = NG (0件)
SELECT results_eq(
  'SELECT count(*)::int FROM public.journal_entries WHERE company_id = (SELECT id FROM test_fixtures WHERE key = ''comp_b'')',
  ARRAY[0],
  'Test 2: User A cannot read Company B journal entries'
);

-- Test 3: A社ユーザー ➔ B社UPDATE = NG
SELECT is_empty(
  'UPDATE public.journal_entries SET summary = ''hacked'' WHERE company_id = (SELECT id FROM test_fixtures WHERE key = ''comp_b'') RETURNING *',
  'Test 3: User A cannot update Company B journal entries'
);

-- Test 4: A社ユーザー ➔ B社DELETE = NG
SELECT is_empty(
  'DELETE FROM public.journal_entries WHERE company_id = (SELECT id FROM test_fixtures WHERE key = ''comp_b'') RETURNING *',
  'Test 4: User A cannot delete Company B journal entries'
);

-- Test 5: A社ユーザー ➔ B社Storage = NG
SELECT results_eq(
  'SELECT count(*)::int FROM storage.objects WHERE (storage.foldername(name))[1] = (SELECT id::text FROM test_fixtures WHERE key = ''comp_b'')',
  ARRAY[0],
  'Test 5: User A cannot access Company B storage'
);

-- Test 6: 未ログイン ➔ データ取得 = NG
SELECT tests.clear_authentication();
SELECT results_eq(
  'SELECT count(*)::int FROM public.journal_entries',
  ARRAY[0],
  'Test 6: Unauthenticated user cannot read any journal entries'
);

-- Test 7: A社ユーザー ➔ B社self-owner INSERT = NG
SELECT tests.authenticate_as('user_a');
SELECT throws_ok(
  'INSERT INTO public.company_members (company_id, user_id, role) SELECT id, tests.get_supabase_uid(''user_a''), ''owner'' FROM test_fixtures WHERE key = ''comp_b''',
  'Test 7: User A cannot self-insert as owner into Company B'
);

-- Test 8: 招待受諾 RPC メール不一致検証
-- 招待先は userd@example.com だが、現在 User A (usera@example.com) として認証中。
-- メールアドレスが一致しないため accept_invitation() が拒否する。
SELECT throws_ok(
  'SELECT public.accept_invitation(''b_raw_token_xyz'')',
  'Test 8: User A cannot accept invitation addressed to User D email'
);

-- Test 9: Owner ➔ user_d を admin 追加 = OK
SELECT lives_ok(
  'INSERT INTO public.company_members (company_id, user_id, role) SELECT id, tests.get_supabase_uid(''user_d''), ''admin'' FROM test_fixtures WHERE key = ''comp_a''',
  'Test 9: Owner can add admin'
);

-- Test 10: Admin ➔ user_e を member 追加 = OK
SELECT tests.authenticate_as('user_c');
SELECT lives_ok(
  'INSERT INTO public.company_members (company_id, user_id, role) SELECT id, tests.get_supabase_uid(''user_e''), ''member'' FROM test_fixtures WHERE key = ''comp_a''',
  'Test 10: Admin can add member'
);

-- Test 11: Admin ➔ user_f を admin 追加 = NG (RLS拒否)
SELECT throws_ok(
  'INSERT INTO public.company_members (company_id, user_id, role) SELECT id, tests.get_supabase_uid(''user_f''), ''admin'' FROM test_fixtures WHERE key = ''comp_a''',
  'Test 11: Admin cannot add another admin'
);

-- Test 12: 最後のOwner削除 ➔ Exception発生で拒否
SELECT tests.authenticate_as('user_a');
SELECT throws_ok(
  'DELETE FROM public.company_members WHERE company_id = (SELECT id FROM test_fixtures WHERE key = ''comp_a'') AND user_id = tests.get_supabase_uid(''user_a'')',
  'Test 12: Cannot delete the last owner of the company'
);

-- Test 13: 最後のOwner降格 ➔ Exception発生で拒否
SELECT throws_ok(
  'UPDATE public.company_members SET role = ''member'' WHERE company_id = (SELECT id FROM test_fixtures WHERE key = ''comp_a'') AND user_id = tests.get_supabase_uid(''user_a'')',
  'Test 13: Cannot downgrade the last owner of the company'
);

SELECT * FROM finish();
ROLLBACK;
