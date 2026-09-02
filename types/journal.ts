export interface ReceiptAnalysisResult {
  /** 取引日 (例: "2026-08-25" または "要確認") */
  date: string;
  /** 支払先・店舗名 / 相手先印字 (例: "○○株式会社", "タカギ ユキオ" または "要確認") */
  payee: string;
  /** 取引内容 / 摘要 (例: "文房具・食品の購入", "振込 BZ2" または "要確認") */
  description: string;
  /** 合計金額 (例: 1500 または "要確認") */
  amount: number | string;

  /** 借方勘定科目 (例: "仮払金", "普通預金", "消耗品費" または "要確認") */
  debitAccount: string;
  /** 借方補助科目 (例: "パソコン関連" または "") */
  debitSubAccount: string;
  /** 借方税区分 (例: "課対仕入10%", "課対仕入8%(軽)", "対象外" または "要確認") */
  debitTaxType: string;
  /** 借方金額 (例: 1500 または "要確認") */
  debitAmount: number | string;

  /** 貸方勘定科目 (例: "普通預金", "仮受金", "現金" または "要確認") */
  creditAccount: string;
  /** 貸方補助科目 (例: "○○カード" または "") */
  creditSubAccount: string;
  /** 貸方税区分 (例: "対象外" または "要確認") */
  creditTaxType: string;
  /** 貸方金額 (例: 1500 または "要確認") */
  creditAmount: number | string;

  /** 摘要 (例: "通帳明細 08/15 振込 BZ2 タカギ ユキオ") */
  summary: string;
  /** AIが判断に自信を持てない項目名のリスト (例: ["date", "amount"]) */
  uncertainFields: string[];

  /** 通帳分析用オプショナル属性 */
  transactionType?: "出金" | "入金" | "要確認";
  balance?: number | string;
  rawText?: string;
  pageNumber?: number; // 通帳PDFの該当ページ番号 (1, 2, 3...)
}

export interface PageDetail {
  pageNumber: number;
  detectedCount: number;
  items: ReceiptAnalysisResult[];
}

export interface AnalyzeApiResponse {
  success: boolean;
  data?: ReceiptAnalysisResult[];
  detectedCount?: number; // AIが通帳全ページから認識した明細行の総数
  pages?: PageDetail[]; // ページごとの解析詳細
  error?: string;
}

export type ReceiptStatus = "idle" | "analyzing" | "completed" | "error";

export interface ReceiptFileItem {
  id: string;
  file: File;
  fileName: string;
  previewUrl: string;
  status: ReceiptStatus;
  errorMessage?: string;
  results?: ReceiptAnalysisResult[];
  detectedCount?: number; // 通帳全ページから認識した明細行総数
  pages?: PageDetail[]; // ページ別詳細
}

export type AppMode = "receipt" | "bankbook";

export interface AnalysisHistoryItem {
  id: string;
  createdAt: string; // ISO 日時文字列
  mode: AppMode;
  fileNames: string[];
  totalEntries: number;
  totalAmount: number;
  // 復元用ファイルデータオブジェクト (Fileオブジェクトは除外してシリアライズ可能なプロパティのみ保持)
  filesData: {
    id: string;
    fileName: string;
    status: ReceiptStatus;
    results?: ReceiptAnalysisResult[];
    detectedCount?: number;
    pages?: PageDetail[];
  }[];
}
