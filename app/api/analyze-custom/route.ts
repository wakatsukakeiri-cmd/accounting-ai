import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptAnalysisResult } from "@/types/journal";
import { getCompanyReferenceRulesPromptServer } from "@/lib/db/reference-book-server";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      return NextResponse.json(
        {
          success: false,
          error:
            "GEMINI_API_KEY が設定されていません。.env.local に有効な API キーを設定してください。",
        },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const companyId = formData.get("companyId") as string | null;
    const customPrompt = (formData.get("customPrompt") as string | null) || "";
    const modeName = (formData.get("modeName") as string | null) || "カスタムモード";

    if (!file) {
      return NextResponse.json(
        { success: false, error: "ファイルが送信されていません。" },
        { status: 400 }
      );
    }

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";

    if (!isImage && !isPdf) {
      return NextResponse.json(
        {
          success: false,
          error: "画像ファイル (.png, .jpg, .webp 等) または PDF (.pdf) をアップロードしてください。",
        },
        { status: 400 }
      );
    }

    // ファイルを Buffer / Base64 に変換
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");

    const ai = new GoogleGenAI({ apiKey });

    // 会社の過去帳簿ルールを取得
    const referenceRulesPrompt = await getCompanyReferenceRulesPromptServer(companyId);

    const systemPrompt = `
あなたはお客さまの会社専属の日本の高度な会計・経理プロフェッショナルAIです。
提供された資料（画像またはPDF）から内容を精密に読み取り、弥生会計に適合する仕訳データの【配列 (JSON Array)】を抽出・作成してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【最優先・厳格遵守ルール：ユーザー指定の専用プロンプト（モード: ${modeName}）】
${customPrompt}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${referenceRulesPrompt}

【共通基本ルール】
1. 必ず以下のJSON配列形式で回答してください。JSON以外の解説文等は含めないでください。
2. 各仕訳において、借方金額 (debitAmount) と貸方金額 (creditAmount) は必ず合計金額 (amount) と一致させてください。(debitAmount == creditAmount == amount)
3. 読み取れない箇所や不確実な項目は絶対に推測で埋めず、文字列 "要確認" と出力してください。
4. 1枚の資料の中に「標準税率10%」と「軽減税率8%」が混在する場合は、必ず税率ごとに分けて仕訳オブジェクトを分割作成してください。
5. 摘要 (summary) には取引日付 (例: '08/15', '2026/08/25') を含めないでください。

【出力JSONスキーマ (仕訳オブジェクトの配列)】
[
  {
    "date": "YYYY-MM-DD 形式の取引日、判断できない場合は '要確認'",
    "payee": "相手先・店舗名・会社名、判断できない場合は '要確認'",
    "description": "取引内容・購入品目等の概要、判断できない場合は '要確認'",
    "amount": "数値または '要確認'",
    "debitAccount": "借方勘定科目名、判断できない場合は '要確認'",
    "debitSubAccount": "借方補助科目名、なければ空文字 ''",
    "debitTaxType": "借方税区分 ('課対仕入10%', '課対仕入8%(軽)', '対象外' 等)、判断できない場合は '要確認'",
    "debitAmount": "借方金額(数値)。amountと一致させること",
    "creditAccount": "貸方勘定科目名、判断できない場合は '要確認'",
    "creditSubAccount": "貸方補助科目名、なければ空文字 ''",
    "creditTaxType": "貸方税区分 (原則 '対象外' または '課税売上10%' 等)、判断できない場合は '要確認'",
    "creditAmount": "貸方金額(数値)。amountと一致させること",
    "summary": "摘要 (日付は含めない)",
    "uncertainFields": ["要確認となった項目の英名キー配列"]
  }
]
`;

    function isTransientError(err: unknown): boolean {
      if (!err) return false;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as Record<string, unknown>)?.status || (err as Record<string, unknown>)?.statusCode;

      if (status === 503 || status === 429) return true;

      const lowerMsg = msg.toLowerCase();
      return (
        lowerMsg.includes("503") ||
        lowerMsg.includes("unavailable") ||
        lowerMsg.includes("high demand") ||
        lowerMsg.includes("resource_exhausted") ||
        lowerMsg.includes("rate limit") ||
        lowerMsg.includes("temporarily") ||
        lowerMsg.includes("overloaded")
      );
    }

    async function callGeminiWithRetry<T>(
      fn: () => Promise<T>,
      maxRetries = 3
    ): Promise<T> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err;
          if (attempt === maxRetries || !isTransientError(err)) {
            throw err;
          }
          const delayMs = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      throw lastError;
    }

    const response = await callGeminiWithRetry(() =>
      ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: file.type,
                },
              },
              {
                text: systemPrompt,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                payee: { type: Type.STRING },
                description: { type: Type.STRING },
                amount: {
                  type: Type.STRING,
                  description: "合計金額の文字列または数値",
                },
                debitAccount: { type: Type.STRING },
                debitSubAccount: { type: Type.STRING },
                debitTaxType: { type: Type.STRING },
                debitAmount: {
                  type: Type.STRING,
                  description: "借方金額",
                },
                creditAccount: { type: Type.STRING },
                creditSubAccount: { type: Type.STRING },
                creditTaxType: { type: Type.STRING },
                creditAmount: {
                  type: Type.STRING,
                  description: "貸方金額",
                },
                summary: { type: Type.STRING },
                uncertainFields: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                "date",
                "payee",
                "description",
                "amount",
                "debitAccount",
                "debitSubAccount",
                "debitTaxType",
                "debitAmount",
                "creditAccount",
                "creditSubAccount",
                "creditTaxType",
                "creditAmount",
                "summary",
                "uncertainFields",
              ],
            },
          },
        },
      })
    );

    const text = response.text?.trim();
    if (!text) {
      return NextResponse.json(
        { success: false, error: "AIからの応答が空でした。" },
        { status: 500 }
      );
    }

    let parsedList: ReceiptAnalysisResult[];
    try {
      parsedList = JSON.parse(text);
      if (!Array.isArray(parsedList)) {
        parsedList = [parsedList as any];
      }
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "AIの出力をJSONとしてパースできませんでした。",
        },
        { status: 500 }
      );
    }

    // 数値型へのキャスト
    const processedList: ReceiptAnalysisResult[] = parsedList.map((entry) => {
      const parsedAmount =
        entry.amount === "要確認" || isNaN(Number(entry.amount))
          ? "要確認"
          : Number(entry.amount);

      const parsedDebitAmount =
        entry.debitAmount === "要確認" || isNaN(Number(entry.debitAmount))
          ? parsedAmount
          : Number(entry.debitAmount);

      const parsedCreditAmount =
        entry.creditAmount === "要確認" || isNaN(Number(entry.creditAmount))
          ? parsedAmount
          : Number(entry.creditAmount);

      return {
        ...entry,
        amount: parsedAmount,
        debitAmount: parsedDebitAmount,
        creditAmount: parsedCreditAmount,
        debitSubAccount: entry.debitSubAccount || "",
        creditSubAccount: entry.creditSubAccount || "",
        uncertainFields: Array.isArray(entry.uncertainFields)
          ? entry.uncertainFields
          : [],
        originalFileName: file.name,
      };
    });

    return NextResponse.json({
      success: true,
      data: processedList,
    });
  } catch (err: any) {
    console.error("Custom analysis error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "カスタム資料の解析中にエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}
