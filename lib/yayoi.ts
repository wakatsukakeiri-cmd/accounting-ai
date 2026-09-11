import Encoding from "encoding-japanese";
import { ReceiptAnalysisResult } from "@/types/journal";

/**
 * 2桁元号年表記 (08/08/25, 09.03.10, R08-08-25 等) を西暦 YYYY-MM-DD に正規化する
 * 令和N年 = 2018 + N年 (例: 08 -> 2026, 09 -> 2027, 01 -> 2019, 07 -> 2025)
 * 既に 20XX-MM-DD など 4桁西暦の場合は一切変更せずそのまま維持する
 */
export function normalizeDateToSeireki(dateStr: string): string {
  if (!dateStr || dateStr === "要確認") return dateStr || "";

  const trimmed = dateStr.trim();

  // 既に 4桁西暦 (YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD) の場合はハイフン表記にしてそのまま返す
  if (/^(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split(/[-/.]/);
    const y = parts[0];
    const m = parts[1].padStart(2, "0");
    const d = parts[2].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 2桁元号年パターン (例: 08-08-25, 09/03/10, R08-08-25, 08.08.25)
  // 月(01〜12), 日(01〜31) が正しい場合のみ変換
  const match2Digit = trimmed.match(/^(?:R|r)?(\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])$/);
  if (match2Digit) {
    const eraYear = parseInt(match2Digit[1], 10);
    // 令和の年数 (01〜99): 2018 + eraYear
    const seirekiYear = 2018 + eraYear;
    const m = match2Digit[2].padStart(2, "0");
    const d = match2Digit[3].padStart(2, "0");
    return `${seirekiYear}-${m}-${d}`;
  }

  // "令和8年8月25日" や "R8年8月25日" などの日本語パターン
  const matchJp = trimmed.match(/^(?:令和|R|r)?(\d{1,2})年\s*(0?[1-9]|1[0-2])月\s*(0?[1-9]|[12]\d|3[01])日$/);
  if (matchJp) {
    const eraYear = parseInt(matchJp[1], 10);
    const seirekiYear = 2018 + eraYear;
    const m = matchJp[2].padStart(2, "0");
    const d = matchJp[3].padStart(2, "0");
    return `${seirekiYear}-${m}-${d}`;
  }

  return trimmed;
}

/**
 * 摘要欄から「取引日付」のみを削除し、会計上意味のある「8月分」「15日締め」などはそのまま保持する
 */
export function sanitizeSummaryForCsv(summaryStr: string): string {
  if (!summaryStr || summaryStr === "要確認") return summaryStr || "";

  let cleaned = summaryStr;

  // 先頭の "通帳明細 " プレフィックスを削除
  cleaned = cleaned.replace(/^通帳明細\s*/, "");

  // 1. 4桁西暦日付パターン (例: "2026/08/25 ", "2026-08-25 ") の除去
  cleaned = cleaned.replace(/(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\s*/g, "");

  // 2. 先頭または区切り文字直後の取引日付パターン (例: "08/25 ", "8/25 ", "08-25 ") の除去
  // ※ 「8月分」「15日締め」などの会計上の重要表現は (?!\d|月|日) のガードにより保持されます
  cleaned = cleaned.replace(/(?<!\d)(?:0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\d|3[01])(?!\d|月|日|\w)\s*/g, "");

  return cleaned.trim();
}

/**
 * 取引日付文字列を YYYY/MM/DD 形式にフォーマットする
 */
export function formatYayoiDate(dateStr: string): string {
  if (!dateStr || dateStr === "要確認") return "";
  const normalized = normalizeDateToSeireki(dateStr);
  return normalized.replace(/-/g, "/").trim();
}

/**
 * 単一フィールドをCSV出力用にダブルクォーテーション囲み・エスケープ処理する
 */
function escapeCsvValue(val: string | number | undefined, isNumeric = false): string {
  if (val === undefined || val === null || val === "要確認") {
    return isNumeric ? "0" : '""';
  }

  if (isNumeric) {
    const num = Number(val);
    return isNaN(num) ? "0" : String(num);
  }

  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * 仕訳データ (ReceiptAnalysisResult) から弥生会計26インポート用 (25項目) のCSV文字列を行ごとに生成
 */
export function buildYayoiCsvLine(entry: ReceiptAnalysisResult): string {
  const cleanSummary = sanitizeSummaryForCsv(entry.summary || "");

  const columns: string[] = [
    '"2000"',                                         // 1: 識別フラグ (単行仕訳)
    '""',                                             // 2: 伝票No.
    '""',                                             // 3: 決算
    escapeCsvValue(formatYayoiDate(entry.date)),      // 4: 取引日付 (YYYY/MM/DD)
    escapeCsvValue(entry.debitAccount),               // 5: 借方勘定科目
    escapeCsvValue(entry.debitSubAccount || ""),      // 6: 借方補助科目
    '""',                                             // 7: 借方部門
    escapeCsvValue(entry.debitTaxType),               // 8: 借方税区分
    escapeCsvValue(entry.debitAmount, true),          // 9: 借方金額 (数値)
    "0",                                              // 10: 借方消費税額
    escapeCsvValue(entry.creditAccount),              // 11: 貸方勘定科目
    escapeCsvValue(entry.creditSubAccount || ""),     // 12: 貸方補助科目
    '""',                                             // 13: 貸方部門
    escapeCsvValue(entry.creditTaxType),              // 14: 貸方税区分
    escapeCsvValue(entry.creditAmount, true),         // 15: 貸方金額 (数値)
    "0",                                              // 16: 貸方消費税額
    escapeCsvValue(cleanSummary),                     // 17: 摘要 (日付除去済み)
    '""',                                             // 18: 番号
    '""',                                             // 19: 荷証券番号
    "0",                                              // 20: タイプ
    "0",                                              // 21: 生成フラグ / 拡張項目
    "0",                                              // 22: 調整
    '""',                                             // 23: 仕訳メモ
    "0",                                              // 24: 付箋1
    "0",                                              // 25: 付箋2
  ];

  return columns.join(",");
}

/**
 * 単一または複数の仕訳データから 弥生会計用CSV (Shift-JIS / CP932) の Blob を生成
 */
export function generateYayoiCsvBlob(
  entries: ReceiptAnalysisResult | ReceiptAnalysisResult[]
): Blob {
  const entryArray = Array.isArray(entries) ? entries : [entries];

  const csvLines = entryArray.map((entry) => buildYayoiCsvLine(entry));
  const csvTextWithCrlf = csvLines.join("\r\n") + "\r\n";

  // 文字列を Unicode コードポイント配列に変換
  const unicodeArray = Encoding.stringToCode(csvTextWithCrlf);

  // Shift-JIS (SJIS / CP932) のバイト配列に変換
  const sjisBytes = Encoding.convert(unicodeArray, {
    to: "SJIS",
    from: "UNICODE",
  });

  const uint8Array = new Uint8Array(sjisBytes);
  return new Blob([uint8Array], { type: "text/csv;charset=shift_jis" });
}

/**
 * 単一または複数の仕訳データから 弥生会計用テキスト (.txt / Shift-JIS / CP932) の Blob を生成
 */
export function generateYayoiTxtBlob(
  entries: ReceiptAnalysisResult | ReceiptAnalysisResult[]
): Blob {
  const entryArray = Array.isArray(entries) ? entries : [entries];

  const csvLines = entryArray.map((entry) => buildYayoiCsvLine(entry));
  const csvTextWithCrlf = csvLines.join("\r\n") + "\r\n";

  const unicodeArray = Encoding.stringToCode(csvTextWithCrlf);

  const sjisBytes = Encoding.convert(unicodeArray, {
    to: "SJIS",
    from: "UNICODE",
  });

  const uint8Array = new Uint8Array(sjisBytes);
  return new Blob([uint8Array], { type: "text/plain;charset=shift_jis" });
}
