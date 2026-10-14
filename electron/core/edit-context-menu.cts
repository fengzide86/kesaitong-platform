import { Menu, type BrowserWindow, type WebContents } from 'electron'

/**
 * Adds the standard native edit menu to the trusted renderer only.
 *
 * Chromium's text-field context menu is not exposed when the app hides the
 * application menu.  Using Electron's built-in edit roles keeps clipboard
 * data inside the renderer/OS; no clipboard contents cross our IPC boundary.
 */
export function installEditContextMenu(window: BrowserWindow): void {
  const contents = window.webContents
  contents.on('context-menu', (event, params) => {
    if (window.isDestroyed() || contents.isDestroyed() || !params.isEditable) return

    const menu = Menu.buildFromTemplate([
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ])
    menu.popup({ window })
  })
}

export type { WebContents }
