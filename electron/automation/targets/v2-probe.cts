import { createHash } from 'node:crypto'
import type { BrowserSnapshot, ProbeObservation, TargetBrowserPort } from './contracts.cjs'
import { assertVerifiedPageContext } from './verified-context.cjs'

const ref = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function classifyTargetSnapshot(snapshot: BrowserSnapshot): ProbeObservation {
  const shape = snapshot.templateDom || snapshot.courseDom
  let verified = snapshot.verifiedContext
  if (verified && !snapshot.loginVisible) {
    try { assertVerifiedPageContext(verified, { origin: snapshot.origin, ...snapshot.context }) }
    catch { verified = undefined }
  } else verified = undefined
  // The audited header is a CSS image in current deployments, so its text is
  // absent from body.innerText. Only a still-valid same-context proof can lend
  // the visually reviewed image's version; unknown images never do.
  const verifiedLogo = Boolean(verified?.evidence.includes('verified-v2-logo'))
  const v2 = snapshot.v2Marker || verifiedLogo
  const version = v2 !== snapshot.v3Marker ? (v2 ? 'v2' : 'v3') : null
  const branded = (snapshot.amazonMarker || verifiedLogo) && snapshot.amazonRoute
  const missing: string[] = []
  if (!version) missing.push(v2 && snapshot.v3Marker ? 'conflicting-version-markers' : 'explicit-platform-version-marker')
  if (!branded) missing.push('amazon-brand-and-route')
  if (!shape) missing.push('recognised-page-shape')
  if (!verified) missing.push('course-context', 'shop-context', 'account-identity-unverified')
  if (!snapshot.context.roleCode) missing.push('role-context')
  const context = snapshot.context
  const evidence = [
    ...(snapshot.v2Marker ? ['explicit-v2-marker'] : []),
    ...(snapshot.v3Marker ? ['explicit-v3-marker'] : []),
    ...(snapshot.amazonRoute ? ['amazon-route'] : []),
    ...(snapshot.templateDom ? ['template-controls-observed'] : []),
    ...(snapshot.templateDom && /\/SellerShippingTemplateSetting$/.test(snapshot.path) ? ['template-list-controls-observed'] : []),
    ...(snapshot.templateDom && /\/SellerShippingTemplateSettingAdd$/.test(snapshot.path) ? ['template-editor-controls-observed'] : []),
    ...(snapshot.courseDom ? ['course-navigation-observed'] : []),
    ...(verified ? ['verified-local-identity'] : []),
    ...(verifiedLogo ? ['verified-v2-logo'] : []),
  ]
  return {
    kind: snapshot.loginVisible ? 'login_required' : v2 && snapshot.v3Marker ? 'ambiguous' : branded && shape && version ? 'matched' : 'unknown',
    platformFamily: branded ? 'bjy-amazon' : null,
    version,
    origin: snapshot.origin,
    path: snapshot.path,
    courseRef: verified?.courseRef || null,
    shopRef: verified?.shopRef || null,
    role: context.roleCode || null,
    // Raw URL/account fields never establish identity. Only the main-process
    // successful-login + map + personal-profile chain may supply these refs.
    localAccountRef: verified?.localAccountRef || null,
    pageFingerprint: ref({ path: snapshot.path, version, templateDom: snapshot.templateDom, courseDom: snapshot.courseDom, controls: [...snapshot.controls].sort() }),
    evidence,
    missing,
  }
}

export async function probeContext(browser: TargetBrowserPort): Promise<ProbeObservation> {
  return classifyTargetSnapshot(await browser.inspect())
}
