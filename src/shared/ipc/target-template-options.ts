/** Current V2 form observations. This catalog is data only, not executable
 * selectors or proof that an arbitrary deployment supports these choices. */
export const V2_MAINLAND_REGION = 'Alabama, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, Florida, Georgia, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland, Massachusetts, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Jersey, New Mexico, New York, North Carolina, North Dakota, Ohio, Oklahoma, Oregon, Pennsylvania, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming, District of Columbia'
export const V2_ISLAND_REGION = 'Alaska, Hawaii, Puerto Rico'
export const V2_TEMPLATE_SERVICE_OPTIONS = [
  { value: '10001', label: '国内标准配送' }, { value: '10002', label: '国内加急配送' },
  { value: '10003', label: '国内两日达' }, { value: '10004', label: '国内一日达' },
  { value: '20001', label: '国际标准配送' }, { value: '20002', label: '国际加急配送' },
] as const
export type V2TemplateServiceCode = typeof V2_TEMPLATE_SERVICE_OPTIONS[number]['value']
export const V2_TEMPLATE_FIXED_TRANSIT: Readonly<Partial<Record<V2TemplateServiceCode, string>>> = Object.freeze({ '10001': '14 - 28', '10003': '2', '10004': '1', '20001': '10 - 20' })
export const V2_TEMPLATE_SELECTABLE_TRANSIT = ['1 - 2', '1 - 3', '2 - 2', '3 - 5'] as const
/** The platform's observed value 2 - 2 deliberately displays 2 - 4 days. */
export function v2TransitLabel(value: string): string { return `${value === '2 - 2' ? '2 - 4' : value} 天` }
export const V2_MAINLAND_COUNTRIES: readonly string[] = Object.freeze(V2_MAINLAND_REGION.split(', '))
export const V2_ISLAND_COUNTRIES: readonly string[] = Object.freeze(V2_ISLAND_REGION.split(', '))
