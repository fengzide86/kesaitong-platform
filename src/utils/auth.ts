import { z } from 'zod'
import { toolboxVersionHeaders } from '@/shared/api/client-metadata'
import { getApiBase } from '@/shared/api/base'
import { clearAllCache } from '@/utils/cache'
import {
  authRoleSchema,
  authSessionSchema,
  authenticatedUserSchema,
  parseAuthSession,
  type AuthenticatedUser,
  type AuthRole,
  type AuthSession,
  isBackofficeRole,
  isSuperAdminRole,
} from '@/features/auth/model'
import { readSessionUser } from '@/features/auth/sessionUser'

const AUTH_KEY = 'toolbox_auth'
const ROLE_KEY = 'toolbox_role'
const USER_KEY = 'toolbox_user'
const PLATFORM_KEY = 'toolbox_current_platform'
const TOKEN_KEY = 'toolbox_token'

const refreshResponseSchema = z.object({
  token: z.string().optional(),
  data: z.object({ token: z.string().optional() }).passthrough().optional(),
}).passthrough()

class AuthService {
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null

  getAuth(): AuthSession | null {
    try {
      return parseAuthSession(sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY))
    } catch (error) {
      console.error('解析认证信息失败:', error)
      return null
    }
  }

  setAuth(auth: AuthSession): void {
    try {
      const parsed = authSessionSchema.parse(auth)
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(parsed))
      localStorage.removeItem(AUTH_KEY)
    } catch (error) {
      console.error('保存认证信息失败:', error)
    }
  }

  getRole(): AuthRole {
    const role = sessionStorage.getItem(ROLE_KEY) || localStorage.getItem(ROLE_KEY)
    const parsed = authRoleSchema.safeParse(role)
    return parsed.success ? parsed.data : 'user'
  }

  setRole(role: AuthRole): void {
    sessionStorage.setItem(ROLE_KEY, role)
    localStorage.removeItem(ROLE_KEY)
  }

  getUser(): AuthenticatedUser | null {
    try {
      return readSessionUser()
    } catch (error) {
      console.error('解析用户信息失败:', error)
      return null
    }
  }

  setUser(user: AuthenticatedUser): void {
    try {
      sessionStorage.setItem(USER_KEY, JSON.stringify(authenticatedUserSchema.parse(user)))
      localStorage.removeItem(USER_KEY)
      window.dispatchEvent(new CustomEvent('toolbox:user-updated'))
    } catch (error) {
      console.error('保存用户信息失败:', error)
    }
  }

  isAuthenticated(): boolean {
    const auth = this.getAuth()
    if (!auth) return false

    if (auth.expires_at) {
      const expiresAt = new Date(auth.expires_at).getTime()
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
        this.clear()
        return false
      }
    }

    return Boolean(sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY))
  }

  isAdmin(): boolean {
    return this.isSuperAdmin()
  }

  isSuperAdmin(): boolean {
    return isSuperAdminRole(this.getRole())
  }

  isBackoffice(): boolean {
    return isBackofficeRole(this.getRole())
  }

  login(auth: AuthSession, role: AuthRole, user: AuthenticatedUser): void {
    this.setAuth(auth)
    this.setRole(role)
    this.setUser(user)
    this.startTokenRefresh()
  }

  logout(): void {
    this.clear()
    this.stopTokenRefresh()
  }

  clear(): void {
    clearAllCache()
    sessionStorage.removeItem('toolbox_support_handoff_v1')
    sessionStorage.removeItem('toolbox_purchase_inquiry')
    localStorage.removeItem('toolbox_support_context')
    sessionStorage.removeItem(AUTH_KEY)
    sessionStorage.removeItem(ROLE_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    localStorage.removeItem(AUTH_KEY)
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(PLATFORM_KEY)
    localStorage.removeItem(TOKEN_KEY)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toolbox:auth-cleared'))
    }
  }

  startTokenRefresh(): void {
    this.stopTokenRefresh()
    this.tokenRefreshTimer = setInterval(() => {
      void this.refreshToken()
    }, 30 * 60 * 1000)
  }

  stopTokenRefresh(): void {
    if (!this.tokenRefreshTimer) return
    clearInterval(this.tokenRefreshTimer)
    this.tokenRefreshTimer = null
  }

  async refreshToken(): Promise<void> {
    const auth = this.getAuth()
    if (!auth?.refresh_token) return

    try {
      const response = await fetch(`${getApiBase()}/api/auth/refresh`, {
        method: 'POST',
        headers: toolboxVersionHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ refresh_token: auth.refresh_token }),
      })

      if (!response.ok) {
        this.logout()
        return
      }

      const parsed = refreshResponseSchema.safeParse(await response.json())
      const token = parsed.success ? parsed.data.data?.token || parsed.data.token : undefined
      if (!token) return
      sessionStorage.setItem(TOKEN_KEY, token)
      this.setAuth({ ...auth, token })
    } catch (error) {
      console.error('刷新 token 失败:', error)
    }
  }

  getCurrentPlatform(): string {
    return localStorage.getItem(PLATFORM_KEY) || 'amazon'
  }

  setCurrentPlatform(platform: string): void {
    localStorage.setItem(PLATFORM_KEY, platform)
  }
}

export const authService = new AuthService()

// 保留旧的命名导出协议，并用包装函数确保不会丢失实例 this。
export const getAuth = (): AuthSession | null => authService.getAuth()
export const setAuth = (auth: AuthSession): void => authService.setAuth(auth)
export const getRole = (): AuthRole => authService.getRole()
export const setRole = (role: AuthRole): void => authService.setRole(role)
export const getUser = (): AuthenticatedUser | null => authService.getUser()
export const setUser = (user: AuthenticatedUser): void => authService.setUser(user)
export const isAuthenticated = (): boolean => authService.isAuthenticated()
export const isAdmin = (): boolean => authService.isAdmin()
export const isSuperAdmin = (): boolean => authService.isSuperAdmin()
export const isBackoffice = (): boolean => authService.isBackoffice()
export const login = (auth: AuthSession, role: AuthRole, user: AuthenticatedUser): void => authService.login(auth, role, user)
export const logout = (): void => authService.logout()
export const clear = (): void => authService.clear()
export const getCurrentPlatform = (): string => authService.getCurrentPlatform()
export const setCurrentPlatform = (platform: string): void => authService.setCurrentPlatform(platform)
