const crypto = require('crypto');
const fs = require('fs');
const ExcelJS = require('exceljs');

type UnknownRecord = Record<string, unknown>;

function numberValue(value: unknown): number | null {
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    // ExcelJS does not calculate formulas. Only a numeric cached result is usable.
    const result = (value as { result?: unknown }).result;
    return typeof result === 'number' || typeof result === 'string' ? numberValue(result) : null;
  }
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

function rateValues(worksheet: import('exceljs').Worksheet, rowNumber: number, columns: number[], warnings: string[]): number[] | null {
  const row = worksheet.getRow(rowNumber);
  const values = columns.map(column => {
    const cell = row.getCell(column);
    const value = cell.value;
    // ExcelJS's value getter omits a cached result of 0; cell.result preserves it.
    return numberValue(value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value) ? cell.result : value);
  });
  const invalidCells = columns.filter((_column, index) => values[index] === null || values[index]! < 0);
  if (invalidCells.length) {
    warnings.push(`工作表“${worksheet.name}”第 ${rowNumber} 行：${invalidCells.map(column => row.getCell(column).address).join('、')} 缺少有效非负数值（空白、无缓存公式、错误或负数），已跳过该费率行`);
    return null;
  }
  return values as number[];
}

function textValue(value: unknown): string {
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text || '').trim();
  return String(value ?? '').trim();
}

function rateRuleBase(carrierId: string, carrierName: string, serviceType: string, countryCode: string, countryName: string, countryNameEn: string, priority: number) {
  return { carrierId, carrierName, serviceType, countryCode, countryName, countryNameEn, priority };
}

function tier(maxWeightG: number, perKgCny: number, fixedFeeCny: number) {
  return { maxWeightG, perKgCny, fixedFeeCny };
}

function parseChinaPost(worksheet: import('exceljs').Worksheet | undefined, warnings: string[] = []): UnknownRecord[] {
  if (!worksheet) return [];
  const rules: UnknownRecord[] = [];
  for (let rowNumber = 10; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const countryName = textValue(row.getCell(1).value);
    const countryNameEn = textValue(row.getCell(2).value);
    const countryCode = textValue(row.getCell(3).value).toUpperCase();
    if (!countryName || !countryCode) continue;
    const values = rateValues(worksheet, rowNumber, [4, 5, 6, 7, 8, 9], warnings);
    if (!values) continue;
    const [firstRate, firstFixed, secondRate, secondFixed, thirdRate, thirdFixed] = values as [number, number, number, number, number, number];
    const tiers = [tier(150, firstRate, firstFixed), tier(300, secondRate, secondFixed), tier(2_000, thirdRate, thirdFixed)];
    rules.push({
      ...rateRuleBase('china-post-registered', '中国邮政挂号小包', 'tiered', countryCode, countryName, countryNameEn, 30),
      maxWeightKg: 2,
      suspended: /暂停/.test(textValue(row.getCell(10).value)),
      tiers,
      percentageSurcharge: 0.14,
      minimumSurchargeCny: 2,
    });
  }
  return rules;
}

function parseEPacket(worksheet: import('exceljs').Worksheet | undefined, warnings: string[] = []): UnknownRecord[] {
  if (!worksheet) return [];
  const rules: UnknownRecord[] = [];
  for (let rowNumber = 9; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const countryNameEn = textValue(row.getCell(1).value);
    const countryCode = textValue(row.getCell(2).value).toUpperCase();
    const countryName = textValue(row.getCell(3).value);
    if (!countryName || !countryCode) continue;
    const values = rateValues(worksheet, rowNumber, [4, 5, 6], warnings);
    if (!values) continue;
    const [minWeight, perKg, fixed] = values as [number, number, number];
    rules.push({
      ...rateRuleBase('epacket', 'e邮宝', 'epacket', countryCode, countryName, countryNameEn, 10),
      maxWeightKg: countryCode === 'IL' || /以色列/.test(countryName) ? 3 : 2,
      minBillableWeightG: minWeight,
      perKgCny: perKg,
      fixedFeeCny: fixed,
    });
  }
  return rules;
}

function parseYanwen(worksheet: import('exceljs').Worksheet | undefined, warnings: string[] = []): UnknownRecord[] {
  if (!worksheet) return [];
  const rules: UnknownRecord[] = [];
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const countryName = textValue(row.getCell(2).value);
    const countryNameEn = textValue(row.getCell(3).value);
    const countryCode = textValue(row.getCell(4).value).toUpperCase();
    if (!countryName || !countryCode) continue;
    const values = rateValues(worksheet, rowNumber, [5, 6, 7, 8, 9, 10], warnings);
    if (!values) continue;
    const [firstRate, firstFixed, secondRate, secondFixed, thirdRate, thirdFixed] = values as [number, number, number, number, number, number];
    const tiers = [tier(150, firstRate, firstFixed), tier(300, secondRate, secondFixed), tier(2_000, thirdRate, thirdFixed)];
    rules.push({ ...rateRuleBase('yanwen-air-registered', '燕文航空挂号小包', 'tiered', countryCode, countryName, countryNameEn, 20), maxWeightKg: 2, tiers });
  }
  return rules;
}

function parseUps(worksheet: import('exceljs').Worksheet | undefined, warnings: string[] = []): UnknownRecord[] {
  if (!worksheet) return [];
  const rules: UnknownRecord[] = [];
  const bandLimits = [44, 70, 99, 299, 499, 999, 9_999];
  for (let rowNumber = 9; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const countryNameEn = textValue(row.getCell(1).value);
    const countryName = textValue(row.getCell(2).value);
    const countryCode = textValue(row.getCell(3).value).toUpperCase();
    if (!countryName || !countryCode) continue;
    const values = rateValues(worksheet, rowNumber, Array.from({ length: 27 }, (_, index) => 4 + index), warnings);
    if (!values || values.length !== 27) continue;
    const fixedPricesCny = values.slice(0, 20);
    // All 27 cells were validated: the seven band indices are bounded by 20..26.
    const perKgBands = bandLimits.map((maxWeightKg, index) => ({ maxWeightKg, perKgCny: values[20 + index]! }));
    rules.push({
      ...rateRuleBase('ups-expedited', 'UPS 全球快捷', 'ups', countryCode, countryName, countryNameEn, 40),
      maxWeightKg: 9_999,
      volumetricDivisor: 5_000,
      fixedPricesCny,
      perKgBands,
      fuelSurchargeIncluded: false,
    });
  }
  return rules;
}

function findSheet(workbook: import('exceljs').Workbook, names: string[]) {
  return workbook.worksheets.find((sheet: import('exceljs').Worksheet) => names.some(name => sheet.name.toLowerCase().includes(name.toLowerCase())));
}

async function parseFreightWorkbook(filePath: string, options: UnknownRecord = {}) {
  const stat = fs.statSync(filePath);
  if (stat.size > 20 * 1024 * 1024) throw Object.assign(new Error('费率工作簿不能超过 20MB'), { code: 'FREIGHT_FILE_TOO_LARGE' });
  if (!/\.xlsx$/i.test(filePath)) throw Object.assign(new Error('费率中心仅支持 .xlsx 工作簿'), { code: 'FREIGHT_FILE_TYPE_INVALID' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheetMappings = options.sheetMappings && typeof options.sheetMappings === 'object' ? options.sheetMappings as UnknownRecord : {};
  const mappedSheet = (key: string, aliases: string[]) => {
    const explicit = textValue(sheetMappings[key]);
    return explicit ? workbook.getWorksheet(explicit) : findSheet(workbook, aliases);
  };
  const groups = [
    { key: 'china_post', label: '中国邮政挂号小包', sheet: mappedSheet('china_post', ['中国邮政挂号小包', 'china post']), parse: parseChinaPost },
    { key: 'epacket', label: 'e邮宝', sheet: mappedSheet('epacket', ['e邮宝', 'epacket']), parse: parseEPacket },
    { key: 'yanwen', label: '燕文航空挂号小包', sheet: mappedSheet('yanwen', ['燕文航空挂号小包', 'yanwen']), parse: parseYanwen },
    { key: 'ups', label: 'UPS 全球快捷', sheet: mappedSheet('ups', ['ups']), parse: parseUps },
  ];
  const warnings: string[] = [];
  const mappings = groups.map(group => {
    const rules = group.parse(group.sheet, warnings);
    if (!group.sheet) warnings.push(`未识别 ${group.label} 工作表`);
    else if (!rules.length) warnings.push(`${group.label} 工作表未识别到有效费率行`);
    return { carrierKey: group.key, carrierName: group.label, worksheetName: group.sheet?.name || null, confidence: group.sheet && rules.length ? 1 : 0, ruleCount: rules.length, rules };
  });
  const rules = mappings.flatMap(item => item.rules);
  const content = fs.readFileSync(filePath);
  const exchangeRate = numberValue(options.exchangeRateCnyPerUsd ?? 7);
  if (exchangeRate === null || exchangeRate <= 0) throw new Error('人民币兑美元汇率无效');
  const pack = {
    schemaVersion: 1,
    resourceType: 'freight-rate-pack',
    id: String(options.id || 'competition-freight'),
    version: String(options.version || '1.0.0'),
    name: String(options.name || '赛训物流首版费率包'),
    currency: 'CNY',
    exchangeRateCnyPerUsd: exchangeRate,
    sourceHash: crypto.createHash('sha256').update(content).digest('hex'),
    createdAt: new Date().toISOString(),
    rules,
    mappingWarnings: warnings,
  };
  return {
    pack,
    sourceFileName: require('path').basename(filePath),
    availableWorksheets: workbook.worksheets.map((sheet: import('exceljs').Worksheet) => sheet.name),
    mappings: mappings.map(({ rules: _rules, ...mapping }) => mapping),
    warnings,
    summary: { carrierCount: mappings.filter(item => item.ruleCount > 0).length, ruleCount: rules.length, countryCount: new Set(rules.map(rule => rule.countryCode)).size },
  };
}

module.exports = { parseFreightWorkbook, parseChinaPost, parseEPacket, parseYanwen, parseUps };
