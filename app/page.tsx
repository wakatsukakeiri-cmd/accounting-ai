"use client";

import { useState, useEffect, useRef, ChangeEvent, DragEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ReceiptAnalysisResult,
  AnalyzeApiResponse,
  ReceiptFileItem,
  AppMode,
  AnalysisHistoryItem,
  PageDetail,
} from "@/types/journal";
import { generateYayoiCsvBlob, generateYayoiTxtBlob, normalizeDateToSeireki } from "@/lib/yayoi";
import { generateYayoiExcelBlob, ExcelExportItem } from "@/lib/excel";
import { runWithConcurrencyLimit } from "@/lib/queue";
import { convertPdfToHighResImages } from "@/lib/pdf-helper";
import CompanySwitcher from "@/components/CompanySwitcher";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchCompanyAnalysisHistories,
  saveCompanyAnalysisHistory,
  deleteCompanyAnalysisHistory,
} from "@/lib/db/history";

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
  const [pendingDownloadType, setPendingDownloadType] = useState<"csv" | "excel">("csv");

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

  const [bulkDateValue, setBulkDateValue] = useState<string>("");

  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);

  // 初期解析結果のバックアップ (リセット用: fileId -> ReceiptAnalysisResult[])
  const [initialBackup, setInitialBackup] = useState<Record<string, ReceiptAnalysisResult[]>>({});

  // 履歴保存用ステート
  const [historyList, setHistoryList] = useState<AnalysisHistoryItem[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  const currentFiles = appMode === "receipt" ? receiptFiles : bankbookFiles;
  const setCurrentFiles = appMode === "receipt" ? setReceiptFiles : setBankbookFiles;

  const router = useRouter();
  const { currentCompany, user, isLoading } = useAuth();
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState<boolean>(true);

  // 1. 未ログイン状態ではログイン画面へリダイレクト（仕訳作成UIは非表示）
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  // 2. 会社ごとの仕訳作業スペース分離
  const prevCompanyIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentCompany) return;

    // 前回の会社データをローカル退避
    if (prevCompanyIdRef.current && prevCompanyIdRef.current !== currentCompany.id) {
      try {
        const workspaceData = {
          receiptFiles: receiptFiles.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            status: f.status,
            results: f.results,
            detectedCount: f.detectedCount,
            pages: f.pages,
          })),
          bankbookFiles: bankbookFiles.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            status: f.status,
            results: f.results,
            detectedCount: f.detectedCount,
            pages: f.pages,
          })),
          initialBackup,
        };
        localStorage.setItem(
          `accounting_workspace_${prevCompanyIdRef.current}`,
          JSON.stringify(workspaceData)
        );
      } catch (e) {
        console.error("Failed to save workspace for prev company:", e);
      }
    }

    // 新会社データの復元
    if (prevCompanyIdRef.current !== currentCompany.id) {
      prevCompanyIdRef.current = currentCompany.id;

      try {
        const saved = localStorage.getItem(`accounting_workspace_${currentCompany.id}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          setReceiptFiles(
            (parsed.receiptFiles || []).map((f: any) => ({
              ...f,
              file: new File([], f.fileName),
              previewUrl: "",
            }))
          );
          setBankbookFiles(
            (parsed.bankbookFiles || []).map((f: any) => ({
              ...f,
              file: new File([], f.fileName),
              previewUrl: "",
            }))
          );
          setInitialBackup(parsed.initialBackup || {});
        } else {
          setReceiptFiles([]);
          setBankbookFiles([]);
          setInitialBackup({});
        }
      } catch (e) {
        console.error("Failed to load workspace for company:", e);
        setReceiptFiles([]);
        setBankbookFiles([]);
        setInitialBackup({});
      }

      setSelectedKeys(new Set());
      setActiveFileTab("all");
    }
  }, [currentCompany?.id]);

  // 会社作業中データの自動保存 (debounce 1秒)
  useEffect(() => {
    if (!currentCompany) return;

    const timeout = setTimeout(() => {
      try {
        const workspaceData = {
          receiptFiles: receiptFiles.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            status: f.status,
            results: f.results,
            detectedCount: f.detectedCount,
            pages: f.pages,
          })),
          bankbookFiles: bankbookFiles.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            status: f.status,
            results: f.results,
            detectedCount: f.detectedCount,
            pages: f.pages,
          })),
          initialBackup,
        };
        localStorage.setItem(
          `accounting_workspace_${currentCompany.id}`,
          JSON.stringify(workspaceData)
        );
      } catch {}
    }, 1000);

    return () => clearTimeout(timeout);
  }, [currentCompany?.id, receiptFiles, bankbookFiles, initialBackup]);

  // 3. 会社が選択されている場合、Supabase DBから最新の解析履歴をロード
  useEffect(() => {
    let isMounted = true;

    if (currentCompany) {
      const loadCloudHistory = async () => {
        setIsLoadingHistory(true);
        try {
          const list = await fetchCompanyAnalysisHistories(currentCompany.id);
          if (isMounted) {
            setHistoryList(list);
          }
        } catch (err) {
          console.error("Failed to fetch cloud analysis histories:", err);
        } finally {
          if (isMounted) setIsLoadingHistory(false);
        }
      };
      loadCloudHistory();
    }

    return () => {
      isMounted = false;
    };
  }, [currentCompany?.id]);

  // 選択中会社の履歴のみに絞り込み
  const filteredHistoryList = historyList.filter((item) => {
    if (currentCompany) {
      return item.companyId === currentCompany.id;
    }
    return !item.companyId;
  });

  // 履歴保存（会社選択時はクラウドDB保存、未ログイン時はlocalStorage保存）
  const saveSnapshotToHistory = async (
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

    const fileNames = completedItems.map((f) => f.fileName);

    if (currentCompany) {
      try {
        const res = await saveCompanyAnalysisHistory({
          companyId: currentCompany.id,
          mode: targetMode,
          fileNames,
          totalEntries,
          totalAmount,
          filesData,
        });
        if (res.success) {
          const latestList = await fetchCompanyAnalysisHistories(currentCompany.id);
          setHistoryList(latestList);
        }
      } catch (err) {
        console.error("Failed to save history to cloud DB:", err);
      }
    } else {
      const newRecord: AnalysisHistoryItem = {
        id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        createdAt: new Date().toISOString(),
        mode: targetMode,
        fileNames,
        totalEntries,
        totalAmount,
        filesData,
      };

      setHistoryList((prev) => {
        const updated = [newRecord, ...prev].slice(0, 20);
        try {
          localStorage.setItem("accounting_ai_history", JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    }
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

  const handleDeleteHistoryRecord = async (id: string) => {
    if (currentCompany) {
      try {
        await deleteCompanyAnalysisHistory(id);
        setHistoryList((prev) => prev.filter((item) => item.id !== id));
      } catch (err) {
        console.error("Failed to delete history from DB:", err);
      }
    } else {
      setHistoryList((prev) => {
        const updated = prev.filter((item) => item.id !== id);
        try {
          localStorage.setItem("accounting_ai_history", JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    }
  };

  const handleFilesAdded = (selectedFiles: FileList | File[] | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;

    const validFiles: File[] = Array.from(selectedFiles).filter((f) => {
      const isImg = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
      return isImg || isPdf;
    });

    if (validFiles.length === 0) {
      setGlobalError(
        "画像ファイル (.png, .jpg, .jpeg, .webp 等) または PDFファイル (.pdf) を選択してください。"
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
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              status: "analyzing",
              progressMessage: "解析を開始中...",
              errorMessage: undefined,
            }
          : i
      )
    );

    try {
      const isPdf =
        item.file.type === "application/pdf" ||
        item.file.name.toLowerCase().endsWith(".pdf");

      // 【ケースA】 領収書モードかつ PDF の場合：1ページずつPNG画像化して /api/analyze に順次送信
      if (appMode === "receipt" && isPdf) {
        setCurrentFiles((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, progressMessage: "領収書PDFをページ画像へ展開中..." }
              : i
          )
        );

        const pageImages = await convertPdfToHighResImages(item.file);
        const totalPages = pageImages.length;

        const allIntegratedItems: ReceiptAnalysisResult[] = [];

        for (let idx = 0; idx < totalPages; idx++) {
          const pImg = pageImages[idx];
          const pageNum = pImg.pageNumber;

          setCurrentFiles((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: "analyzing",
                    progressMessage: `${pageNum}/${totalPages} ページ目を解析中...`,
                  }
                : i
            )
          );

          const formData = new FormData();
          formData.append("file", pImg.blob, pImg.fileName);
          if (currentCompany) {
            formData.append("companyId", currentCompany.id);
          }

          const res = await fetch("/api/analyze", {
            method: "POST",
            body: formData,
          });

          const contentType = res.headers.get("content-type") || "";
          let json: AnalyzeApiResponse;
          if (contentType.includes("application/json")) {
            json = await res.json();
          } else {
            const textError = await res.text();
            const cleanText = textError.replace(/<[^>]*>?/gm, "").trim();
            throw new Error(
              cleanText || `サーバーエラーが発生しました (HTTP ${res.status})`
            );
          }

          if (!res.ok || !json.success || !json.data) {
            throw new Error(
              json.error ||
                `Page ${pageNum} の解析に失敗しました (HTTP ${res.status})`
            );
          }

          const items = json.data;
          items.forEach((entry) => {
            entry.pageNumber = pageNum;
            // 元号年 (08, 09等) を西暦 YYYY-MM-DD に正規化
            entry.date = normalizeDateToSeireki(entry.date);
            allIntegratedItems.push(entry);
          });
        }

        const finalIntegratedItems = allIntegratedItems;

        setInitialBackup((prev) => ({
          ...prev,
          [item.id]: JSON.parse(JSON.stringify(finalIntegratedItems)),
        }));
        setSelectedPageMap((prev) => ({ ...prev, [item.id]: 1 }));

        setCurrentFiles((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: "completed",
                  results: finalIntegratedItems,
                  detectedCount: finalIntegratedItems.length,
                  progressMessage: undefined,
                  errorMessage: undefined,
                }
              : i
          )
        );
        return;
      }

      // 【ケースB】 通帳モードかつ PDF の場合：1ページずつPNG画像化して /api/analyze-bankbook に順次送信
      if (appMode === "bankbook" && isPdf) {
        setCurrentFiles((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, progressMessage: "通帳PDFをページ画像へ展開中..." }
              : i
          )
        );

        const pageImages = await convertPdfToHighResImages(item.file);
        const totalPages = pageImages.length;

        const allIntegratedItems: ReceiptAnalysisResult[] = [];
        const allPageDetails: PageDetail[] = [];
        let totalDetected = 0;
        let lastValidDate = "要確認";

        for (let idx = 0; idx < totalPages; idx++) {
          const pImg = pageImages[idx];
          const pageNum = pImg.pageNumber;

          setCurrentFiles((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: "analyzing",
                    progressMessage: `${pageNum}/${totalPages} ページ目を解析中...`,
                  }
                : i
            )
          );

          const formData = new FormData();
          formData.append("file", pImg.blob, pImg.fileName);
          if (currentCompany) {
            formData.append("companyId", currentCompany.id);
          }

          const startTime = performance.now();
          const res = await fetch("/api/analyze-bankbook", {
            method: "POST",
            body: formData,
          });
          const duration = ((performance.now() - startTime) / 1000).toFixed(2);
          console.log(
            `[Bankbook Client Timing] Page ${pageNum}/${totalPages} (${pImg.fileName}) completed in ${duration}s`
          );

          const contentType = res.headers.get("content-type") || "";
          let json: AnalyzeApiResponse;
          if (contentType.includes("application/json")) {
            json = await res.json();
          } else {
            const textError = await res.text();
            const cleanText = textError.replace(/<[^>]*>?/gm, "").trim();
            throw new Error(
              cleanText || `サーバーエラーが発生しました (HTTP ${res.status})`
            );
          }

          if (!res.ok || !json.success || !json.data) {
            throw new Error(
              json.error ||
                `Page ${pageNum} の解析に失敗しました (HTTP ${res.status})`
            );
          }

          const items = json.data;
          totalDetected += json.detectedCount || items.length;

          // ページを跨ぐ日付補完とページ番号付与、元号西暦正規化
          items.forEach((entry) => {
            entry.pageNumber = pageNum;
            if (!entry.date || entry.date === "要確認") {
              if (lastValidDate !== "要確認") {
                entry.date = lastValidDate;
              }
            } else {
              entry.date = normalizeDateToSeireki(entry.date);
              lastValidDate = entry.date;
            }
            allIntegratedItems.push(entry);
          });

          allPageDetails.push({
            pageNumber: pageNum,
            detectedCount: items.length,
            items,
          });
        }

        const finalIntegratedItems = allIntegratedItems;

        setInitialBackup((prev) => ({
          ...prev,
          [item.id]: JSON.parse(JSON.stringify(finalIntegratedItems)),
        }));
        setSelectedPageMap((prev) => ({ ...prev, [item.id]: 1 }));

        setCurrentFiles((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: "completed",
                  results: finalIntegratedItems,
                  detectedCount: totalDetected,
                  pages: allPageDetails,
                  progressMessage: undefined,
                  errorMessage: undefined,
                }
              : i
          )
        );
        return;
      }

      // 【ケースC】 単一画像ファイル（領収書画像または通帳単枚画像）の場合の処理
      const formData = new FormData();
      formData.append("file", item.file);
      if (currentCompany) {
        formData.append("companyId", currentCompany.id);
      }

      const endpoint =
        appMode === "receipt" ? "/api/analyze" : "/api/analyze-bankbook";

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const contentType = res.headers.get("content-type") || "";

      let json: AnalyzeApiResponse;
      if (contentType.includes("application/json")) {
        json = await res.json();
      } else {
        const textError = await res.text();
        const cleanText = textError.replace(/<[^>]*>?/gm, "").trim();
        throw new Error(
          cleanText || `サーバーエラーが発生しました (HTTP ${res.status})`
        );
      }

      if (!res.ok || !json.success || !json.data || json.data.length === 0) {
        throw new Error(json.error || `解析に失敗しました (HTTP ${res.status})`);
      }

      const results = json.data.map((entry) => ({
        ...entry,
        date: normalizeDateToSeireki(entry.date),
      }));
      const detectedCount = json.detectedCount;
      const pages = json.pages;

      const finalResults = results;

      setInitialBackup((prev) => ({
        ...prev,
        [item.id]: JSON.parse(JSON.stringify(finalResults)),
      }));

      setSelectedPageMap((prev) => ({ ...prev, [item.id]: 1 }));

      setCurrentFiles((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "completed",
                results: finalResults,
                detectedCount,
                pages,
                progressMessage: undefined,
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
            ? {
                ...i,
                status: "error",
                errorMessage: msg,
                progressMessage: undefined,
              }
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
    const finalValue =
      fieldKey === "date" && typeof value === "string"
        ? normalizeDateToSeireki(value)
        : value;

    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.id !== fileId || !item.results) return item;
        const nextResults = [...item.results];
        const entryToUpdate = nextResults[resultIndex];
        nextResults[resultIndex] = {
          ...entryToUpdate,
          [fieldKey]: finalValue,
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
            const updated =
              bulkAccountSide === "debit"
                ? { ...entry, debitAccount: bulkAccountValue.trim() }
                : { ...entry, creditAccount: bulkAccountValue.trim() };

            return updated;
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
            const updated =
              bulkTaxSide === "debit"
                ? { ...entry, debitTaxType: bulkTaxValue }
                : { ...entry, creditTaxType: bulkTaxValue };

            return updated;
          }
          return entry;
        });

        return { ...item, results: nextResults };
      })
    );

    setSelectedKeys(new Set());
  };

  const handleApplyBulkDateChange = () => {
    if (selectedKeys.size === 0 || !bulkDateValue.trim()) return;

    const normalizedDate = normalizeDateToSeireki(bulkDateValue.trim());

    setCurrentFiles((prev) =>
      prev.map((item) => {
        if (item.status !== "completed" || !item.results) return item;

        const nextResults = item.results.map((entry, resIdx) => {
          const key = `${item.id}_${resIdx}`;
          if (selectedKeys.has(key)) {
            const updated = { ...entry, date: normalizedDate };

            return updated;
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
    const allCompletedExportItems: ExcelExportItem[] = [];
    const selectedExportItems: ExcelExportItem[] = [];

    const isSelectionActive = selectedKeys.size > 0;

    currentFiles.forEach((item) => {
      if (item.status === "completed") completedFiles++;
      if (item.status === "error") errorFiles++;

      if (item.status === "completed" && item.results) {
        item.results.forEach((entry, idx) => {
          totalEntries++;
          allCompletedEntries.push(entry);
          const exportItem: ExcelExportItem = { entry, fileName: item.fileName };
          allCompletedExportItems.push(exportItem);

          const entryKey = `${item.id}_${idx}`;
          const isSelected = selectedKeys.has(entryKey);
          if (isSelected) {
            selectedEntries.push(entry);
            selectedExportItems.push(exportItem);
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
    const exportExportItems = isSelectionActive ? selectedExportItems : allCompletedExportItems;
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
      exportExportItems,
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
    const blob = generateYayoiCsvBlob(summary.exportEntries);

    const url = URL.createObjectURL(blob);

    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = isBankbook ? "Yayoi_Bankbook" : "Yayoi_Receipt";
    const selectedTag = summary.isSelectionActive ? "_Selected" : "";
    const fileName = `${prefix}${selectedTag}_Journal_${nowStr}.csv`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const executeDownloadYayoiExcel = async () => {
    if (!summary.canExport || summary.exportExportItems.length === 0) return;

    const isBankbook = appMode === "bankbook";
    const blob = await generateYayoiExcelBlob(summary.exportExportItems, appMode);

    const url = URL.createObjectURL(blob);

    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = isBankbook ? "Yayoi_Bankbook" : "Yayoi_Receipt";
    const selectedTag = summary.isSelectionActive ? "_Selected" : "";
    const fileName = `${prefix}${selectedTag}_Journal_${nowStr}.xlsx`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadClick = (type: "csv" | "excel" = "csv") => {
    if (!summary.canExport) return;
    setPendingDownloadType(type);

    if (summary.uncertainList.length > 0) {
      setShowWarningModal(true);
    } else {
      if (type === "csv") {
        executeDownloadYayoiCsv();
      } else {
        executeDownloadYayoiExcel();
      }
    }
  };

  const formatCurrency = (val: number | string) => {
    if (val === "要確認" || typeof val !== "number") return "要確認";
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: "JPY",
    }).format(val);
  };

  // 未ログインまたは認証情報読み込み中は全画面ローダーを表示（ログイン画面へリダイレクト）
  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-500">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-xs font-medium">認証状態を確認中...</p>
      </div>
    );
  }

  // 選択中のファイルアイテム
  const activeFileItem =
    activeFileTab !== "all"
      ? currentFiles.find((f) => f.id === activeFileTab) || currentFiles[0]
      : currentFiles[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-blue-500 selection:text-white">
      <div className="mx-auto max-w-[1800px] px-4 py-4 space-y-4">
        {/* Header */}
        <header className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur-md">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
                  <span>弥生会計26対応</span>
                </div>
                {currentCompany ? (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 shadow-sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>☁️ {currentCompany.name} (クラウド履歴共有中)</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">
                    <span>💻 ローカル作業中 (会社未選択)</span>
                  </div>
                )}
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl">
                AI 会計仕訳作成アシスタント
              </h1>
              <p className="mt-1 text-xs text-slate-500 font-medium">
                左側で元画像/PDFを対照確認しながら、右側の横一列データテーブルで高速チェック・仕訳編集。
              </p>
            </div>

            {/* 右側アクションエリア */}
            <div className="flex flex-wrap items-center gap-3">
              <CompanySwitcher />

              {currentCompany && (
                <Link
                  href="/reference-books"
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3.5 py-2 text-xs font-bold text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all shadow-xs"
                  title="前期・前々期の総勘定元帳・仕訳日記帳・補助残高一覧表を登録・学習"
                >
                  <span>📚 過去帳簿・仕訳学習</span>
                </Link>
              )}

              <button
                onClick={async () => {
                  setShowHistoryModal(true);
                  if (currentCompany) {
                    try {
                      const list = await fetchCompanyAnalysisHistories(currentCompany.id);
                      setHistoryList(list);
                    } catch (e) {
                      console.error(e);
                    }
                  }
                }}
                className="flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-slate-700 border border-slate-300 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
              >
                <span>📜 解析履歴</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                  {filteredHistoryList.length}件
                </span>
              </button>

              <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200">
                <button
                  onClick={() => {
                    setAppMode("receipt");
                    setGlobalError(null);
                    setSelectedKeys(new Set());
                    setActiveFileTab("all");
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                    appMode === "receipt"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
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
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
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
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-xs flex items-start gap-3 shadow-sm">
            <svg
              className="h-5 w-5 text-rose-600 shrink-0 mt-0.5"
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
              <h3 className="font-bold text-rose-900 mb-0.5">エラーが発生しました</h3>
              <p>{globalError}</p>
            </div>
          </div>
        )}

        {/* 現在作業中の会社バナー */}
        {currentCompany && (
          <div className="rounded-xl border border-indigo-200 bg-white p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                {currentCompany.name.slice(0, 1)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    作業スペース
                  </span>
                  <span className="text-sm font-extrabold text-slate-900">
                    {currentCompany.name}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  この画面上の仕訳作成・編集内容は「{currentCompany.name}」の作業スペースに独立して保持されています。
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/reference-books"
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 transition-colors"
              >
                <span>📚 前期・前々期の帳簿学習を設定</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        )}

        {/* Main 2-Column Split View Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Column: 元画像・PDFプレビュー & ファイル管理 */}
          {isLeftPanelOpen && (
            <section className="lg:col-span-3 xl:col-span-3 space-y-4 animate-in fade-in duration-200">
            {/* アップロードコントロールエリア */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-blue-600"
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
                className="group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/80 p-4 text-center transition-all hover:border-blue-500 hover:bg-blue-50/30"
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                  multiple
                  onChange={onFileInputChange}
                  className="absolute inset-0 z-10 cursor-pointer opacity-0"
                />

                <div className="space-y-1">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 group-hover:scale-110 transition-transform border border-blue-100">
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
                  <div className="text-xs font-bold text-slate-700">
                    {appMode === "receipt"
                      ? "領収書画像・PDFをドラッグ＆ドロップ"
                      : "通帳画像・PDF(全ページ)をドラッグ＆ドロップ"}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {appMode === "receipt"
                      ? "またはクリックして選択 (.png, .jpg, .webp, .pdf 複数選択可)"
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
                            ? "border-blue-500 bg-blue-50/80 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          {item.file.type === "application/pdf" ? (
                            <div className="h-8 w-8 rounded border border-red-200 bg-red-50 flex items-center justify-center text-red-600 shrink-0 font-bold text-[10px]">
                              PDF
                            </div>
                          ) : item.previewUrl ? (
                            /* eslint-disable-next-html-element-for-img */
                            <img
                              src={item.previewUrl}
                              alt={item.fileName}
                              className="h-8 w-8 object-cover rounded border border-slate-200 shrink-0 bg-slate-100"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded border border-blue-200 bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 font-bold text-[10px]">
                              画像
                            </div>
                          )}

                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800 truncate">
                              {item.fileName}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {(item.file.size / 1024).toFixed(1)} KB
                            </p>
                            {item.status === "error" && item.errorMessage && (
                              <p
                                className="text-[10px] font-mono text-rose-600 mt-0.5 truncate max-w-[220px]"
                                title={item.errorMessage}
                              >
                                {item.errorMessage}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.status === "idle" && (
                            <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium border border-slate-200">
                              未解析
                            </span>
                          )}
                          {item.status === "analyzing" && (
                            <span className="text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold border border-blue-200 animate-pulse">
                              {item.progressMessage || "解析中..."}
                            </span>
                          )}
                          {item.status === "completed" && (
                            <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold border border-emerald-200">
                              ✓ {item.results?.length || 0}件
                            </span>
                          )}
                          {item.status === "error" && (
                            <span className="text-[9px] bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded font-bold border border-rose-200">
                              ⚠️ エラー
                            </span>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(item.id);
                            }}
                            disabled={isBatchProcessing}
                            className="text-slate-400 hover:text-rose-600 p-0.5 transition-colors disabled:opacity-30"
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
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 font-bold text-xs text-white shadow-md shadow-blue-500/20 transition-all hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
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
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>🔍 元画像プレビュー:</span>
                    <span className="text-blue-700 truncate max-w-[200px]">
                      {activeFileItem.fileName}
                    </span>
                  </h3>

                  <button
                    onClick={() => handleResetFileResults(activeFileItem.id)}
                    className="text-[10px] text-slate-600 hover:text-slate-900 border border-slate-300 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 rounded font-medium"
                  >
                    初期結果にリセット
                  </button>
                </div>

                {/* 通帳モードのページ選択コントロール */}
                {appMode === "bankbook" && activeFileItem.pages && activeFileItem.pages.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                      <span className="font-bold text-blue-800">
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
                                  ? "bg-blue-600 border-blue-600 text-white"
                                  : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
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
                <div className="bg-slate-100 rounded-xl p-2 border border-slate-200 flex items-center justify-center min-h-[220px] max-h-[360px] overflow-hidden">
                  {activeFileItem.file.type === "application/pdf" && activeFileItem.previewUrl ? (
                    <iframe
                      src={`${activeFileItem.previewUrl}#page=${selectedPageMap[activeFileItem.id] === "all" ? 1 : selectedPageMap[activeFileItem.id] || 1}&toolbar=0&navpanes=0`}
                      title={`元画像プレビュー ${activeFileItem.fileName}`}
                      className="w-full h-[320px] rounded border border-slate-200 bg-white"
                    />
                  ) : activeFileItem.previewUrl ? (
                    /* eslint-disable-next-html-element-for-img */
                    <img
                      src={activeFileItem.previewUrl}
                      alt={`通帳/領収書画像 ${activeFileItem.fileName}`}
                      className="max-h-[320px] w-full object-contain rounded"
                    />
                  ) : (
                    <div className="text-xs text-slate-500 text-center p-6 font-medium">
                      📜 履歴復元データ (元画像プレビューなし)
                    </div>
                  )}
                </div>

                {/* 件数照合ステータス */}
                {appMode === "bankbook" && (
                  <div className="text-[11px] font-mono text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
                    <span>認識明細: <strong>{activeFileItem.detectedCount ?? activeFileItem.results?.length}</strong> 件</span>
                    <span>生成仕訳: <strong>{activeFileItem.results?.length}</strong> 件</span>
                    <span className="text-emerald-700 font-bold">✅ 照合OK</span>
                  </div>
                )}
              </div>
            )}
            </section>
          )}

          {/* Right Column: 仕訳確認・編集・一括操作 & 横一列データテーブル */}
          <section className={`${isLeftPanelOpen ? "lg:col-span-9 xl:col-span-9" : "lg:col-span-12 xl:col-span-12"} space-y-4 transition-all duration-200`}>
            {summary.completedFiles === 0 && !isBatchProcessing && (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                <div className="rounded-full bg-slate-100 p-4 text-slate-400 mb-3 border border-slate-200">
                  <svg
                    className="h-8 w-8 text-slate-500"
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
                <h3 className="text-base font-bold text-slate-800">
                  仕訳データが未作成です
                </h3>
                <p className="mt-1 text-xs text-slate-500 max-w-xs font-medium">
                  {appMode === "receipt"
                    ? "左側のエリアで領収書画像を選択し、「AIで仕訳を作成」ボタンを押してください。"
                    : "左側のエリアで通帳画像またはPDFを選択し、「通帳全ページをAI解析して仕訳作成」ボタンを押してください。"}
                </p>
              </div>
            )}

            {summary.completedFiles > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm shadow-slate-200/50 space-y-4">
                {/* ファイル切替タブバー */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                  <button
                    onClick={() => setActiveFileTab("all")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all shrink-0 ${
                      activeFileTab === "all"
                        ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                        : "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"
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
                              ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                              : "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"
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

                  {/* プレビュー表示切替トグルボタン */}
                  <button
                    onClick={() => setIsLeftPanelOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 bg-indigo-50/80 text-indigo-700 hover:bg-indigo-100 transition-all shrink-0 cursor-pointer shadow-xs ml-auto"
                    title={isLeftPanelOpen ? "プレビューを非表示にして仕訳一覧を全画面表示" : "元画像プレビューを再表示"}
                  >
                    <span>{isLeftPanelOpen ? "⤢ 全幅表示 (プレビューを隠す)" : "◨ プレビューを表示"}</span>
                  </button>
                </div>

                {/* AI要確認アラートバッジ */}
                {summary.uncertainList.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚠️</span>
                      <span className="font-medium">
                        要確認項目が <strong>{summary.uncertainList.length} 件</strong> あります。修正して確定してください。
                      </span>
                    </div>
                    <span className="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded font-bold border border-amber-300">
                      要確認
                    </span>
                  </div>
                )}

                {/* ⚡ 一括操作コントロールパネル */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>⚡ 一括操作</span>
                        {selectedKeys.size > 0 ? (
                          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700 border border-blue-200">
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
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors shadow-sm"
                      >
                        ☑ 全て選択
                      </button>
                      <button
                        onClick={handleDeselectAll}
                        disabled={selectedKeys.size === 0}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40 transition-colors shadow-sm"
                      >
                        ☐ 全て解除
                      </button>
                    </div>
                  </div>

                  {/* 一括変更・削除フォーム群 */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                    {/* 日付変更 */}
                    <div className="rounded-lg bg-white p-2.5 border border-slate-200 space-y-1.5 shadow-sm">
                      <label className="text-[10px] font-bold text-slate-700 block">
                        取引日付の一括変更
                      </label>
                      <input
                        type="date"
                        value={bulkDateValue}
                        onChange={(e) => setBulkDateValue(e.target.value)}
                        className="w-full rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-800 focus:outline-none"
                      />
                      <button
                        onClick={handleApplyBulkDateChange}
                        disabled={selectedKeys.size === 0 || !bulkDateValue.trim()}
                        className="w-full rounded bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        日付一括変更
                      </button>
                    </div>

                    {/* 科目変更 */}
                    <div className="rounded-lg bg-white p-2.5 border border-slate-200 space-y-1.5 shadow-sm">
                      <label className="text-[10px] font-bold text-slate-700 block">
                        勘定科目の一括変更
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={bulkAccountSide}
                          onChange={(e) => setBulkAccountSide(e.target.value as "debit" | "credit")}
                          className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-800 focus:outline-none"
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
                          className="w-full rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-800 focus:outline-none"
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
                        className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        科目一括変更
                      </button>
                    </div>

                    {/* 税区分変更 */}
                    <div className="rounded-lg bg-white p-2.5 border border-slate-200 space-y-1.5 shadow-sm">
                      <label className="text-[10px] font-bold text-slate-700 block">
                        税区分の一括変更
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={bulkTaxSide}
                          onChange={(e) => setBulkTaxSide(e.target.value as "debit" | "credit")}
                          className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-800 focus:outline-none"
                        >
                          <option value="debit">借方</option>
                          <option value="credit">貸方</option>
                        </select>
                        <select
                          value={bulkTaxValue}
                          onChange={(e) => setBulkTaxValue(e.target.value)}
                          className="w-full rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-800 focus:outline-none"
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
                        className="w-full rounded bg-indigo-600 px-2 py-1 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        税区分一括変更
                      </button>
                    </div>

                    {/* 一括削除 */}
                    <div className="rounded-lg bg-white p-2.5 border border-slate-200 space-y-1.5 flex flex-col justify-between shadow-sm">
                      <div>
                        <label className="text-[10px] font-bold text-slate-700 block mb-0.5">
                          選択仕訳の一括削除
                        </label>
                        <p className="text-[10px] text-slate-500 font-medium">
                          {selectedKeys.size} 件を選択中
                        </p>
                      </div>
                      <button
                        onClick={() => setShowDeleteConfirmModal(true)}
                        disabled={selectedKeys.size === 0}
                        className="w-full rounded bg-rose-600 px-2 py-1 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        選択仕訳を一括削除
                      </button>
                    </div>
                  </div>
                </div>

                {/* 横一列データテーブル (スプレッドシート型仕訳一覧) */}
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white max-h-[600px] overflow-y-auto shadow-sm">
                  <table className="w-full text-left text-xs text-slate-800 border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200 text-slate-700 font-bold shadow-sm text-[11px]">
                      <tr>
                        <th className="px-1.5 py-2 w-7 text-center">☑</th>
                        <th className="px-1.5 py-2 w-16 text-slate-600">ファイル</th>
                        <th className="px-1.5 py-2 w-24">取引日</th>
                        <th className="px-1.5 py-2 w-28">相手先</th>
                        <th className="px-1.5 py-2 w-28 text-slate-900 font-extrabold">借方科目</th>
                        <th className="px-1.5 py-2 w-28 text-indigo-700 font-extrabold bg-indigo-50/70 border-x border-indigo-200">借方補助</th>
                        <th className="px-1.5 py-2 w-20">借方税</th>
                        <th className="px-1.5 py-2 w-28 text-slate-900 font-extrabold">貸方科目</th>
                        <th className="px-1.5 py-2 w-28 text-indigo-700 font-extrabold bg-indigo-50/70 border-x border-indigo-200">貸方補助</th>
                        <th className="px-1.5 py-2 w-20">貸方税</th>
                        <th className="px-1.5 py-2 w-20 text-right">金額</th>
                        <th className="px-1.5 py-2 min-w-[100px]">摘要</th>
                        <th className="px-1.5 py-2 w-8 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono">
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
                                className={`transition-colors hover:bg-slate-50/80 ${
                                  isSelected ? "bg-blue-50/80" : ""
                                }`}
                              >
                                {/* チェックボックス */}
                                <td className="px-1 py-1 text-center w-8">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleSelectKey(entryKey)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  />
                                </td>

                                {/* 元ファイル / ページ */}
                                <td className="px-1 py-1 truncate max-w-[70px]" title={fileItem.fileName}>
                                  <span className="text-[10px] text-slate-700 font-sans block truncate font-medium">
                                    📁 {fileItem.fileName}
                                  </span>
                                  {entry.pageNumber && (
                                    <span className="text-[9px] bg-blue-50 text-blue-700 px-1 py-0.2 rounded border border-blue-200 font-bold">
                                      P.{entry.pageNumber}
                                    </span>
                                  )}
                                </td>

                                {/* 取引日 (全体表示用拡大) */}
                                <td className="px-1 py-1 w-24">
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
                                    className={`w-full rounded border px-2 py-0.5 text-xs text-slate-900 focus:outline-none ${
                                      isUncertainInEntry(entry, "date")
                                        ? "border-amber-400 bg-amber-50 text-amber-900 font-medium"
                                        : "border-slate-300 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                                    }`}
                                  />
                                </td>

                                {/* 相手先 / 支払先 */}
                                <td className="px-1 py-1 w-28">
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
                                    className={`w-full rounded border px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none ${
                                      isUncertainInEntry(entry, "payee")
                                        ? "border-amber-400 bg-amber-50 text-amber-900 font-medium"
                                        : "border-slate-300 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                                    }`}
                                  />
                                </td>

                                {/* 借方科目 */}
                                <td className="px-1 py-1 w-28">
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
                                    className={`w-full rounded border px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none ${
                                      isUncertainInEntry(entry, "debitAccount")
                                        ? "border-amber-400 bg-amber-50 text-amber-900 font-medium"
                                        : "border-slate-300 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                                    }`}
                                  />
                                  <datalist id={`debit-accounts-${fileItem.id}-${resIdx}`}>
                                    {COMMON_DEBIT_ACCOUNTS.map((cat) => (
                                      <option key={cat} value={cat} />
                                    ))}
                                  </datalist>
                                </td>

                                {/* 借方補助科目 */}
                                <td className="px-1 py-1 w-28">
                                  <input
                                    type="text"
                                    value={String(entry.debitSubAccount || "")}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "debitSubAccount",
                                        e.target.value
                                      )
                                    }
                                    placeholder="借方補助"
                                    className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                                  />
                                </td>

                                {/* 借方税区分 */}
                                <td className="px-1 py-1 w-20">
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
                                    className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
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
                                <td className="px-1 py-1 w-28">
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
                                    className={`w-full rounded border px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none ${
                                      isUncertainInEntry(entry, "creditAccount")
                                        ? "border-amber-400 bg-amber-50 text-amber-900 font-medium"
                                        : "border-slate-300 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                                    }`}
                                  />
                                  <datalist id={`credit-accounts-${fileItem.id}-${resIdx}`}>
                                    {COMMON_CREDIT_ACCOUNTS.map((cat) => (
                                      <option key={cat} value={cat} />
                                    ))}
                                  </datalist>
                                </td>

                                {/* 貸方補助科目 */}
                                <td className="px-1 py-1 w-28">
                                  <input
                                    type="text"
                                    value={String(entry.creditSubAccount || "")}
                                    onChange={(e) =>
                                      handleFieldChange(
                                        fileItem.id,
                                        resIdx,
                                        "creditSubAccount",
                                        e.target.value
                                      )
                                    }
                                    placeholder="貸方補助"
                                    className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-500"
                                  />
                                </td>

                                {/* 貸方税区分 */}
                                <td className="px-1 py-1 w-20">
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
                                    className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
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
                                <td className="px-1 py-1 text-right font-bold text-emerald-700 w-20">
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
                                    className={`w-full text-right rounded border px-1.5 py-0.5 text-xs font-bold text-slate-900 focus:outline-none ${
                                      isUncertainInEntry(entry, "amount")
                                        ? "border-amber-400 bg-amber-50 text-amber-900"
                                        : "border-slate-300 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                                    }`}
                                  />
                                </td>

                                {/* 摘要 */}
                                <td className="px-1 py-1 min-w-[100px]">
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
                                    className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
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
                                    className="rounded p-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 transition-colors inline-flex items-center justify-center"
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
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      貸借集計チェック
                    </h3>
                    {summary.isAllBalanced ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                        ✓ 貸借一致 (借方: ¥{summary.totalDebitSum.toLocaleString()} / 貸方: ¥{summary.totalCreditSum.toLocaleString()})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 border border-rose-200">
                        ⚠️ 貸借不一致 (差額: ¥{Math.abs(summary.totalDebitSum - summary.totalCreditSum).toLocaleString()})
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                    <button
                      onClick={() => handleDownloadClick("csv")}
                      disabled={!summary.canExport}
                      className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 font-bold text-xs text-white shadow-md shadow-emerald-500/20 transition-all hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                    >
                      <span className="text-base">📄</span>
                      <span>
                        {summary.isSelectionActive
                          ? `弥生会計用CSV (選択 ${summary.exportEntries.length}件) (.csv)`
                          : `弥生会計用CSV (全 ${summary.totalEntries}件) (.csv)`}
                      </span>
                    </button>

                    <button
                      onClick={() => handleDownloadClick("excel")}
                      disabled={!summary.canExport}
                      className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 font-bold text-xs text-white shadow-md shadow-blue-500/20 transition-all hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                    >
                      <span className="text-base">📊</span>
                      <span>
                        {summary.isSelectionActive
                          ? `Excel仕訳帳 (選択 ${summary.exportEntries.length}件) (.xlsx)`
                          : `Excel仕訳帳 (全 ${summary.totalEntries}件) (.xlsx)`}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 一括削除確認モーダル */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <span className="text-2xl">🗑️</span>
              <h3 className="text-lg font-bold text-slate-900">一括削除の確認</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              選択した <strong>{selectedKeys.size} 件</strong> の仕訳エントリーを一覧から削除します。よろしいですか？
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDeleteConfirmModal(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleApplyBulkDelete}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 transition-colors shadow-sm"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 要確認警告モーダル */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-lg font-bold text-slate-900">要確認項目が残っています</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              仕訳の中に「要確認」の項目が含まれています。このまま{pendingDownloadType === "csv" ? "弥生会計26用CSV (.csv)" : "Excel (.xlsx)"}をダウンロードしますか？
            </p>

            <div className="max-h-40 overflow-y-auto rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
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
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                キャンセルして修正
              </button>
              <button
                onClick={() => {
                  setShowWarningModal(false);
                  if (pendingDownloadType === "csv") {
                    executeDownloadYayoiCsv();
                  } else {
                    executeDownloadYayoiExcel();
                  }
                }}
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-900 hover:bg-amber-400 transition-colors shadow-sm"
              >
                了解してそのままダウンロード
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 解析履歴モーダル */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📜</span>
                <h3 className="text-base font-bold text-slate-900">
                  解析・作成履歴 {currentCompany ? `- ${currentCompany.name} (クラウド共有)` : "(ローカル)"} ({filteredHistoryList.length} 件)
                </h3>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 font-medium">
              {currentCompany
                ? `「${currentCompany.name}」のクラウド共有解析履歴です。どのデバイス・どのアカウントからでも共通して閲覧でき、「仕訳を復元」を押すと作業画面に読み込めます。`
                : "ローカル環境の解析履歴です。「仕訳を復元」ボタンを押すと対象の仕訳データを復元できます。"}
            </p>

            {filteredHistoryList.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50 font-medium">
                {currentCompany
                  ? `「${currentCompany.name}」に共有された解析履歴はありません。仕訳を解析すると自動的にクラウド共有されます。`
                  : "保存された解析履歴はありません。仕訳を作成すると自動的に保存されます。"}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {filteredHistoryList.map((record) => {
                  const dateStr = new Date(record.createdAt).toLocaleString("ja-JP");

                  return (
                    <div
                      key={record.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5 transition-all hover:border-blue-300 hover:bg-blue-50/20"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                              record.mode === "receipt"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-indigo-50 text-indigo-700 border-indigo-200"
                            }`}
                          >
                            {record.mode === "receipt" ? "📄 領収書" : "🏦 通帳"}
                          </span>
                          <span className="text-xs font-mono text-slate-500">
                            {dateStr}
                          </span>
                          {(record.createdByName || record.createdByEmail) && (
                            <span
                              className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-medium"
                              title={`作成者: ${record.createdByEmail || ''}`}
                            >
                              👤 {record.createdByName || record.createdByEmail}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-emerald-700">
                            ¥{record.totalAmount.toLocaleString()} ({record.totalEntries}件)
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1 max-w-[360px]">
                          {record.fileNames.map((fn, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] bg-white text-slate-700 px-2 py-0.5 rounded border border-slate-200 truncate max-w-[160px] font-medium"
                              title={fn}
                            >
                              📁 {fn}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleRestoreHistoryRecord(record)}
                            className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 transition-colors shadow-sm"
                          >
                            仕訳を復元
                          </button>
                          <button
                            onClick={() => handleDeleteHistoryRecord(record.id)}
                            className="text-[11px] text-slate-400 hover:text-rose-600 p-1 transition-colors"
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

            <div className="border-t border-slate-200 pt-3 flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}