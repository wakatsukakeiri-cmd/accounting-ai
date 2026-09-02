import Encoding from "encoding-japanese";
import { ReceiptAnalysisResult } from "@/types/journal";

/**
 * 取引日付文字列を YYYY/MM/DD 形式にフォーマットする
 */
export function formatYayoiDate(dateStr: string): string {
  if (!dateStr || dateStr === "要確認") return "";
  // "2026-08-25" -> "2026/08/25"
  return dateStr.replace(/-/g, "/").trim();
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
    escapeCsvValue(entry.summary),                    // 17: 摘要
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
