'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { CompanyItem, UserProfile } from '@/types/auth'

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  companies: CompanyItem[]
  currentCompany: CompanyItem | null
  isLoading: boolean
  setCurrentCompanyId: (id: string) => void
  createCompany: (name: string) => Promise<{ success: boolean; companyId?: string; error?: string }>
  refreshCompanies: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const CURRENT_COMPANY_STORAGE_KEY = 'accounting_ai_current_company_id'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [companies, setCompanies] = useState<CompanyItem[]>([])
  const [currentCompanyId, setCurrentCompanyIdState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // 会社一覧の取得
  const fetchCompanies = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('company_members')
        .select(`
          company_id,
          role,
          companies:company_id (
            id,
            name
          )
        `)
        .eq('user_id', userId)

      if (error) {
        console.error('Failed to fetch companies:', error)
        return []
      }

      const formatted: CompanyItem[] = (data || [])
        .map((item: any) => {
          const comp = item.companies
          if (!comp) return null
          return {
            id: item.company_id,
            name: comp.name,
            role: item.role,
          }
        })
        .filter((item): item is CompanyItem => item !== null)

      setCompanies(formatted)
      return formatted
    } catch (err) {
      console.error('Error fetching companies:', err)
      return []
    }
  }, [supabase])

  // プロフィール情報の取得
  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, display_name, avatar_url')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Failed to fetch profile:', error)
        return null
      }
      setProfile(data)
      return data
    } catch (err) {
      console.error('Error fetching profile:', err)
      return null
    }
  }, [supabase])

  // 認証状態の監視
  useEffect(() => {
    let mounted = true

    const initAuth = async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        if (!mounted) return

        setUser(currentUser)

        if (currentUser) {
          await fetchProfile(currentUser.id)
          const fetchedCompanies = await fetchCompanies(currentUser.id)

          // 保存された会社IDを復元、なければ最初の会社を選択
          const savedCompanyId = typeof window !== 'undefined' ? localStorage.getItem(CURRENT_COMPANY_STORAGE_KEY) : null
          const exists = fetchedCompanies.find(c => c.id === savedCompanyId)

          if (exists) {
            setCurrentCompanyIdState(exists.id)
          } else if (fetchedCompanies.length > 0) {
            setCurrentCompanyIdState(fetchedCompanies[0].id)
            if (typeof window !== 'undefined') {
              localStorage.setItem(CURRENT_COMPANY_STORAGE_KEY, fetchedCompanies[0].id)
            }
          }
        } else {
          setProfile(null)
          setCompanies([])
          setCurrentCompanyIdState(null)
        }
      } catch (err) {
        console.error('Error initializing auth:', err)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)

      if (currentUser) {
        await fetchProfile(currentUser.id)
        const fetchedCompanies = await fetchCompanies(currentUser.id)

        const savedCompanyId = typeof window !== 'undefined' ? localStorage.getItem(CURRENT_COMPANY_STORAGE_KEY) : null
        const exists = fetchedCompanies.find(c => c.id === savedCompanyId)

        if (exists) {
          setCurrentCompanyIdState(exists.id)
        } else if (fetchedCompanies.length > 0) {
          setCurrentCompanyIdState(fetchedCompanies[0].id)
          if (typeof window !== 'undefined') {
            localStorage.setItem(CURRENT_COMPANY_STORAGE_KEY, fetchedCompanies[0].id)
          }
        }
      } else {
        setProfile(null)
        setCompanies([])
        setCurrentCompanyIdState(null)
        if (typeof window !== 'undefined') {
          localStorage.removeItem(CURRENT_COMPANY_STORAGE_KEY)
        }
      }
      setIsLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, fetchCompanies, fetchProfile])

  // 会社切り替え
  const setCurrentCompanyId = useCallback((id: string) => {
    setCurrentCompanyIdState(id)
    if (typeof window !== 'undefined') {
      localStorage.setItem(CURRENT_COMPANY_STORAGE_KEY, id)
    }
  }, [])

  // 新規会社作成（RPC経由）
  const createCompany = useCallback(async (name: string): Promise<{ success: boolean; companyId?: string; error?: string }> => {
    if (!name.trim()) {
      return { success: false, error: '会社名を入力してください。' }
    }

    try {
      const { data, error } = await supabase.rpc('create_company', {
        _name: name.trim(),
      })

      if (error) {
        return { success: false, error: error.message }
      }

      const newCompanyId = data as string
      if (user) {
        await fetchCompanies(user.id)
      }
      setCurrentCompanyId(newCompanyId)
      return { success: true, companyId: newCompanyId }
    } catch (err: any) {
      return { success: false, error: err?.message || '会社の作成中にエラーが発生しました。' }
    }
  }, [supabase, user, fetchCompanies, setCurrentCompanyId])

  // 会社一覧の再取得
  const refreshCompanies = useCallback(async () => {
    if (user) {
      await fetchCompanies(user.id)
    }
  }, [user, fetchCompanies])

  // ログアウト
  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setCompanies([])
    setCurrentCompanyIdState(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CURRENT_COMPANY_STORAGE_KEY)
    }
  }, [supabase])

  const currentCompany = companies.find(c => c.id === currentCompanyId) || (companies.length > 0 ? companies[0] : null)

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        companies,
        currentCompany,
        isLoading,
        setCurrentCompanyId,
        createCompany,
        refreshCompanies,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
