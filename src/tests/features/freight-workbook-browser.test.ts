import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { quoteFreight } from '@/shared/freight/rate-engine'
import {
  parseChinaPostSheet, parseEPacketSheet, parseFreightWorkbookBuffer, parseUpsSheet, parseYanwenSheet,
} from '@/shared/freight/workbook-parser'

function ePacketWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('e邮宝').getRow(9).values = ['United States', 'US', '美国', 50, 55, 12]
  return workbook
}

describe('browser freight workbook parser', () => {
  it('normalizes the bundled workbook in memory and quotes without Electron', async () => {
    const workbook = new ExcelJS.Workbook()
    const chinaPost = workbook.addWorksheet('中国邮政挂号小包')
    chinaPost.getRow(10).values = ['美国', 'United States', 'US', 30, 10, 28, 11, 26, 12, '']
    const ePacket = workbook.addWorksheet('e邮宝')
    ePacket.getRow(9).values = ['United States', 'US', '美国', 50, 55, 12]
    const yanwen = workbook.addWorksheet('燕文航空挂号小包')
    yanwen.getRow(8).values = [null, '美国', 'United States', 'US', 29, 9, 27, 10, 25, 11]
    const ups = workbook.addWorksheet('UPS')
    ups.getRow(9).values = ['United States', '美国', 'US', ...Array.from({ length: 20 }, (_, index) => 80 + index), ...[50, 48, 46, 44, 42, 40, 38]]
    const buffer = await workbook.xlsx.writeBuffer()
    const parsed = await parseFreightWorkbookBuffer(buffer, 'FreightTemplate_v2.xlsx', {
      id: 'competition-freight', version: '1.0.0', exchangeRateCnyPerUsd: 7,
    })

    expect(parsed.summary.carrierCount).toBe(4)
    expect(parsed.summary.countryCount).toBe(1)
    expect(parsed.summary.ruleCount).toBe(4)
    expect(parsed.pack.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(quoteFreight(parsed.pack, {
      country: 'US', actualWeightKg: 0.5, dimensionsCm: { length: 20, width: 15, height: 8 },
    }).selected).not.toBeNull()
  }, 30_000)

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty text', ''],
    ['whitespace', '   '],
    ['formula without a cached result', { formula: '10+20' }],
    ['Excel error', { error: '#N/A' }],
    ['formula error', { formula: '1/0', result: { error: '#DIV/0!' } }],
    ['boolean true', true],
    ['boolean false', false],
    ['formula with a boolean result', { formula: '1=1', result: true }],
    ['negative fee', -1],
    ['nonfinite fee', Number.POSITIVE_INFINITY],
  ] as const)('rejects %s instead of importing a free ePacket rate', (_label, value) => {
    const worksheet = ePacketWorkbook().getWorksheet('e邮宝')!
    worksheet.getCell('E9').value = value as ExcelJS.CellValue
    const warnings: string[] = []

    expect(parseEPacketSheet(worksheet, warnings)).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('e邮宝')
    expect(warnings[0]).toContain('第 9 行')
    expect(warnings[0]).toContain('E9')
  })

  it.each(['D9', 'E9', 'F9'])('rejects a negative weight or fee at %s', address => {
    const worksheet = ePacketWorkbook().getWorksheet('e邮宝')!
    worksheet.getCell(address).value = -1
    const warnings: string[] = []
    expect(parseEPacketSheet(worksheet, warnings)).toEqual([])
    expect(warnings[0]).toContain(address)
  })

  it('uses cached numeric formulas and keeps an explicit zero fixed fee after an xlsx round trip', async () => {
    const workbook = ePacketWorkbook()
    const worksheet = workbook.getWorksheet('e邮宝')!
    worksheet.getCell('D9').value = { formula: '25*2', result: 50 }
    worksheet.getCell('E9').value = { formula: '50+5', result: 55 }
    worksheet.getCell('F9').value = { formula: '0', result: 0 }
    const parsed = await parseFreightWorkbookBuffer(await workbook.xlsx.writeBuffer(), 'cached.xlsx')

    expect(parsed.pack.rules).toHaveLength(1)
    expect(parsed.pack.rules[0]).toMatchObject({ minBillableWeightG: 50, perKgCny: 55, fixedFeeCny: 0 })
    expect(parsed.warnings.every(warning => !warning.includes('第 9 行'))).toBe(true)
  })

  it.each([0, '0', { formula: '0', result: 0 }, { sharedFormula: 'F8', result: 0 }] as const)('keeps a present zero fixed fee (%j)', value => {
    const worksheet = ePacketWorkbook().getWorksheet('e邮宝')!
    worksheet.getCell('F9').value = value
    expect(parseEPacketSheet(worksheet)[0]?.fixedFeeCny).toBe(0)
  })

  it('rejects partial tiered and UPS rows and identifies the missing cells', () => {
    const workbook = new ExcelJS.Workbook()
    const chinaPost = workbook.addWorksheet('中国邮政挂号小包')
    chinaPost.getRow(10).values = ['美国', 'United States', 'US', 30, 0, 28, 0, 26, 0, '']
    chinaPost.getCell('D10').value = null
    const yanwen = workbook.addWorksheet('燕文航空挂号小包')
    yanwen.getRow(8).values = [null, '美国', 'United States', 'US', 29, 0, 27, 0, 25, 0]
    yanwen.getCell('H8').value = ' '
    const ups = workbook.addWorksheet('UPS')
    ups.getRow(9).values = ['United States', '美国', 'US', ...Array.from({ length: 27 }, () => 50)]
    ups.getCell('AD9').value = { formula: '1/0', result: { error: '#DIV/0!' } }
    const warnings: string[] = []

    expect(parseChinaPostSheet(chinaPost, warnings)).toEqual([])
    expect(parseYanwenSheet(yanwen, warnings)).toEqual([])
    expect(parseUpsSheet(ups, warnings)).toEqual([])
    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toContain('D10')
    expect(warnings[1]).toContain('H8')
    expect(warnings[2]).toContain('AD9')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects explicit invalid exchange rate %s', async exchangeRate => {
    await expect(parseFreightWorkbookBuffer(await ePacketWorkbook().xlsx.writeBuffer(), 'rates.xlsx', {
      exchangeRateCnyPerUsd: exchangeRate,
    })).rejects.toThrow('人民币兑美元汇率无效')
  })
})
