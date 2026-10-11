const { RunnerClient } = require('./runner-client.cjs');
const crypto = require('node:crypto');
import type { RecoveryStore } from './recovery-store.cjs';
import { ExecutionLease, type ExecutionPermit } from './execution-lease.cjs';
import type { ExecutionReportOutbox } from './execution-report-outbox.cjs';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

type UnknownRecord = Record<string, unknown>;

interface RunnerEvent extends UnknownRecord {
  type: string;
  action?: { type?: string; instruction?: string };
  error?: { message?: string };
}

interface RunnerLike {
  start(tool: UnknownRecord): Promise<unknown>;
  stop(): Promise<unknown>;
  completeUserAction(): Promise<unknown>;
}

interface HostManagerLike {
  register(itemId: string, guest: unknown): unknown;
  release(itemId: string): unknown;
  releaseAll(): unknown;
  isReady(itemId: string): boolean;
  request(itemId: string, action: string, payload: UnknownRecord): Promise<unknown> | unknown;
  size(): number;
}

interface ImportedRow {
  retryOf?: string;
  itemId: string;
  sourceRow?: number;
  input: UnknownRecord;
  preview: UnknownRecord;
  accountLabelMasked: string;
}

interface ParsedImport {
  importId: string;
  fileName: string;
  rows: ImportedRow[];
  errors: unknown[];
  worksheetName?: string;
  templateVersion?: string | null;
}

interface BatchItem {
  permit?: ExecutionPermit;
  reportReservation?: string;
  attemptId: string;
  recoveryId: string | null;
  retryOf?: string;
  itemId: string;
  sourceRow?: number;
  input: UnknownRecord | null;
  accountLabelMasked: string;
  status: string;
  interventionType: string | null;
  message: string;
  runner: RunnerLike | null;
  browserReady: boolean;
  readyToResume: boolean;
  notifiedInterventions: Set<string>;
}

interface ActiveBatch {
  owner: string | null;
  batchId: string;
  serverBatchId?: string | number;
  tool: UnknownRecord;
  status: string;
  recordKind: 'demo' | 'live';
  maxOpenSessions: number;
  items: BatchItem[];
}

interface RunnerFactoryOptions {
  scriptPath: string;
  env: NodeJS.ProcessEnv;
  onEvent: (event: RunnerEvent) => void;
  onHostRequest: (action: string, payload: UnknownRecord) => Promise<unknown> | unknown;
}

interface CoordinatorOptions {
  executionLease?: ExecutionLease;
  reportOutbox?: ExecutionReportOutbox;
  validateUpload?: (payload: UnknownRecord) => Promise<unknown>;
  authorizeMutation?: () => Promise<string>;
  recoveryStore?: RecoveryStore;
  scriptPath?: string;
  env?: NodeJS.ProcessEnv;
  hostManager?: HostManagerLike;
  onEvent?: (event: UnknownRecord) => void;
  onNotify?: (payload: { itemId: string; accountLabelMasked: string; type: string }) => void;
  runnerFactory?: (options: RunnerFactoryOptions) => RunnerLike;
}

class BatchCoordinator {
  private readonly executionLease: ExecutionLease;
  private readonly reportOutbox?: ExecutionReportOutbox;
  private generation = 0;
  private cancelling = false;
  private unsubscribeLease?: () => void;
  validateUpload?: (payload: UnknownRecord) => Promise<unknown>;
  authorizeMutation?: () => Promise<string>;
  recoveryStore?: RecoveryStore;
  scriptPath: string;
  env: NodeJS.ProcessEnv;
  hostManager: HostManagerLike;
  onEvent: (event: UnknownRecord) => void;
  onNotify: (payload: { itemId: string; accountLabelMasked: string; type: string }) => void;
  runnerFactory: (options: RunnerFactoryOptions) => RunnerLike;
  imports: Map<string, ImportedRow[]>;
  importOwners: Map<string, string | null>;
  batch: ActiveBatch | null;
  activeItemId: string | null;
  provisioningItemId: string | null;

  constructor({ scriptPath = '', env, hostManager, onEvent = () => {}, onNotify = () => {}, runnerFactory, recoveryStore, authorizeMutation, validateUpload, executionLease, reportOutbox }: CoordinatorOptions = {}) {
    if (!hostManager) throw new Error('BatchCoordinator requires hostManager');
    this.scriptPath = scriptPath;
    this.executionLease = executionLease || new ExecutionLease();
    this.reportOutbox = reportOutbox;
    this.env = env || {};
    this.recoveryStore = recoveryStore;
    this.authorizeMutation = authorizeMutation;
    this.validateUpload = validateUpload;
    this.hostManager = hostManager;
    this.onEvent = onEvent;
    this.onNotify = onNotify;
    this.runnerFactory = runnerFactory || ((options: RunnerFactoryOptions) => new RunnerClient(options) as RunnerLike);
    this.imports = new Map<string, ImportedRow[]>();
    this.importOwners = new Map<string, string | null>();
    this.batch = null;
    this.activeItemId = null;
    this.provisioningItemId = null;
  }

  storeImport(parsed: ParsedImport, owner: string | null = null) {
    this.imports.set(parsed.importId, parsed.rows);
    this.importOwners.set(parsed.importId, owner);
    return {
      importId: parsed.importId,
      fileName: parsed.fileName,
      validCount: parsed.rows.length,
      errorCount: parsed.errors.length,
      rows: parsed.rows.map(row => ({ itemId: row.itemId, sourceRow: row.sourceRow, preview: row.preview, accountLabelMasked: row.accountLabelMasked })),
      errors: parsed.errors,
      worksheetName: parsed.worksheetName,
      templateVersion: parsed.templateVersion,
    };
  }

  remapImportItems(importId: string, itemIds: string[], owner: string | null = null) {
    this.assertImportOwner(importId, owner);
    const importedRows = this.imports.get(importId);
    if (!importedRows?.length) throw this.error('BATCH_IMPORT_MISSING', '导入数据已经失效，请重新载入');
    if (itemIds.length !== importedRows.length) throw this.error('BATCH_ITEM_COUNT_MISMATCH', '服务端任务数与本地导入行数不一致');
    const nextImportId = `${importId}_mapped`;
    const rows = importedRows.map((row, index) => ({ ...row, itemId: itemIds[index]! }));
    this.imports.delete(importId);
    this.importOwners.delete(importId);
    this.imports.set(nextImportId, rows);
    this.importOwners.set(nextImportId, owner);
    return {
      importId: nextImportId,
      validCount: rows.length,
      errorCount: 0,
      rows: rows.map(row => ({ itemId: row.itemId, sourceRow: row.sourceRow, preview: row.preview, accountLabelMasked: row.accountLabelMasked })),
      errors: [],
    };
  }

  create({ importId, batchId, serverBatchId, tool, maxOpenSessions = 6, recordKind = 'live', owner = null }: { importId: string; batchId: string; serverBatchId?: string | number; tool: UnknownRecord; maxOpenSessions?: number; recordKind?: 'demo' | 'live'; owner?: string | null }) {
    if (this.cancelling) throw this.error('BATCH_STOPPING', '原批次正在停止，请稍后重试');
    if (this.batch && this.batch.status === 'running') throw this.error('BATCH_ACTIVE', '已有批次正在执行');
    const importedRows = this.imports.get(importId);
    if (!importedRows?.length) throw this.error('BATCH_IMPORT_MISSING', '导入数据已经失效，请重新选择文件');
    if (recordKind === 'live') this.assertImportOwner(importId, owner);
    const queued = recordKind === 'live' && this.recoveryStore && owner
      ? this.recoveryStore.queue(owner, tool, importedRows.map(row => ({ input: row.input, batchId, itemId: row.itemId, originalRow: row.sourceRow, retryOf: row.retryOf }))) : [];
    this.imports.clear();
    this.importOwners.clear();
    this.generation += 1;
    this.unsubscribeLease?.();
    this.unsubscribeLease = this.executionLease.onAvailable(() => this.schedule());
    this.batch = {
      owner,
      batchId,
      serverBatchId,
      tool: { ...tool },
      status: 'running',
      recordKind,
      maxOpenSessions: Math.min(Math.max(Number(maxOpenSessions) || 6, 2), 10),
      items: importedRows.map(row => ({
        attemptId: crypto.randomUUID(), recoveryId: queued.find(record => record.itemId === row.itemId)?.id || null, retryOf: row.retryOf,
        itemId: row.itemId,
        sourceRow: row.sourceRow,
        input: row.input,
        accountLabelMasked: row.accountLabelMasked,
        status: 'pending',
        interventionType: null,
        message: '',
        runner: null,
        browserReady: false,
        readyToResume: false,
        notifiedInterventions: new Set(),
      })),
    };
    this.emit('batch.created');
    this.schedule();
    return this.snapshot();
  }

  prepareRecovery(owner: string, request: { batchId: string; importId: string; toolId: string; toolVersion: string }) {
    if (this.batch?.status === 'running') throw this.error('BATCH_ACTIVE', '当前批次仍在执行，请先完成或停止。');
    if (!this.recoveryStore) throw this.error('RECOVERY_MISSING', '当前客户端无法读取本机恢复记录。');
    const imported = this.imports.get(request.importId);
    if (!imported?.length) throw this.error('BATCH_IMPORT_MISSING', '请重新选择原始文件。');
    this.assertImportOwner(request.importId, owner);
    const previous = this.recoveryStore.list(owner, request.batchId);
    if (!previous.length) throw this.error('RECOVERY_MISSING', '缺少这批任务的本机证据，禁止自动恢复。');
    const expectedRows = new Set(previous.map(row => row.originalRow).filter((row): row is number => row !== null));
    if ([...expectedRows].some(sourceRow => !imported.some(row => row.sourceRow === sourceRow))) throw this.error('RECOVERY_ROW_MISMATCH', '所选文件缺少原批次行，请选择完整原文件。');
    const rows: ImportedRow[] = [];
    const errors: Array<{ rowNumber: number | undefined; message: string }> = [];
    for (const row of imported) {
      if (!expectedRows.has(row.sourceRow || -1)) { errors.push({ rowNumber: row.sourceRow, message: '缺少这行的本机提交证据，已排除；请先核对平台。' }); continue; }
      const retryOf = this.recoveryStore.matchRetry(owner, request.batchId, row, request.toolId, request.toolVersion);
      if (retryOf) rows.push({ ...row, retryOf, itemId: `retry_${crypto.randomUUID()}` });
      else errors.push({ rowNumber: row.sourceRow, message: '已完成、待核对或已建立恢复尝试，已排除以免重复执行。' });
    }
    if (!rows.length) throw this.error('RECOVERY_NOT_RETRYABLE', '没有确定可重试的行；成功项和待核对项不会重复执行。');
    const importId = `recovery_${crypto.randomUUID()}`;
    return this.storeImport({ importId, fileName: '已核对的原文件可重试行', rows, errors }, owner);
  }

  private assertImportOwner(importId: string, owner: string | null): void {
    if (this.recoveryStore && (!owner || this.importOwners.get(importId) !== owner)) throw this.error('RECOVERY_OWNER_MISMATCH', '所选原文件不属于当前授权，请重新选择文件。');
  }

  assertOwner(owner: string): void {
    if (this.batch && this.batch.recordKind === 'live' && this.batch.owner !== owner) throw this.error('RECOVERY_OWNER_MISMATCH', '当前授权不拥有这个本机批次。');
  }

  registerBrowser(itemId: string, guest: unknown) {
    const item = this.requireItem(itemId);
    const result = this.hostManager.register(itemId, guest);
    item.browserReady = true;
    this.emit('batch.browser_ready', { itemId });
    return result;
  }

  unregisterBrowser(itemId: string) {
    const item = this.batch?.items.find(candidate => candidate.itemId === itemId);
    if (item) item.browserReady = false;
    return this.hostManager.release(itemId);
  }

  async startItem(itemId: string, tool: UnknownRecord) {
    const item = this.requireItem(itemId);
    const batch = this.batch;
    if (!batch) throw this.error('BATCH_NOT_FOUND', '批次不存在');
    if (batch.status !== 'running' || this.cancelling) throw this.error('BATCH_STOPPING', '批次已结束或正在停止');
    if (this.activeItemId && this.activeItemId !== itemId) throw this.error('BATCH_RUNNER_BUSY', '另一个账号正在处理');
    if (batch.recordKind !== 'demo' && !this.hostManager.isReady(itemId)) throw this.error('BROWSER_NOT_REGISTERED', '账号浏览器尚未就绪');
    if (TERMINAL.has(item.status)) throw this.error('BATCH_ITEM_TERMINAL', '该账号已经结束');
    if (item.runner || item.permit || item.status !== 'pending') throw this.error('BATCH_RUNNER_BUSY', '该账号已启动或正在等待人工操作');
    const generation = this.generation;
    const permit = this.executionLease.acquire();
    item.permit = permit;
    this.provisioningItemId = null;
    this.activeItemId = itemId;
    item.status = 'running';
    item.interventionType = null;
    item.message = '';
    const runTool = {
      ...batch.tool,
      ...tool,
      browserMode: this.hostManager.isReady(itemId) ? 'embedded-cdp' : 'playwright',
      executionMode: batch.recordKind,
      executionContext: {
        mode: 'batch',
        batchId: batch.batchId,
        itemId,
        sessionId: `session_${itemId}`,
        input: item.input,
      },
    };
    try {
      if (batch.recordKind === 'live' && this.env.TOOLBOX_PERSIST_REPORTS === '1') {
        if (!this.reportOutbox) throw this.error('RECEIPT_SERVICE_MISSING', '本机回执服务不可用，已禁止执行');
        item.reportReservation = await this.reportOutbox.reserve(((runTool as UnknownRecord).launchGrant as UnknownRecord | undefined)?.token);
        if (generation !== this.generation || batch.status !== 'running') {
          await this.reportOutbox.releaseReservation(item.reportReservation);
          throw this.error('SESSION_REVOKED', '原批次准备已失效');
        }
      }
      permit.assert();
      if (batch.recordKind === 'live' && this.recoveryStore) {
        if (!batch.owner) throw this.error('RECOVERY_OWNER_MISSING', '未验证当前授权，已禁止执行。');
        const record = this.recoveryStore.begin(batch.owner, runTool, item.input || {}, { batchId: batch.batchId, itemId, originalRow: item.sourceRow, retryOf: item.recoveryId || item.retryOf });
        item.recoveryId = record.id;
        (runTool.executionContext as UnknownRecord).sessionId = `session_${item.attemptId}`;
      }
    } catch (cause) {
      if (item.reportReservation) await this.reportOutbox?.releaseReservation(item.reportReservation);
      if (generation === this.generation) this.finishItem(item, 'failed', cause instanceof Error ? cause.message : '恢复检查失败');
      permit.release();
      throw cause;
    }
    item.runner = this.createRunner(item);
    this.emit('batch.item_updated', { itemId });
    try {
      const result = await item.runner.start(runTool);
      if (generation !== this.generation) throw this.error('SESSION_REVOKED', '原批次执行已退出');
      return result;
    } catch (error) {
      if (generation === this.generation) this.finishItem(item, 'failed', error instanceof Error ? error.message : '启动失败');
      throw error;
    }
  }

  failProvision(itemId: string, message = '启动授权未通过') {
    const item = this.requireItem(itemId);
    if (this.provisioningItemId !== itemId) return this.snapshot();
    this.provisioningItemId = null;
    const batch = this.batch;
    if (batch?.recordKind === 'live' && batch.owner && this.recoveryStore && !item.recoveryId) {
      const record = this.recoveryStore.begin(batch.owner, batch.tool, item.input || {}, { batchId: batch.batchId, itemId, originalRow: item.sourceRow, retryOf: item.retryOf });
      item.recoveryId = record.id;
      this.recoveryStore.observe(batch.owner, record.id, { type: 'run.failed', error: { code: 'GRANT_START_FAILED' } });
    }
    this.finishItem(item, 'failed', message);
    return this.snapshot();
  }

  async completeUserAction(itemId: string) {
    const item = this.requireItem(itemId);
    if (item.status !== 'waiting_user') return this.snapshot();
    item.readyToResume = true;
    item.message = '已确认操作，等待继续处理';
    this.emit('batch.item_updated', { itemId });
    this.schedule();
    return this.snapshot();
  }

  async restartItem(itemId: string) {
    const item = this.requireItem(itemId);
    if (this.batch?.status !== 'running' || !item.input) {
      throw this.error('BATCH_REIMPORT_REQUIRED', '批次已结束，请重新导入需要处理的账号并新建批次');
    }
    if (item.status !== 'failed') throw this.error('BATCH_ITEM_NOT_FAILED', '只有未完成账号可以重新发起');
    if (this.batch.recordKind === 'live' && this.recoveryStore) {
      const record = this.recoveryStore.list(this.batch.owner || '').find(row => row.id === item.recoveryId);
      if (!record?.retryAllowed) throw this.error('RECOVERY_REVIEW_REQUIRED', '结果待核对，禁止直接重试；请先核对平台并记录结论。');
      item.retryOf = record.id;
    } else if (this.batch.recordKind === 'live' && item.runner) {
      throw this.error('RECOVERY_REVIEW_REQUIRED', '缺少完整未提交证据，请先核对平台结果。');
    }
    await item.runner?.stop?.().catch(() => {});
    item.runner = null;
    item.status = 'pending';
    item.attemptId = crypto.randomUUID();
    item.recoveryId = null;
    item.message = '';
    item.interventionType = null;
    this.emit('batch.item_updated', { itemId });
    this.schedule();
    return this.snapshot();
  }

  async cancel(status = 'cancelled') {
    if (!this.batch) return { status: 'idle' };
    if (this.cancelling) throw this.error('BATCH_STOPPING', '原批次正在停止，请稍后重试');
    this.cancelling = true;
    try {
    this.generation += 1;
    this.batch.status = status;
    this.unsubscribeLease?.(); this.unsubscribeLease = undefined;
    const runners = this.batch.items.flatMap((item) => item.runner ? [item.runner.stop()] : []);
    const stopped = await Promise.allSettled(runners);
    if (stopped.some(result => result.status === 'rejected')) throw this.error('BATCH_STOP_FAILED', '执行进程尚未确认停止，已保留执行锁，请关闭后重新打开软件。');
    for (const item of this.batch.items) {
      if (this.batch.owner && item.recoveryId && this.recoveryStore) this.recoveryStore.observe(this.batch.owner, item.recoveryId, { type: status === 'interrupted' ? 'run.interrupted' : 'run.cancelled' });
      this.releaseUnusedReceipt(item);
      if (!TERMINAL.has(item.status)) item.status = 'cancelled';
      item.input = null;
      item.runner = null;
      item.permit?.release(); item.permit = undefined;
    }
    this.batch.status = status;
    this.activeItemId = null;
    this.provisioningItemId = null;
    this.hostManager.releaseAll();
    this.emit('batch.finished');
    return this.snapshot();
    } finally { this.cancelling = false; }
  }

  createRunner(item: BatchItem): RunnerLike {
    const generation = this.generation;
    const attempt = item.attemptId;
    const current = () => generation === this.generation && item.attemptId === attempt && this.batch?.status === 'running' && !TERMINAL.has(item.status);
    return this.runnerFactory({
      scriptPath: this.scriptPath,
      env: this.env,
      onEvent: (event: RunnerEvent) => { if (current()) this.handleRunnerEvent(item, event); },
      onHostRequest: async (action: string, payload: UnknownRecord) => {
        if (!current() || TERMINAL.has(item.status)) throw this.error('SESSION_REVOKED', '原批次执行已退出');
        if (action === 'execution.report') {
          if (!item.reportReservation || !this.reportOutbox) throw this.error('RECEIPT_RESERVATION_MISSING', '缺少本次执行回执预留');
          return this.reportOutbox.submit(payload, item.reportReservation);
        }
        if (!item.permit) throw this.error('EXECUTION_REVOKED', '该账号尚未取得执行许可');
        const requestPermit = item.permit;
        requestPermit.assert();
        if (action === 'files.validate-upload' || (action === 'browser.action' && (payload.action as UnknownRecord | undefined)?.kind === 'upload')) {
          if (!this.validateUpload) throw this.error('LOCAL_FILE_UNAVAILABLE', '本机上传验证不可用，已禁止上传');
          const upload = (payload.action || {}) as UnknownRecord;
          const filePath = action === 'files.validate-upload' ? payload.filePath
            : typeof upload.inputKey === 'string' ? (payload.input as UnknownRecord | undefined)?.[upload.inputKey] : upload.value;
          const result = await this.validateUpload({ filePath });
          if (!current()) throw this.error('SESSION_REVOKED', '原批次上传已退出');
          requestPermit.assert();
          if (action === 'files.validate-upload') return result;
        }
        if (action === 'recovery.before-mutation') {
          if (!this.batch?.owner || !item.recoveryId || !this.recoveryStore) throw this.error('RECOVERY_MISSING', '缺少本机恢复记录，已禁止提交。');
          if (this.authorizeMutation && await this.authorizeMutation() !== this.batch.owner) throw this.error('RECOVERY_OWNER_MISMATCH', '授权已变化，已禁止继续提交。');
          if (!current() || !item.permit) throw this.error('SESSION_REVOKED', '原批次提交已退出');
          requestPermit.assert();
          this.recoveryStore.mutation(this.batch.owner, item.recoveryId);
          return { saved: true };
        }
        return this.hostManager.request(item.itemId, action, payload);
      },
    });
  }

  handleRunnerEvent(item: BatchItem, event: RunnerEvent) {
    if (this.batch?.owner && item.recoveryId && this.recoveryStore) {
      try { this.recoveryStore.observe(this.batch.owner, item.recoveryId, event); }
      catch { this.finishItem(item, 'failed', '本机恢复记录保存失败，结果待核对。'); return; }
    }
    const enriched = { ...event, batchId: this.batch?.batchId, itemId: item.itemId };
    if (event.type === 'user.action_required') {
      item.status = 'waiting_user';
      item.interventionType = event.action?.type || 'other';
      item.message = event.action?.instruction || '需要完成页面操作';
      this.activeItemId = null;
      item.permit?.release(); item.permit = undefined;
      if (!item.notifiedInterventions.has(item.interventionType)) {
        item.notifiedInterventions.add(item.interventionType);
        this.onNotify({ itemId: item.itemId, accountLabelMasked: item.accountLabelMasked, type: item.interventionType });
      }
      this.emit('batch.item_updated', { itemId: item.itemId, runnerEvent: enriched });
      this.schedule();
      return;
    }
    if (event.type === 'run.completed') this.finishItem(item, 'completed');
    else if (event.type === 'run.failed') this.finishItem(item, 'failed', event.error?.message);
    else if (event.type === 'run.cancelled') this.finishItem(item, 'cancelled');
    else this.emit('batch.runner_event', { itemId: item.itemId, runnerEvent: enriched });
  }

  finishItem(item: BatchItem, status: string, message = '') {
    const batch = this.batch;
    if (!batch) return;
    if (batch.owner && item.recoveryId && this.recoveryStore && status !== 'completed') {
      try { this.recoveryStore.observe(batch.owner, item.recoveryId, { type: status === 'cancelled' ? 'run.cancelled' : 'run.failed', error: { code: 'RUNNER_START_OR_EXECUTION_FAILED' } }); }
      catch { message = '本机恢复记录保存失败，结果待核对。'; }
    }
    item.status = status;
    this.releaseUnusedReceipt(item);
    item.message = message || '';
    item.interventionType = null;
    item.readyToResume = false;
    if (this.activeItemId === item.itemId) this.activeItemId = null;
    const permit = item.permit;
    item.permit = undefined;
    // Do not hand execution to another process until the old Runner stopped.
    if (item.runner) void item.runner.stop().then(() => permit?.release(), () => { /* fail closed: retain the lease */ });
    else permit?.release();
    item.runner = null;
    if (item.browserReady) {
      this.hostManager.release(item.itemId);
      item.browserReady = false;
    }
    this.emit('batch.item_updated', { itemId: item.itemId });
    if (batch.items.every(candidate => TERMINAL.has(candidate.status))) {
      batch.status = 'completed';
      for (const candidate of batch.items) candidate.input = null;
      this.emit('batch.finished');
      return;
    }
    this.schedule();
  }

  private releaseUnusedReceipt(item: BatchItem): void {
    if (!this.batch?.owner || !item.recoveryId || !item.reportReservation) return;
    try {
      if (this.recoveryStore?.list(this.batch.owner).find(row => row.id === item.recoveryId)?.classification === 'not_submitted') {
        void this.reportOutbox?.releaseReservation(item.reportReservation).catch(() => { /* retain on storage failure */ });
      }
    } catch { /* Unknown execution keeps its reservation. */ }
  }

  async resumeWaiting(item: BatchItem) {
    if (!item.runner) {
      item.status = 'pending';
      item.readyToResume = false;
      this.schedule();
      return;
    }
    if (this.executionLease.busy) return;
    item.permit = this.executionLease.acquire();
    this.activeItemId = item.itemId;
    item.readyToResume = false;
    item.status = 'running';
    this.emit('batch.item_updated', { itemId: item.itemId });
    try {
      await item.runner.completeUserAction();
    } catch (error) {
      this.finishItem(item, 'failed', error instanceof Error ? error.message : '继续处理失败');
    }
  }

  schedule(): void {
    if (!this.batch || this.batch.status !== 'running' || this.activeItemId || this.provisioningItemId) return;
    if (this.executionLease.busy) return;
    const resumable = this.batch.items.find(item => item.status === 'waiting_user' && item.readyToResume);
    if (resumable) {
      this.resumeWaiting(resumable);
      return;
    }
    const next = this.batch.items.find(item => item.status === 'pending');
    if (!next) return;
    if (this.batch.recordKind !== 'demo' && this.hostManager.size() >= this.batch.maxOpenSessions && !this.hostManager.isReady(next.itemId)) {
      this.emit('batch.resource_blocked', { message: '浏览器现场已达上限，请先处理一个需要操作的账号' });
      return;
    }
    this.provisioningItemId = next.itemId;
    this.emit('batch.item_ready', { itemId: next.itemId });
  }

  snapshot(): UnknownRecord {
    if (!this.batch) return { status: 'idle', items: [] };
    const items = this.batch.items.map(item => ({
      itemId: item.itemId,
      sourceRow: item.sourceRow,
      accountLabelMasked: item.accountLabelMasked,
      status: item.status,
      interventionType: item.interventionType,
      message: item.message,
      browserReady: item.browserReady,
      attemptId: item.attemptId,
      recovery: this.batch?.owner && item.recoveryId ? this.recoveryStore?.list(this.batch.owner).find(record => record.id === item.recoveryId) : undefined,
    }));
    const count = (status: string) => items.filter(item => item.status === status).length;
    return {
      batchId: this.batch.batchId,
      serverBatchId: this.batch.serverBatchId,
      tool: this.batch.tool,
      status: this.batch.status,
      activeItemId: this.activeItemId,
      provisioningItemId: this.provisioningItemId,
      maxOpenSessions: this.batch.maxOpenSessions,
      recordKind: this.batch.recordKind,
      counts: {
        total: items.length,
        pending: count('pending'),
        running: count('running'),
        waiting: count('waiting_user'),
        completed: count('completed'),
        failed: count('failed'),
      },
      items,
    };
  }

  emit(type: string, payload: UnknownRecord = {}): void {
    this.onEvent({ type, timestamp: Date.now(), ...payload, snapshot: this.snapshot() });
  }

  requireItem(itemId: string): BatchItem {
    const item = this.batch?.items.find(candidate => candidate.itemId === itemId);
    if (!item) throw this.error('BATCH_ITEM_NOT_FOUND', '批次账号不存在');
    return item;
  }

  error(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
  }
}

module.exports = { BatchCoordinator };
