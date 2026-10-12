import { createClient } from '@/lib/supabase/client'
import type { ReceiptAnalysisResult, AppMode } from '@/types/journal'

function parseDbDate(dateStr: string): string | null {
  if (!dateStr || dateStr === '要確認') return null
  const match = dateStr.match(/^\d{4}-\d{2}-\d{2}$/)
  return match ? dateStr : null
}

function parseDbAmount(amount: number | string): number | null {
  if (typeof amount === 'number') return isNaN(amount) ? null : amount
  if (typeof amount === 'string') {
    const clean = amount.replace(/[,\s円]/g, '')
    const num = Number(clean)
    return isNaN(num) ? null : num
  }
  return null
}

export function mapDbRecordToResult(record: any): ReceiptAnalysisResult {
  const amountVal = record.amount !== null && record.amount !== undefined ? Number(record.amount) : '要確認'
  const dateVal = record.date || '要確認'

  const uncertainFields: string[] = []
  if (amountVal === '要確認') uncertainFields.push('amount')
  if (dateVal === '要確認') uncertainFields.push('date')

  return {
    id: record.id,
    date: dateVal,
    payee: record.payee || '',
    description: record.summary || '',
    amount: amountVal,
    debitAccount: record.debit_account || '仮払金',
    debitSubAccount: record.debit_sub_account || '',
    debitTaxType: record.debit_tax_type || '対象外',
    debitAmount: amountVal,
    creditAccount: record.credit_account || '現金',
    creditSubAccount: record.credit_sub_account || '',
    creditTaxType: record.credit_tax_type || '対象外',
    creditAmount: amountVal,
    summary: record.summary || '',
    uncertainFields,
    originalFileName: record.original_file_name || undefined,
  }
}

/**
 * 会社の仕訳一覧を取得する
 */
export async function fetchCompanyJournalEntries(
  companyId: string,
  mode?: AppMode
): Promise<{ success: boolean; data?: ReceiptAnalysisResult[]; error?: string }> {
  const supabase = createClient()

  try {
    let query = supabase
      .from('journal_entries')
      .select('*')
      .eq('company_id', companyId)
      .order('date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (mode) {
      query = query.eq('mode', mode)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching journal entries:', error)
      return { success: false, error: error.message }
    }

    const results = (data || []).map(mapDbRecordToResult)
    return { success: true, data: results }
  } catch (err: any) {
    return { success: false, error: err?.message || '取得に失敗しました。' }
  }
}

/**
 * 解析された仕訳を一括保存する
 */
export async function saveJournalEntries(
  companyId: string,
  mode: AppMode,
  entries: ReceiptAnalysisResult[],
  defaultFileName?: string
): Promise<{ success: boolean; data?: ReceiptAnalysisResult[]; error?: string }> {
  if (entries.length === 0) return { success: true, data: [] }

  const supabase = createClient()

  try {
    const insertPayload = entries.map((item) => ({
      company_id: companyId,
      mode,
      date: parseDbDate(item.date),
      payee: item.payee || '',
      amount: parseDbAmount(item.amount),
      debit_account: item.debitAccount || '仮払金',
      debit_sub_account: item.debitSubAccount || '',
      debit_tax_type: item.debitTaxType || '対象外',
      credit_account: item.creditAccount || '現金',
      credit_sub_account: item.creditSubAccount || '',
      credit_tax_type: item.creditTaxType || '対象外',
      summary: item.summary || item.description || '',
      original_file_name: item.originalFileName || defaultFileName || '',
    }))

    const { data, error } = await supabase
      .from('journal_entries')
      .insert(insertPayload)
      .select('*')

    if (error) {
      console.error('Error inserting journal entries:', error)
      return { success: false, error: error.message }
    }

    const savedResults = (data || []).map(mapDbRecordToResult)
    return { success: true, data: savedResults }
  } catch (err: any) {
    return { success: false, error: err?.message || '保存に失敗しました。' }
  }
}

/**
 * 単一仕訳レコードの更新
 */
export async function updateJournalEntry(
  companyId: string,
  id: string,
  updates: Partial<ReceiptAnalysisResult>
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()

  try {
    const updatePayload: Record<string, any> = {}

    if (updates.date !== undefined) updatePayload.date = parseDbDate(updates.date)
    if (updates.payee !== undefined) updatePayload.payee = updates.payee
    if (updates.amount !== undefined) updatePayload.amount = parseDbAmount(updates.amount)
    if (updates.debitAccount !== undefined) updatePayload.debit_account = updates.debitAccount
    if (updates.debitSubAccount !== undefined) updatePayload.debit_sub_account = updates.debitSubAccount
    if (updates.debitTaxType !== undefined) updatePayload.debit_tax_type = updates.debitTaxType
    if (updates.creditAccount !== undefined) updatePayload.credit_account = updates.creditAccount
    if (updates.creditSubAccount !== undefined) updatePayload.credit_sub_account = updates.creditSubAccount
    if (updates.creditTaxType !== undefined) updatePayload.credit_tax_type = updates.creditTaxType
    if (updates.summary !== undefined) updatePayload.summary = updates.summary

    const { error } = await supabase
      .from('journal_entries')
      .update(updatePayload)
      .eq('id', id)
      .eq('company_id', companyId)

    if (error) {
      console.error('Error updating journal entry:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || '更新に失敗しました。' }
  }
}

/**
 * 仕訳レコードの一括削除
 */
export async function deleteJournalEntries(
  companyId: string,
  ids: string[]
): Promise<{ success: boolean; error?: string }> {
  if (ids.length === 0) return { success: true }

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('journal_entries')
      .delete()
      .in('id', ids)
      .eq('company_id', companyId)

    if (error) {
      console.error('Error deleting journal entries:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || '削除に失敗しました。' }
  }
}
