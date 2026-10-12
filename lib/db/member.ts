import { createClient } from '@/lib/supabase/client'
import type { CompanyMemberItem, CompanyInvitationItem, CompanyRole } from '@/types/auth'

/**
 * SHA-256 ハッシュ文字列を生成 (Web Crypto API)
 */
export async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  const hashArray = Array.from(new Uint8Array(hashBuf))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 安全なランダムトークンを生成 (32バイトのhex文字列)
 */
export function generateRandomToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 会社の所属メンバー一覧を取得
 */
export async function fetchCompanyMembers(companyId: string): Promise<CompanyMemberItem[]> {
  const supabase = createClient()

  // 1. メンバー一覧取得
  const { data: members, error: membersError } = await supabase
    .from('company_members')
    .select('id, company_id, user_id, role, created_at')
    .eq('company_id', companyId)

  if (membersError || !members) {
    console.error('Failed to fetch company members:', membersError)
    return []
  }

  const userIds = members.map((m) => m.user_id)
  if (userIds.length === 0) return []

  // 2. プロフィール情報を取得
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email, display_name')
    .in('id', userIds)

  if (profilesError) {
    console.error('Failed to fetch member profiles:', profilesError)
  }

  const profileMap = new Map<string, { email: string; displayName: string | null }>()
  if (profiles) {
    profiles.forEach((p) => {
      profileMap.set(p.id, {
        email: p.email,
        displayName: p.display_name,
      })
    })
  }

  return members.map((m) => {
    const p = profileMap.get(m.user_id)
    return {
      id: m.id,
      companyId: m.company_id,
      userId: m.user_id,
      email: p?.email || '(不明)',
      displayName: p?.displayName || null,
      role: m.role as CompanyRole,
      createdAt: m.created_at,
    }
  })
}

/**
 * 会社の招待中一覧を取得
 */
export async function fetchCompanyInvitations(companyId: string): Promise<CompanyInvitationItem[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('company_invitations')
    .select('id, company_id, email, role, expires_at, accepted_at, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('Failed to fetch invitations:', error)
    return []
  }

  return data.map((item) => ({
    id: item.id,
    companyId: item.company_id,
    email: item.email,
    role: item.role as CompanyRole,
    expiresAt: item.expires_at,
    acceptedAt: item.accepted_at,
    createdAt: item.created_at,
  }))
}

/**
 * 新しいメンバー招待を作成
 */
export async function createCompanyInvitation(
  companyId: string,
  email: string,
  role: 'admin' | 'member'
): Promise<{ success: boolean; rawToken?: string; error?: string }> {
  const supabase = createClient()

  try {
    const rawToken = generateRandomToken()
    const tokenHash = await sha256(rawToken)

    // 有効期限: 7日間
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: { user } } = await supabase.auth.getUser()

    const { error } = await supabase.from('company_invitations').insert({
      company_id: companyId,
      email: email.trim().toLowerCase(),
      role,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: user?.id,
    })

    if (error) {
      console.error('Failed to create invitation:', error)
      return { success: false, error: error.message }
    }

    return { success: true, rawToken }
  } catch (err: any) {
    console.error('Error creating invitation:', err)
    return { success: false, error: err.message || '招待の作成に失敗しました' }
  }
}

/**
 * 招待を取り消し (削除)
 */
export async function cancelCompanyInvitation(invitationId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()

  const { error } = await supabase
    .from('company_invitations')
    .delete()
    .eq('id', invitationId)

  if (error) {
    console.error('Failed to cancel invitation:', error)
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * メンバーのロールを変更
 */
export async function updateMemberRole(
  memberId: string,
  newRole: CompanyRole
): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()

  const { error } = await supabase
    .from('company_members')
    .update({ role: newRole })
    .eq('id', memberId)

  if (error) {
    console.error('Failed to update member role:', error)
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * メンバーを会社から除名
 */
export async function removeCompanyMember(memberId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createClient()

  const { error } = await supabase
    .from('company_members')
    .delete()
    .eq('id', memberId)

  if (error) {
    console.error('Failed to remove company member:', error)
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * 招待を受諾 (RPC経由)
 */
export async function acceptInvitation(
  rawToken: string
): Promise<{ success: boolean; companyId?: string; error?: string }> {
  const supabase = createClient()

  try {
    const { data, error } = await supabase.rpc('accept_invitation', {
      _raw_token: rawToken,
    })

    if (error) {
      console.error('Failed to accept invitation:', error)
      return { success: false, error: error.message }
    }

    return { success: true, companyId: data as string }
  } catch (err: any) {
    console.error('Error accepting invitation:', err)
    return { success: false, error: err.message || '招待の受諾に失敗しました' }
  }
}
