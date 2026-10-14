// Executed by the packaged Electron in Node mode, never by the host Node.
// All imports are absolute ASAR paths, so host node_modules cannot hide gaps.
const path = require('node:path')

async function main() {
  if (!process.versions.electron) throw new Error('Spreadsheet package smoke requires packaged Electron')
  const archive = process.argv[2]
  if (!archive || !path.isAbsolute(archive) || !archive.endsWith('app.asar')) throw new Error('An absolute packaged ASAR is required')
  const ExcelJS = require(path.join(archive, 'node_modules/exceljs/excel.js'))
  const source = new ExcelJS.Workbook()
  const sheet = source.addWorksheet('中文 运费')
  sheet.addRow(['SKU', '单价', '数量', '金额'])
  sheet.addRow(['中文 SKU-1', 12.5, 2, { formula: 'B2*C2', result: 25 }])
  sheet.getCell('B2').numFmt = '0.00'
  const bytes = await source.xlsx.writeBuffer()
  const restored = new ExcelJS.Workbook()
  await restored.xlsx.load(bytes)
  const readback = restored.getWorksheet('中文 运费')
  if (readback.getCell('A2').value !== '中文 SKU-1' || readback.getCell('B2').value !== 12.5
    || readback.getCell('D2').value.result !== 25 || readback.getCell('B2').numFmt !== '0.00') {
    throw new Error('Packaged spreadsheet readback did not match written values')
  }
  console.log('packaged_spreadsheet_roundtrip=verified')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
