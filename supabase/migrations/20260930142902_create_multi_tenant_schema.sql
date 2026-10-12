-- ============================================================================
-- 多対多マルチテナント統合スキーマ (本体SQL)
-- ============================================================================

-- 1. 拡張機能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. プライベートスキーマ
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;

-- 3. テーブル定義 (7テーブル)

-- ① public.profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ② public.companies
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ③ public.company_members
CREATE TABLE IF NOT EXISTS public.company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_company_user UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_user_id ON public.company_members(user_id);
CREATE INDEX IF NOT EXISTS idx_company_members_company_id ON public.company_members(company_id);

-- ④ public.journal_entries
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('receipt', 'bankbook')),
  date DATE,
  payee TEXT,
  amount NUMERIC(12, 2),
  debit_account TEXT,
  debit_sub_account TEXT,
  debit_tax_type TEXT,
  credit_account TEXT,
  credit_sub_account TEXT,
  credit_tax_type TEXT,
  summary TEXT,
  original_file_name TEXT,
  receipt_file_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_id ON public.journal_entries(company_id);

-- ⑤ public.bankbook_entries
CREATE TABLE IF NOT EXISTS public.bankbook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  page_number INT,
  date DATE,
  summary TEXT,
  withdrawal NUMERIC(12, 2),
  deposit NUMERIC(12, 2),
  balance NUMERIC(12, 2),
  debit_account TEXT,
  credit_account TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bankbook_entries_company_id ON public.bankbook_entries(company_id);

-- ⑥ public.receipt_files
CREATE TABLE IF NOT EXISTS public.receipt_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_files_company_id ON public.receipt_files(company_id);

-- ⑦ public.company_invitations
CREATE TABLE IF NOT EXISTS public.company_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_invitations_company_id ON public.company_invitations(company_id);
CREATE INDEX IF NOT EXISTS idx_company_invitations_token_hash ON public.company_invitations(token_hash);

-- 4. ヘルパー関数 (private schema, SECURITY DEFINER)

CREATE OR REPLACE FUNCTION private.is_company_member(_user_id UUID, _company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members
    WHERE user_id = _user_id
      AND company_id = _company_id
  );
$$;

CREATE OR REPLACE FUNCTION private.get_company_role(_user_id UUID, _company_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role
  FROM public.company_members
  WHERE user_id = _user_id
    AND company_id = _company_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.is_company_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_company_member(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION private.get_company_role(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_company_role(UUID, UUID) TO authenticated;

-- 5. トリガー関数定義

-- ① auth.users ➔ public.profiles 自動連携
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ② updated_at 自動更新
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.company_members FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bankbook_entries FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.receipt_files FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ③ company_members 不変トリガー
CREATE OR REPLACE FUNCTION public.prevent_company_member_immutable_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'company_id cannot be modified.';
  END IF;
  IF OLD.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'user_id cannot be modified.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_members_immutable_trigger
  BEFORE UPDATE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_company_member_immutable_change();

-- ④ 最後のOwner保護トリガー
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_count INT;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner') OR
     (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner') THEN

    SELECT COUNT(*) INTO owner_count
    FROM public.company_members
    WHERE company_id = OLD.company_id
      AND role = 'owner';

    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove or downgrade the last owner of the company.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER company_members_last_owner_trigger
  BEFORE DELETE OR UPDATE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_removal();

-- 6. RPC 関数 (SECURITY DEFINER, search_path = '')

-- ① create_company RPC
CREATE OR REPLACE FUNCTION public.create_company(_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_company_id UUID;
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF _name IS NULL OR trim(_name) = '' THEN
    RAISE EXCEPTION 'Company name cannot be empty.';
  END IF;

  INSERT INTO public.companies (name, created_by)
  VALUES (trim(_name), current_user_id)
  RETURNING id INTO new_company_id;

  INSERT INTO public.company_members (company_id, user_id, role)
  VALUES (new_company_id, current_user_id, 'owner');

  RETURN new_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company(TEXT) TO authenticated;

-- ② accept_invitation RPC
CREATE OR REPLACE FUNCTION public.accept_invitation(_raw_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invitation_rec RECORD;
  computed_hash TEXT;
  current_user_id UUID := auth.uid();
  current_user_email TEXT;
  is_confirmed TIMESTAMPTZ;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT email, email_confirmed_at INTO current_user_email, is_confirmed
  FROM auth.users
  WHERE id = current_user_id;

  IF is_confirmed IS NULL THEN
    RAISE EXCEPTION 'Email is not confirmed.';
  END IF;

  computed_hash := encode(extensions.digest(_raw_token, 'sha256'), 'hex');

  SELECT * INTO invitation_rec
  FROM public.company_invitations
  WHERE token_hash = computed_hash
    AND accepted_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF invitation_rec IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or already accepted invitation token.';
  END IF;

  IF lower(trim(current_user_email)) <> lower(trim(invitation_rec.email)) THEN
    RAISE EXCEPTION 'Invitation email mismatch.';
  END IF;

  INSERT INTO public.company_members (company_id, user_id, role)
  VALUES (invitation_rec.company_id, current_user_id, invitation_rec.role)
  ON CONFLICT (company_id, user_id) DO UPDATE
  SET role = EXCLUDED.role,
      updated_at = NOW();

  UPDATE public.company_invitations
  SET accepted_at = NOW()
  WHERE id = invitation_rec.id;

  RETURN invitation_rec.company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;

-- 7. RLS 有効化とポリシー設定

-- ① profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ② companies
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated
  USING (private.is_company_member(auth.uid(), id));

CREATE POLICY companies_insert ON public.companies FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY companies_update ON public.companies FOR UPDATE TO authenticated
  USING (private.get_company_role(auth.uid(), id) = 'owner')
  WITH CHECK (private.get_company_role(auth.uid(), id) = 'owner');

CREATE POLICY companies_delete ON public.companies FOR DELETE TO authenticated
  USING (private.get_company_role(auth.uid(), id) = 'owner');

-- ③ company_members
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_members_select ON public.company_members FOR SELECT TO authenticated
  USING (private.is_company_member(auth.uid(), company_id));

CREATE POLICY company_members_insert ON public.company_members FOR INSERT TO authenticated
  WITH CHECK (
    (private.get_company_role(auth.uid(), company_id) = 'owner' AND role IN ('admin', 'member'))
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  );

CREATE POLICY company_members_update ON public.company_members FOR UPDATE TO authenticated
  USING (
    private.get_company_role(auth.uid(), company_id) = 'owner'
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  )
  WITH CHECK (
    (private.get_company_role(auth.uid(), company_id) = 'owner' AND role IN ('admin', 'member'))
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  );

CREATE POLICY company_members_delete ON public.company_members FOR DELETE TO authenticated
  USING (
    private.get_company_role(auth.uid(), company_id) = 'owner'
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  );

-- ④ journal_entries
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY journal_entries_select ON public.journal_entries FOR SELECT TO authenticated USING (private.is_company_member(auth.uid(), company_id));
CREATE POLICY journal_entries_insert ON public.journal_entries FOR INSERT TO authenticated WITH CHECK (private.is_company_member(auth.uid(), company_id));
CREATE POLICY journal_entries_update ON public.journal_entries FOR UPDATE TO authenticated USING (private.is_company_member(auth.uid(), company_id)) WITH CHECK (private.is_company_member(auth.uid(), company_id));
CREATE POLICY journal_entries_delete ON public.journal_entries FOR DELETE TO authenticated USING (private.is_company_member(auth.uid(), company_id));

-- ⑤ bankbook_entries
ALTER TABLE public.bankbook_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY bankbook_entries_select ON public.bankbook_entries FOR SELECT TO authenticated USING (private.is_company_member(auth.uid(), company_id));
CREATE POLICY bankbook_entries_insert ON public.bankbook_entries FOR INSERT TO authenticated WITH CHECK (private.is_company_member(auth.uid(), company_id));
CREATE POLICY bankbook_entries_update ON public.bankbook_entries FOR UPDATE TO authenticated USING (private.is_company_member(auth.uid(), company_id)) WITH CHECK (private.is_company_member(auth.uid(), company_id));
CREATE POLICY bankbook_entries_delete ON public.bankbook_entries FOR DELETE TO authenticated USING (private.is_company_member(auth.uid(), company_id));

-- ⑥ receipt_files
ALTER TABLE public.receipt_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipt_files_select ON public.receipt_files FOR SELECT TO authenticated USING (private.is_company_member(auth.uid(), company_id));
CREATE POLICY receipt_files_insert ON public.receipt_files FOR INSERT TO authenticated WITH CHECK (private.is_company_member(auth.uid(), company_id));
CREATE POLICY receipt_files_update ON public.receipt_files FOR UPDATE TO authenticated USING (private.is_company_member(auth.uid(), company_id)) WITH CHECK (private.is_company_member(auth.uid(), company_id));
CREATE POLICY receipt_files_delete ON public.receipt_files FOR DELETE TO authenticated USING (private.is_company_member(auth.uid(), company_id));

-- ⑦ company_invitations
ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_invitations_select ON public.company_invitations FOR SELECT TO authenticated USING (private.is_company_member(auth.uid(), company_id));

CREATE POLICY company_invitations_insert ON public.company_invitations FOR INSERT TO authenticated
  WITH CHECK (
    (private.get_company_role(auth.uid(), company_id) = 'owner' AND role IN ('admin', 'member'))
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  );

CREATE POLICY company_invitations_update ON public.company_invitations FOR UPDATE TO authenticated
  USING (
    private.get_company_role(auth.uid(), company_id) = 'owner'
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  )
  WITH CHECK (
    (private.get_company_role(auth.uid(), company_id) = 'owner' AND role IN ('admin', 'member'))
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  );

CREATE POLICY company_invitations_delete ON public.company_invitations FOR DELETE TO authenticated
  USING (
    private.get_company_role(auth.uid(), company_id) = 'owner'
    OR
    (private.get_company_role(auth.uid(), company_id) = 'admin' AND role = 'member')
  );

-- 8. Storage bucket & Storage RLS

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipt-files', 'receipt-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY storage_receipt_files_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipt-files'
    AND private.is_company_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY storage_receipt_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receipt-files'
    AND private.is_company_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY storage_receipt_files_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'receipt-files'
    AND private.is_company_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'receipt-files'
    AND private.is_company_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY storage_receipt_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'receipt-files'
    AND private.is_company_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
