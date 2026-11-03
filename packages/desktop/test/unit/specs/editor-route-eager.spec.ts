// The editor route must not be lazy.
//
// It is the route every window opens on, and its component is evaluated with
// the entry chunk: `main.ts` awaits `installTauriBridge()` at module scope,
// before mounting, so a lazy editor route would hold the first frame behind a
// second chunk instead. The other half of the split is the settings tree, which
// stays lazy — a window visits one tree or the other, never both.
//
// The original reason was sharper: Electron's main process sent a one-shot
// `mt::bootstrap-editor` from `webContents.once('did-finish-load')`, and behind
// a dynamic import the listener registered after the message had already gone.
// That main process is gone; the static import is kept as the cheaper shape.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROUTER = resolve(__dirname, '../../../src/renderer/src/router/index.ts')

describe('the editor route', () => {
  const source = readFileSync(ROUTER, 'utf-8')

  it('is imported statically', () => {
    expect(source).toMatch(/^import App from '@\/pages\/app\.vue'$/m)
    expect(source, 'a dynamic import would lose the bootstrap message').not.toMatch(
      /const App\s*=\s*\(\)\s*=>\s*import\(/
    )
  })

  it('still defers the settings tree', () => {
    // The other half of the split is the part that actually helps: a window
    // visits one tree or the other, never both.
    expect(source).toMatch(/const Preference\s*=\s*\(\)\s*=>\s*import\(/)
    expect(source).toMatch(/const Keybindings\s*=\s*\(\)\s*=>\s*import\(/)
  })
})
