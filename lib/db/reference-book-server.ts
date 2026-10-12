import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import type { ReferenceRuleItem } from '@/types/reference-book'

/**
 * Route Handler 用: 会社の過去帳簿から仕訳ルールを取得してプロンプトテキストを生成
 */
export async function getCompanyReferenceRulesPromptServer(
  companyId?: string | null
): Promise<string> {
  if (!companyId) {
    console.log('[ReferenceBooks Server] No companyId provided, skipping reference rules prompt.')
    return ''
  }

  try {
    let books: any[] = []

    // 1. まずSSRサーバークライアント（Cookieセッション付き、RLS通過）で試行
    try {
      const serverSupabase = await createServerClient()
      const { data, error } = await serverSupabase
        .from('company_reference_books')
        .select('parsed_rules, period, book_type, file_name')
        .eq('company_id', companyId)

      if (!error && data && data.length > 0) {
        books = data
        console.log(`[ReferenceBooks Server] Successfully loaded ${books.length} reference books via server client for company: ${companyId}`)
      } else if (error) {
        console.warn('[ReferenceBooks Server] SSR client error, trying fallback:', error.message)
      }
    } catch (ssrErr: any) {
      console.warn('[ReferenceBooks Server] SSR client exception:', ssrErr.message)
    }

    // 2. フォールバック: 通常のSupabaseクライアント
    if (books.length === 0) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (supabaseUrl && supabaseAnonKey) {
        const anonSupabase = createAnonClient(supabaseUrl, supabaseAnonKey)
        const { data, error } = await anonSupabase
          .from('company_reference_books')
          .select('parsed_rules, period, book_type, file_name')
          .eq('company_id', companyId)

        if (!error && data && data.length > 0) {
          books = data
          console.log(`[ReferenceBooks Server] Loaded ${books.length} books via anon fallback.`)
        }
      }
    }

    if (books.length === 0) {
      console.log(`[ReferenceBooks Server] No reference books found for company: ${companyId}`)
      return ''
    }

    const allRules: ReferenceRuleItem[] = []
    books.forEach((b) => {
      if (Array.isArray(b.parsed_rules)) {
        b.parsed_rules.forEach((r: any) => allRules.push(r))
      }
    })

    if (allRules.length === 0) {
      console.log(`[ReferenceBooks Server] Reference books found, but 0 rules parsed for company: ${companyId}`)
      return ''
    }

    console.log(`[ReferenceBooks Server] Total rules collected: ${allRules.length} for company: ${companyId}`)

    // 重複を排除し頻度順にソート (出金・入金それぞれで管理)
    const withdrawalMap = new Map<string, ReferenceRuleItem>()
    const depositMap = new Map<string, ReferenceRuleItem>()

    allRules.forEach((r) => {
      if (r.direction === 'deposit' || r.creditAccount) {
        const existing = depositMap.get(r.keyword)
        if (!existing || (r.frequency || 0) > (existing.frequency || 0)) {
          depositMap.set(r.keyword, r)
        }
      } else {
        const existing = withdrawalMap.get(r.keyword)
        if (!existing || (r.frequency || 0) > (existing.frequency || 0)) {
          withdrawalMap.set(r.keyword, r)
        }
      }
    })

    const topWithdrawals = Array.from(withdrawalMap.values())
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
      .slice(0, 100)

    const topDeposits = Array.from(depositMap.values())
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
      .slice(0, 50)

    let prompt = `\n\n【最重要・厳格遵守ルール：当社の前期・前々期の帳簿実績に基づく仕訳ルール】\n`
    prompt += `当社が登録した過去（前期・前々期）の総勘定元帳・仕訳日記帳・補助残高一覧表の実績から、以下の仕訳パターンが抽出されています。\n`
    prompt += `【絶対厳守】通帳モードでも領収書モードでも、安易に「仮払金」や「仮受金」で仕訳することは厳禁です。\n`
    prompt += `取引先名・店舗名・印字摘要が以下のキーワードに合致または類似する場合は、【必ず以下の過去実績の勘定科目・税区分・補助科目を最優先適用】してください：\n\n`

    if (topWithdrawals.length > 0) {
      prompt += `▼ 出金・支払い・経費・買掛金決済の過去実績ルール：\n`
      topWithdrawals.forEach((r) => {
        let line = `- 取引先/摘要「${r.keyword}」➔ 借方科目「${r.debitAccount}」`
        if (r.taxType) line += `、税区分「${r.taxType}」`
        if (r.subAccount) line += `、補助科目「${r.subAccount}」`
        prompt += line + `\n`
      })
      prompt += `\n`
    }

    if (topDeposits.length > 0) {
      prompt += `▼ 入金・売上・売掛金回収・利息等の過去実績ルール：\n`
      topDeposits.forEach((r) => {
        let line = `- 取引先/摘要「${r.keyword}」➔ 貸方科目「${r.creditAccount || r.debitAccount}」`
        if (r.taxType) line += `、税区分「${r.taxType}」`
        if (r.subAccount) line += `、補助科目「${r.subAccount}」`
        prompt += line + `\n`
      })
      prompt += `\n`
    }

    return prompt
  } catch (err) {
    console.error('[ReferenceBooks Server] Failed to get reference rules for prompt:', err)
    return ''
  }
}
