import { contextBridge, ipcRenderer } from 'electron'

// This preload ships only with the excluded local smoke entry, never the app.
const channels = new Set(['scenes:policy', 'scenes:list', 'scenes:open', 'scenes:select', 'scenes:close', 'scenes:bounds', 'automation:start'])
contextBridge.exposeInMainWorld('localScenesSmoke', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!channels.has(channel)) throw new Error('Smoke channel not allowed')
    return ipcRenderer.invoke(channel, ...args)
  },
})
