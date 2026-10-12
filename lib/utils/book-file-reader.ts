import Encoding from 'encoding-japanese'
import ExcelJS from 'exceljs'

/**
 * アップロードされた帳簿ファイル（CSV, TSV, TXT, Excel .xlsx）を文字列（CSV形式）に統一変換
 */
export async function readBookFileToText(file: File): Promise<{
  text: string
  fileType: 'csv' | 'tsv' | 'excel' | 'text'
  encoding: string
  rowCount: number
}> {
  const buffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(buffer)

  // 1. Excel (.xlsx) 判定: 拡張子またはZIPマジックバイト (0x50, 0x4B)
  const isExcel =
    file.name.toLowerCase().endsWith('.xlsx') ||
    (uint8Array.length > 4 && uint8Array[0] === 0x50 && uint8Array[1] === 0x4b)

  if (isExcel) {
    try {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(buffer)
      const worksheet = workbook.worksheets[0] // 最初のシートを取得
      if (!worksheet) {
        throw new Error('Excelファイル内にシートが見つかりませんでした。')
      }

      const rows: string[] = []
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        // row.values は 1-indexed 配列
        const rawValues = Array.isArray(row.values) ? row.values.slice(1) : []
        const line = rawValues
          .map((v) => {
            if (v === null || v === undefined) return ''
            if (typeof v === 'object') {
              if ('result' in v) return String(v.result ?? '')
              if ('text' in v) return String(v.text ?? '')
              if ('richText' in v && Array.isArray((v as any).richText)) {
                return (v as any).richText.map((t: any) => t.text).join('')
              }
            }
            return String(v).replace(/"/g, '""')
          })
          .map((cell) => `"${cell}"`)
          .join(',')
        rows.push(line)
      })

      const text = rows.join('\n')
      return {
        text,
        fileType: 'excel',
        encoding: 'Excel (OpenXML)',
        rowCount: rows.length,
      }
    } catch (excelErr: any) {
      console.warn('Excel parse failed, falling back to text decoder:', excelErr)
    }
  }

  // 2. CSV / TSV / テキストファイルの文字コード自動検出＆変換
  const detected = Encoding.detect(uint8Array) || 'UTF8'
  const unicodeArray = Encoding.convert(uint8Array, {
    to: 'UNICODE',
    from: detected,
  })
  const text = Encoding.codeToString(unicodeArray)

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const isTsv = file.name.toLowerCase().endsWith('.tsv') || (lines[0] && lines[0].includes('\t'))

  return {
    text,
    fileType: isTsv ? 'tsv' : 'csv',
    encoding: typeof detected === 'string' ? detected : 'AUTO',
    rowCount: lines.length,
  }
}
