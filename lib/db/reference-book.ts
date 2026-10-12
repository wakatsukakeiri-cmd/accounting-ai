import { createClient } from '@/lib/supabase/client'
import type {
  ReferenceBookItem,
  ReferenceRuleItem,
  PeriodType,
  BookType,
} from '@/types/reference-book'

/**
 * 簡易CSVパーサー（カンマまたはタブ区切り、引用符対応）
 */
export function parseCsvRows(text: string): string[][] {
  const lines = text.split(/\r?\n/)
  const result: string[][] = []

  for (const line of lines) {
    if (!line.trim()) continue

    // タブ区切りの場合
    if (line.includes('\t') && !line.includes(',')) {
      result.push(line.split('\t').map((c) => c.trim().replace(/^"|"$/g, '')))
      continue
    }

    // カンマ区切りのパース
    const row: string[] = []
    let inQuotes = false
    let currentField = ''

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        row.push(currentField.trim().replace(/^"|"$/g, ''))
        currentField = ''
      } else {
        currentField += char
      }
    }
    row.push(currentField.trim().replace(/^"|"$/g, ''))
    result.push(row)
  }

  return result
}

// 日本の標準勘定科目辞書（照合および列自動検出用）
export const STANDARD_ACCOUNTS = new Set([
  // 資産
  '現金', '小口現金', '当座預金', '普通預金', '定期預金', '預金',
  '受取手形', '売掛金', '売掛代金', '有価証券', '商品', '製品', '原材料', '仕掛品', '貯蔵品',
  '前払金', '前渡金', '前払費用', '未収入金', '未収金', '未収消費税等', '短期貸付金',
  '立替金', '仮払金', '建物', '構築物', '機械装置', '車両運搬具', '工具器具備品', '備品',
  '一括償却資産', 'ソフトウェア', '敷金', '保証金', '差入保証金', '長期前払費用',
  // 負債
  '支払手形', '買掛金', '買掛代金', '短期借入金', '未払金', '未払費用', '未払法人税等', '未払消費税等',
  '前受金', '前受収益', '預り金', '源泉所得税預り金', '社会保険料預り金', '仮受金', '仮受消費税等',
  '長期借入金', '役員借入金',
  // 純資産
  '資本金', '資本剰余金', '利益剰余金', '繰越利益剰余金',
  // 収益
  '売上高', '売上', '完成工事高', '役務収益', '受取利息', '受取配当金', '雑収入', '雑手当',
  '仕入割引', '固定資産売却益',
  // 費用
  '仕入高', '仕入', '外注費', '外注工賃', '役員報酬', '役員給与', '給料手当', '給与手当', '給料', '給与',
  '賞与', '退職給付費用', '法定福利費', '福利厚生費',
  '旅費交通費', '交通費', '通信費', '水道光熱費', '広告宣伝費', '販売促進費',
  '接待交際費', '交際費', '会議費', '損害保険料', '保険料', '修繕費',
  '消耗品費', '事務用品費', '事務用消耗品費', '消耗品',
  '支払手数料', '振込手数料', '手数料', '決済手数料', '車両費',
  '地代家賃', '家賃', '賃借料', 'リース料', '共益費',
  '租税公課', '印紙税', '諸会費', '新聞図書費', '図書費', '研修費', '採用教育費',
  '荷造運賃', '運賃', '保管料', '支払利息', '雑費', '減価償却費',
])

/**
 * アップロードされた帳簿テキスト/CSVから仕訳ルール（摘要・取引先 ➔ 勘定科目・税区分）を自動抽出
 */
export function extractRulesFromBookContent(
  content: string,
  bookType?: BookType
): {
  rules: ReferenceRuleItem[]
  summary: string
} {
  const rows = parseCsvRows(content)
  if (rows.length === 0) {
    return { rules: [], summary: 'データが空でした。有効なCSV/テキストデータを指定してください。' }
  }

  const ruleMap = new Map<
    string,
    {
      keyword: string
      direction: 'withdrawal' | 'deposit'
      debit?: string
      credit?: string
      tax?: string
      sub?: string
      count: number
    }
  >()

  // 1. 補助残高一覧表（subsidiary_ledger）の特化抽出
  // 構造例: [勘定科目, 補助科目(取引先名), 期首残高, 借方金額, 貸方金額, 期末残高]
  if (bookType === 'subsidiary_ledger') {
    let accountCol = -1
    let subCol = -1

    for (let r = 0; r < Math.min(30, rows.length); r++) {
      const row = rows[r]
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]
        if (/勘定科目|科目名|科目/i.test(cell) && accountCol === -1) accountCol = c
        else if (/補助科目|補助名|取引先|相手先/i.test(cell) && subCol === -1) subCol = c
      }
      if (accountCol !== -1 && subCol !== -1) break
    }

    // ヘッダーが見つからない場合のフォールバック: 最初の行で標準科目が存在する列を探す
    if (accountCol === -1) {
      for (const row of rows.slice(0, 20)) {
        for (let c = 0; c < row.length; c++) {
          if (STANDARD_ACCOUNTS.has(row[c])) {
            accountCol = c
            subCol = c + 1 < row.length ? c + 1 : 0
            break
          }
        }
        if (accountCol !== -1) break
      }
    }

    if (accountCol !== -1 && subCol !== -1) {
      for (const row of rows) {
        const acc = row[accountCol]?.trim()
        const sub = row[subCol]?.trim()

        if (
          acc &&
          sub &&
          sub.length >= 2 &&
          !/合計|残高|補助科目|科目名|取引先|期首|期末/i.test(sub) &&
          !/合計|残高|勘定科目|科目名/i.test(acc)
        ) {
          const isDeposit = ['売掛金', '受取手形', '売上高', '売上', '普通預金', '受取利息'].includes(acc)
          const dir = isDeposit ? 'deposit' : 'withdrawal'
          const key = `${dir}:${sub}`

          const existing = ruleMap.get(key)
          if (existing) {
            existing.count++
          } else {
            ruleMap.set(key, {
              keyword: sub,
              direction: dir,
              debit: isDeposit ? undefined : acc,
              credit: isDeposit ? acc : undefined,
              sub: sub,
              count: 1,
            })
          }
        }
      }
    }
  }

  // 2. 総勘定元帳（general_ledger）の特化抽出
  // パターンA: 科目ごとに見出しがあるブロック形式（「勘定科目：消耗品費」など）
  // パターンB: 通常の明細行テーブル
  if (bookType === 'general_ledger' && ruleMap.size === 0) {
    let currentBlockAccount: string | null = null

    for (const row of rows) {
      const fullText = row.join(' ')

      // 科目ブロック見出しの検知（例: "勘定科目: 消耗品費" や "科目名 [売掛金]"）
      const blockMatch = fullText.match(/(?:勘定科目|科目名|科目)\s*[:：]?\s*([^\s,]+)/)
      if (blockMatch && blockMatch[1]) {
        const candidate = blockMatch[1].replace(/[\[\]「」]/g, '').trim()
        if (candidate.length >= 2 && !/コード|一覧|合計/i.test(candidate)) {
          currentBlockAccount = candidate
          continue
        }
      }

      // 明細行の処理
      if (currentBlockAccount) {
        // 摘要や相手先を探す（通常、日付や金額以外の文字列セル）
        let summaryText = ''
        for (const cell of row) {
          const c = cell.trim()
          if (
            c.length >= 2 &&
            !/^\d+[\/\-\.]\d+/.test(c) && // 日付除外
            !/^\-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(c) && // 金額数値除外
            !/^\d+$/.test(c) && // 番号除外
            !['普通預金', '当座預金', '現金', currentBlockAccount].includes(c) &&
            !/相手科目|摘要|残高|借方|貸方/i.test(c)
          ) {
            summaryText = c
            break
          }
        }

        if (summaryText) {
          const cleanKw = summaryText.replace(/^(振込|カブシキガイシャ|株式会社|\(株\))\s*/g, '').slice(0, 30)
          if (cleanKw.length >= 2) {
            const isDeposit = ['売掛金', '受取手形', '売上高', '売上', '受取利息'].includes(currentBlockAccount)
            const dir = isDeposit ? 'deposit' : 'withdrawal'
            const key = `${dir}:${cleanKw}`

            const existing = ruleMap.get(key)
            if (existing) {
              existing.count++
            } else {
              ruleMap.set(key, {
                keyword: cleanKw,
                direction: dir,
                debit: isDeposit ? undefined : currentBlockAccount,
                credit: isDeposit ? currentBlockAccount : undefined,
                count: 1,
              })
            }
          }
        }
      }
    }
  }

  // 3. 仕訳日記帳（journal）または上記で抽出できなかった場合の汎用テーブル解析
  if (ruleMap.size === 0) {
    let debitCol = -1
    let creditCol = -1
    let summaryCol = -1
    let partnerCol = -1
    let taxCol = -1
    let subCol = -1

    // 最初の50行からヘッダー列を探索
    for (let r = 0; r < Math.min(50, rows.length); r++) {
      const row = rows[r]
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]
        if (/借方勘定科目|借方科目|借方\s*科目/i.test(cell) && debitCol === -1) debitCol = c
        else if (/貸方勘定科目|貸方科目|貸方\s*科目/i.test(cell) && creditCol === -1) creditCol = c
        else if (/摘要|内容|品名|取引内容|記事|メモ|備考/i.test(cell) && summaryCol === -1) summaryCol = c
        else if (/取引先|相手先/i.test(cell) && partnerCol === -1) partnerCol = c
        else if (/借方税区分|税区分|課税区分|税種別/i.test(cell) && taxCol === -1) taxCol = c
        else if (/借方補助科目|借方補助|補助科目|補助/i.test(cell) && subCol === -1) subCol = c
      }
      if (debitCol !== -1 && summaryCol !== -1) break
    }

    // ヘッダーが見つからない場合のスマート自動列判定（弥生会計のヘッダーなしCSVや標準外CSV対応）
    if (debitCol === -1 || summaryCol === -1) {
      // 弥生会計形式: [0:取引No, 1:伝票No, 3:日付, 4:借方科目, 5:借方補助, 7:借方税区分, 10:貸方科目, 16:摘要]
      const sampleRow = rows.find((r) => r.length >= 12)
      if (sampleRow) {
        // 標準勘定科目に一致する列をスキャン
        const colMatchCounts: number[] = new Array(sampleRow.length).fill(0)
        const colTextLengths: number[] = new Array(sampleRow.length).fill(0)

        for (const r of rows.slice(0, 50)) {
          for (let c = 0; c < r.length; c++) {
            if (STANDARD_ACCOUNTS.has(r[c]?.trim())) {
              colMatchCounts[c]++
            }
            if (r[c] && r[c].length >= 3 && !/^\d+$/.test(r[c])) {
              colTextLengths[c] += r[c].length
            }
          }
        }

        // 勘定科目出現回数が多い列を借方・貸方科目列として特定
        const sortedColIndices = colMatchCounts
          .map((count, idx) => ({ idx, count }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count)

        if (sortedColIndices.length >= 1 && debitCol === -1) {
          debitCol = sortedColIndices[0].idx
        }
        if (sortedColIndices.length >= 2 && creditCol === -1) {
          creditCol = sortedColIndices[1].idx
        }

        // テキスト文字数が多く勘定科目列でない列を摘要列として特定
        if (summaryCol === -1) {
          let maxLenIdx = -1
          let maxLen = 0
          colTextLengths.forEach((len, idx) => {
            if (idx !== debitCol && idx !== creditCol && len > maxLen) {
              maxLen = len
              maxLenIdx = idx
            }
          })
          if (maxLenIdx !== -1) {
            summaryCol = maxLenIdx
          }
        }
      }

      // それでも未検出時の弥生標準インデックスフォールバック
      if (debitCol === -1 && rows[0] && rows[0].length >= 10) {
        debitCol = 4
        subCol = 5
        taxCol = 7
        creditCol = 10
        summaryCol = rows[0].length > 16 ? 16 : 10
      }
    }

    // 各行からルールを抽出
    for (const row of rows) {
      let kw = ''
      if (partnerCol !== -1 && row[partnerCol]) {
        kw = row[partnerCol].trim()
      }
      if (!kw && summaryCol !== -1 && row[summaryCol]) {
        kw = row[summaryCol].trim()
      }

      const debitAcc = debitCol !== -1 && row[debitCol] ? row[debitCol].trim() : ''
      const creditAcc = creditCol !== -1 && row[creditCol] ? row[creditCol].trim() : ''
      const taxType = taxCol !== -1 && row[taxCol] ? row[taxCol].trim() : undefined
      const subAcc = subCol !== -1 && row[subCol] ? row[subCol].trim() : undefined

      if (kw && kw.length > 1) {
        const cleanKw = kw.replace(/^(振込|カブシキガイシャ|株式会社|\(株\))\s*/g, '').slice(0, 30)

        // 1. 入金取引（借方が普通預金/当座預金など）➔ 貸方科目（売掛金、売上、受取利息、雑収入等）を学習
        if (
          ['普通預金', '当座預金', '預金', '現金'].includes(debitAcc) &&
          creditAcc &&
          !['普通預金', '当座預金', '仮受金'].includes(creditAcc)
        ) {
          const key = `deposit:${cleanKw}`
          const existing = ruleMap.get(key)
          if (existing) {
            existing.count++
          } else {
            ruleMap.set(key, {
              keyword: cleanKw,
              direction: 'deposit',
              credit: creditAcc,
              tax: taxType,
              sub: subAcc,
              count: 1,
            })
          }
        }
        // 2. 出金取引または一般費用（借方科目が消耗品費、買掛金、地代家賃、水道光熱費等）
        else if (
          debitAcc &&
          !['借方科目', '勘定科目', '借方勘定科目', '仮払金', '普通預金', '当座預金'].includes(debitAcc)
        ) {
          const key = `withdrawal:${cleanKw}`
          const existing = ruleMap.get(key)
          if (existing) {
            existing.count++
          } else {
            ruleMap.set(key, {
              keyword: cleanKw,
              direction: 'withdrawal',
              debit: debitAcc,
              tax: taxType,
              sub: subAcc,
              count: 1,
            })
          }
        }
      }
    }
  }

  // 4. 万全のフェイルセーフ: 上記すべてで0件だった場合、行内の標準勘定科目とテキストから強制抽出
  if (ruleMap.size === 0) {
    for (const row of rows) {
      let foundAccount = ''
      let candidateKw = ''

      for (const cell of row) {
        const c = cell.trim()
        if (STANDARD_ACCOUNTS.has(c) && !['普通預金', '当座預金', '現金', '仮払金', '仮受金'].includes(c)) {
          foundAccount = c
        } else if (
          c.length >= 2 &&
          !/^\d+[\/\-\.]\d+/.test(c) &&
          !/^\-?\d+$/.test(c) &&
          !foundAccount
        ) {
          candidateKw = c.replace(/^(振込|カブシキガイシャ|株式会社|\(株\))\s*/g, '').slice(0, 30)
        }
      }

      if (foundAccount && candidateKw && candidateKw.length >= 2) {
        const isDeposit = ['売掛金', '売上高', '売上', '受取利息'].includes(foundAccount)
        const dir = isDeposit ? 'deposit' : 'withdrawal'
        const key = `${dir}:${candidateKw}`
        const existing = ruleMap.get(key)
        if (existing) {
          existing.count++
        } else {
          ruleMap.set(key, {
            keyword: candidateKw,
            direction: dir,
            debit: isDeposit ? undefined : foundAccount,
            credit: isDeposit ? foundAccount : undefined,
            count: 1,
          })
        }
      }
    }
  }

  // 上位300件をルールとして抽出
  const sorted = Array.from(ruleMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 300)

  const rules: ReferenceRuleItem[] = sorted.map((data) => ({
    keyword: data.keyword,
    direction: data.direction,
    debitAccount: data.debit,
    creditAccount: data.credit,
    taxType: data.tax,
    subAccount: data.sub,
    frequency: data.count,
  }))

  const withdrawalCount = rules.filter((r) => r.direction === 'withdrawal').length
  const depositCount = rules.filter((r) => r.direction === 'deposit').length
  const summary = `抽出ルール件数: ${rules.length}件 (出金/費用: ${withdrawalCount}件, 入金/売上: ${depositCount}件 / 全${rows.length}行解析)`

  return { rules, summary }
}

/**
 * 会社の過去帳簿一覧を取得
 */
export async function fetchCompanyReferenceBooks(
  companyId: string
): Promise<ReferenceBookItem[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('company_reference_books')
    .select('*')
    .eq('company_id', companyId)
    .order('period', { ascending: true })
    .order('book_type', { ascending: true })

  if (error || !data) {
    console.error('Failed to fetch reference books:', error)
    return []
  }

  return data.map((d) => ({
    id: d.id,
    companyId: d.company_id,
    period: d.period as PeriodType,
    bookType: d.book_type as BookType,
    fileName: d.file_name,
    fileSize: d.file_size || 0,
    parsedRules: Array.isArray(d.parsed_rules) ? d.parsed_rules : [],
    rawSummary: d.raw_summary,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }))
}

/**
 * 過去帳簿を保存（同一の会社・期・帳簿タイプはUPSERT）
 */
export async function saveCompanyReferenceBook(params: {
  companyId: string
  period: PeriodType
  bookType: BookType
  fileName: string
  fileSize: number
  content: string
}): Promise<{ success: boolean; data?: ReferenceBookItem; error?: string }> {
  const supabase = createClient()

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // コンテンツから仕訳ルールを抽出
    const { rules, summary } = extractRulesFromBookContent(params.content, params.bookType)

    const payload = {
      company_id: params.companyId,
      period: params.period,
      book_type: params.bookType,
      file_name: params.fileName,
      file_size: params.fileSize,
      parsed_rules: rules,
      raw_summary: summary,
      uploaded_by: user?.id,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('company_reference_books')
      .upsert(payload, { onConflict: 'company_id, period, book_type' })
      .select('*')
      .single()

    if (error) {
      console.error('Failed to upsert reference book:', error)
      return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        id: data.id,
        companyId: data.company_id,
        period: data.period,
        bookType: data.book_type,
        fileName: data.file_name,
        fileSize: data.file_size,
        parsedRules: data.parsed_rules || [],
        rawSummary: data.raw_summary,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    }
  } catch (err: any) {
    console.error('Error saving reference book:', err)
    return { success: false, error: err.message || '保存に失敗しました' }
  }
}

/**
 * 過去帳簿を削除
 */
export async function deleteCompanyReferenceBook(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()

  const { error } = await supabase.from('company_reference_books').delete().eq('id', id)

  if (error) {
    console.error('Failed to delete reference book:', error)
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * AIプロンプト注入用に会社の全過去仕訳ルールをテキスト形式で取得
 */
export async function getCompanyReferenceRulesPrompt(
  companyId: string
): Promise<string> {
  const books = await fetchCompanyReferenceBooks(companyId)
  if (books.length === 0) return ''

  // 全帳簿からルールをマージ
  const allRules: ReferenceRuleItem[] = []
  books.forEach((b) => {
    b.parsedRules.forEach((r) => {
      allRules.push(r)
    })
  })

  if (allRules.length === 0) return ''

  // キーワード重複排除（出現頻度が高いものを優先）
  const uniqueMap = new Map<string, ReferenceRuleItem>()
  allRules.forEach((r) => {
    const existing = uniqueMap.get(r.keyword)
    if (!existing || (r.frequency || 0) > (existing.frequency || 0)) {
      uniqueMap.set(r.keyword, r)
    }
  })

  const topRules = Array.from(uniqueMap.values())
    .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
    .slice(0, 100)

  let prompt = `\n\n【最優先ルール：当社の前期・前々期の帳簿実績に基づく勘定科目・税区分ルール】\n`
  prompt += `過去の総勘定元帳・仕訳日記帳・補助残高一覧表の実績から、以下の取引パターンが登録されています。\n`
  prompt += `領収書や通帳の取引内容（取引先や摘要）が以下のキーワードに合致する場合は、必ず過去実績の勘定科目・税区分・補助科目を最優先して適用してください：\n`

  topRules.forEach((r) => {
    let line = `- 取引先/摘要「${r.keyword}」➔ 借方科目「${r.debitAccount}」`
    if (r.taxType) line += `、税区分「${r.taxType}」`
    if (r.subAccount) line += `、補助科目「${r.subAccount}」`
    prompt += line + `\n`
  })

  return prompt
}
