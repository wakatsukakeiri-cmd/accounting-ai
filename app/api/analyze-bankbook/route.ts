import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptAnalysisResult, PageDetail } from "@/types/journal";
import { getCompanyReferenceRulesPromptServer } from "@/lib/db/reference-book-server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const startTime = performance.now();
  const logTime = (step: string) => {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[Bankbook API Timing] [${elapsed}s] ${step}`);
  };

  try {
    logTime("1. リクエスト受信開始");

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
    logTime(`2. PDF/Base64変換完了 (サイズ: ${(file.size / 1024).toFixed(1)}KB)`);

    const ai = new GoogleGenAI({ apiKey });

    // 会社の過去帳簿ルールを取得
    const referenceRulesPrompt = await getCompanyReferenceRulesPromptServer(companyId);

    const systemPrompt = `
あなたはお客さまの会社専属の日本の会計・経理プロフェッショナルAIです。
提供された通帳の画像またはPDF（複数ページ含む）から、すべてのページ (Page 1, Page 2, Page 3...) を最初から最後まで漏れなくスキャンし、ページ単位で明細行を抽出したJSON構造を出力してください。
${referenceRulesPrompt}

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

4. **【通帳モード勘定科目判定ルール（前期・前々期帳簿実績の最優先適用）】**:
   - 通帳の出金・入金取引に対して、安易に「仮払金」「仮受金」を一律適用することは絶対に避けてください。
   - **出金 (お引出し) 取引の場合**:
     - transactionType: "出金"
     - 貸方勘定科目 (creditAccount): **"普通預金"**
     - **借方勘定科目 (debitAccount)**:
       1. 上記の【最重要・厳格遵守ルール：過去実績ルール】に該当・類似する取引先や摘要があれば、その過去実績科目（例: 「買掛金」「水道光熱費」「地代家賃」「支払手数料」「消耗品費」「通信費」など）を最優先で適用してください。
       2. 過去実績ルールにない場合でも、以下の【通帳取引標準判定辞書】に従って適切な科目を決定してください：
          - **支払手数料**: 「振込手数料」「フリカエ手数料」「FB手数料」「EB利用料」「ATM利用料」「口座維持手数料」「為替手数料」等 ➔ 税区分: 課対仕入10%
          - **水道光熱費**: 「東京電力」「関西電力」「中部電力」「デンキ」「ガス」「東京ガス」「大阪ガス」「水道局」「スイドウ」等 ➔ 税区分: 課対仕入10%
          - **通信費**: 「NTT」「ドコモ」「ソフトバンク」「KDDI」「オプテージ」「UQ」「インターネット」等 ➔ 税区分: 課対仕入10%
          - **地代家賃**: 「ヤチン」「家賃」「地代」「オフィス」「ビル」「レジデンス」「不動産」「管理費」等 ➔ 税区分: 対象外(居住用) または 課対仕入10%(事務所)
          - **租税公課 / 法定福利費**: 「税務署」「国税」「都税」「県税」「市役所」「区役所」「住民税」「年金機構」「ネンキン」「労働保険」等 ➔ 税区分: 対象外
          - **給料手当**: 「給与」「キュウヨ」「賞与」「ショウヨ」等 ➔ 税区分: 対象外
          - **旅費交通費 / 車両費**: 「ETC」「高速道路」「JR」「メトロ」「出光」「エネオス」「ENEOS」「ガソリン」等 ➔ 税区分: 課対仕入10%
          - **未払金**: 「カード」「ニコス」「JCB」「VISA」「三井住友」「セゾン」「アメックス」「楽天カード」「ビューカード」「オリコ」「ジャックス」等 ➔ 税区分: 対象外
          - **買掛金**: 主要仕入先・取引先への振込 ➔ 税区分: 対象外
       3. 取引内容が完全に不明で判断できない場合のみ "仮払金" としてください。
     - 借方税区分 (debitTaxType): 過去実績ルールまたは取引内容に応じた税区分（課対仕入10%、対象外 等）を設定してください。
   - **入金 (お預り) 取引の場合**:
     - transactionType: "入金"
     - 借方勘定科目 (debitAccount): **"普通預金"**
     - **貸方勘定科目 (creditAccount)**:
       1. 上記の【最重要・厳格遵守ルール：過去実績ルール】に該当・類似する取引先や摘要があれば、その過去実績科目（例: 「売掛金」「売上」「受取利息」「預り金」など）を最優先で適用してください。
       2. 過去実績ルールにない場合でも、以下の標準ルールに従ってください：
          - **受取利息**: 「利息」「受取利息」「ヨキンリソク」等 ➔ 税区分: 非課税
          - **売掛金**: 取引先名・顧客名・会社名・個人名からの振込入金 ➔ 税区分: 対象外
          - **売上**: 店舗名や売上金等の直接入金 ➔ 税区分: 課税売上10%
       3. 取引内容が完全に不明で判断できない場合のみ "仮受金" としてください。
     - 貸方税区分 (creditTaxType): 過去実績ルールまたは取引内容に応じた税区分（課税売上10%、非課税、対象外 等）を設定してください。

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
          "debitAccount": "出金時は過去実績または適切な借方科目 (例: '水道光熱費', '支払手数料', '買掛金'、不明時のみ'仮払金')、入金時は '普通預金'",
          "debitSubAccount": "借方補助科目名 (買掛金や未払金時は取引先/カード会社名、水道光熱費や通信費時は会社名、過去実績にあればその補助科目)。なければ空文字 ''",
          "debitTaxType": "借方税区分 (例: '課対仕入10%', '対象外')",
          "debitAmount": "借方金額(数値)。amountと一致させること",
          "creditAccount": "出金時は '普通預金'、入金時は過去実績または適切な貸方科目 (例: '売掛金', '売上', '受取利息'、不明時のみ'仮受金')",
          "creditSubAccount": "貸方補助科目名 (売掛金や売上時は入金元取引先名/顧客名、過去実績にあればその補助科目)。なければ空文字 ''",
          "creditTaxType": "貸方税区分 (例: '課税売上10%', '対象外')",
          "creditAmount": "貸方金額(数値)。amountと一致させること",
          "summary": "摘要 (例: '振込 BZ2 タカギ ユキオ')。※重要: 摘要の中に取引日付 (例: '08/15', '2026/08/25') を含めないでください。",
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

    logTime("3. Gemini API呼び出し開始 (model: gemini-3.6-flash)");
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
    logTime("4. Gemini API応答受信完了");

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
      logTime("5. レスポンスJSON解析完了");
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

    logTime(`6. APIレスポンス返却直前 (抽出結果: ${allIntegratedItems.length}件)`);
    return NextResponse.json({
      success: true,
      data: allIntegratedItems,
      detectedCount: totalDetectedCount,
      pages: parsedPages,
    });
  } catch (err: unknown) {
    logTime(`❌ エラー発生: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Gemini Bankbook API Error:", err);
    const errorMessage =
      err instanceof Error ? err.message : "通帳の解析中にエラーが発生しました。";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
