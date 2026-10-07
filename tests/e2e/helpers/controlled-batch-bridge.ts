import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'

/** UI contract fixture only: no Electron Runner or external platform executes. */
export async function installControlledBatchBridge(
  page: Page,
  labels: string[],
  parseActualWorkbook = false,
): Promise<void> {
  const workerFile = parseActualWorkbook
    ? readdirSync(resolve('dist/assets')).find(name => /^spreadsheet\.worker-.*\.js$/.test(name))
    : undefined
  if (parseActualWorkbook && !workerFile) throw new Error('Prebuilt production spreadsheet Worker is missing')
  await page.addInitScript(({ labels, workerUrl }) => {
    type Preview = {
      importId: string; fileName?: string; validCount: number; errorCount: number;
      rows: Array<{ itemId: string; preview: Record<string, unknown> }>; errors: unknown[];
    }
    const observed = window as typeof window & { __spreadsheetWorkerReplies: unknown[]; __batchCreates: unknown[] }
    observed.__spreadsheetWorkerReplies = []
    observed.__batchCreates = []
    let preview: Preview = {
      importId: 'controlled-local-import', fileName: '本地客户资料.xlsx', validCount: labels.length, errorCount: 0,
      rows: labels.map((account_label, index) => ({ itemId: `controlled-item-${index + 1}`, preview: { account_label } })), errors: [],
    }
    let snapshot: Record<string, unknown> = { status: 'idle', recordKind: 'live', items: [], counts: {} }
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        runtime: { deviceId: 'isolated-e2e-fixture-device' },
        batch: {
          onEvent: () => () => {},
          getSnapshot: async () => snapshot,
          selectImportFile: async (options: { schema: Array<Record<string, unknown>>; capabilityKey: string; maxRows: number }) => {
            if (!workerUrl) return preview
            // The bridge boundary is a fixture, but file selection, bytes and
            // the exact production Worker/parser stay real. No inline fallback.
            preview = await new Promise<Preview>((resolveImport, rejectImport) => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.xlsx,.csv'
              input.hidden = true
              input.addEventListener('cancel', () => { input.remove(); rejectImport(new Error('未选择文件')) }, { once: true })
              input.addEventListener('change', () => {
                const file = input.files?.[0]
                input.remove()
                if (!file) { rejectImport(new Error('未选择文件')); return }
                const worker = new Worker(workerUrl, { type: 'module' })
                worker.addEventListener('message', event => {
                  observed.__spreadsheetWorkerReplies.push(event.data)
                  worker.terminate()
                  if (event.data.ok) resolveImport(event.data.result as Preview)
                  else rejectImport(new Error(event.data.error || '文件解析失败'))
                }, { once: true })
                worker.addEventListener('error', event => { worker.terminate(); rejectImport(new Error(event.message)) }, { once: true })
                void file.arrayBuffer().then(buffer => worker.postMessage({
                  buffer, fileName: file.name,
                  inputSchema: options.schema, maxRows: options.maxRows,
                  selection: { capabilityKey: options.capabilityKey },
                }, [buffer])).catch(error => { worker.terminate(); rejectImport(error) })
              }, { once: true })
              document.body.appendChild(input)
              input.click()
            })
            return preview
          },
          create: async (input: { batchId: string; serverBatchId: string | number; tool: unknown; importId: string; maxOpenSessions: number }) => {
            observed.__batchCreates.push(input)
            snapshot = {
              batchId: input.batchId, serverBatchId: input.serverBatchId, tool: input.tool,
              status: 'running', recordKind: 'live', counts: { total: preview.validCount, running: preview.validCount },
              items: preview.rows.map(row => ({ itemId: row.itemId, accountLabelMasked: row.preview.account_label, status: 'running', browserReady: false })),
            }
            return snapshot
          },
          cancel: async () => { snapshot = { ...snapshot, status: 'cancelled' }; return snapshot },
          selectItem: async () => {},
        },
      },
    })
  }, { labels, workerUrl: workerFile ? `/assets/${workerFile}` : null })
}
