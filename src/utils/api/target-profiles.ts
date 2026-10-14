import { api } from './index'
import { signedTargetProfileSchema, type SignedTargetProfile, type TargetProfile } from '@/shared/ipc/target-contract'

export interface TargetProfileSubmission {
  name: string
  entryUrl: string
  providerId?: string
  productKey?: string
  edition?: TargetProfile['edition']
  evidence?: { edition?: TargetProfile['edition']; pageFingerprint?: string | null; markers?: TargetProfile['evidence']['markers'] }
}

export interface TargetProfileApproval {
  revision: number
  reviewStatus: 'approved'
  edition: TargetProfile['edition']
  allowedRoutes: TargetProfile['allowedRoutes']
  capabilities: TargetProfile['capabilities']
  adapterVersion: string | null
  evidence: TargetProfile['evidence']
  executionScopes: NonNullable<TargetProfile['executionScopes']>
}

export interface TargetProfileStatusDecision {
  revision: number
  reviewStatus: 'rejected' | 'disabled'
}

export type TargetProfileReview = TargetProfileApproval | TargetProfileStatusDecision

export const listTargetProfiles = async (): Promise<SignedTargetProfile[]> =>
  signedTargetProfileSchema.array().parse(await api.get('/api/tools/target-profiles', {}, { cache: false }))

export const listTargetProfileReviews = async (): Promise<SignedTargetProfile[]> =>
  signedTargetProfileSchema.array().parse(await api.get('/api/tool-releases/target-profiles', {}, { cache: false }))

export async function submitTargetProfile(payload: TargetProfileSubmission): Promise<SignedTargetProfile> {
  const result = await api.post<{ success: boolean; data: SignedTargetProfile }>('/api/tools/target-profiles', payload, { retry: 'none' })
  return signedTargetProfileSchema.parse(result.data)
}

export async function reviewTargetProfile(id: string, payload: TargetProfileReview): Promise<SignedTargetProfile> {
  const result = await api.post<{ success: boolean; data: SignedTargetProfile }>(`/api/tool-releases/target-profiles/${encodeURIComponent(id)}/review`, payload, { retry: 'none' })
  return signedTargetProfileSchema.parse(result.data)
}
