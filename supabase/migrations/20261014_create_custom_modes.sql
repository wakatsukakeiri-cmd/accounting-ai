-- ============================================================================
-- 会社専用カスタムアップロードモード (company_custom_modes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.company_custom_modes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📋',
  custom_prompt TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_custom_modes_company_id ON public.company_custom_modes(company_id);

ALTER TABLE public.company_custom_modes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_members_select_custom_modes" ON public.company_custom_modes
  FOR SELECT TO authenticated
  USING (private.is_company_member(auth.uid(), company_id));

CREATE POLICY "company_members_insert_custom_modes" ON public.company_custom_modes
  FOR INSERT TO authenticated
  WITH CHECK (private.is_company_member(auth.uid(), company_id));

CREATE POLICY "company_members_update_custom_modes" ON public.company_custom_modes
  FOR UPDATE TO authenticated
  USING (private.is_company_member(auth.uid(), company_id))
  WITH CHECK (private.is_company_member(auth.uid(), company_id));

CREATE POLICY "company_members_delete_custom_modes" ON public.company_custom_modes
  FOR DELETE TO authenticated
  USING (private.is_company_member(auth.uid(), company_id));
