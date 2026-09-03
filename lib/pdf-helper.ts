import * as pdfjsLib from "pdfjs-dist";

// WorkerSrc の設定 (npm パッケージバージョンと100%一致する unpkg 公式 HTTPS CDN を使用)
if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

export interface PageImageResult {
  pageNumber: number;
  blob: Blob;
  fileName: string;
}

/**
 * 通帳PDFファイルを高解像度 (scale: 2.0 / 144DPI相当) の PNG 画像 Blob 配列に変換する
 */
export async function convertPdfToHighResImages(
  file: File
): Promise<PageImageResult[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const pageImages: PageImageResult[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    // 高解像度 scale: 2.0 (小さい活字・数字・日付をGeminiが超高精度に読み取れる視認性を維持)
    const viewport = page.getViewport({ scale: 2.0 });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      // 白背景を描画（透明度による文字欠けを防止）
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport,
        canvas,
      }).promise;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error(`PDF Page ${i} の画像変換に失敗しました。`));
        }, "image/png", 1.0);
      });

      const baseName = file.name.replace(/\.[^/.]+$/, "");
      pageImages.push({
        pageNumber: i,
        blob,
        fileName: `${baseName}_p${i}.png`,
      });
    }
  }

  return pageImages;
}
