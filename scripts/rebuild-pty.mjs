// node-pty ships prebuilt binaries for Windows and macOS only. On Linux it has to be compiled
// against the Electron headers, which needs Python, make and a C++ compiler.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
if (process.platform === 'win32' || process.platform === 'darwin') {
  console.log('node-pty: usando os binários pré-compilados do pacote.')
  process.exit(0)
}
const electron = require('electron/package.json').version
const cwd = dirname(require.resolve('node-pty/package.json'))
console.log(`node-pty: compilando para o Electron ${electron}…`)
execFileSync(
  'npx',
  ['--yes', 'node-gyp@10', 'rebuild', `--target=${electron}`, '--runtime=electron', '--dist-url=https://electronjs.org/headers'],
  { cwd, stdio: 'inherit' },
)
