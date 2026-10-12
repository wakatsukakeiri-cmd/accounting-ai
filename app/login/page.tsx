'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectUrl = searchParams.get('redirect') || '/'

  const { user, isLoading } = useAuth()
  const supabase = createClient()

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // すでにログインしている場合はリダイレクト
  useEffect(() => {
    if (!isLoading && user) {
      router.push(redirectUrl)
    }
  }, [user, isLoading, router, redirectUrl])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)
    setIsSubmitting(true)

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) {
          setErrorMsg(
            error.message === 'Invalid login credentials'
              ? 'メールアドレスまたはパスワードが正しくありません。'
              : error.message
          )
          setIsSubmitting(false)
          return
        }
        router.push(redirectUrl)
      } else {
        // 新規登録
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim() || undefined,
            },
          },
        })
        if (error) {
          setErrorMsg(error.message)
          setIsSubmitting(false)
          return
        }

        if (data.session) {
          // 即時ログインされた場合
          router.push(redirectUrl)
        } else {
          // メール認証確認待ちの場合
          setSuccessMsg(
            '確認メールを送信しました。記載されたリンクをクリックしてメール認証を完了してからログインしてください。'
          )
          setIsSubmitting(false)
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'エラーが発生しました。もう一度お試しください。')
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gray-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            AI
          </div>
          <span className="text-2xl font-bold text-gray-900 tracking-tight">Accounting AI</span>
        </Link>
        <h2 className="text-center text-sm text-gray-600">
          複数会社対応の領収書・通帳 自動仕訳システム
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm border border-gray-200 rounded-xl sm:px-10">
          {/* タブ切り替え */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('signin')
                setErrorMsg(null)
                setSuccessMsg(null)
              }}
              className={`flex-1 pb-3 text-center text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                mode === 'signin'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              ログイン
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup')
                setErrorMsg(null)
                setSuccessMsg(null)
              }}
              className={`flex-1 pb-3 text-center text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                mode === 'signup'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              新規アカウント登録
            </button>
          </div>

          {/* メッセージ表示 */}
          {errorMsg && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg leading-relaxed">
              {successMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  お名前（任意）
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="山田 太郎"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                メールアドレス <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@company.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                パスワード <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6文字以上のパスワード"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                  処理中...
                </span>
              ) : mode === 'signin' ? (
                'ログイン'
              ) : (
                'アカウントを作成'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/" className="text-xs text-gray-500 hover:text-gray-700 underline">
              トップページに戻る
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
