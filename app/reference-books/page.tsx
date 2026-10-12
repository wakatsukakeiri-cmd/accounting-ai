'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import CompanySwitcher from '@/components/CompanySwitcher'
import type {
  ReferenceBookItem,
  PeriodType,
  BookType,
} from '@/types/reference-book'
import {
  fetchCompanyReferenceBooks,
  saveCompanyReferenceBook,
  deleteCompanyReferenceBook,
} from '@/lib/db/reference-book'
import { readBookFileToText } from '@/lib/utils/book-file-reader'

const BOOK_CONFIGS: {
  type: BookType
  title: string
  icon: string
  desc: string
}[] = [
  {
    type: 'journal',
    title: '仕訳日記帳',
    icon: '📑',
    desc: '過去の日々の仕訳履歴。取引先や摘要と科目の対応ルールを最も詳細に抽出できます（推奨）。',
  },
  {
    type: 'general_ledger',
    title: '総勘定元帳',
    icon: '📖',
    desc: '科目ごとの取引推移と摘要。どの取引先にどの勘定科目を使っていたかの学習に活用されます。',
  },
  {
    type: 'subsidiary_ledger',
    title: '補助残高一覧表',
    icon: '📊',
    desc: '取引先別・科目別の補助科目一覧。銀行口座名や主要取引先の補助科目対応に反映されます。',
  },
]

export default function ReferenceBooksPage() {
  const router = useRouter()
  const { currentCompany, user, isLoading } = useAuth()

  const [activePeriod, setActivePeriod] = useState<PeriodType>('previous')
  const [books, setBooks] = useState<ReferenceBookItem[]>([])
  const [loadingBooks, setLoadingBooks] = useState(false)
  const [uploadingType, setUploadingType] = useState<BookType | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedBookId, setExpandedBookId] = useState<string | null>(null)

  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})

  // 未ログイン時はログイン画面へ
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login')
    }
  }, [isLoading, user, router])

  // 帳簿一覧ロード
  const loadBooks = useCallback(async () => {
    if (!currentCompany) return
    setLoadingBooks(true)
    try {
      const list = await fetchCompanyReferenceBooks(currentCompany.id)
      setBooks(list)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingBooks(false)
    }
  }, [currentCompany])

  useEffect(() => {
    if (currentCompany) {
      loadBooks()
      setMessage(null)
    }
  }, [currentCompany, loadBooks])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-500">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-xs font-medium">認証状態を確認中...</p>
      </div>
    )
  }

  // ファイルアップロード処理（Shift_JIS/UTF-8自動判別、Excel対応）
  const handleFileUpload = async (bookType: BookType, file: File) => {
    if (!currentCompany) return
    setUploadingType(bookType)
    setMessage(null)

    try {
      const { text, fileType, encoding, rowCount } = await readBookFileToText(file)

      if (!text || rowCount === 0) {
        throw new Error('ファイルを読み取れませんでした。ファイルが空か破損している可能性があります。')
      }

      const res = await saveCompanyReferenceBook({
        companyId: currentCompany.id,
        period: activePeriod,
        bookType,
        fileName: file.name,
        fileSize: file.size,
        content: text,
      })

      if (res.success && res.data) {
        const ruleCount = res.data.parsedRules.length
        if (ruleCount === 0) {
          setMessage({
            type: 'error',
            text: `「${file.name}」を読み込みましたが（${rowCount}行）、仕訳ルールを抽出できませんでした。勘定科目名や取引先・摘要列が含まれるCSV/Excelファイルであることをご確認ください。`,
          })
        } else {
          setMessage({
            type: 'success',
            text: `「${file.name}」を学習・登録しました！（形式: ${encoding}, 読込行数: ${rowCount}行, 抽出ルール: ${ruleCount}件）`,
          })
        }
        await loadBooks()
      } else {
        setMessage({
          type: 'error',
          text: res.error || 'ファイルの登録に失敗しました。',
        })
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.message || 'ファイルの読み込みに失敗しました。',
      })
    } finally {
      setUploadingType(null)
    }
  }

  // 削除処理
  const handleDeleteBook = async (bookId: string, title: string) => {
    if (!confirm(`「${title}」の登録データを削除しますか？`)) return
    setMessage(null)
    try {
      const res = await deleteCompanyReferenceBook(bookId)
      if (res.success) {
        setBooks((prev) => prev.filter((b) => b.id !== bookId))
        setMessage({ type: 'success', text: `データを削除しました。` })
      } else {
        setMessage({ type: 'error', text: res.error || '削除に失敗しました。' })
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || '削除中にエラーが発生しました。' })
    }
  }

  const currentPeriodBooks = books.filter((b) => b.period === activePeriod)
  const getBookForType = (type: BookType) => currentPeriodBooks.find((b) => b.bookType === type)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              ← 仕訳作成に戻る
            </Link>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-xl">📚</span>
              <h1 className="text-base font-extrabold text-slate-900">
                過去帳簿・仕訳ルール学習設定
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <CompanySwitcher />
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* 説明バナー */}
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-6 text-white shadow-md space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-indigo-500/40 text-indigo-200 text-[11px] font-bold border border-indigo-400/30">
              AI自動参照機能
            </span>
            <span className="text-xs text-indigo-200">
              対象会社: <span className="font-bold text-white">{currentCompany?.name}</span>
            </span>
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            前期・前々期の帳簿を参考に、あなたの会社専用の仕訳を作成
          </h2>
          <p className="text-xs text-indigo-200 leading-relaxed max-w-3xl">
            総勘定元帳、仕訳日記帳、補助残高一覧表（CSVやテキスト等）をあらかじめ登録しておくと、
            領収書や通帳を解析する際にAIが過去の仕訳実績（取引先・摘要と勘定科目の対応パターン）を自動で最優先参照して仕訳を作成します。
          </p>
        </div>

        {/* メッセージ通知 */}
        {message && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between animate-in fade-in ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="text-slate-400 hover:text-slate-600 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* 期の切り替えタブ */}
        <div className="flex border-b border-slate-200 gap-2">
          <button
            onClick={() => setActivePeriod('previous')}
            className={`pb-3 px-5 text-sm font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activePeriod === 'previous'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📅 前期分（1年前）</span>
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">
              {books.filter((b) => b.period === 'previous').length} / 3 登録
            </span>
          </button>
          <button
            onClick={() => setActivePeriod('two_years_ago')}
            className={`pb-3 px-5 text-sm font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activePeriod === 'two_years_ago'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📅 前々期分（2年前）</span>
            <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">
              {books.filter((b) => b.period === 'two_years_ago').length} / 3 登録
            </span>
          </button>
        </div>

        {/* 3つの帳簿アップロードカード */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {BOOK_CONFIGS.map((cfg) => {
            const existingBook = getBookForType(cfg.type)
            const isUploading = uploadingType === cfg.type
            const isExpanded = expandedBookId === existingBook?.id

            return (
              <div
                key={cfg.type}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl">{cfg.icon}</span>
                    {existingBook ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ✓ 登録・学習完了
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                        未登録
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{cfg.title}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{cfg.desc}</p>
                </div>

                {existingBook ? (
                  /* 登録済み情報表示 */
                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-slate-800 truncate max-w-[180px]" title={existingBook.fileName}>
                          {existingBook.fileName}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {(existingBook.fileSize / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <div className="text-[11px] font-medium text-indigo-700">
                        ⚡️ {existingBook.parsedRules.length} 件の仕訳ルールを抽出
                      </div>
                      <div className="text-[10px] text-slate-400">
                        更新日: {new Date(existingBook.updatedAt).toLocaleDateString('ja-JP')}
                      </div>
                    </div>

                    {/* ルールサンプルアコーディオン */}
                    {existingBook.parsedRules.length > 0 ? (
                      <div>
                        <button
                          onClick={() => setExpandedBookId(isExpanded ? null : existingBook.id)}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <span>{isExpanded ? '▲ 抽出ルール一覧を閉じる' : '▼ 抽出された仕訳ルールを確認（上位30件）'}</span>
                        </button>
                        {isExpanded && (
                          <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg max-h-56 overflow-y-auto space-y-1.5 text-[11px]">
                            {existingBook.parsedRules.slice(0, 30).map((r, idx) => (
                              <div key={idx} className="flex items-center justify-between border-b border-slate-200 pb-1 gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span
                                    className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                                      r.direction === 'deposit'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-indigo-100 text-indigo-800'
                                    }`}
                                  >
                                    {r.direction === 'deposit' ? '入金' : '出金'}
                                  </span>
                                  <span className="truncate max-w-[120px] font-bold text-slate-700" title={r.keyword}>
                                    {r.keyword}
                                  </span>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="font-bold text-indigo-700">
                                    {r.direction === 'deposit' ? r.creditAccount || r.debitAccount : r.debitAccount || r.creditAccount}
                                  </span>
                                  {r.taxType && (
                                    <span className="text-[9px] text-slate-400 ml-1">({r.taxType})</span>
                                  )}
                                </div>
                              </div>
                            ))}
                            {existingBook.parsedRules.length > 30 && (
                              <div className="text-[10px] text-slate-400 text-center pt-1 font-bold">
                                他 {existingBook.parsedRules.length - 30} 件のルールを学習済み
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-800 font-medium">
                        ⚠️ ルールが0件です。勘定科目や摘要・取引先を含むCSV/Excel形式で再アップロードしてください。
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => fileInputRefs.current[cfg.type]?.click()}
                        disabled={isUploading}
                        className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer text-center"
                      >
                        {isUploading ? '更新中...' : '再アップロード'}
                      </button>
                      <button
                        onClick={() => handleDeleteBook(existingBook.id, cfg.title)}
                        className="py-1.5 px-3 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ) : (
                  /* アップロードゾーン */
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <div
                      onClick={() => fileInputRefs.current[cfg.type]?.click()}
                      className={`border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/20 rounded-xl p-4 text-center cursor-pointer transition-all ${
                        isUploading ? 'opacity-50 pointer-events-none' : ''
                      }`}
                    >
                      <div className="text-base mb-1">📤</div>
                      <div className="text-xs font-bold text-slate-700">
                        {isUploading ? '解析・学習中...' : 'ファイルを選択またはドロップ'}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        CSV, TSV, テキスト等
                      </div>
                    </div>
                  </div>
                )}

                {/* 隠しinput */}
                <input
                  type="file"
                  ref={(el) => {
                    fileInputRefs.current[cfg.type] = el
                  }}
                  accept=".csv,.tsv,.txt,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      handleFileUpload(cfg.type, file)
                      e.target.value = ''
                    }
                  }}
                />
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
