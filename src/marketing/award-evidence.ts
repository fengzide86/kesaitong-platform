import competitionCertificate from '@/assets/website/competition-award-2025-redacted.jpg'
import competitionThumbnail from '@/assets/website/competition-award-2025-thumb.webp'
import qualificationCertificate from '@/assets/website/team-qualification-redacted.jpg'

export type CertificateEvidence = { id: 'competition-award' | 'qualification'; title: string; src: string; thumbnail?: { src: string; width: number; height: number }; alt: string; caption: string }

// User-provided documents with personal information permanently removed from
// the public files, not recreated certificates or official partnership claims.
export const competitionAwardEvidence: CertificateEvidence = {
  id: 'competition-award',
  title: '2025 年第六届全国数字贸易技能大赛 · 跨境电商赛全国总决赛一等奖',
  src: competitionCertificate,
  thumbnail: { src: competitionThumbnail, width: 640, height: 905 },
  alt: '2025 年第六届全国数字贸易技能大赛跨境电商赛全国总决赛一等奖证书，个人信息已隐去',
  caption: '用户提供，个人信息已隐去。',
}

export const teamQualificationEvidence: CertificateEvidence = {
  id: 'qualification',
  title: '跨境电子商务师（中级）职业能力证书',
  src: qualificationCertificate,
  alt: '跨境电子商务师（中级）职业能力证书，个人信息已隐去',
  caption: '用户提供，个人信息已隐去。',
}
