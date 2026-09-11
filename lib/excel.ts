import ExcelJS from "exceljs";
import { ReceiptAnalysisResult, AppMode } from "@/types/journal";
import { formatYayoiDate, sanitizeSummaryForCsv } from "@/lib/yayoi";

export interface ExcelExportItem {
  entry: ReceiptAnalysisResult;
  fileName?: string;
}

/**
 * 仕訳データからプロフェッショナルな2シート構成の Excel Blob (.xlsx) を生成する
 * 1. 「仕訳明細一覧」シート
 * 2. 「勘定科目別集計」シート
 */
export async function generateYayoiExcelBlob(
  items: ExcelExportItem[],
  mode: AppMode
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AI 会計仕訳作成アシスタント";
  workbook.created = new Date();

  const modeLabel = mode === "bankbook" ? "🏦 通帳" : "📄 領収書";

  // ---------------------------------------------------------
  // 📜 第1シート: 「仕訳明細一覧」
  // ---------------------------------------------------------
  const sheet1 = workbook.addWorksheet("仕訳明細一覧", {
    views: [{ showGridLines: true }],
  });

  // ヘッダー定義
  sheet1.columns = [
    { header: "取引日", key: "date", width: 14 },
    { header: "種別", key: "type", width: 12 },
    { header: "借方勘定科目", key: "debitAccount", width: 16 },
    { header: "借方補助科目", key: "debitSubAccount", width: 15 },
    { header: "借方金額", key: "debitAmount", width: 15 },
    { header: "借方税区分", key: "debitTaxType", width: 15 },
    { header: "貸方勘定科目", key: "creditAccount", width: 16 },
    { header: "貸方補助科目", key: "creditSubAccount", width: 15 },
    { header: "貸方金額", key: "creditAmount", width: 15 },
    { header: "貸方税区分", key: "creditTaxType", width: 15 },
    { header: "摘要", key: "summary", width: 35 },
    { header: "元ファイル名", key: "fileName", width: 25 },
  ];

  // ヘッダー行スタイリング
  const headerRow1 = sheet1.getRow(1);
  headerRow1.height = 26;
  headerRow1.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "1E293B" }, // ダークスレート
    };
    cell.font = {
      name: "メイリオ",
      size: 10,
      bold: true,
      color: { argb: "FFFFFF" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: "334155" } },
      bottom: { style: "medium", color: { argb: "0F172A" } },
    };
  });

  // 行データ投入
  items.forEach((item, index) => {
    const entry = item.entry;
    const dateFormatted = formatYayoiDate(entry.date) || entry.date || "";
    const cleanSummary = sanitizeSummaryForCsv(entry.summary || "");
    const dAmount = typeof entry.debitAmount === "number" ? entry.debitAmount : Number(entry.debitAmount) || 0;
    const cAmount = typeof entry.creditAmount === "number" ? entry.creditAmount : Number(entry.creditAmount) || 0;

    const row = sheet1.addRow({
      date: dateFormatted,
      type: modeLabel,
      debitAccount: entry.debitAccount || "",
      debitSubAccount: entry.debitSubAccount || "",
      debitAmount: dAmount,
      debitTaxType: entry.debitTaxType || "",
      creditAccount: entry.creditAccount || "",
      creditSubAccount: entry.creditSubAccount || "",
      creditAmount: cAmount,
      creditTaxType: entry.creditTaxType || "",
      summary: cleanSummary,
      fileName: item.fileName || "",
    });

    row.height = 22;

    // ゼブラカラー背景
    const isEven = index % 2 === 1;
    const bgColor = isEven ? "F8FAFC" : "FFFFFF";

    row.eachCell((cell, colNumber) => {
      cell.font = { name: "メイリオ", size: 9.5 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bgColor },
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: "E2E8F0" } },
      };

      // 配置とフォーマット
      if (colNumber === 1 || colNumber === 2 || colNumber === 6 || colNumber === 10) {
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (colNumber === 5 || colNumber === 9) {
        cell.alignment = { vertical: "middle", horizontal: "right" };
        cell.numFmt = "#,##0";
      } else {
        cell.alignment = { vertical: "middle", horizontal: "left" };
      }
    });
  });

  // 最下部合計行の追加
  const lastRowIndex = items.length + 1;
  if (items.length > 0) {
    const totalRowIndex = lastRowIndex + 1;
    const totalRow = sheet1.getRow(totalRowIndex);
    totalRow.height = 24;

    totalRow.getCell(1).value = "合計";
    totalRow.getCell(5).value = { formula: `SUM(E2:E${lastRowIndex})` };
    totalRow.getCell(9).value = { formula: `SUM(I2:I${lastRowIndex})` };

    totalRow.eachCell((cell, colNumber) => {
      cell.font = { name: "メイリオ", size: 10, bold: true };
      cell.border = {
        top: { style: "thin", color: { argb: "64748B" } },
        bottom: { style: "double", color: { argb: "0F172A" } },
      };
      if (colNumber === 5 || colNumber === 9) {
        cell.alignment = { vertical: "middle", horizontal: "right" };
        cell.numFmt = "#,##0";
      } else {
        cell.alignment = { vertical: "middle", horizontal: "left" };
      }
    });
  }

  // ---------------------------------------------------------
  // 📊 第2シート: 「勘定科目別集計」
  // ---------------------------------------------------------
  const sheet2 = workbook.addWorksheet("勘定科目別集計", {
    views: [{ showGridLines: true }],
  });

  sheet2.columns = [
    { header: "区分", key: "side", width: 12 },
    { header: "勘定科目", key: "account", width: 22 },
    { header: "件数", key: "count", width: 12 },
    { header: "合計金額", key: "totalAmount", width: 18 },
  ];

  const headerRow2 = sheet2.getRow(1);
  headerRow2.height = 26;
  headerRow2.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "0F172A" },
    };
    cell.font = {
      name: "メイリオ",
      size: 10,
      bold: true,
      color: { argb: "FFFFFF" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  // 集計計算
  const debitMap: Record<string, { count: number; sum: number }> = {};
  const creditMap: Record<string, { count: number; sum: number }> = {};

  items.forEach((item) => {
    const entry = item.entry;
    const dAcc = entry.debitAccount || "要確認";
    const cAcc = entry.creditAccount || "要確認";
    const dAmt = typeof entry.debitAmount === "number" ? entry.debitAmount : Number(entry.debitAmount) || 0;
    const cAmt = typeof entry.creditAmount === "number" ? entry.creditAmount : Number(entry.creditAmount) || 0;

    if (!debitMap[dAcc]) debitMap[dAcc] = { count: 0, sum: 0 };
    debitMap[dAcc].count += 1;
    debitMap[dAcc].sum += dAmt;

    if (!creditMap[cAcc]) creditMap[cAcc] = { count: 0, sum: 0 };
    creditMap[cAcc].count += 1;
    creditMap[cAcc].sum += cAmt;
  });

  let s2RowIdx = 0;

  // 借方集計書き込み
  Object.entries(debitMap).forEach(([acc, stat]) => {
    s2RowIdx += 1;
    const row = sheet2.addRow({
      side: "借方",
      account: acc,
      count: stat.count,
      totalAmount: stat.sum,
    });
    row.height = 22;
    row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(3).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(4).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(4).numFmt = "#,##0";
    row.eachCell((cell) => {
      cell.font = { name: "メイリオ", size: 9.5 };
      cell.border = { bottom: { style: "thin", color: { argb: "E2E8F0" } } };
    });
  });

  // 貸方集計書き込み
  Object.entries(creditMap).forEach(([acc, stat]) => {
    s2RowIdx += 1;
    const row = sheet2.addRow({
      side: "貸方",
      account: acc,
      count: stat.count,
      totalAmount: stat.sum,
    });
    row.height = 22;
    row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    row.getCell(3).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(4).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(4).numFmt = "#,##0";
    row.eachCell((cell) => {
      cell.font = { name: "メイリオ", size: 9.5 };
      cell.border = { bottom: { style: "thin", color: { argb: "E2E8F0" } } };
    });
  });

  // Buffer 変換 ➔ Blob 返却
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
