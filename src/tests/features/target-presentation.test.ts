import { describe, expect, it } from 'vitest'
import { displayEntry, splitLines, targetError, missingEvidenceLabel, reviewedMarkerNames, requiresTargetProfile, supportsTargetWorkspace, stageLabels } from '@/features/targets/presentation'

describe('multi-target presentation boundaries', () => {
  it('shows only the entry origin and path', () => {
    expect(displayEntry('https://school.example/platform?paras=secret#token')).toBe('https://school.example/platform')
    expect(displayEntry('https://user:pass@school.example/')).toBe('无效入口')
    expect(displayEntry('javascript:alert(1)')).toBe('无效入口')
  })
  it('does not render host error URL queries or credentials', () => {
    expect(targetError(new Error('请重新登录 https://school.example/login?paras=secret token=private'))).toBe('请重新登录 https://school.example/login [认证内容已隐藏]')
  })
  it('explains the online backend rollout gap instead of suggesting a duplicate submission', () => {
    expect(targetError({ status: 404 })).toContain('云端尚未启用平台入口登记/审核服务')
    expect(targetError({ status: 403 })).toContain('没有平台入口审核权限')
    expect(targetError({ status: 401 })).toContain('刷新并重新登录')
  })
  it('removes blank and duplicate evidence lines without inventing markers', () => {
    expect(splitLines(' marker-a\n\nmarker-a\nmarker-b ')).toEqual(['marker-a', 'marker-b'])
  })
  it('maps observed probe evidence without adding inferred version or page evidence', () => {
    expect(reviewedMarkerNames(['explicit-v2-marker', 'template-controls-observed', 'course-navigation-observed', 'route-only'])).toEqual(['amazon-v2', 'seller-shipping-template', 'course-index'])
    expect(reviewedMarkerNames(['hostname-is-known'])).toEqual([])
    expect(reviewedMarkerNames(['verified-v2-logo', 'verified-local-identity'])).toEqual(['amazon-v2'])
  })
  it('identity evidence missing is not incorrectly reduced to a login problem', () => {
    expect(missingEvidenceLabel('account-identity-unverified')).toContain('仅重新登录不能证明已修复')
  })
  it('all target contract signals leave legacy execution and unsupported versions stay blocked', () => {
    expect(requiresTargetProfile({ requires_target_profile: true })).toBe(true)
    expect(requiresTargetProfile({ target_capability: 'future.v1' })).toBe(true)
    expect(requiresTargetProfile({ runner_api_version: 2 })).toBe(true)
    expect(supportsTargetWorkspace({ target_capability: 'template.create.v1', runner_api_version: 2 })).toBe(true)
    expect(supportsTargetWorkspace({ target_capability: 'template.create.v1', runner_api_version: 3 })).toBe(false)
    expect(supportsTargetWorkspace({ runner_api_version: 2 })).toBe(false)
    expect(requiresTargetProfile({ runner_api_version: 1 })).toBe(false)
  })
  it('history labels do not imply the competition stage was independently detected', () => {
    expect(stageLabels.formal).toBe('正式比赛（用户声明）')
    expect(stageLabels.practice).toBe('比赛练习（用户声明）')
  })
})
