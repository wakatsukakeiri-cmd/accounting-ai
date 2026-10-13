import { createClient } from '@/lib/supabase/client'
import type { CustomModeItem, CreateCustomModeInput } from '@/types/custom-mode'

const LOCAL_STORAGE_PREFIX = 'accounting_ai_custom_modes_'

/**
 * ローカルストレージからカスタムモード一覧を取得
 */
function getLocalCustomModes(companyId: string): CustomModeItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${companyId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * ローカルストレージにカスタムモード一覧を保存
 */
function saveLocalCustomModes(companyId: string, modes: CustomModeItem[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${companyId}`, JSON.stringify(modes))
  } catch (err) {
    console.error('Failed to save custom modes to localStorage:', err)
  }
}

/**
 * 会社のカスタムモード一覧を取得 (Supabase優先、失敗時はlocalStorageフォールバック)
 */
export async function fetchCompanyCustomModes(companyId: string): Promise<CustomModeItem[]> {
  const localList = getLocalCustomModes(companyId)
  const supabase = createClient()

  try {
    const { data, error } = await supabase
      .from('company_custom_modes')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })

    if (error || !data) {
      // テーブルが未作成等の場合はローカルデータを返す
      return localList
    }

    const formatted: CustomModeItem[] = data.map((d: any) => ({
      id: d.id,
      companyId: d.company_id,
      name: d.name,
      description: d.description || '',
      icon: d.icon || '📋',
      customPrompt: d.custom_prompt,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }))

    // ローカルストレージにも同期キャッシュ
    saveLocalCustomModes(companyId, formatted)
    return formatted
  } catch (err) {
    console.warn('Supabase fetch failed for custom modes, using local cache:', err)
    return localList
  }
}

/**
 * カスタムモードを保存（新規作成または更新）
 */
export async function saveCompanyCustomMode(
  input: CreateCustomModeInput & { id?: string }
): Promise<{ success: boolean; data?: CustomModeItem; error?: string }> {
  const supabase = createClient()
  const localList = getLocalCustomModes(input.companyId)

  const modeId = input.id || crypto.randomUUID()
  const now = new Date().toISOString()

  const itemToSave: CustomModeItem = {
    id: modeId,
    companyId: input.companyId,
    name: input.name,
    description: input.description || '',
    icon: input.icon || '📋',
    customPrompt: input.customPrompt,
    updatedAt: now,
    createdAt: input.id ? (localList.find(m => m.id === input.id)?.createdAt || now) : now,
  }

  // 1. ローカルストレージを即時更新
  const existingIdx = localList.findIndex((m) => m.id === modeId)
  if (existingIdx !== -1) {
    localList[existingIdx] = itemToSave
  } else {
    localList.push(itemToSave)
  }
  saveLocalCustomModes(input.companyId, localList)

  // 2. Supabase へ保存 (可能な場合)
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const payload = {
      id: modeId,
      company_id: input.companyId,
      name: input.name,
      description: input.description || '',
      icon: input.icon || '📋',
      custom_prompt: input.customPrompt,
      created_by: user?.id,
      updated_at: now,
    }

    const { data, error } = await supabase
      .from('company_custom_modes')
      .upsert(payload)
      .select('*')
      .single()

    if (!error && data) {
      itemToSave.id = data.id
      itemToSave.createdAt = data.created_at
    }
  } catch (err) {
    console.warn('Failed to upsert custom mode to Supabase, saved locally:', err)
  }

  return { success: true, data: itemToSave }
}

/**
 * カスタムモードを削除
 */
export async function deleteCompanyCustomMode(
  id: string,
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()

  // 1. ローカルストレージから削除
  const localList = getLocalCustomModes(companyId).filter((m) => m.id !== id)
  saveLocalCustomModes(companyId, localList)

  // 2. Supabase から削除
  try {
    await supabase.from('company_custom_modes').delete().eq('id', id)
  } catch (err) {
    console.warn('Failed to delete custom mode from Supabase:', err)
  }

  return { success: true }
}
