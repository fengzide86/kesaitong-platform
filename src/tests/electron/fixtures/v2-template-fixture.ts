import type { BrowserSnapshot, TemplateCreateInput, TemplateExchange } from '../../../../electron/automation/targets/contracts.cjs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type * as ContextModule from '../../../../electron/automation/targets/verified-context.cjs'

const contextRequire = createRequire(import.meta.url)
const { validateLocalContext, localLoginAccountRef, VERIFIED_V2_LOGO_SHA256 } = contextRequire(resolve('dist-electron/electron/automation/targets/verified-context.cjs')) as typeof ContextModule
export function makeVerifiedFixture(accountValue = '880001', userId = '404') {
  const origin = 'https://fixture.invalid'
  return validateLocalContext({ origin, siteEpoch: 1, logoHash: VERIFIED_V2_LOGO_SHA256,
    loginEvidence: { origin, siteEpoch: 1, loginType: '24', accountRef: localLoginAccountRef(origin, '24', accountValue), authenticatedAt: Date.now() - 1000 },
    map: { origin, path: '/ECrossAmazonHome/GetPage', httpStatus: 200, code: 0, request: { courseId: '101' }, record: { A1001: '101', B3001: '303', B3101: '202', A0902: userId } },
    identity: { origin, path: '/ECrossCommon/GetPersonalProfileInformation', httpStatus: 200, code: 0, request: { userId, loginType: '24' }, record: { LoginName: accountValue, StudentNo: accountValue } },
    identityField: { value: accountValue, readonly: true },
  })
}

// Synthetic values using the documented 2026-10-04 nested response schema.
// This fixture is not a capture and is not proof of platform UAT or UI selectors.
export const templateInput: TemplateCreateInput = {
  name: 'KST-local-fixture', currency: 'USD', pricingMode: 'weight-item',
  rules: [{ countries: ['fixture-country'], serviceCode: '20001', transitTime: '7-14', perOrder: '1.23', unitRate: '0.45', unit: 'item' }],
}
export const templateSnapshot: BrowserSnapshot = {
  origin: 'https://fixture.invalid', path: '/ECrossAmazon/SellerShippingTemplateSetting',
  v2Marker: true, v3Marker: false, amazonMarker: true, amazonRoute: true, loginVisible: false, templateDom: true, courseDom: false,
  context: { courseId: '101', shopId: '202', companyId: '303', roleCode: '2' },
  verifiedContext: makeVerifiedFixture(),
  controls: ['#div_10001', '#div_20001'],
}
const result = JSON.stringify({ Code: 0, Msg: '保存成功！', RedirectUrl: '/fixture?secret=not-returned', Token: 'fixture-sensitive-never-return' })
export function listExchange(hasCreated = false): TemplateExchange {
  return { method: 'POST', origin: templateSnapshot.origin, path: '/ECrossAmazon/GetTemplateList', httpStatus: 200, requestFields: { courseId: '101', shopId: '202' }, body: { result, jsonStr: JSON.stringify([{ DS0701: 1, DS0705: 'existing-fixture', DS0707: 1 }, ...(hasCreated ? [{ DS0701: 2, DS0705: templateInput.name, DS0707: 0 }] : [])]) } }
}
export function saveExchange(): TemplateExchange {
  return { method: 'POST', origin: templateSnapshot.origin, path: '/ECrossAmazon/SaveTemplate', httpStatus: 200, requestFields: { courseId: '101', shopId: '202', ds0701: '0', templateName: templateInput.name }, body: { result } }
}
export function detailExchange(): TemplateExchange {
  return { method: 'POST', origin: templateSnapshot.origin, path: '/ECrossAmazon/GetFeightRelationList', httpStatus: 200, requestFields: { courseId: '101', shopId: '202', ds0701: '2' }, body: {
    result,
    jsonStr1: JSON.stringify([{ DS0701: 2, DS0705: templateInput.name, DS0708: 0 }]),
    jsonStr2: JSON.stringify([{ DS0801: 20, DS0805: 20001, DS0810: 'fixture-country', DS0813: '7-14', DS0814: 1.23, DS0815: 0.45, DS0816: 1 }]),
    jsonStr3: '[]',
  } }
}
