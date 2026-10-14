import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'

import { parseFreightWorkbookBuffer, type ParsedFreightWorkbook } from '@/shared/freight/workbook-parser'

const require = createRequire(import.meta.url)
const { parseFreightWorkbook } = require('../../../dist-electron/electron/freight/rate-pack.cjs') as {
  parseFreightWorkbook(filePath: string, options?: Record<string, unknown>): Promise<ParsedFreightWorkbook>
}
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function testWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  const chinaPost = workbook.addWorksheet('中国邮政挂号小包')
  chinaPost.getRow(10).values = ['美国', 'United States', 'US', 30, 0, 28, 0, 26, 0, '']
  chinaPost.getRow(11).values = ['英国', 'United Kingdom', 'GB', null, 10, 28, 11, 26, 12, '']
  const ePacket = workbook.addWorksheet('e邮宝')
  ePacket.getRow(9).values = ['United States', 'US', '美国', 50, 55, 0]
  ePacket.getCell('D9').value = { formula: '25*2', result: 50 }
  ePacket.getCell('E9').value = { formula: '50+5', result: 55 }
  ePacket.getCell('F9').value = { formula: '0', result: 0 }
  ePacket.getRow(10).values = ['United Kingdom', 'GB', '英国', 50, 55, 12]
  ePacket.getCell('E10').value = { formula: '10+20' }
  ePacket.getRow(11).values = ['France', 'FR', '法国', -1, 55, 12]
  ePacket.getRow(12).values = ['Canada', 'CA', '加拿大', 50, -1, 12]
  ePacket.getRow(13).values = ['Germany', 'DE', '德国', 50, 55, true]
  const yanwen = workbook.addWorksheet('燕文航空挂号小包')
  yanwen.getRow(8).values = [null, '美国', 'United States', 'US', 29, 0, 27, 0, 25, 0]
  yanwen.getRow(9).values = [null, '英国', 'United Kingdom', 'GB', 29, 9, 27, 10, 25, 11]
  yanwen.getCell('E9').value = { error: '#N/A' }
  const ups = workbook.addWorksheet('UPS')
  ups.getRow(9).values = ['United States', '美国', 'US', ...Array.from({ length: 20 }, () => 80), ...[50, 48, 46, 44, 42, 40, 38]]
  ups.getRow(10).values = ['United Kingdom', '英国', 'GB', ...Array.from({ length: 27 }, () => 50)]
  ups.getCell('AD10').value = -1
  return workbook
}

async function saveTemporaryWorkbook(workbook: ExcelJS.Workbook): Promise<{ filePath: string; buffer: ArrayBuffer }> {
  const directory = await mkdtemp(join(tmpdir(), 'kst-freight-parser-'))
  temporaryRoots.push(directory)
  const filePath = join(directory, 'rates.xlsx')
  const content = Buffer.from(await workbook.xlsx.writeBuffer())
  await writeFile(filePath, content)
  return { filePath, buffer: Uint8Array.from(content).buffer }
}

function comparable(parsed: ParsedFreightWorkbook) {
  const { createdAt: _createdAt, ...pack } = parsed.pack
  return { ...parsed, pack }
}

describe('freight workbook browser and desktop parity', () => {
  it('accepts cached values and zero fixed fees, rejects malformed rows and reports the same locations', async () => {
    const { filePath, buffer } = await saveTemporaryWorkbook(testWorkbook())
    const browser = await parseFreightWorkbookBuffer(buffer, 'rates.xlsx')
    const desktop = await parseFreightWorkbook(filePath)

    expect(comparable(browser)).toEqual(comparable(desktop))
    expect(browser.summary).toEqual({ carrierCount: 4, countryCount: 1, ruleCount: 4 })
    expect(browser.pack.rules.find(rule => rule.carrierId === 'epacket')).toMatchObject({
      minBillableWeightG: 50, perKgCny: 55, fixedFeeCny: 0,
    })
    expect(browser.warnings).toHaveLength(7)
    for (const cell of ['D11', 'E10', 'D11', 'E12', 'F13', 'E9', 'AD10']) {
      expect(browser.warnings.some(warning => warning.includes(cell))).toBe(true)
    }
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '', true])('rejects invalid explicit exchange rate %s on both runtimes', async exchangeRate => {
    const { filePath, buffer } = await saveTemporaryWorkbook(testWorkbook())
    await expect(parseFreightWorkbookBuffer(buffer, 'rates.xlsx', {
      exchangeRateCnyPerUsd: exchangeRate as number,
    })).rejects.toThrow('人民币兑美元汇率无效')
    await expect(parseFreightWorkbook(filePath, {
      exchangeRateCnyPerUsd: exchangeRate,
    })).rejects.toThrow('人民币兑美元汇率无效')
  })

  it('normalizes the actual bundled workbook equally on both runtimes without changing source data', async () => {
    const filePath = resolve('resources/rates/FreightTemplate_v2.xlsx')
    const source = await readFile(filePath)
    const browser = await parseFreightWorkbookBuffer(Uint8Array.from(source).buffer, 'FreightTemplate_v2.xlsx')
    const desktop = await parseFreightWorkbook(filePath)

    expect(comparable(browser)).toEqual(comparable(desktop))
    expect(browser.summary.carrierCount).toBe(4)
    expect(browser.summary.ruleCount).toBeGreaterThan(100)
    expect(await readFile(filePath)).toEqual(source)
  })
})
