import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptAnalysisResult, PageDetail } from "@/types/journal";

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
          error:
            "通帳機能では画像ファイル (.png, .jpg, .webp 等) または 通帳PDF (.pdf) に対応しています。",
        },
        { status: 400 }
      );
    }

    // ファイルを Buffer / Base64 に変換
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");

    const ai = new GoogleGenAI({ apiKey });

    const systemPrompt = `
あなたは日本の会計・経理プロフェッショナルAIです。
提供された通帳の画像またはPDF（複数ページ含む）から、すべてのページ (Page 1, Page 2, Page 3...) を最初から最後まで漏れなくスキャンし、ページ単位で明細行を抽出したJSON構造を出力してください。

【通帳解析における厳格な最重要ルール】

1. **【複数ページPDFの全ページ処理】**:
   - PDF内のすべてのページ（1ページ目だけでなく、2ページ目、3ページ目、10ページ目等）をすべて解析対象としてください。
   - レスポンスの pages 配列に、各ページごとの解析結果 (pageNumber, detectedCount, items) を順に格納してください。

2. **【ページ跨ぎ・継続行と「1行＝1明細」の絶対維持】**:
   - ページの切り替わりや前行からの継続により、次ページ先頭行等の日付欄が空欄になっている場合は、明細の連続性を確認した上で、直前の取引日付（前ページまたは直前行の日付）を自動補完してください。
   - **ただし、日付の補完やページを跨いだことを理由に、取引を勝手に同一取引として統合・結合しないでください！**
   - 必ず「1行＝1明細」の原則を維持してください。同じ日付・同じ摘要（例: "為替手数料"）・同じ金額（例: 660円）が複数あっても、絶対重複削除や間引きをせず、印字されているすべての行をそれぞれ別々の明細として抽出してください。
   - 補完判断に迷う場合や不確実な場合は、強引に統合・削除せず日付を "要確認" として残してください。

3. **【金額の厳格使用（残高使用の絶対禁止）】**:
   - 通帳の「差引残高」欄の数字を絶対に仕訳金額として使用しないでください！
   - 出金の場合は「お支払い金額」、入金の場合は「お預り金額」欄に印字されている金額のみを取引金額 (amount, debitAmount, creditAmount) として使用してください。

4. **【通帳モード固定勘定科目ルール】**:
   - 通帳モードでは、AIによる複雑な相手勘定科目の推測は一切行わないでください。
   - **出金 (お引出し) 取引の場合**:
     - transactionType: "出金"
     - 借方勘定科目 (debitAccount): **"仮払金"**
     - 貸方勘定科目 (creditAccount): **"普通預金"**
     - 借方税区分 / 貸方税区分: 原則 **"対象外"**
   - **入金 (お預り) 取引の場合**:
     - transactionType: "入金"
     - 借方勘定科目 (debitAccount): **"普通預金"**
     - 貸方勘定科目 (creditAccount): **"仮受金"**
     - 借方税区分 / 貸方税区分: 原則 **"対象外"**

5. **【取引日のフォーマット】**:
   - 通帳に印字されている取引日付を読み取り、内部データとして "YYYY-MM-DD" 形式（年が不明な場合は現在年2026年または該当通帳の年、例: "2026-08-15"）で設定してください。
   - 日付がどうしても読み取れない場合のみ "要確認" としてください。

6. **【ページ別認識件数 counts のカウント】**:
   - 各ページにおいて、視覚的に認識した通帳明細行の数を pageNumber ごとの detectedCount に設定してください。

【出力JSON構造】
{
  "pages": [
    {
      "pageNumber": 1,
      "detectedCount": ページ1で認識した明細行の総数(数値),
      "items": [
        {
          "date": "YYYY-MM-DD 形式の取引日、判定不能時は '要確認'",
          "payee": "印字された相手先・店舗・口座名 (例: 'タカギ ユキオ', 'デンキ カンサイ')",
          "description": "取引内容・印字摘要 (例: '振込 BZ2', '為替手数料')",
          "amount": "出金額または入金額の数値。絶対に残高を使用しないこと",
          "debitAccount": "出金時は '仮払金'、入金時は '普通預金'",
          "debitSubAccount": "",
          "debitTaxType": "対象外",
          "debitAmount": "借方金額(数値)。amountと一致させること",
          "creditAccount": "出金時は '普通預金'、入金時は '仮受金'",
          "creditSubAccount": "",
          "creditTaxType": "対象外",
          "creditAmount": "貸方金額(数値)。amountと一致させること",
          "summary": "摘要 (例: '通帳明細 08/15 振込 BZ2 タカギ ユキオ')",
          "uncertainFields": ["要確認となった項目のキー名配列"],
          "transactionType": "出金 または 入金",
          "balance": "解読できた場合の残高(数値または'要確認')",
          "rawText": "通帳該当行の印字原文"
        }
      ]
    }
  ]
}
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
                  mimeType: file.type,
                  data: base64Data,
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
            type: Type.OBJECT,
            properties: {
              pages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageNumber: { type: Type.INTEGER },
                    detectedCount: { type: Type.INTEGER },
                    items: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          date: { type: Type.STRING },
                          payee: { type: Type.STRING },
                          description: { type: Type.STRING },
                          amount: { type: Type.STRING },
                          debitAccount: { type: Type.STRING },
                          debitSubAccount: { type: Type.STRING },
                          debitTaxType: { type: Type.STRING },
                          debitAmount: { type: Type.STRING },
                          creditAccount: { type: Type.STRING },
                          creditSubAccount: { type: Type.STRING },
                          creditTaxType: { type: Type.STRING },
                          creditAmount: { type: Type.STRING },
                          summary: { type: Type.STRING },
                          uncertainFields: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                          transactionType: { type: Type.STRING },
                          balance: { type: Type.STRING },
                          rawText: { type: Type.STRING },
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
                  required: ["pageNumber", "detectedCount", "items"],
                },
              },
            },
            required: ["pages"],
          },
        },
      })
    );

    const responseText = response.text || "";
    if (!responseText) {
      return NextResponse.json(
        { success: false, error: "AIからの応答が空でした。" },
        { status: 500 }
      );
    }

    let parsedPages: PageDetail[] = [];
    try {
      const rawJson = JSON.parse(responseText);
      if (rawJson && Array.isArray(rawJson.pages)) {
        parsedPages = rawJson.pages;
      } else if (Array.isArray(rawJson)) {
        // 単一配列で返された場合の互換構造
        parsedPages = [
          {
            pageNumber: 1,
            detectedCount: rawJson.length,
            items: rawJson,
          },
        ];
      } else {
        throw new Error("Invalid response structure");
      }
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "AIからの応答のJSONパースに失敗しました。",
        },
        { status: 500 }
      );
    }

    // 全ページの仕訳アイテムを統合し、pageNumber を付与
    let totalDetectedCount = 0;
    const allIntegratedItems: ReceiptAnalysisResult[] = [];

    parsedPages.forEach((page) => {
      totalDetectedCount += Number(page.detectedCount) || page.items.length;

      page.items.forEach((item) => {
        item.pageNumber = page.pageNumber;

        // 数値変換
        if (item.amount !== "要確認") {
          const numAmount = Number(item.amount);
          if (!isNaN(numAmount)) {
            item.amount = numAmount;
            if (item.debitAmount !== "要確認") {
              item.debitAmount = numAmount;
            }
            if (item.creditAmount !== "要確認") {
              item.creditAmount = numAmount;
            }
          }
        }

        if (!item.debitSubAccount) item.debitSubAccount = "";
        if (!item.creditSubAccount) item.creditSubAccount = "";
        if (!item.debitTaxType) item.debitTaxType = "対象外";
        if (!item.creditTaxType) item.creditTaxType = "対象外";

        allIntegratedItems.push(item);
      });
    });

    return NextResponse.json({
      success: true,
      data: allIntegratedItems,
      detectedCount: totalDetectedCount,
      pages: parsedPages,
    });
  } catch (err: unknown) {
    console.error("Gemini Bankbook API Error:", err);
    const errorMessage =
      err instanceof Error ? err.message : "通帳の解析中にエラーが発生しました。";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
