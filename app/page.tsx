"use client";

import { useState, useEffect, ChangeEvent, DragEvent } from "react";
import {
  ReceiptAnalysisResult,
  AnalyzeApiResponse,
  ReceiptFileItem,
  AppMode,
  AnalysisHistoryItem,
} from "@/types/journal";
import { generateYayoiCsvBlob, generateYayoiTxtBlob } from "@/lib/yayoi";
import { runWithConcurrencyLimit } from "@/lib/queue";

const COMMON_DEBIT_ACCOUNTS = [
  "仮払金",
  "普通預金",
  "消耗品費",
  "旅費交通費",
  "会議費",
  "接待交際費",
  "通信費",
  "新聞図書費",
  "水道光熱費",
  "地代家賃",
  "支払手数料",
  "事業主貸",
  "雑費",
];

const COMMON_CREDIT_ACCOUNTS = [
  "普通預金",
  "仮受金",
  "現金",
  "小口現金",
  "売上",
  "事業主借",
  "未払金",
  "クレジットカード",
];

const TAX_TYPES = [
  "対象外",
  "課対仕入10%",
  "課対仕入8%(軽)",
  "非課仕入",
];

export default function Home() {
  const [appMode, setAppMode] = useState<AppMode>("receipt");

  // モード別ファイル管理
  const [receiptFiles, setReceiptFiles] = useState<ReceiptFileItem[]>([]);
  const [bankbookFiles, setBankbookFiles] = useState<ReceiptFileItem[]>([]);

  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showWarningModal, setShowWarningModal] = useState<boolean>(false);

  // 複数仕訳の一括選択キーセット ("${fileId}_${resIdx}")
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // 右側のファイル表示タブ ("all" または ファイルID)
  const [activeFileTab, setActiveFileTab] = useState<string>("all");

  // 通帳モード用: ファイルごとの現在選択中ページ (fileId -> pageNumber | 'all')
  const [selectedPageMap, setSelectedPageMap] = useState<Record<string, number | "all">>({});

  // 一括変更用フォーム状態
  const [bulkAccountSide, setBulkAccountSide] = useState<"debit" | "credit">("debit");
  const [bulkAccountValue, setBulkAccountValue] = useState<string>("");

  const [bulkTaxSide, setBulkTaxSide] = useState<"debit" | "credit">("debit");
  const [bulkTaxValue, setBulkTaxValue] = useState<string>("対象外");

  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);

  // 初期解析結果のバックアップ (リセット用: fileId -> ReceiptAnalysisResult[])
  const [initialBackup, setInitialBackup] = useState<Record<string, ReceiptAnalysisResult[]>>({});

  // 履歴保存用ステート
  const [historyList, setHistoryList] = useState<AnalysisHistoryItem[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  const currentFiles = appMode === "receipt" ? receiptFiles : bankbookFiles;
  const setCurrentFiles = appMode === "receipt" ? setReceiptFiles : setBankbookFiles;

  // ローカルストレージからの履歴読み込み
  useEffect(() => {
    try {
      const saved = localStorage.getItem("accounting_ai_history");
      if (saved) {
        setHistoryList(JSON.parse(saved));
      }
    } catch {
      // localStorage read error ignored
    }
  }, []);

  // 履歴のローカルストレージ自動保存
  const saveSnapshotToHistory = (
    targetMode: AppMode,
    files: ReceiptFileItem[]
  ) => {
    const completedItems = files.filter(
      (f) => f.status === "completed" && f.results && f.results.length > 0
    );

    if (completedItems.length === 0) return;

    let totalEntries = 0;
    let totalAmount = 0;

    const filesData = completedItems.map((f) => {
      const results = f.results || [];
      results.forEach((entry) => {
        totalEntries++;
        const amt =
          typeof entry.amount === "number"
            ? entry.amount
            : parseFloat(String(entry.amount)) || 0;
        totalAmount += amt;
      });

      return {
        id: f.id,
        fileName: f.fileName,
        status: f.status,
        results: f.results,
        detectedCount: f.detectedCount,
        pages: f.pages,
      };
    });

    const newRecord: AnalysisHistoryItem = {
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date().toISOString(),
      mode: targetMode,
      fileNames: completedItems.map((f) => f.fileName),
      totalEntries,
      totalAmount,
      filesData,
    };

    setHistoryList((prev) => {
      if (prev.length > 0) {
        const last = prev[0];
        const isSameFiles = JSON.stringify(last.fileNames) === JSON.stringify(newRecord.fileNames);
        const isSameEntries = last.totalEntries === newRecord.totalEntries;
        const isSameAmount = last.totalAmount === newRecord.totalAmount;
        const isRecent = Date.now() - new Date(last.createdAt).getTime() < 3000;

        if (isSameFiles && isSameEntries && isSameAmount && isRecent) {
          return prev;
        }
      }

      const updated = [newRecord, ...prev].slice(0, 20);
      try {
        localStorage.setItem("accounting_ai_history", JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  // 履歴からの復元処理
  const handleRestoreHistoryRecord = (record: AnalysisHistoryItem) => {
    setAppMode(record.mode);

    const restoredItems: ReceiptFileItem[] = record.filesData.map((fd) => ({
      id: fd.id,
      file: new File([], fd.fileName),
      fileName: fd.fileName,
      previewUrl: "",
      status: fd.status,
      results: JSON.parse(JSON.stringify(fd.results || [])),
      detectedCount: fd.detectedCount,
      pages: fd.pages,
    }));

    if (record.mode === "receipt") {
      setReceiptFiles(restoredItems);
    } else {
      setBankbookFiles(restoredItems);
    }

    const newBackup: Record<string, ReceiptAnalysisResult[]> = {};
    record.filesData.forEach((fd) => {
      if (fd.results) {
        newBackup[fd.id] = JSON.parse(JSON.stringify(fd.results));
      }
    });
    setInitialBackup((prev) => ({ ...prev, ...newBackup }));

    setSelectedKeys(new Set());
    setActiveFileTab("all");
    setShowHistoryModal(false);
  };

  const handleDeleteHistoryRecord = (id: string) => {
    setHistoryList((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      try {
        localStorage.setItem("accounting_ai_history", JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const handleFilesAdded = (selectedFiles: FileList | File[] | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;

    const validFiles: File[] = Array.from(selectedFiles).filter((f) => {
      if (appMode === "receipt") {
        return f.type.startsWith("image/");
      } else {
        return f.type.startsWith("image/") || f.type === "application/pdf";
      }
    });

    if (validFiles.length === 0) {
      setGlobalError(
        appMode === "receipt"
          ? "領収書モードでは画像ファイル (.png, .jpg, .jpeg, .webp 等) を選択してください。"
          : "通帳モードでは画像ファイル (.png, .jpg, .webp 等) または 通帳PDF (.pdf) を選択してください。"
      );
      return;
    }

    setGlobalError(null);

    const newItems: ReceiptFileItem[] = validFiles.map((file, idx) => {
      const id = `${appMode}_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`;
      const previewUrl = URL.createObjectURL(file);
      return {
        id,
        file,
        fileName: file.name,
        previewUrl,
        status: "idle",
      };
    });

    setCurrentFiles((prev) => [...prev, ...newItems]);
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFilesAdded(e.target.files);
    e.target.value = "";
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleFilesAdded(e.dataTransfer.files);
  };

  const handleRemoveFile = (id: string) => {
    setCurrentFiles((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item?.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter((i) => i.id !== id);
    });

    setInitialBackup((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      Array.from(next).forEach((key) => {
        if (key.startsWith(`${id}_`)) next.delete(key);
      });
      return next;
    });

    if (activeFileTab === id) {
      setActiveFileTab("all");
    }
  };

  const handleClearAll = () => {
    currentFiles.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setCurrentFiles([]);
    setSelectedKeys(new Set());
    setActiveFileTab("all");
    setGlobalError(null);
  };

  const analyzeSingleFile = async (item: ReceiptFileItem) => {
    setCurrentFiles((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: "analyzing" } : i))
    );

    try {
      const formData = new FormData();
      formData.append("file", item.file);

      const endpoint =
        appMode === "receipt" ? "/api/analyze" : "/api/analyze-bankbook";

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const json: AnalyzeApiResponse = await res.json();

      if (!json.success || !json.data || json.data.length === 0) {
        throw new Error(json.error || "解析に失敗しました。");
      }

      const results = json.data;
      const detectedCount = json.detectedCount;
      const pages = json.pages;

      setInitialBackup((prev) => ({
        ...prev,
        [item.id]: JSON.parse(JSON.stringify(results)),
      }));

      setSelectedPageMap((prev) => ({ ...prev, [item.id]: 1 }));

      setCurrentFiles((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "completed",
                results,
                detectedCount,
                pages,
                errorMessage: undefined,
              }
            : i
        )
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "予期せぬエラーが発生しました。";
      setCurrentFiles((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "error", errorMessage: msg }
            : i
        )
      );
    }
  };

  const handleBatchAnalyze = async () => {
    const pendingItems = currentFiles.filter(
      (item) => item.status === "idle" || item.status === "error"
    );

    if (pendingItems.length === 0) return;

    setIsBatchProcessing(true);
    setGlobalError(null);

    await runWithConcurrencyLimit(pendingItems, 1, async (item) => {
      await analyzeSingleFile(item);
    });

    setIsBatchProcessing(false);

    setCurrentFiles((latestFiles) => {
      saveSnapshotToHistory(appMode, latestFiles);
      return latestFiles;
    });
  };

  const parseAmountInput = (valStr: string): number | string => {
    if (!valStr || valStr.trim() === "") return "";
    if (valStr === "要確認") return "要確認";
    const sanitized = valStr
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
      .replace(/[,円￥\s]/g, "");
    const num = Number(sanitized);
    if (!isNaN(num) && sanitized !== "") {
      return num;
    }
    return valStr;
  };

  const handleFieldChange = (
    fileId: string,
    resultIndex: number,
    fieldKey: keyof ReceiptAnalysisResult,
    value: string | number
  ) => {
    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.id !== fileId || !item.results) return item;
        const nextResults = [...item.results];
        nextResults[resultIndex] = {
          ...nextResults[resultIndex],
          [fieldKey]: value,
        };
        return { ...item, results: nextResults };
      })
    );
  };

  const handleAmountChange = (
    fileId: string,
    resultIndex: number,
    fieldKey: "amount" | "debitAmount" | "creditAmount",
    rawValue: string
  ) => {
    const parsedVal = parseAmountInput(rawValue);

    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.id !== fileId || !item.results) return item;
        const nextResults = [...item.results];
        const updatedEntry = {
          ...nextResults[resultIndex],
          [fieldKey]: parsedVal,
        };

        if (fieldKey === "amount") {
          updatedEntry.debitAmount = parsedVal;
          updatedEntry.creditAmount = parsedVal;
        }

        nextResults[resultIndex] = updatedEntry;
        return { ...item, results: nextResults };
      })
    );
  };

  const handleResetFileResults = (fileId: string) => {
    const backup = initialBackup[fileId];
    if (!backup) return;

    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.id !== fileId) return item;
        return {
          ...item,
          results: JSON.parse(JSON.stringify(backup)),
        };
      })
    );

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      Array.from(next).forEach((key) => {
        if (key.startsWith(`${fileId}_`)) next.delete(key);
      });
      return next;
    });
  };

  const handleToggleSelectKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getAllCompletedEntryKeys = (): string[] => {
    const keys: string[] = [];
    currentFiles.forEach((item) => {
      if (item.status === "completed" && item.results) {
        if (activeFileTab === "all" || item.id === activeFileTab) {
          item.results.forEach((_, resIdx) => {
            keys.push(`${item.id}_${resIdx}`);
          });
        }
      }
    });
    return keys;
  };

  const handleSelectAll = () => {
    const allKeys = getAllCompletedEntryKeys();
    setSelectedKeys(new Set(allKeys));
  };

  const handleDeselectAll = () => {
    setSelectedKeys(new Set());
  };

  const handleApplyBulkAccountChange = () => {
    if (selectedKeys.size === 0 || !bulkAccountValue.trim()) return;

    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.status !== "completed" || !item.results) return item;

        const nextResults = item.results.map((entry, resIdx) => {
          const key = `${item.id}_${resIdx}`;
          if (selectedKeys.has(key)) {
            if (bulkAccountSide === "debit") {
              return { ...entry, debitAccount: bulkAccountValue.trim() };
            } else {
              return { ...entry, creditAccount: bulkAccountValue.trim() };
            }
          }
          return entry;
        });

        return { ...item, results: nextResults };
      })
    );

    setSelectedKeys(new Set());
  };

  const handleApplyBulkTaxChange = () => {
    if (selectedKeys.size === 0 || !bulkTaxValue) return;

    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.status !== "completed" || !item.results) return item;

        const nextResults = item.results.map((entry, resIdx) => {
          const key = `${item.id}_${resIdx}`;
          if (selectedKeys.has(key)) {
            if (bulkTaxSide === "debit") {
              return { ...entry, debitTaxType: bulkTaxValue };
            } else {
              return { ...entry, creditTaxType: bulkTaxValue };
            }
          }
          return entry;
        });

        return { ...item, results: nextResults };
      })
    );

    setSelectedKeys(new Set());
  };

  const handleApplyBulkDelete = () => {
    if (selectedKeys.size === 0) return;

    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.status !== "completed" || !item.results) return item;

        const nextResults = item.results.filter((_, resIdx) => {
          const key = `${item.id}_${resIdx}`;
          return !selectedKeys.has(key);
        });

        return { ...item, results: nextResults };
      })
    );

    setSelectedKeys(new Set());
    setShowDeleteConfirmModal(false);
  };

  const isUncertainInEntry = (
    entry: ReceiptAnalysisResult,
    fieldKey: keyof ReceiptAnalysisResult
  ) => {
    return entry[fieldKey] === "要確認";
  };

  const getOverallSummary = () => {
    let totalFiles = currentFiles.length;
    let completedFiles = 0;
    let errorFiles = 0;
    let totalEntries = 0;
    let totalDebitSum = 0;
    let totalCreditSum = 0;
    let isAllBalanced = true;
    const uncertainList: string[] = [];
    const allCompletedEntries: ReceiptAnalysisResult[] = [];
    const selectedEntries: ReceiptAnalysisResult[] = [];

    const isSelectionActive = selectedKeys.size > 0;

    currentFiles.forEach((item) => {
      if (item.status === "completed") completedFiles++;
      if (item.status === "error") errorFiles++;

      if (item.status === "completed" && item.results) {
        item.results.forEach((entry, idx) => {
          totalEntries++;
          allCompletedEntries.push(entry);

          const entryKey = `${item.id}_${idx}`;
          const isSelected = selectedKeys.has(entryKey);
          if (isSelected) {
            selectedEntries.push(entry);
          }

          const isTargetForExport = isSelectionActive ? isSelected : true;

          if (isTargetForExport) {
            const debitNum =
              typeof entry.debitAmount === "number"
                ? entry.debitAmount
                : parseFloat(String(entry.debitAmount)) || 0;

            const creditNum =
              typeof entry.creditAmount === "number"
                ? entry.creditAmount
                : parseFloat(String(entry.creditAmount)) || 0;

            const isValidNumbers =
              entry.debitAmount !== "要確認" &&
              entry.creditAmount !== "要確認" &&
              !isNaN(debitNum) &&
              !isNaN(creditNum);

            if (!isValidNumbers || debitNum !== creditNum) {
              isAllBalanced = false;
            }

            totalDebitSum += debitNum;
            totalCreditSum += creditNum;

            const checkKeys: (keyof ReceiptAnalysisResult)[] = [
              "date",
              "payee",
              "description",
              "amount",
              "debitAccount",
              "debitTaxType",
              "debitAmount",
              "creditAccount",
              "creditTaxType",
              "creditAmount",
              "summary",
            ];

            checkKeys.forEach((k) => {
              if (entry[k] === "要確認") {
                uncertainList.push(`${item.fileName} (仕訳#${idx + 1}): ${k}`);
              }
            });
          }
        });
      }
    });

    const exportEntries = isSelectionActive ? selectedEntries : allCompletedEntries;
    const diff = totalDebitSum - totalCreditSum;
    const canExport =
      completedFiles > 0 &&
      isAllBalanced &&
      exportEntries.length > 0 &&
      diff === 0;

    return {
      totalFiles,
      completedFiles,
      errorFiles,
      totalEntries,
      exportEntries,
      isSelectionActive,
      totalDebitSum,
      totalCreditSum,
      isAllBalanced: isAllBalanced && diff === 0,
      canExport,
      uncertainList,
      allCompletedEntries,
    };
  };

  const summary = getOverallSummary();

  const executeDownloadYayoiCsv = () => {
    if (!summary.canExport || summary.exportEntries.length === 0) return;

    const isBankbook = appMode === "bankbook";
    const blob = isBankbook
      ? generateYayoiTxtBlob(summary.exportEntries)
      : generateYayoiCsvBlob(summary.exportEntries);

    const url = URL.createObjectURL(blob);

    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = isBankbook ? "Yayoi_Bankbook" : "Yayoi_Receipt";
    const selectedTag = summary.isSelectionActive ? "_Selected" : "";
    const ext = isBankbook ? "txt" : "csv";
    const fileName = `${prefix}${selectedTag}_Journal_${nowStr}.${ext}`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadClick = () => {
    if (!summary.canExport) return;

    if (summary.uncertainList.length > 0) {
      setShowWarningModal(true);
    } else {
      executeDownloadYayoiCsv();
    }
  };

  const formatCurrency = (val: number | string) => {
    if (val === "要確認" || typeof val !== "number") return "要確認";
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: "JPY",
    }).format(val);
  };

  // 選択中のファイルアイテム
  const activeFileItem =
    activeFileTab !== "all"
      ? currentFiles.find((f) => f.id === activeFileTab) || currentFiles[0]
      : currentFiles[0];

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-3 md:p-6 font-sans">
      <div className="mx-auto max-w-[1600px] space-y-4">
        {/* Header */}
        <header className="border-b border-slate-800 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400 border border-blue-500/20 mb-2">
                <span>AI Powered</span>
                <span>•</span>
                <span>Gemini 3.6 Flash</span>
                <span>•</span>
                <span>Split View ＆ 横一列データテーブル</span>
                <span>•</span>
                <span>弥生会計26対応</span>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
                AI 会計仕訳作成アシスタント
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                左側で元画像/PDFを対照確認しながら、右側の横一列データテーブルで高速チェック・仕訳編集。
              </p>
            </div>

            {/* 右側アクションエリア */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowHistoryModal(true)}
                className="flex items-center gap-2 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all shadow-md"
              >
                <span>📜 解析履歴</span>
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold text-blue-300 border border-blue-500/40">
                  {historyList.length}件
                </span>
              </button>

              <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800">
                <button
                  onClick={() => {
                    setAppMode("receipt");
                    setGlobalError(null);
                    setSelectedKeys(new Set());
                    setActiveFileTab("all");
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                    appMode === "receipt"
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30"
                      : "text-slate-400 hover:text-white hover:bg-slate-900"
                  }`}
                >
                  <span>📄 領収書モード</span>
                </button>

                <button
                  onClick={() => {
                    setAppMode("bankbook");
                    setGlobalError(null);
                    setSelectedKeys(new Set());
                    setActiveFileTab("all");
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                    appMode === "bankbook"
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                      : "text-slate-400 hover:text-white hover:bg-slate-900"
                  }`}
                >
                  <span>🏦 通帳モード (画像/複数PDF)</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Global Error Banner */}
        {globalError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 text-xs flex items-start gap-3 shadow-lg">
            <svg
              className="h-5 w-5 text-red-400 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <h3 className="font-bold text-red-200 mb-0.5">エラーが発生しました</h3>
              <p>{globalError}</p>
            </div>
          </div>
        )}

        {/* Main 2-Column Split View Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: 元画像・PDFプレビュー & ファイル管理 (lg:col-span-4 xl:col-span-3) */}
          <section className="lg:col-span-4 xl:col-span-3 space-y-4">
            {/* アップロードコントロールエリア */}
            <div className="rounded-2xl border border-slate-800 bg-slate-800/50 p-4 backdrop-blur-sm shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 002-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span>1. ファイル選択 ＆ 解析</span>
                </h2>

                {currentFiles.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    disabled={isBatchProcessing}
                    className="text-[11px] text-slate-400 hover:text-red-400 transition-colors disabled:opacity-40"
                  >
                    すべて削除
                  </button>
                )}
              </div>

              {/* ドラッグ＆ドロップエリア */}
              <div
                onDragOver={onDragOver}
                onDrop={onDrop}
                className="group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/60 p-4 text-center transition-all hover:border-blue-500 hover:bg-slate-900/80"
              >
                <input
                  type="file"
                  accept={
                    appMode === "receipt"
                      ? "image/png,image/jpeg,image/jpg,image/webp"
                      : "image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                  }
                  multiple
                  onChange={onFileInputChange}
                  className="absolute inset-0 z-10 cursor-pointer opacity-0"
                />

                <div className="space-y-1">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      />
                    </svg>
                  </div>
                  <div className="text-xs font-medium text-slate-300">
                    {appMode === "receipt"
                      ? "領収書画像をドラッグ＆ドロップ"
                      : "通帳画像・PDF(全ページ)をドラッグ＆ドロップ"}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {appMode === "receipt"
                      ? "またはクリックして選択 (.png, .jpg, .webp 複数選択可)"
                      : "またはクリックして選択 (.png, .jpg, .webp, .pdf 全ページ自動処理)"}
                  </p>
                </div>
              </div>

              {/* 選択中のファイルリスト */}
              {currentFiles.length > 0 && (
                <div className="space-y-1.5">
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {currentFiles.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setActiveFileTab(item.id)}
                        className={`flex items-center justify-between rounded-xl border p-2 cursor-pointer transition-all ${
                          activeFileTab === item.id
                            ? "border-blue-500 bg-blue-500/10 shadow-sm"
                            : "border-slate-700/80 bg-slate-900/80 hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          {item.file.type === "application/pdf" ? (
                            <div className="h-8 w-8 rounded border border-red-500/30 bg-red-500/10 flex items-center justify-center text-red-400 shrink-0 font-bold text-[10px]">
                              PDF
                            </div>
                          ) : item.previewUrl ? (
                            /* eslint-disable-next-html-element-for-img */
                            <img
                              src={item.previewUrl}
                              alt={item.fileName}
                              className="h-8 w-8 object-cover rounded border border-slate-700 shrink-0 bg-black/40"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded border border-blue-500/30 bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0 font-bold text-[10px]">
                              画像
                            </div>
                          )}

                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-200 truncate">
                              {item.fileName}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {(item.file.size / 1024).toFixed(1)} KB
                            </p>
                            {item.status === "error" && item.errorMessage && (
                              <p
                                className="text-[10px] font-mono text-red-400 mt-0.5 truncate max-w-[220px]"
                                title={item.errorMessage}
                              >
                                {item.errorMessage}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.status === "idle" && (
                            <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-medium border border-slate-700">
                              未解析
                            </span>
                          )}
                          {item.status === "analyzing" && (
                            <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-bold border border-blue-500/40 animate-pulse">
                              解析中...
                            </span>
                          )}
                          {item.status === "completed" && (
                            <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold border border-emerald-500/40">
                              ✓ {item.results?.length || 0}件
                            </span>
                          )}
                          {item.status === "error" && (
                            <span className="text-[9px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-bold border border-red-500/40">
                              ⚠️ エラー
                            </span>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(item.id);
                            }}
                            disabled={isBatchProcessing}
                            className="text-slate-500 hover:text-red-400 p-0.5 transition-colors disabled:opacity-30"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI解析ボタン */}
              <button
                onClick={handleBatchAnalyze}
                disabled={
                  currentFiles.length === 0 ||
                  isBatchProcessing ||
                  currentFiles.every((i) => i.status === "completed")
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 font-bold text-xs text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {isBatchProcessing ? (
                  <span>全ページ解析中 ({summary.completedFiles}/{summary.totalFiles})...</span>
                ) : (
                  <span>
                    {appMode === "receipt"
                      ? `AIで仕訳を作成 (${currentFiles.length} 件)`
                      : `通帳全ページをAI解析して仕訳作成 (${currentFiles.length} 件)`}
                  </span>
                )}
              </button>
            </div>

            {/* 左カラム下部: 選択中ファイルの元画像プレビュー ＆ 通帳ページ照合 */}
            {activeFileItem && activeFileItem.status === "completed" && (
              <div className="rounded-2xl border border-slate-800 bg-slate-800/50 p-4 backdrop-blur-sm shadow-xl space-y-3">
                <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span>🔍 元画像プレビュー:</span>
                    <span className="text-blue-400 truncate max-w-[200px]">
                      {activeFileItem.fileName}
                    </span>
                  </h3>

                  <button
                    onClick={() => handleResetFileResults(activeFileItem.id)}
                    className="text-[10px] text-slate-400 hover:text-white border border-slate-700 bg-slate-800 px-2 py-0.5 rounded"
                  >
                    初期結果にリセット
                  </button>
                </div>

                {/* 通帳モードのページ選択コントロール */}
                {appMode === "bankbook" && activeFileItem.pages && activeFileItem.pages.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                      <span className="font-bold text-blue-300">
                        通帳ページ: {selectedPageMap[activeFileItem.id] === "all" ? "全ページ" : `${selectedPageMap[activeFileItem.id] || 1} / ${activeFileItem.pages.length} ページ`}
                      </span>

                      <div className="flex items-center gap-1">
                        {activeFileItem.pages.map((p) => {
                          const isCur = selectedPageMap[activeFileItem.id] === p.pageNumber;
                          return (
                            <button
                              key={p.pageNumber}
                              onClick={() =>
                                setSelectedPageMap((prev) => ({
                                  ...prev,
                                  [activeFileItem.id]: p.pageNumber,
                                }))
                              }
                              className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                                isCur
                                  ? "bg-blue-600 border-blue-500 text-white"
                                  : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
                              }`}
                            >
                              P.{p.pageNumber}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* プレビュー表示キャンバス/画像 */}
                <div className="bg-black/70 rounded-xl p-2 border border-slate-800 flex items-center justify-center min-h-[220px] max-h-[360px] overflow-hidden">
                  {activeFileItem.file.type === "application/pdf" && activeFileItem.previewUrl ? (
                    <iframe
                      src={`${activeFileItem.previewUrl}#page=${selectedPageMap[activeFileItem.id] === "all" ? 1 : selectedPageMap[activeFileItem.id] || 1}&toolbar=0&navpanes=0`}
                      title={`元画像プレビュー ${activeFileItem.fileName}`}
                      className="w-full h-[320px] rounded border-0 bg-white"
                    />
                  ) : activeFileItem.previewUrl ? (
                    /* eslint-disable-next-html-element-for-img */
                    <img
                      src={activeFileItem.previewUrl}
                      alt={`通帳/領収書画像 ${activeFileItem.fileName}`}
                      className="max-h-[320px] w-full object-contain rounded"
                    />
                  ) : (
                    <div className="text-xs text-slate-400 text-center p-6">
                      📜 履歴復元データ (元画像プレビューなし)
                    </div>
                  )}
                </div>

                {/* 件数照合ステータス */}
                {appMode === "bankbook" && (
                  <div className="text-[11px] font-mono text-slate-300 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                    <span>認識明細: <strong>{activeFileItem.detectedCount ?? activeFileItem.results?.length}</strong> 件</span>
                    <span>生成仕訳: <strong>{activeFileItem.results?.length}</strong> 件</span>
                    <span className="text-emerald-400 font-bold">✅ 照合OK</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Right Column: 仕訳確認・編集・一括操作 & 横一列データテーブル (lg:col-span-8 xl:col-span-9) */}
          <section className="lg:col-span-8 xl:col-span-9 space-y-4">
            {summary.completedFiles === 0 && !isBatchProcessing && (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
                <div className="rounded-full bg-slate-800 p-4 text-slate-500 mb-3">
                  <svg
                    className="h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-300">
                  仕訳データが未作成です
                </h3>
                <p className="mt-1 text-xs text-slate-500 max-w-xs">
                  {appMode === "receipt"
                    ? "左側のエリアで領収書画像を選択し、「AIで仕訳を作成」ボタンを押してください。"
                    : "左側のエリアで通帳画像またはPDFを選択し、「通帳全ページをAI解析して仕訳作成」ボタンを押してください。"}
                </p>
              </div>
            )}

            {summary.completedFiles > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-800/50 p-4 md:p-5 backdrop-blur-sm shadow-xl space-y-4">
                {/* ファイル切替タブバー */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-700/80">
                  <button
                    onClick={() => setActiveFileTab("all")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all shrink-0 ${
                      activeFileTab === "all"
                        ? "bg-blue-600 border-blue-500 text-white shadow-md"
                        : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    🌐 全ファイル統合 ({summary.totalEntries}件)
                  </button>

                  {currentFiles
                    .filter((f) => f.status === "completed" && f.results)
                    .map((f) => {
                      const isAct = activeFileTab === f.id;
                      return (
                        <button
                          key={f.id}
                          onClick={() => setActiveFileTab(f.id)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all shrink-0 flex items-center gap-1.5 ${
                            isAct
                              ? "bg-indigo-600 border-indigo-500 text-white shadow-md"
                              : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
                          }`}
                        >
                          <span>📁 {f.fileName}</span>
                          <span className="text-[10px] opacity-80 font-mono">
                            ({f.results?.length}件)
                          </span>
                        </button>
                      );
                    })}
                </div>

                {/* AI要確認アラートバッジ */}
                {summary.uncertainList.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span>
                        要確認項目が <strong>{summary.uncertainList.length} 件</strong> あります。修正して確定してください。
                      </span>
                    </div>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-bold border border-amber-500/40">
                      要確認
                    </span>
                  </div>
                )}

                {/* ⚡ 一括操作コントロールパネル */}
                <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 space-y-3 shadow-lg">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>⚡ 一括操作</span>
                        {selectedKeys.size > 0 ? (
                          <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-bold text-blue-300 border border-blue-500/40">
                            {selectedKeys.size} 件選択中
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500 font-normal">
                            (未選択)
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSelectAll}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
                      >
                        ☑ 全て選択
                      </button>
                      <button
                        onClick={handleDeselectAll}
                        disabled={selectedKeys.size === 0}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-400 hover:bg-slate-700 disabled:opacity-40 transition-colors"
                      >
                        ☐ 全て解除
                      </button>
                    </div>
                  </div>

                  {/* 一括変更・削除フォーム群 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {/* 科目変更 */}
                    <div className="rounded-lg bg-slate-950/80 p-2.5 border border-slate-800 space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-300 block">
                        勘定科目の一括変更
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={bulkAccountSide}
                          onChange={(e) => setBulkAccountSide(e.target.value as "debit" | "credit")}
                          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs text-white focus:outline-none"
                        >
                          <option value="debit">借方</option>
                          <option value="credit">貸方</option>
                        </select>
                        <input
                          type="text"
                          list="bulk-account-suggestions"
                          value={bulkAccountValue}
                          onChange={(e) => setBulkAccountValue(e.target.value)}
                          placeholder="新科目名"
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-white focus:outline-none"
                        />
                        <datalist id="bulk-account-suggestions">
                          {Array.from(new Set([...COMMON_DEBIT_ACCOUNTS, ...COMMON_CREDIT_ACCOUNTS])).map((cat) => (
                            <option key={cat} value={cat} />
                          ))}
                        </datalist>
                      </div>
                      <button
                        onClick={handleApplyBulkAccountChange}
                        disabled={selectedKeys.size === 0 || !bulkAccountValue.trim()}
                        className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        科目一括変更
                      </button>
                    </div>

                    {/* 税区分変更 */}
                    <div className="rounded-lg bg-slate-950/80 p-2.5 border border-slate-800 space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-300 block">
                        税区分の一括変更
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={bulkTaxSide}
                          onChange={(e) => setBulkTaxSide(e.target.value as "debit" | "credit")}
                          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs text-white focus:outline-none"
                        >
                          <option value="debit">借方</option>
                          <option value="credit">貸方</option>
                        </select>
                        <select
                          value={bulkTaxValue}
                          onChange={(e) => setBulkTaxValue(e.target.value)}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-white focus:outline-none"
                        >
                          {TAX_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={handleApplyBulkTaxChange}
                        disabled={selectedKeys.size === 0}
                        className="w-full rounded bg-indigo-600 px-2 py-1 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        税区分一括変更
                      </button>
                    </div>

                    {/* 一括削除 */}
                    <div className="rounded-lg bg-slate-950/80 p-2.5 border border-slate-800 space-y-1.5 flex flex-col justify-between">
                      <div>
                        <label className="text-[10px] font-bold text-slate-300 block mb-0.5">
                          選択仕訳の一括削除
                        </label>
                        <p className="text-[10px] text-slate-400">
                          {selectedKeys.size} 件を選択中
                        </p>
                      </div>
                      <button
                        onClick={() => setShowDeleteConfirmModal(true)}
                        disabled={selectedKeys.size === 0}
                        className="w-full rounded bg-rose-600 px-2 py-1 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        選択仕訳を一括削除
                      </button>
                    </div>
                  </div>
                </div>

                {/* 横一列データテーブル (スプレッドシート型仕訳一覧) */}
                <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-950/80 max-h-[600px] overflow-y-auto shadow-inner">
                  <table className="w-full text-left text-xs text-slate-200 border-collapse min-w-[850px]">
                    <thead className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 text-slate-300 font-bold shadow-md">
                      <tr>
                        <th className="px-2 py-2 w-10 text-center">☑</th>
                        <th className="px-2 py-2 w-28">元ファイル</th>
                        <th className="px-2 py-2 w-36">取引日</th>
                        <th className="px-2 py-2 w-36">相手先 / 支払先</th>
                        <th className="px-2 py-2 w-32">借方科目</th>
                        <th className="px-2 py-2 w-28">借方税区分</th>
                        <th className="px-2 py-2 w-32">貸方科目</th>
                        <th className="px-2 py-2 w-28">貸方税区分</th>
                        <th className="px-2 py-2 w-28 text-right">金額 (円)</th>
                        <th className="px-2 py-2">摘要</th>
                        <th className="px-2 py-2 w-12 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {currentFiles
                        .filter(
                          (fileItem) =>
                            fileItem.status === "completed" &&
                            fileItem.results &&
                            (activeFileTab === "all" || fileItem.id === activeFileTab)
                        )
                        .flatMap((fileItem) =>
                          fileItem.results!.map((entry, resIdx) => {
                            const entryKey = `${fileItem.id}_${resIdx}`;
                            const isSelected = selectedKeys.has(entryKey);

                            return (
                              <tr
                                key={entryKey}
                                className={`transition-colors hover:bg-slate-900/90 ${
                                  isSelected ? "bg-blue-500/15" : ""
                                }`}
                              >
                                {/* チェックボックス */}
                                <td className="px-2 py-1.5 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleSelectKey(entryKey)}
                                    className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                </td>

                                {/* 元ファイル / ページ */}
                                <td className="px-2 py-1.5 truncate max-w-[120px]" title={fileItem.fileName}>
                                  <span className="text-[10px] text-slate-300 font-sans block truncate">
                                    📁 {fileItem.fileName}
                                  </span>
                                  {entry.pageNumber && (
                                    <span className="text-[9px] bg-slate-800 text-blue-300 px-1 py-0.2 rounded border border-blue-500/30">
                                      P.{entry.pageNumber}
                                    </span>
                                  )}
                                </td>

                                {/* 取引日 (全体表示用拡大) */}
                                <td className="px-2 py-1.5 min-w-[130px]">
                                  <input
                                    type="text"
                                    value={String(entry.date)}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "date",
                                        e.target.value
                                      )
                                    }
                                    placeholder="YYYY-MM-DD"
                                    className={`w-full rounded border px-2 py-0.5 text-xs text-white focus:outline-none ${
                                      isUncertainInEntry(entry, "date")
                                        ? "border-amber-500 bg-amber-500/20"
                                        : "border-slate-700 bg-slate-950 focus:border-blue-500"
                                    }`}
                                  />
                                </td>

                                {/* 相手先 / 支払先 */}
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    value={String(entry.payee)}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "payee",
                                        e.target.value
                                      )
                                    }
                                    placeholder="相手先"
                                    className={`w-full rounded border px-1.5 py-0.5 text-xs text-white focus:outline-none ${
                                      isUncertainInEntry(entry, "payee")
                                        ? "border-amber-500 bg-amber-500/20"
                                        : "border-slate-700 bg-slate-950 focus:border-blue-500"
                                    }`}
                                  />
                                </td>

                                {/* 借方科目 */}
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    list={`debit-accounts-${fileItem.id}-${resIdx}`}
                                    value={String(entry.debitAccount)}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "debitAccount",
                                        e.target.value
                                      )
                                    }
                                    className={`w-full rounded border px-1.5 py-0.5 text-xs text-white focus:outline-none ${
                                      isUncertainInEntry(entry, "debitAccount")
                                        ? "border-amber-500 bg-amber-500/20"
                                        : "border-slate-700 bg-slate-950 focus:border-blue-500"
                                    }`}
                                  />
                                  <datalist id={`debit-accounts-${fileItem.id}-${resIdx}`}>
                                    {COMMON_DEBIT_ACCOUNTS.map((cat) => (
                                      <option key={cat} value={cat} />
                                    ))}
                                  </datalist>
                                </td>

                                {/* 借方税区分 */}
                                <td className="px-2 py-1.5">
                                  <select
                                    value={String(entry.debitTaxType)}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "debitTaxType",
                                        e.target.value
                                      )
                                    }
                                    className="w-full rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs text-white focus:outline-none"
                                  >
                                    <option value="要確認">要確認</option>
                                    {TAX_TYPES.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                </td>

                                {/* 貸方科目 */}
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    list={`credit-accounts-${fileItem.id}-${resIdx}`}
                                    value={String(entry.creditAccount)}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "creditAccount",
                                        e.target.value
                                      )
                                    }
                                    className={`w-full rounded border px-1.5 py-0.5 text-xs text-white focus:outline-none ${
                                      isUncertainInEntry(entry, "creditAccount")
                                        ? "border-amber-500 bg-amber-500/20"
                                        : "border-slate-700 bg-slate-950 focus:border-blue-500"
                                    }`}
                                  />
                                  <datalist id={`credit-accounts-${fileItem.id}-${resIdx}`}>
                                    {COMMON_CREDIT_ACCOUNTS.map((cat) => (
                                      <option key={cat} value={cat} />
                                    ))}
                                  </datalist>
                                </td>

                                {/* 貸方税区分 */}
                                <td className="px-2 py-1.5">
                                  <select
                                    value={String(entry.creditTaxType)}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "creditTaxType",
                                        e.target.value
                                      )
                                    }
                                    className="w-full rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs text-white focus:outline-none"
                                  >
                                    <option value="要確認">要確認</option>
                                    {TAX_TYPES.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                </td>

                                {/* 金額 */}
                                <td className="px-2 py-1.5 text-right font-bold text-emerald-400">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={String(entry.amount ?? "")}
                                    onChange={(e) =>
                                      handleAmountChange(
                                        fileItem.id,
                                        resIdx,
                                        "amount",
                                        e.target.value
                                      )
                                    }
                                    className={`w-full text-right rounded border px-1.5 py-0.5 text-xs font-bold text-white focus:outline-none ${
                                      isUncertainInEntry(entry, "amount")
                                        ? "border-amber-500 bg-amber-500/20"
                                        : "border-slate-700 bg-slate-950 focus:border-blue-500"
                                    }`}
                                  />
                                </td>

                                {/* 摘要 */}
                                <td className="px-2 py-1.5">
                                  <input
                                    type="text"
                                    value={String(entry.summary)}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "summary",
                                        e.target.value
                                      )
                                    }
                                    placeholder="摘要"
                                    className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs text-white focus:outline-none"
                                  />
                                </td>

                                {/* 操作(赤いゴミ箱アイコン削除) */}
                                <td className="px-2 py-1.5 text-center">
                                  <button
                                    onClick={() => {
                                      setCurrentFiles((prev) =>
                                        prev.map((i) => {
                                          if (i.id !== fileItem.id || !i.results) return i;
                                          return {
                                            ...i,
                                            results: i.results.filter((_, idx) => idx !== resIdx),
                                          };
                                        })
                                      );
                                    }}
                                    className="rounded p-1 text-rose-500 hover:text-red-300 hover:bg-rose-500/20 transition-all inline-flex items-center justify-center"
                                    title="仕訳を削除"
                                  >
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                    </tbody>
                  </table>
                </div>

                {/* 貸借集計・ダウンロードエリア */}
                <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      貸借集計チェック
                    </h3>
                    {summary.isAllBalanced ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/30">
                        ✓ 貸借一致 (借方: ¥{summary.totalDebitSum.toLocaleString()} / 貸方: ¥{summary.totalCreditSum.toLocaleString()})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-3 py-1 text-xs font-bold text-red-300 border border-red-500/40">
                        ⚠️ 貸借不一致 (差額: ¥{Math.abs(summary.totalDebitSum - summary.totalCreditSum).toLocaleString()})
                      </span>
                    )}
                  </div>

                  <button
                    onClick={handleDownloadClick}
                    disabled={!summary.canExport}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 font-bold text-xs text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-500 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                  >
                    <span>
                      {summary.isSelectionActive
                        ? `弥生会計用${appMode === "bankbook" ? "テキスト" : "CSV"} (選択した ${summary.exportEntries.length} 件の仕訳) をダウンロード (${appMode === "bankbook" ? ".txt" : ".csv"})`
                        : `弥生会計用${appMode === "bankbook" ? "テキスト" : "CSV"} (全 ${summary.totalEntries} 件の仕訳) をダウンロード (${appMode === "bankbook" ? ".txt" : ".csv"})`}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 一括削除確認モーダル */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <span className="text-2xl">🗑️</span>
              <h3 className="text-lg font-bold text-white">一括削除の確認</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              選択した <strong>{selectedKeys.size} 件</strong> の仕訳エントリーを一覧から削除します。よろしいですか？
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDeleteConfirmModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                キャンセル
              </button>
              <button
                onClick={handleApplyBulkDelete}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 要確認警告モーダル */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-lg font-bold text-white">要確認項目が残っています</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              仕訳の中に「要確認」の項目が含まれています。このまま弥生会計26用{appMode === "bankbook" ? "テキスト(.txt)" : "CSV(.csv)"}をダウンロードしますか？
            </p>

            <div className="max-h-40 overflow-y-auto rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200">
              <span className="font-bold block mb-1">要確認項目一覧: </span>
              {summary.uncertainList.map((itemStr, i) => (
                <div key={i} className="truncate">
                  • {itemStr}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowWarningModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                キャンセルして修正
              </button>
              <button
                onClick={() => {
                  setShowWarningModal(false);
                  executeDownloadYayoiCsv();
                }}
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors"
              >
                了解してそのままダウンロード
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 解析履歴モーダル */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📜</span>
                <h3 className="text-base font-bold text-white">
                  解析・作成履歴 ({historyList.length} 件)
                </h3>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              ブラウザに自動保存された過去の仕訳解析履歴です。「復元」ボタンを押すと対象の仕訳データを復元できます。
            </p>

            {historyList.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                保存された解析履歴はありません。仕訳を作成すると自動的に保存されます。
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {historyList.map((record) => {
                  const dateStr = new Date(record.createdAt).toLocaleString("ja-JP");

                  return (
                    <div
                      key={record.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-2.5 transition-all hover:border-slate-700"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                              record.mode === "receipt"
                                ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                                : "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                            }`}
                          >
                            {record.mode === "receipt" ? "📄 領収書" : "🏦 通帳"}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            {dateStr}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-emerald-400">
                            ¥{record.totalAmount.toLocaleString()} ({record.totalEntries}件)
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1 max-w-[360px]">
                          {record.fileNames.map((fn, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] bg-slate-900 text-slate-300 px-2 py-0.5 rounded border border-slate-800 truncate max-w-[160px]"
                              title={fn}
                            >
                              📁 {fn}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRestoreHistoryRecord(record)}
                            className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-500 transition-colors shadow-md shadow-blue-500/20"
                          >
                            仕訳を復元
                          </button>
                          <button
                            onClick={() => handleDeleteHistoryRecord(record.id)}
                            className="text-[11px] text-slate-500 hover:text-red-400 p-1 transition-colors"
                            title="履歴から削除"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="border-t border-slate-800 pt-3 flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}