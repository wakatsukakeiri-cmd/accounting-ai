'use client'

import React, { useState, useEffect } from 'react'
import type { CustomModeItem } from '@/types/custom-mode'
import { saveCompanyCustomMode, deleteCompanyCustomMode } from '@/lib/db/custom-mode'

interface CustomModeModalProps {
  isOpen: boolean
  onClose: () => void
  companyId: string
  companyName: string
  modes: CustomModeItem[]
  onModesUpdated: () => void
  onSelectMode?: (modeId: string) => void
  initialEditMode?: CustomModeItem | null
}

const TEMPLATES = [
  {
    name: '📊 POSレジ・売上日計表',
    icon: '📊',
    desc: '日計表から現金売上・クレジット売上・手数料を分割仕訳',
    prompt: `【資料形式: POSレジ売上日計表・レジ点検レシート】
以下のルールに従って仕訳を作成してください：
1. 「現金売上合計」または「現金計」:
   - 借方科目: 現金
   - 貸方科目: 売上高 (税区分: 課税売上10%)
   - 摘要: 日計表 現金売上
2. 「クレジット売上」または「カード計」:
   - 借方科目: 売掛金 (補助科目: クレジット)
   - 貸方科目: 売上高 (税区分: 課税売上10%)
   - 摘要: 日計表 クレジット売上
3. 「電子マネー / QR売上」がある場合:
   - 借方科目: 売掛金 (補助科目: 電子マネー)
   - 貸方科目: 売上高 (税区分: 課税売上10%)
4. 「過不足金」がある場合:
   - 不足時: 借方 雑損失 / 貸方 現金
   - 過剰時: 借方 現金 / 貸方 雑収入`,
  },
  {
    name: '📑 独自フォーマット請求書・納品書',
    icon: '📑',
    desc: '品目ごとに部門や勘定科目を細かく振り分ける',
    prompt: `【資料形式: 独自フォーマットの請求書 / 納品明細書】
明細ごとに記載された品目名・費目を読み取り、適切な勘定科目に振り分けてください：
1. 相手先 (payee) は請求元・発行元会社名を抽出してください。
2. 「材料費」「仕入商品」等の品目:
   - 借方科目: 仕入高 (税区分: 課対仕入10%)
3. 「運賃」「配送料」等の品目:
   - 借方科目: 荷造運賃 (税区分: 課対仕入10%)
4. 「手数料」「システム利用料」等の品目:
   - 借方科目: 支払手数料 (税区分: 課対仕入10%)
5. 貸方科目: 買掛金 (補助科目: 相手先会社名)`,
  },
  {
    name: '💳 EC・カード利用明細・精算書',
    icon: '💳',
    desc: '特定サイト（Amazon、モノタロウ等）や立替精算書用',
    prompt: `【資料形式: EC購入明細 / クレジットカード利用明細 / 社員立替精算書】
1. 購入品目や摘要から適切な勘定科目（消耗品費、事務用品費、新聞図書費、旅費交通費等）を判定してください。
2. 借方補助科目に店舗名・購入先（例: Amazon, モノタロウ 等）を設定してください。
3. 貸方科目: 未払金 (補助科目: カード会社名または精算先)
4. 1枚の中に軽減税率8%（食品・飲料等）と10%が混在する場合は、必ず税率ごとに仕訳を分割してください。`,
  },
  {
    name: '📝 完全自由設定（シンプル）',
    icon: '📝',
    desc: '独自の指示をゼロから自由に指定',
    prompt: `【この資料の特殊仕訳ルール】
・借方勘定科目には、取引内容に応じて適切な科目を設定してください。
・貸方勘定科目には、原則として「○○」を設定してください。
・補助科目には、○○を記載してください。
・摘要には「○○」を含めてください。`,
  },
]

export default function CustomModeModal({
  isOpen,
  onClose,
  companyId,
  companyName,
  modes,
  onModesUpdated,
  onSelectMode,
  initialEditMode,
}: CustomModeModalProps) {
  const [editingMode, setEditingMode] = useState<CustomModeItem | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)

  // フォーム状態
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('📋')
  const [customPrompt, setCustomPrompt] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialEditMode) {
      setEditingMode(initialEditMode)
      setIsCreatingNew(false)
      setName(initialEditMode.name)
      setDescription(initialEditMode.description || '')
      setIcon(initialEditMode.icon || '📋')
      setCustomPrompt(initialEditMode.customPrompt)
    } else if (isOpen && modes.length === 0) {
      setIsCreatingNew(true)
      setEditingMode(null)
      setName('')
      setDescription('')
      setIcon('📋')
      setCustomPrompt(TEMPLATES[0].prompt)
    }
  }, [initialEditMode, isOpen, modes.length])

  if (!isOpen) return null

  const handleStartNew = () => {
    setEditingMode(null)
    setIsCreatingNew(true)
    setName('')
    setDescription('')
    setIcon('📋')
    setCustomPrompt(TEMPLATES[0].prompt)
    setError(null)
  }

  const handleStartEdit = (mode: CustomModeItem) => {
    setEditingMode(mode)
    setIsCreatingNew(false)
    setName(mode.name)
    setDescription(mode.description || '')
    setIcon(mode.icon || '📋')
    setCustomPrompt(mode.customPrompt)
    setError(null)
  }

  const handleApplyTemplate = (tmpl: typeof TEMPLATES[number]) => {
    if (!name) setName(tmpl.name.replace(/^[^\s]+\s*/, ''))
    if (!description) setDescription(tmpl.desc)
    setIcon(tmpl.icon)
    setCustomPrompt(tmpl.prompt)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('モード名を入力してください。')
      return
    }
    if (!customPrompt.trim()) {
      setError('プロンプト（仕訳指示文）を入力してください。')
      return
    }

    setIsSubmitting(true)
    setError(null)

    const res = await saveCompanyCustomMode({
      id: editingMode?.id,
      companyId,
      name: name.trim(),
      description: description.trim(),
      icon: icon.trim() || '📋',
      customPrompt: customPrompt.trim(),
    })

    setIsSubmitting(false)

    if (res.success && res.data) {
      onModesUpdated()
      if (onSelectMode) {
        onSelectMode(res.data.id)
      }
      setIsCreatingNew(false)
      setEditingMode(null)
    } else {
      setError(res.error || '保存に失敗しました。')
    }
  }

  const handleDelete = async (id: string, modeName: string) => {
    if (!confirm(`カスタムモード「${modeName}」を削除しますか？`)) return
    const res = await deleteCompanyCustomMode(id, companyId)
    if (res.success) {
      onModesUpdated()
      if (editingMode?.id === id) {
        setEditingMode(null)
        setIsCreatingNew(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* ヘッダー */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
              ⚡
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                会社専用アップロードモード設定
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                対象会社: <span className="font-bold text-slate-800">{companyName}</span>（所属メンバー全員で共有されます）
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold p-1 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* ボディ */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium">
              {error}
            </div>
          )}

          {/* 新規作成・編集フォーム */}
          {isCreatingNew || editingMode ? (
            <form onSubmit={handleSave} className="space-y-4 bg-slate-50 p-4 rounded-xl border border-indigo-100">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-indigo-900 flex items-center gap-1.5">
                  <span>{editingMode ? '✏️ モードの編集' : '✨ 新しい専用モードを作成'}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNew(false)
                    setEditingMode(null)
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 font-medium"
                >
                  キャンセル
                </button>
              </div>

              {/* テンプレート例文選択 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-600 block">
                  💡 テンプレート例文から選んで入力（クリックすると雛形がセットされます）:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TEMPLATES.map((tmpl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyTemplate(tmpl)}
                      className="text-left p-2 rounded-lg border border-slate-200 bg-white hover:border-indigo-400 hover:bg-indigo-50/40 text-xs transition-all cursor-pointer"
                    >
                      <div className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span>{tmpl.icon}</span>
                        <span>{tmpl.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">{tmpl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">アイコン</label>
                  <input
                    type="text"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    className="w-full text-center px-2 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    placeholder="📋"
                  />
                </div>
                <div className="sm:col-span-6">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    モード名 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例: POSレジ日計表モード"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-xs font-bold text-slate-700 mb-1">説明 (任意)</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="例: 日計表から売上と手数料を分割"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  AI専用プロンプト（仕訳作成の指示文） <span className="text-rose-500">*</span>
                </label>
                <p className="text-[11px] text-slate-500 mb-1.5 leading-relaxed">
                  資料内のどの数値を、どの勘定科目・補助科目・税区分として仕訳に変換してほしいかを具体的に指示してください。
                </p>
                <textarea
                  required
                  rows={8}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="ここにAIへの仕訳作成指示を記入してください..."
                  className="w-full p-3 font-mono text-xs border border-slate-300 rounded-lg bg-white focus:border-indigo-500 focus:outline-none leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNew(false)
                    setEditingMode(null)
                  }}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim() || !customPrompt.trim()}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isSubmitting ? '保存中...' : editingMode ? '変更を保存' : '専用モードを作成'}
                </button>
              </div>
            </form>
          ) : (
            /* 作成ボタン */
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  登録済みの専用モード ({modes.length}件)
                </h4>
                <p className="text-xs text-slate-500">
                  この会社で使える独自の資料アップロードモード一覧です。
                </p>
              </div>
              <button
                onClick={handleStartNew}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer"
              >
                <span>➕ 新しい専用モードを追加</span>
              </button>
            </div>
          )}

          {/* 登録済みモード一覧カード */}
          <div className="space-y-3">
            {modes.map((mode) => (
              <div
                key={mode.id}
                className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{mode.icon || '📋'}</span>
                    <h5 className="text-sm font-bold text-slate-900 truncate">{mode.name}</h5>
                    {mode.description && (
                      <span className="text-[11px] text-slate-500 font-medium truncate">
                        — {mode.description}
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 text-[11px] font-mono text-slate-600 line-clamp-3 whitespace-pre-wrap">
                    {mode.customPrompt}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0">
                  {onSelectMode && (
                    <button
                      onClick={() => {
                        onSelectMode(mode.id)
                        onClose()
                      }}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      このモードを選択
                    </button>
                  )}
                  <button
                    onClick={() => handleStartEdit(mode)}
                    className="px-2.5 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(mode.id, mode.name)}
                    className="px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}

            {modes.length === 0 && !isCreatingNew && (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl space-y-2">
                <span className="text-3xl block">📋</span>
                <p className="text-xs font-bold text-slate-700">
                  専用アップロードモードはまだ登録されていません
                </p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  「新しい専用モードを追加」を押して、この会社独自の帳票や明細書に合わせた仕訳ルールを登録できます。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
