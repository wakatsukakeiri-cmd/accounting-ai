import { createClient } from '@/lib/supabase/client'
import type { AnalysisHistoryItem, AppMode } from '@/types/journal'

/**
 * 会社の解析履歴一覧をDBから取得（作成者情報付き）
 */
export async function fetchCompanyAnalysisHistories(
  companyId: string
): Promise<AnalysisHistoryItem[]> {
  const supabase = createClient()

  // 1. 履歴レコード取得
  const { data: records, error } = await supabase
    .from('analysis_histories')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error || !records) {
    console.error('Failed to fetch analysis histories:', error)
    return []
  }

  // 2. 作成者のプロフィール情報を取得
  const userIds = Array.from(
    new Set(records.map((r) => r.user_id).filter((id): id is string => Boolean(id)))
  )

  const profileMap = new Map<string, { email: string; displayName: string | null }>()

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', userIds)

    if (profiles) {
      profiles.forEach((p) => {
        profileMap.set(p.id, {
          email: p.email,
          displayName: p.display_name,
        })
      })
    }
  }

  // 3. データをマッピング
  return records.map((r) => {
    const prof = r.user_id ? profileMap.get(r.user_id) : undefined

    return {
      id: r.id,
      companyId: r.company_id,
      userId: r.user_id,
      createdByName: prof?.displayName || null,
      createdByEmail: prof?.email || null,
      createdAt: r.created_at,
      mode: r.mode as AppMode,
      fileNames: Array.isArray(r.file_names) ? r.file_names : [],
      totalEntries: r.total_entries || 0,
      totalAmount: Number(r.total_amount) || 0,
      filesData: Array.isArray(r.files_data) ? r.files_data : [],
    }
  })
}

/**
 * 解析履歴をクラウドDBへ保存
 */
export async function saveCompanyAnalysisHistory(item: {
  companyId: string
  mode: AppMode
  fileNames: string[]
  totalEntries: number
  totalAmount: number
  filesData: any[]
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = createClient()

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('analysis_histories')
      .insert({
        company_id: item.companyId,
        user_id: user?.id,
        mode: item.mode,
        file_names: item.fileNames,
        total_entries: item.totalEntries,
        total_amount: item.totalAmount,
        files_data: item.filesData,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to save analysis history to DB:', error)
      return { success: false, error: error.message }
    }

    return { success: true, id: data.id }
  } catch (err: any) {
    console.error('Error saving analysis history:', err)
    return { success: false, error: err.message || '保存に失敗しました' }
  }
}

/**
 * 解析履歴をクラウドDBから削除
 */
export async function deleteCompanyAnalysisHistory(
  historyId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()

  const { error } = await supabase
    .from('analysis_histories')
    .delete()
    .eq('id', historyId)

  if (error) {
    console.error('Failed to delete analysis history:', error)
    return { success: false, error: error.message }
  }

  return { success: true }
}
