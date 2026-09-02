import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptAnalysisResult } from "@/types/journal";

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

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        {
          success: false,
          error: "現在は領収書の画像ファイル (.png, .jpg, .webp 等) のみ対応しています。",
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
提供された領収書・レシートの画像から取引内容を精密に読み取り、弥生会計に適合する仕訳データの【配列 (JSON Array)】を抽出してください。

【最重要: 複数税率(10%・8%軽減税率)の分割ルール】
1. 1枚の領収書・レシートの中に「標準税率10%対象額」と「軽減税率8%対象額」が混在している場合は、必ず税率ごとに分けて集計し、**仕訳オブジェクトを2件（配列に2要素）作成**してください。
   - 10%対象分仕訳: debitTaxType は "課対仕入10%"、amount / debitAmount / creditAmount は10%対象の小計額。摘要には必要に応じて "(10%対象)" を付記。
   - 8%対象分仕訳: debitTaxType は "課対仕入8%(軽)"、amount / debitAmount / creditAmount は8%対象の小計額。摘要には必要に応じて "(8%軽減税率)" を付記。
2. 領収書の全品目が単一税率（10%のみ、または8%のみ）の場合は、仕訳オブジェクトを1件（配列に1要素）作成してください。

【共通出力ルール】
1. 必ず以下のJSON配列形式で回答してください。JSON以外のテキストは含めないでください。
2. 各仕訳において、借方金額 (debitAmount) と貸方金額 (creditAmount) は必ず合計金額 (amount) と一致させてください。(debitAmount == creditAmount == amount)
3. 不鮮明、文字が隠れている、該当記述がない、または確定的な判断ができない項目については、絶対に推測で埋めず、文字列 "要確認" と出力してください。
4. 【支払方法・決済手段】が領収書から明確に判別・印字されている場合は、決済手段の種類（クレジットカード、電子マネー、現金、預金等）にかかわらず、貸方勘定科目 (creditAccount) には一律「現金」を出力してください。ただし、領収書から支払方法を確実に判断・確認できない場合は、絶対に推測せず 貸方勘定科目 (creditAccount) を「要確認」としてください。
5. "要確認" に設定した項目、または自信が持てない項目名(例: "date", "debitAccount", "creditAccount", "debitTaxType" 等)の英名を uncertainFields 配列に含めてください。
6. 借方勘定科目 (debitAccount) は「消耗品費」「旅費交通費」「会議費」「接待交際費」「通信費」「新聞図書費」「雑費」等の一般的な科目を選択してください。
7. 貸方税区分 (creditTaxType) は原則「対象外」としてください。

【出力JSONスキーマ (仕訳オブジェクトの配列)】
[
  {
    "date": "YYYY-MM-DD 形式の取引日、判断できない場合は '要確認'",
    "payee": "支払先・店舗名・会社名、判断できない場合は '要確認'",
    "description": "取引内容・購入品目等の概要、判断できない場合は '要確認'",
    "amount": "該当税率の対象金額(数値)。数値化できない場合は '要確認'",
    "debitAccount": "推測される借方勘定科目名、判断できない場合は '要確認'",
    "debitSubAccount": "借方補助科目名、なければ空文字 ''",
    "debitTaxType": "借方税区分 ('課対仕入10%', '課対仕入8%(軽)', '対象外' 等)、判断できない場合は '要確認'",
    "debitAmount": "借方金額(数値)。amountと一致させること。判定不能時は '要確認'",
    "creditAccount": "支払方法が確実に判断できる場合は一律 '現金' とし、確実に判断できない場合は絶対に推測せず '要確認'",
    "creditSubAccount": "貸方補助科目名、なければ空文字 ''",
    "creditTaxType": "貸方税区分 (原則 '対象外')、判断できない場合は '要確認'",
    "creditAmount": "貸方金額(数値)。amountと一致させること。判定不能時は '要確認'",
    "summary": "摘要 (例: 「支払先名 事務用品購入 (10%対象)」)",
    "uncertainFields": ["自信のない項目や要確認となった項目のキー名の配列"]
  }
]
`;

    const response = await ai.models.generateContent({
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
    });

    const responseText = response.text || "";
    if (!responseText) {
      return NextResponse.json(
        { success: false, error: "AIからの応答が空でした。" },
        { status: 500 }
      );
    }

    let parsedResultArray: ReceiptAnalysisResult[];
    try {
      const rawJson = JSON.parse(responseText);
      // 単一オブジェクトで返ってきた場合のフォールバック対応
      if (Array.isArray(rawJson)) {
        parsedResultArray = rawJson;
      } else if (typeof rawJson === "object" && rawJson !== null) {
        parsedResultArray = [rawJson];
      } else {
        throw new Error("Invalid response format");
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

    // 各仕訳の後処理・数値変換
    const processedArray = parsedResultArray.map((parsedResult) => {
      if (parsedResult.amount !== "要確認") {
        const numAmount = Number(parsedResult.amount);
        if (!isNaN(numAmount)) {
          parsedResult.amount = numAmount;
          if (parsedResult.debitAmount !== "要確認") {
            parsedResult.debitAmount = numAmount;
          }
          if (parsedResult.creditAmount !== "要確認") {
            parsedResult.creditAmount = numAmount;
          }
        }
      }

      if (!parsedResult.debitSubAccount) parsedResult.debitSubAccount = "";
      if (!parsedResult.creditSubAccount) parsedResult.creditSubAccount = "";
      if (!parsedResult.creditTaxType || parsedResult.creditTaxType === "") {
        parsedResult.creditTaxType = "対象外";
      }

      return parsedResult;
    });

    return NextResponse.json({
      success: true,
      data: processedArray,
    });
  } catch (err: unknown) {
    console.error("Gemini API Error:", err);
    const errorMessage =
      err instanceof Error ? err.message : "AIの解析中にエラーが発生しました。";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
