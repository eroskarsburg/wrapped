import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASE, input, isWindows, launch, run, waitReady, type App } from './helpers'

let wrapped: App
test.afterEach(async () => {
  await wrapped?.close().catch(() => undefined)
})

const blocks = (page: App['page']) => page.locator('[data-pane]:visible .block:not(.background)')

test('a pasted script of several commands stays one block that finishes', async () => {
  test.skip(isWindows, 'bash marks each command of a paste')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await input(page).click()
  await page.keyboard.insertText('echo um')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.insertText('echo dois')
  await page.keyboard.press('Enter')
  const block = blocks(page).first()
  await expect(block).not.toHaveClass(/running/, { timeout: 15_000 })
  await expect(block.locator('.line')).toHaveText(['um', 'dois'])
  await expect(blocks(page)).toHaveCount(1)
})

test('a carriage return inside a command does not start a second, unfinished block', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  const block = await run(page, 'echo um\recho dois')
  await expect(block.locator('.line')).toHaveText(['um', 'dois'])
  await expect(page.locator('[data-pane]:visible .block.running')).toHaveCount(0)
  await expect(blocks(page)).toHaveCount(1)
})

test('a tab inside a one-line command reaches the shell as a tab', async () => {
  test.skip(isWindows, 'PowerShell turns tabs into spaces on purpose')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  const block = await run(page, 'printf "%s|%s\\n" "A\tB" fim')
  await expect(block.locator('.block-output')).toHaveText(/^A\s+B\|fim/)
  const after = await run(page, 'echo depois')
  await expect(after.locator('.block-output')).toHaveText(/^depois/)
})

test('an open quote shows that the shell waits, and Ctrl+C brings the prompt back', async () => {
  test.skip(isWindows, 'bash continuation prompt')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await input(page).click()
  await page.keyboard.insertText("echo 'aberto")
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('stalled-bar')).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('Control+c')
  await expect(page.getByTestId('stalled-bar')).toHaveCount(0)
  const after = await run(page, 'echo recuperado')
  await expect(after.locator('.block-output')).toHaveText(/^recuperado/)
  // The cancelled command must not label the next block.
  await expect(blocks(page)).toHaveCount(1)
  await expect(after.locator('.block-header')).toContainText('echo recuperado')
})

test('Ctrl+B reaches a running program', async () => {
  test.skip(isWindows, 'bash read builtin')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await input(page).click()
  await page.keyboard.insertText(`read -rsn1 k; printf 'tecla:%d\\n' "'$k"`)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-pane]:visible .block.running')).toHaveCount(1)
  await page.waitForTimeout(500)
  await page.keyboard.press('Control+b')
  const block = blocks(page).last()
  await expect(block).not.toHaveClass(/running/, { timeout: 10_000 })
  await expect(block.locator('.block-output')).toHaveText(/tecla:2/)
})

test('Alt+Right accepts a word of the suggestion instead of switching panes', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, 'echo alfa beta gama')
  await page.keyboard.press('Control+Shift+D')
  await expect(page.locator('.input-editor:not(.waiting)')).toHaveCount(2, { timeout: 20_000 })
  const first = page.locator('[data-pane]').first()
  await first.locator('.cm-content').click()
  await page.keyboard.insertText('echo al')
  await expect(first.locator('.ghost')).toHaveText('fa beta gama')
  await page.keyboard.press('Alt+ArrowRight')
  // The line shows the ghost text too, so the rest of the suggestion is checked on its own.
  await expect(first.locator('.ghost')).toHaveText(' beta gama')
  await expect(first.locator('.cm-line')).toHaveText('echo alfa beta gama')
  await expect(page.locator(':focus').locator('xpath=ancestor::*[@data-pane]')).toHaveAttribute('data-pane', (await first.getAttribute('data-pane'))!)
})

test('a settings.toml with a syntax error is reported and kept before being overwritten', async () => {
  wrapped = await launch({ settings: `${BASE}oops = = 1\n[appearance]\nfontSize = 20\n`, keepHome: true })
  const { page, home } = wrapped
  await waitReady(page)
  await expect(page.getByTestId('settings-error')).toBeVisible()
  await page.keyboard.press('Control+=')
  await expect.poll(() => readdirSync(home).filter((name) => name.startsWith('settings.toml.broken-')).length).toBe(1)
  const backup = readdirSync(home).find((name) => name.startsWith('settings.toml.broken-'))!
  expect(readFileSync(join(home, backup), 'utf8')).toContain('fontSize = 20')
  await expect(page.getByTestId('settings-error')).toHaveCount(0)
})

test('shows the branch in a git worktree and the cwd with its own separator', async () => {
  test.skip(isWindows, 'POSIX paths')
  const dir = mkdtempSync(join(tmpdir(), 'wrapped-repo-'))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir })
  git('init', '-q', '-b', 'main', 'repo')
  git('-C', 'repo', 'commit', '-q', '--allow-empty', '-m', 'init')
  git('-C', 'repo', 'worktree', 'add', '-q', '-b', 'galho', '../arvore')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, `cd "${join(dir, 'arvore')}"`)
  await expect(page.locator('.chip-git')).toHaveText('galho', { timeout: 10_000 })
  await expect(page.locator('.chip-cwd')).toHaveText(/^…\/[^\\]+\/arvore$/)
})

test('lists and diffs files with accents in the changes panel', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrapped-repo-'))
  writeFileSync(join(dir, 'ação.txt'), 'um\n')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, `cd "${dir}"; git init -q; git add .; git -c user.name=t -c user.email=t@t commit -qm init`)
  writeFileSync(join(dir, 'ação.txt'), 'um\ndois\n')
  await run(page, 'echo atualiza')
  await expect(page.locator('.chip-diff')).toBeVisible({ timeout: 10_000 })
  await page.locator('.chip-diff').click()
  const row = page.locator('.file-row', { hasText: 'ação.txt' })
  await expect(row).toBeVisible()
  await expect(row).not.toContainText('\\303')
})
