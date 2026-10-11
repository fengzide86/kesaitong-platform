const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

type UnknownRecord = Record<string, unknown>;

interface AdapterManifest extends UnknownRecord {
  scriptKey?: string;
  version?: string;
  artifactSha256?: string;
  artifactUrl?: string | null;
}

interface AdapterGrant extends UnknownRecord {
  toolManifest?: AdapterManifest;
}

interface AdapterTool extends UnknownRecord {
  executionMode?: 'demo' | 'live';
  launchGrant?: AdapterGrant;
}

const MAX_ARTIFACT_BYTES = 512 * 1024;
// The V2 hostname comes from the observed platform audit. Do not allow the
// vendor's entire domain tree or real seller portals; URL/port guards remain
// enforced independently by the Runner.
const ALLOWED_HOSTS = new Set(['idtrade.cn', 'www.bjysoft.cn', 'localhost', '127.0.0.1']);
const ALLOWED_ACTIONS = new Set(['fill', 'select', 'click', 'check', 'upload', 'waitFor', 'assertText', 'calculate']);
const ALLOWED_SELECTORS = new Set(['css', 'id', 'name', 'testId', 'label', 'placeholder', 'text', 'role']);
const ALLOWED_INPUT_TYPES = new Set(['text', 'number', 'file', 'select']);
const SENSITIVE_KEY = /(password|passwd|secret|token|cookie|authorization|credential|session)/i;

function adapterError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : {};
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw adapterError('ADAPTER_SCHEMA_INVALID', `适配器字段无效：${field}`);
  }
  return value;
}

function optionalText(value: unknown, field: string, maxLength = 500): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) throw adapterError('ADAPTER_SCHEMA_INVALID', `适配器字段无效：${field}`);
  return value;
}

function limitedBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function limitedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw adapterError('ADAPTER_SCHEMA_INVALID', '适配器数值字段超出允许范围');
  return parsed;
}

function normalizeSelector(value: unknown): UnknownRecord {
  const selector = asRecord(value);
  const strategy = requiredText(selector.strategy, 'selector.strategy', 30);
  if (!ALLOWED_SELECTORS.has(strategy)) throw adapterError('ADAPTER_SELECTOR_BLOCKED', `不允许的定位方式：${strategy}`);
  return {
    strategy,
    value: requiredText(selector.value, 'selector.value', 500),
    ...(optionalText(selector.name, 'selector.name', 200) !== undefined ? { name: optionalText(selector.name, 'selector.name', 200) } : {}),
  };
}

function normalizeAction(value: unknown, knownInputs: Set<string>): UnknownRecord {
  const action = asRecord(value);
  const kind = requiredText(action.kind, 'action.kind', 30);
  if (!ALLOWED_ACTIONS.has(kind)) throw adapterError('ADAPTER_ACTION_BLOCKED', `不允许的适配器动作：${kind}`);
  const selectors = Array.isArray(action.selectors) ? action.selectors : [];
  if (kind !== 'calculate' && (!selectors.length || selectors.length > 12)) throw adapterError('ADAPTER_SCHEMA_INVALID', '每个页面动作必须包含 1-12 个定位条件');
  if (kind === 'calculate' && action.formula !== 'replenishment') throw adapterError('ADAPTER_CALCULATION_BLOCKED', '远程适配器引用了不允许的计算规则');
  const calculationOutputKey = kind === 'calculate' ? requiredText(action.outputKey, 'action.outputKey', 100) : undefined;
  if (calculationOutputKey && (!knownInputs.has(calculationOutputKey) || SENSITIVE_KEY.test(calculationOutputKey))) {
    throw adapterError('ADAPTER_INPUT_BLOCKED', `计算结果引用了不允许的输入：${calculationOutputKey}`);
  }
  const inputKey = optionalText(action.inputKey, 'action.inputKey', 100);
  if (inputKey && (!knownInputs.has(inputKey) || SENSITIVE_KEY.test(inputKey))) {
    throw adapterError('ADAPTER_INPUT_BLOCKED', `适配器引用了不允许的输入：${inputKey}`);
  }
  const literal = action.value;
  if (literal !== undefined && !['string', 'number', 'boolean'].includes(typeof literal)) {
    throw adapterError('ADAPTER_SCHEMA_INVALID', '动作固定值必须是字符串、数字或布尔值');
  }
  if (typeof literal === 'string' && literal.length > 500) throw adapterError('ADAPTER_SCHEMA_INVALID', '动作固定值过长');
  return {
    id: requiredText(action.id, 'action.id', 100),
    kind,
    title: requiredText(action.title, 'action.title', 200),
    selectors: selectors.map(normalizeSelector),
    ...(inputKey ? { inputKey } : {}),
    ...(literal !== undefined ? { value: literal } : {}),
    ...(limitedBoolean(action.required) !== undefined ? { required: limitedBoolean(action.required) } : {}),
    ...(limitedBoolean(action.optional) !== undefined ? { optional: limitedBoolean(action.optional) } : {}),
    ...(limitedBoolean(action.idempotent) !== undefined ? { idempotent: limitedBoolean(action.idempotent) } : {}),
    ...(limitedInteger(action.timeoutMs, 500, 30000) !== undefined ? { timeoutMs: limitedInteger(action.timeoutMs, 500, 30000) } : {}),
    ...(limitedInteger(action.retries, 1, 4) !== undefined ? { retries: limitedInteger(action.retries, 1, 4) } : {}),
    ...(kind === 'calculate' ? {
      formula: 'replenishment',
      outputKey: calculationOutputKey,
    } : {}),
  };
}

function validateDeclarativeAdapter(value: unknown, manifest: AdapterManifest): UnknownRecord {
  const adapter = asRecord(value);
  const key = requiredText(adapter.key, 'key', 200);
  const version = requiredText(adapter.version, 'version', 50);
  if (key !== manifest.scriptKey || version !== manifest.version) {
    throw adapterError('ADAPTER_MANIFEST_MISMATCH', '适配器内容与签名清单不匹配');
  }
  if (adapter.mode !== 'workflow' || adapter.sandbox === true) {
    throw adapterError('ADAPTER_MODE_BLOCKED', '远程适配器只能是非沙盒声明式工作流');
  }

  const inputSchema = Array.isArray(adapter.inputSchema) ? adapter.inputSchema : [];
  if (inputSchema.length > 80) throw adapterError('ADAPTER_SCHEMA_INVALID', '适配器输入字段过多');
  const normalizedInputs = inputSchema.map((rawField) => {
    const field = asRecord(rawField);
    const fieldKey = requiredText(field.key, 'input.key', 100);
    if (SENSITIVE_KEY.test(fieldKey)) throw adapterError('ADAPTER_INPUT_BLOCKED', `不允许远程适配器处理敏感字段：${fieldKey}`);
    const type = optionalText(field.type, 'input.type', 20) || 'text';
    if (!ALLOWED_INPUT_TYPES.has(type)) throw adapterError('ADAPTER_SCHEMA_INVALID', `不支持的输入类型：${type}`);
    const options = Array.isArray(field.options)
      ? field.options.map((item, index) => requiredText(item, `input.options[${index}]`, 100)).slice(0, 100)
      : undefined;
    return {
      key: fieldKey,
      label: requiredText(field.label, 'input.label', 200),
      type,
      ...(limitedBoolean(field.required) !== undefined ? { required: limitedBoolean(field.required) } : {}),
      ...(options?.length ? { options } : {}),
    };
  });
  const knownInputs = new Set(normalizedInputs.map(field => field.key));

  const rawDefaultInput = asRecord(adapter.defaultInput);
  const defaultInput = Object.fromEntries(Object.entries(rawDefaultInput).filter(([key, item]) => (
    knownInputs.has(key)
    && !SENSITIVE_KEY.test(key)
    && ['string', 'number', 'boolean'].includes(typeof item)
    && (typeof item !== 'string' || item.length <= 500)
  )));

  const allowedHosts = Array.isArray(adapter.allowedHosts)
    ? adapter.allowedHosts.map((host, index) => requiredText(host, `allowedHosts[${index}]`, 200).toLowerCase())
    : [];
  if (!allowedHosts.length || allowedHosts.some(host => !ALLOWED_HOSTS.has(host))) {
    throw adapterError('ADAPTER_HOST_BLOCKED', '适配器只能访问比赛模拟平台域名');
  }

  const rawSteps = Array.isArray(adapter.steps) ? adapter.steps : [];
  if (!rawSteps.length || rawSteps.length > 30) throw adapterError('ADAPTER_SCHEMA_INVALID', '适配器步骤数量必须为 1-30');
  let actionCount = 0;
  const steps = rawSteps.map((rawStep) => {
    const step = asRecord(rawStep);
    const rawActions = Array.isArray(step.actions) ? step.actions : [];
    if (!rawActions.length || rawActions.length > 30) throw adapterError('ADAPTER_SCHEMA_INVALID', '每个步骤必须包含 1-30 个动作');
    actionCount += rawActions.length;
    return {
      id: requiredText(step.id, 'step.id', 100),
      title: requiredText(step.title, 'step.title', 200),
      detail: requiredText(step.detail, 'step.detail', 500),
      action: requiredText(step.action, 'step.action', 200),
      actions: rawActions.map(action => normalizeAction(action, knownInputs)),
    };
  });
  if (actionCount > 150) throw adapterError('ADAPTER_SCHEMA_INVALID', '适配器动作总数超过限制');

  const rawChecks = Array.isArray(adapter.successChecks) ? adapter.successChecks : [];
  if (!rawChecks.length || rawChecks.length > 10) throw adapterError('ADAPTER_SCHEMA_INVALID', '适配器必须包含 1-10 个结果核验动作');
  const successChecks = rawChecks.map(check => normalizeAction(check, knownInputs));
  if (successChecks.some(check => !['assertText', 'waitFor'].includes(String(check.kind)))) {
    throw adapterError('ADAPTER_VERIFY_BLOCKED', '结果核验只能等待或读取页面结果，不能产生提交动作');
  }

  return {
    key,
    name: requiredText(adapter.name, 'name', 200),
    mode: 'workflow',
    description: requiredText(adapter.description, 'description', 1000),
    version,
    capabilityKey: requiredText(adapter.capabilityKey, 'capabilityKey', 100),
    inputSchema: normalizedInputs,
    defaultInput,
    allowedHosts,
    sandbox: false,
    steps,
    successChecks,
  };
}

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function safeCachePath(cacheRoot: string, manifest: AdapterManifest): string {
  const identity = `${manifest.scriptKey || 'unknown'}_${manifest.version || 'unknown'}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180);
  return path.join(cacheRoot, `${identity}.json`);
}

function artifactUrl(rawUrl: string, controlApiBase: string): URL {
  let url: URL;
  try { url = new URL(rawUrl, `${controlApiBase.replace(/\/$/, '')}/`); }
  catch { throw adapterError('ADAPTER_URL_INVALID', '适配器下载地址无效'); }
  if (url.username || url.password || url.hash) throw adapterError('ADAPTER_URL_INVALID', '适配器下载地址包含不允许的认证信息');
  const controlOrigin = new URL(controlApiBase).origin;
  const extraHosts = new Set(String(process.env.TOOLBOX_ADAPTER_ARTIFACT_HOSTS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase());
  const explicitlyAllowedHttps = url.protocol === 'https:' && extraHosts.has(url.hostname.toLowerCase());
  if (url.origin !== controlOrigin && !localHttp && !explicitlyAllowedHttps) {
    throw adapterError('ADAPTER_ORIGIN_BLOCKED', '适配器只能从控制服务或明确允许的 HTTPS 地址下载');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw adapterError('ADAPTER_URL_INVALID', '适配器下载协议不受支持');
  return url;
}

function parseAndValidate(content: Buffer, manifest: AdapterManifest): UnknownRecord {
  const expectedHash = String(manifest.artifactSha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(content) !== expectedHash) {
    throw adapterError('ADAPTER_HASH_INVALID', '适配器文件哈希校验失败，已拒绝执行');
  }
  try { return validateDeclarativeAdapter(JSON.parse(content.toString('utf8')), manifest); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw adapterError('ADAPTER_JSON_INVALID', '适配器文件不是有效 JSON');
  }
}

async function downloadArtifact(url: URL): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw adapterError('ADAPTER_DOWNLOAD_FAILED', `适配器下载失败（HTTP ${response.status}）`);
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > MAX_ARTIFACT_BYTES) throw adapterError('ADAPTER_TOO_LARGE', '适配器文件超过大小限制');
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > MAX_ARTIFACT_BYTES) throw adapterError('ADAPTER_TOO_LARGE', '适配器文件超过大小限制');
    return content;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw adapterError('ADAPTER_DOWNLOAD_FAILED', error instanceof Error ? `适配器下载失败：${error.message}` : '适配器下载失败');
  } finally { clearTimeout(timer); }
}

async function resolveSignedAdapter(
  tool: AdapterTool,
  embeddedAdapter: UnknownRecord,
  cacheRoot: string,
  controlApiBase: string,
  signatureVerified: boolean,
): Promise<{ adapter: UnknownRecord; source: 'embedded' | 'download' | 'cache' }> {
  const manifest = tool.launchGrant?.toolManifest;
  const artifact = manifest?.artifactSha256;
  if (tool.executionMode !== 'live' || !manifest || !artifact || artifact === 'embedded') {
    return { adapter: embeddedAdapter, source: 'embedded' };
  }
  if (!signatureVerified) throw adapterError('ADAPTER_SIGNATURE_REQUIRED', '远程适配器必须包含有效的平台签名');
  if (!manifest.artifactUrl) throw adapterError('ADAPTER_URL_MISSING', '签名清单缺少适配器下载地址');

  fs.mkdirSync(cacheRoot, { recursive: true });
  const cachePath = safeCachePath(cacheRoot, manifest);
  try {
    if (fs.existsSync(cachePath)) return { adapter: parseAndValidate(fs.readFileSync(cachePath), manifest), source: 'cache' };
  } catch {}
  let downloadError: unknown;
  try {
    const content = await downloadArtifact(artifactUrl(manifest.artifactUrl, controlApiBase));
    const adapter = parseAndValidate(content, manifest);
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, content, { mode: 0o600 });
    fs.renameSync(temporaryPath, cachePath);
    return { adapter, source: 'download' };
  } catch (error) { downloadError = error; }

  throw downloadError;
}

module.exports = { MAX_ARTIFACT_BYTES, resolveSignedAdapter, validateDeclarativeAdapter };
