import { createHash } from 'node:crypto'
import type { LocalContextExchange } from './local-context-capture.cjs'
import { targetError } from './contracts.cjs'

/** Visually verified source bytes, not a filename, hostname or course number. */
export const VERIFIED_V2_LOGO_SHA256 = '2bda28b75f3246b6a700fdadb8ba9ed076416a1fdb2ceb94fb9cd690091f0cd3'
export const LOCAL_CONTEXT_MAX_AGE_MS = 10 * 60_000
const ref = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const numeric = (value: unknown): value is string => typeof value === 'string' && /^\d{1,18}$/.test(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Created only by the owned main-process login-response observer. A filled
 * login field alone must never create this evidence. No raw account is stored. */
export interface LocalLoginEvidence {
  origin: string
  siteEpoch: number
  loginType: string
  accountRef: string
  authenticatedAt: number
}

/** Safe to attach to an internal snapshot. It is not a renderer assertion or a
 * server who-am-I token, and must be discarded with its owning site epoch. */
export interface VerifiedLocalContext {
  schemaVersion: 1
  origin: string
  siteEpoch: number
  courseRef: string
  shopRef: string
  companyRef: string
  userRef: string
  localAccountRef: string
  proofHash: string
  verifiedAt: number
  evidence: readonly ['verified-login-response', 'verified-map-identity-chain', 'verified-v2-logo']
}

export interface LocalContextValidation {
  map: LocalContextExchange
  identity: LocalContextExchange
  identityField: { value: string; readonly: boolean }
  logoHash: string
  origin: string
  siteEpoch: number
  loginEvidence?: LocalLoginEvidence
}

export function localLoginAccountRef(origin: string, loginType: string, accountValue: string): string {
  if (!numeric(loginType) || !numeric(accountValue)) throw targetError('TARGET_IDENTITY_INVALID', '本次登录账号格式未取得验收证据。')
  return ref([origin, 'login-account', loginType, accountValue])
}

function proofFields(proof: Omit<VerifiedLocalContext, 'proofHash'> | VerifiedLocalContext): Omit<VerifiedLocalContext, 'proofHash'> {
  return { schemaVersion: 1, origin: proof.origin, siteEpoch: proof.siteEpoch, courseRef: proof.courseRef, shopRef: proof.shopRef,
    companyRef: proof.companyRef, userRef: proof.userRef, localAccountRef: proof.localAccountRef, verifiedAt: proof.verifiedAt,
    evidence: ['verified-login-response', 'verified-map-identity-chain', 'verified-v2-logo'] }
}

/** The personal-profile endpoint is parameterised by userId. Consequently its
 * success is insufficient without the successful-login observer AND map link.
 * Raw numbers below remain stack-local and are never returned or logged. */
export function validateLocalContext(input: LocalContextValidation, now = Date.now()): VerifiedLocalContext {
  const { map, identity, identityField, loginEvidence: login, origin, siteEpoch } = input
  let parsed: URL
  try { parsed = new URL(origin) } catch { throw targetError('TARGET_IDENTITY_INVALID', '现场来源无效。') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || !Number.isSafeInteger(siteEpoch) || siteEpoch < 1 || !Number.isFinite(now)) throw targetError('TARGET_IDENTITY_INVALID', '现场来源或会话范围无效。')
  if (!login || login.origin !== origin || login.siteEpoch !== siteEpoch || !numeric(login.loginType) || !hash(login.accountRef)
    || !Number.isFinite(login.authenticatedAt) || login.authenticatedAt > now) throw targetError('TARGET_LOGIN_EVIDENCE_REQUIRED', '尚未取得本次受控窗口的成功登录证据，请重新登录后进入所选课程。')
  if (input.logoHash !== VERIFIED_V2_LOGO_SHA256) throw targetError('TARGET_VERSION_UNVERIFIED', '当前平台版本图像与已验收证据不一致。')
  if (map.origin !== origin || identity.origin !== origin || map.path !== '/ECrossAmazonHome/GetPage' || identity.path !== '/ECrossCommon/GetPersonalProfileInformation'
    || map.httpStatus !== 200 || identity.httpStatus !== 200 || map.code !== 0 || identity.code !== 0) throw targetError('TARGET_IDENTITY_RESPONSE_INVALID', '课程或账号响应未通过同来源及业务结果核验。')
  const { A1001: courseId, B3001: companyId, B3101: shopId, A0902: userId } = map.record
  const { LoginName: loginName, StudentNo: studentNo } = identity.record
  if (!numeric(courseId) || !numeric(companyId) || !numeric(shopId) || !numeric(userId) || !numeric(loginName) || !numeric(studentNo)
    || map.request.courseId !== courseId || identity.request.userId !== userId || identity.request.loginType !== login.loginType
    || !identityField.readonly || identityField.value !== loginName || studentNo !== loginName
    || localLoginAccountRef(origin, login.loginType, loginName) !== login.accountRef) throw targetError('TARGET_IDENTITY_MISMATCH', '登录账号、个人设置和所选课程没有对应到同一身份，已阻止执行。')
  const fields = proofFields({ schemaVersion: 1, origin, siteEpoch, courseRef: ref([origin, 'course', courseId]), shopRef: ref([origin, courseId, 'shop', shopId]),
    companyRef: ref([origin, courseId, 'company', companyId]), userRef: ref([origin, 'user', userId]),
    localAccountRef: ref([origin, 'account', login.loginType, userId, loginName]), verifiedAt: now,
    evidence: ['verified-login-response', 'verified-map-identity-chain', 'verified-v2-logo'] })
  return Object.freeze({ ...fields, evidence: Object.freeze(fields.evidence), proofHash: ref(fields) })
}

export interface VerifiedPageContext {
  origin: string
  siteEpoch?: number
  courseId?: string
  companyId?: string
  shopId?: string
  userId?: string
}

/** Match the next page's context to the independently captured map/account,
 * without treating page-specific fingerprints as account identity. */
export function assertVerifiedPageContext(proof: VerifiedLocalContext, page: VerifiedPageContext, now = Date.now()): void {
  if (proof.schemaVersion !== 1 || ![proof.courseRef, proof.shopRef, proof.companyRef, proof.userRef, proof.localAccountRef].every(hash)
    || proof.proofHash !== ref(proofFields(proof)) || proof.origin !== page.origin || (page.siteEpoch !== undefined && proof.siteEpoch !== page.siteEpoch)
    || !Number.isFinite(proof.verifiedAt) || proof.verifiedAt > now || now - proof.verifiedAt >= LOCAL_CONTEXT_MAX_AGE_MS) throw targetError('TARGET_IDENTITY_EXPIRED', '本机身份绑定已失效，请在原账号和课程重新识别。')
  if (!numeric(page.courseId) || !numeric(page.companyId) || !numeric(page.shopId)
    || proof.courseRef !== ref([page.origin, 'course', page.courseId])
    || proof.companyRef !== ref([page.origin, page.courseId, 'company', page.companyId])
    || proof.shopRef !== ref([page.origin, page.courseId, 'shop', page.shopId])
    || (page.userId !== undefined && (!numeric(page.userId) || proof.userRef !== ref([page.origin, 'user', page.userId])))) throw targetError('TARGET_CONTEXT_CHANGED', '当前页面已不是刚刚核验的课程、公司、店铺或账号。')
}
