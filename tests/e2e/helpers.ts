import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const isWindows = process.platform === 'win32'
/** The main shell of the platform, and a POSIX one: Git Bash on Windows, bash elsewhere. */
export const SHELL = isWindows ? 'powershell' : 'bash'
export const POSIX = isWindows ? 'git-bash' : 'bash'
export const BASE = `[terminal]\ndefaultProfile = "${SHELL}"\nrestoreSession = false\n`
/** Prints item 1 to item n, one per line. */
export const countTo = (n: number, prefix = 'item') => (isWindows ? `1..${n} | % { "${prefix} $_" }` : `seq 1 ${n} | sed "s/^/${prefix} /"`)

export interface App {
  app: ElectronApplication
  page: Page
  home: string
  close(): Promise<void>
}

export async function launch(options: { settings?: string; home?: string; keepHome?: boolean } = {}): Promise<App> {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'wrapped-e2e-'))
  mkdirSync(home, { recursive: true })
  if (options.settings) writeFileSync(join(home, 'settings.toml'), options.settings)
  const app = await electron.launch({
    args: ['.'],
    // WRAPPED_E2E_HIDDEN keeps the windows off screen, which is handy on a desktop in use.
    env: {
      ...(process.env as Record<string, string>), WRAPPED_HOME: home, WRAPPED_NO_PROFILE: '1',
      ...(process.env.WRAPPED_E2E_HIDDEN ? { WRAPPED_HIDDEN: '1' } : {}),
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return {
    app,
    page,
    home,
    async close() {
      await app.close()
      if (!options.keepHome) rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    },
  }
}

export const input = (page: Page) => page.locator('[data-pane]:visible .cm-content').last()

export async function waitReady(page: Page): Promise<void> {
  await expect(page.locator('.input-editor:not(.waiting):visible').last()).toBeVisible({ timeout: 30_000 })
}

/** Types a command in the input editor and submits it, returning its finished block. */
export async function run(page: Page, command: string) {
  await waitReady(page)
  const before = await page.locator('[data-pane]:visible .block:not(.background)').count()
  await input(page).click()
  await page.keyboard.insertText(command)
  await page.keyboard.press('Enter')
  const block = page.locator('[data-pane]:visible .block:not(.background)').nth(before)
  await expect(block).toBeVisible({ timeout: 20_000 })
  await expect(block).not.toHaveClass(/running/, { timeout: 30_000 })
  return block
}
