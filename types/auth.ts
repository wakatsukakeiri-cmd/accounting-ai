export type CompanyRole = 'owner' | 'admin' | 'member'

export interface CompanyItem {
  id: string
  name: string
  role: CompanyRole
  created_at?: string
}

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}

export interface CompanyMemberItem {
  id: string
  companyId: string
  userId: string
  email: string
  displayName: string | null
  role: CompanyRole
  createdAt: string
}

export interface CompanyInvitationItem {
  id: string
  companyId: string
  email: string
  role: CompanyRole
  tokenHash?: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
}
