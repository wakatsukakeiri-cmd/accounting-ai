'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import CompanyMembersModal from '@/components/CompanyMembersModal'

export default function CompanySwitcher() {
  const {
    user,
    profile,
    companies,
    currentCompany,
    setCurrentCompanyId,
    createCompany,
    signOut,
    isLoading,
  } = useAuth()

  const [isOpen, setIsOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // メニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ログイン済みだが会社が1つもない場合、初回作成モーダルを表示
  useEffect(() => {
    if (!isLoading && user && companies.length === 0) {
      setShowCreateModal(true)
    }
  }, [isLoading, user, companies])

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCompanyName.trim()) return

    setIsCreating(true)
    setCreateError(null)

    const res = await createCompany(newCompanyName)
    setIsCreating(false)

    if (res.success) {
      setNewCompanyName('')
      setShowCreateModal(false)
      setIsOpen(false)
    } else {
      setCreateError(res.error || '作成に失敗しました。')
    }
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-800">Owner</span>
      case 'admin':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-800">Admin</span>
      default:
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-gray-100 text-gray-700">Member</span>
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-8 w-24 bg-gray-200 animate-pulse rounded-lg"></div>
      </div>
    )
  }

  // 未ログイン時
  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-xs font-semibold rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
        >
          ログイン / 新規登録
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2.5 px-3 py-1.5 bg-white border border-gray-200 hover:border-gray-300 rounded-lg text-xs font-medium text-gray-800 shadow-xs transition-colors cursor-pointer"
        >
          <div className="w-5 h-5 rounded bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[11px]">
            {currentCompany ? currentCompany.name.slice(0, 1) : '企'}
          </div>
          <div className="flex flex-col text-left">
            <span className="font-semibold text-gray-900 truncate max-w-[140px]">
              {currentCompany ? currentCompany.name : '会社未選択'}
            </span>
          </div>
          {currentCompany && getRoleBadge(currentCompany.role)}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* ドロップダウンメニュー */}
        {isOpen && (
          <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100">
            {/* ユーザー情報ヘッダー */}
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/70">
              <div className="text-[11px] text-gray-500 font-medium">ログイン中</div>
              <div className="font-semibold text-gray-800 truncate">
                {profile?.display_name || user.email}
              </div>
              <div className="text-[10px] text-gray-400 truncate">{user.email}</div>
            </div>

            {/* 会社一覧 */}
            <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              所属会社
            </div>
            <div className="max-h-48 overflow-y-auto py-0.5">
              {companies.map((comp) => {
                const isSelected = currentCompany?.id === comp.id
                return (
                  <button
                    key={comp.id}
                    onClick={() => {
                      setCurrentCompanyId(comp.id)
                      setIsOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer ${
                      isSelected ? 'bg-indigo-50/60 font-semibold text-indigo-900' : 'text-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div className={`w-4 h-4 rounded text-[10px] flex items-center justify-center font-bold ${
                        isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {comp.name.slice(0, 1)}
                      </div>
                      <span className="truncate">{comp.name}</span>
                    </div>
                    {getRoleBadge(comp.role)}
                  </button>
                )
              })}

              {companies.length === 0 && (
                <div className="px-3 py-2 text-gray-400 text-center">所属会社がありません</div>
              )}
            </div>

            {/* 選択中会社のメンバー管理・招待ボタン */}
            {currentCompany && (
              <div className="p-1.5 border-t border-gray-100">
                <button
                  onClick={() => {
                    setIsOpen(false)
                    setShowMembersModal(true)
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 text-slate-700 hover:bg-slate-50 hover:text-indigo-600 rounded-lg font-medium transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">👥</span>
                    <span>メンバー管理・招待</span>
                  </div>
                  {currentCompany.role === 'owner' || currentCompany.role === 'admin' ? (
                    <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-bold">
                      管理可能
                    </span>
                  ) : null}
                </button>
              </div>
            )}

            {/* 新規会社作成ボタン */}
            <div className="p-1.5 border-t border-gray-100">
              <button
                onClick={() => {
                  setIsOpen(false)
                  setShowCreateModal(true)
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg font-medium transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                新しい会社を作成
              </button>
            </div>

            {/* ログアウト */}
            <div className="p-1.5 border-t border-gray-100">
              <button
                onClick={() => {
                  setIsOpen(false)
                  signOut()
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-red-600 hover:bg-red-50 rounded-lg font-medium transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                ログアウト
              </button>
            </div>
          </div>
        )}
      </div>

      {/* メンバー管理・招待モーダル */}
      <CompanyMembersModal
        isOpen={showMembersModal}
        onClose={() => setShowMembersModal(false)}
      />

      {/* 会社作成モーダル */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-1">新しい会社を作成</h3>
            <p className="text-xs text-gray-500 mb-4">
              会社を作成すると、あなたが「オーナー（Owner）」として登録されます。
            </p>

            {createError && (
              <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateCompany} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  会社名・事業者名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="例: 株式会社サンプル"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                {companies.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false)
                      setCreateError(null)
                    }}
                    className="flex-1 py-2 px-3 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    キャンセル
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isCreating || !newCompanyName.trim()}
                  className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isCreating ? '作成中...' : '会社を作成'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
