'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import type { CompanyMemberItem, CompanyInvitationItem, CompanyRole } from '@/types/auth'
import {
  fetchCompanyMembers,
  fetchCompanyInvitations,
  createCompanyInvitation,
  cancelCompanyInvitation,
  updateMemberRole,
  removeCompanyMember,
} from '@/lib/db/member'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export default function CompanyMembersModal({ isOpen, onClose }: Props) {
  const { currentCompany, user } = useAuth()

  const [activeTab, setActiveTab] = useState<'members' | 'invite'>('members')
  const [members, setMembers] = useState<CompanyMemberItem[]>([])
  const [invitations, setInvitations] = useState<CompanyInvitationItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // 招待フォーム
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false)
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isOwner = currentCompany?.role === 'owner'
  const isAdmin = currentCompany?.role === 'admin'
  const canManageMembers = isOwner || isAdmin

  const loadData = useCallback(async () => {
    if (!currentCompany) return
    setIsLoading(true)
    setErrorMsg(null)
    try {
      const [mList, iList] = await Promise.all([
        fetchCompanyMembers(currentCompany.id),
        fetchCompanyInvitations(currentCompany.id),
      ])
      setMembers(mList)
      setInvitations(iList)
    } catch (err: any) {
      setErrorMsg('データの読み込みに失敗しました。')
    } finally {
      setIsLoading(false)
    }
  }, [currentCompany])

  useEffect(() => {
    if (isOpen && currentCompany) {
      loadData()
      setCreatedInviteUrl(null)
      setInviteEmail('')
      setErrorMsg(null)
      setSuccessMsg(null)
    }
  }, [isOpen, currentCompany, loadData])

  if (!isOpen || !currentCompany) return null

  // 招待リンク発行
  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return

    setIsSubmittingInvite(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    const res = await createCompanyInvitation(
      currentCompany.id,
      inviteEmail.trim(),
      inviteRole
    )

    setIsSubmittingInvite(false)

    if (res.success && res.rawToken) {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const inviteUrl = `${origin}/invite?token=${res.rawToken}`
      setCreatedInviteUrl(inviteUrl)
      setSuccessMsg(`「${inviteEmail}」宛ての招待リンクを発行しました。`)
      setInviteEmail('')
      // 招待一覧更新
      const iList = await fetchCompanyInvitations(currentCompany.id)
      setInvitations(iList)
    } else {
      setErrorMsg(res.error || '招待の作成に失敗しました。')
    }
  }

  // 招待URLコピー
  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 招待取り消し
  const handleCancelInvite = async (invitationId: string) => {
    if (!confirm('この招待を取り消しますか？')) return
    setErrorMsg(null)
    const res = await cancelCompanyInvitation(invitationId)
    if (res.success) {
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId))
      setSuccessMsg('招待を取り消しました。')
    } else {
      setErrorMsg(res.error || '招待の取り消しに失敗しました。')
    }
  }

  // ロール変更
  const handleRoleChange = async (memberId: string, newRole: CompanyRole) => {
    setErrorMsg(null)
    const res = await updateMemberRole(memberId, newRole)
    if (res.success) {
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      )
      setSuccessMsg('権限を更新しました。')
    } else {
      setErrorMsg(res.error || '権限の更新に失敗しました。')
    }
  }

  // メンバー除名
  const handleRemoveMember = async (memberId: string, memberEmail: string) => {
    if (!confirm(`「${memberEmail}」を会社から除名しますか？`)) return
    setErrorMsg(null)
    const res = await removeCompanyMember(memberId)
    if (res.success) {
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
      setSuccessMsg('メンバーを除名しました。')
    } else {
      setErrorMsg(res.error || 'メンバーの除名に失敗しました。')
    }
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            オーナー (Owner)
          </span>
        )
      case 'admin':
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-800 border border-blue-200">
            管理者 (Admin)
          </span>
        )
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            一般 (Member)
          </span>
        )
    }
  }

  // 保留中の招待リスト
  const pendingInvitations = invitations.filter((i) => !i.acceptedAt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[88vh] flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">👥</span>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                メンバー管理 - {currentCompany.name}
              </h3>
              <p className="text-xs text-slate-500">
                あなたの権限: {getRoleBadge(currentCompany.role)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 font-bold text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* タブ切り替え */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => {
              setActiveTab('members')
              setErrorMsg(null)
              setSuccessMsg(null)
            }}
            className={`pb-2 px-4 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'members'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            参加メンバー ({members.length}名)
          </button>
          {canManageMembers && (
            <button
              onClick={() => {
                setActiveTab('invite')
                setErrorMsg(null)
                setSuccessMsg(null)
              }}
              className={`pb-2 px-4 text-xs font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'invite'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>➕ メンバーを招待</span>
              {pendingInvitations.length > 0 && (
                <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[10px] rounded-full font-bold">
                  {pendingInvitations.length}件招待中
                </span>
              )}
            </button>
          )}
        </div>

        {/* 通知メッセージ */}
        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
            {successMsg}
          </div>
        )}

        {/* メインコンテンツ */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-slate-400">
              データを読み込み中...
            </div>
          ) : activeTab === 'members' ? (
            /* メンバー一覧タブ */
            <div className="space-y-2.5">
              {members.map((member) => {
                const isCurrentUser = member.userId === user?.id
                const isTargetOwner = member.role === 'owner'
                const canModify =
                  isOwner && !isCurrentUser && !isTargetOwner

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">
                        {(member.displayName || member.email).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            {member.displayName || '(名前未設定)'}
                          </span>
                          {isCurrentUser && (
                            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                              あなた
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {member.email}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {canModify ? (
                        <select
                          value={member.role}
                          onChange={(e) =>
                            handleRoleChange(member.id, e.target.value as CompanyRole)
                          }
                          className="text-xs font-semibold px-2 py-1 border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                        >
                          <option value="admin">管理者 (Admin)</option>
                          <option value="member">一般 (Member)</option>
                        </select>
                      ) : (
                        getRoleBadge(member.role)
                      )}

                      {canModify && (
                        <button
                          onClick={() =>
                            handleRemoveMember(member.id, member.email)
                          }
                          className="text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded transition-colors cursor-pointer"
                          title="会社から除名"
                        >
                          除名
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* 招待タブ */
            <div className="space-y-5">
              {/* 招待発行フォーム */}
              <form
                onSubmit={handleCreateInvite}
                className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/40 space-y-3"
              >
                <div className="font-bold text-xs text-indigo-900">
                  メールアドレスを指定して招待リンクを発行
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="md:col-span-2">
                    <input
                      type="email"
                      required
                      placeholder="招待する相手のメールアドレス"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <select
                      value={inviteRole}
                      onChange={(e) =>
                        setInviteRole(e.target.value as 'admin' | 'member')
                      }
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {isOwner && <option value="admin">管理者 (Admin)</option>}
                      <option value="member">一般 (Member)</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmittingInvite || !inviteEmail.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    {isSubmittingInvite ? '発行中...' : '招待リンクを発行'}
                  </button>
                </div>
              </form>

              {/* 発行直後の招待リンク表示 */}
              {createdInviteUrl && (
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900">
                      🔗 発行された招待リンク
                    </span>
                    <span className="text-[10px] text-emerald-700">有効期限: 7日間</span>
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    以下のURLを招待したい相手に共有してください。相手がこのURLからログイン・登録すると会社に参加できます。
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={createdInviteUrl}
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-emerald-300 rounded-lg font-mono text-slate-700 select-all"
                    />
                    <button
                      onClick={() => handleCopyUrl(createdInviteUrl)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors"
                    >
                      {copied ? 'コピー完了！' : 'コピー'}
                    </button>
                  </div>
                </div>
              )}

              {/* 招待中一覧 */}
              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-bold text-slate-700">
                  招待中・承認待ち ({pendingInvitations.length} 件)
                </h4>

                {pendingInvitations.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50 font-medium">
                    現在、承認待ちの招待はありません。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingInvitations.map((inv) => {
                      const isExpired = new Date(inv.expiresAt).getTime() < Date.now()

                      return (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold font-mono text-slate-800">
                                {inv.email}
                              </span>
                              {getRoleBadge(inv.role)}
                              {isExpired ? (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 font-bold">
                                  期限切れ
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">
                                  承認待ち
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              発行日: {new Date(inv.createdAt).toLocaleDateString('ja-JP')} /
                              有効期限: {new Date(inv.expiresAt).toLocaleDateString('ja-JP')}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCancelInvite(inv.id)}
                              className="text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded transition-colors cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="pt-2 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
