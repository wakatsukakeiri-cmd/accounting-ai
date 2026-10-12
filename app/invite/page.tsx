'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { acceptInvitation } from '@/lib/db/member'

function InviteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const { user, isLoading, refreshCompanies, setCurrentCompanyId } = useAuth()

  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // エラーメッセージのローカライズ
  const formatErrorMessage = (err: string) => {
    if (err.includes('Email is not confirmed')) {
      return 'メールアドレスの確認が完了していません。確認メールのリンクをクリックしてから再度お試しください。'
    }
    if (err.includes('Invitation email mismatch')) {
      return `招待されたメールアドレスと、現在ログイン中のアカウント（${user?.email}）が一致しません。正しいアカウントでログインし直してください。`
    }
    if (
      err.includes('Invalid, expired, or already accepted invitation token') ||
      err.includes('invalid')
    ) {
      return 'この招待リンクは無効か、有効期限（7日間）が切れているか、または既に使用されています。'
    }
    if (err.includes('Authentication required')) {
      return '招待を承諾するにはログインが必要です。'
    }
    return `エラーが発生しました: ${err}`
  }

  const handleAccept = async () => {
    if (!token) return

    setIsProcessing(true)
    setErrorMsg(null)

    const res = await acceptInvitation(token)

    if (res.success && res.companyId) {
      setSuccessMsg('会社への参加が完了しました！ダッシュボードへ移動します...')
      await refreshCompanies()
      setCurrentCompanyId(res.companyId)

      setTimeout(() => {
        router.push('/')
      }, 1500)
    } else {
      setIsProcessing(false)
      setErrorMsg(formatErrorMessage(res.error || '招待の承諾に失敗しました。'))
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-xs">アカウント情報を確認中...</p>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-xl text-center space-y-4">
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center text-xl mx-auto">
          ⚠️
        </div>
        <h2 className="text-base font-bold text-slate-900">招待トークンが見つかりません</h2>
        <p className="text-xs text-slate-500">
          招待URLが正しくないか、トークンパラメータが含まれていません。招待者に確認してください。
        </p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
        >
          トップページへ戻る
        </Link>
      </div>
    )
  }

  // 未ログイン時
  if (!user) {
    const loginRedirectUrl = `/login?redirect=${encodeURIComponent(`/invite?token=${token}`)}`

    return (
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-xl space-y-5 text-center">
        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-2xl mx-auto">
          ✉️
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900">会社への招待が届いています</h2>
          <p className="text-xs text-slate-500">
            招待を受諾して会社に参加するには、ログインまたはアカウント新規登録が必要です。
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-2">
          <Link
            href={loginRedirectUrl}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors text-center"
          >
            ログイン / 新規登録して参加する
          </Link>
          <Link
            href="/"
            className="w-full py-2 px-4 text-slate-500 hover:text-slate-700 text-xs text-center"
          >
            キャンセル
          </Link>
        </div>
      </div>
    )
  }

  // ログイン済み時
  return (
    <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-xl space-y-5 text-center">
      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-2xl mx-auto">
        🏢
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-bold text-slate-900">会社への参加手続き</h2>
        <p className="text-xs text-slate-500">
          招待を承諾すると、この会社の仕訳データや解析履歴を共有して作業できます。
        </p>
      </div>

      {/* ログインユーザー表示 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left space-y-1">
        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          現在ログイン中のアカウント
        </div>
        <div className="text-xs font-mono font-bold text-slate-800 truncate">
          {user.email}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs text-left leading-relaxed">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs text-center font-bold">
          {successMsg}
        </div>
      )}

      {!successMsg && (
        <div className="pt-2 flex flex-col gap-2">
          <button
            onClick={handleAccept}
            disabled={isProcessing}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
          >
            {isProcessing ? '参加手続き中...' : '招待を承諾して会社に参加する'}
          </button>
          <Link
            href="/"
            className="w-full py-2 px-4 text-slate-500 hover:text-slate-700 text-xs text-center"
          >
            後で
          </Link>
        </div>
      )}
    </div>
  )
}

export default function InvitePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50/30 flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="text-center text-xs text-slate-500">読み込み中...</div>
        }
      >
        <InviteContent />
      </Suspense>
    </div>
  )
}
