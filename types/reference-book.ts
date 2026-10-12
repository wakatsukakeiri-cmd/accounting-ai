export type PeriodType = 'previous' | 'two_years_ago'
export type BookType = 'general_ledger' | 'journal' | 'subsidiary_ledger'

export interface ReferenceRuleItem {
  keyword: string // 取引先や摘要のキーワード
  direction?: 'withdrawal' | 'deposit' | 'both' // 出金 / 入金 / 共通
  debitAccount?: string // 借方勘定科目
  creditAccount?: string // 貸方勘定科目
  taxType?: string // 税区分 (例: 課税仕入 10%)
  subAccount?: string // 補助科目
  frequency?: number // 出現頻度
}

export interface ReferenceBookItem {
  id: string
  companyId: string
  period: PeriodType
  bookType: BookType
  fileName: string
  fileSize: number
  parsedRules: ReferenceRuleItem[]
  rawSummary?: string
  createdAt: string
  updatedAt: string
}
