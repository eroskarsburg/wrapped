import { expect, test } from '@playwright/test'
import { input, isWindows, launch, run, waitReady, type App } from './helpers'

let wrapped: App

const powershell = { name: 'PowerShell', profile: 'powershell', fail: 'cmd /c "exit 3"', notFound: 'nonexistentcmd', multi: 'foreach ($i in 1..2) {\n  "multi $i"\n}' }
const bash = { name: 'Git Bash', profile: 'git-bash', fail: '(exit 3)', notFound: 'nonexistentcmd', multi: 'for i in 1 2; do\n  echo "multi $i"\ndone' }
const shells = isWindows ? [powershell, bash] : [{ ...bash, name: 'Bash', profile: 'bash' }]

for (const shell of shells) {
  test.describe(shell.name, () => {
    test.beforeEach(async () => {
      wrapped = await launch({ settings: `[terminal]\ndefaultProfile = "${shell.profile}"\nrestoreSession = false\n` })
    })
    test.afterEach(() => wrapped.close())

    test('splits commands into blocks with output', async () => {
      const { page } = wrapped
      const block = await run(page, 'echo hello-wrapped')
      await expect(block.locator('[data-testid=block-command]')).toHaveText('echo hello-wrapped')
      await expect(block.locator('.block-output')).toHaveText(/^hello-wrapped/)
      const second = await run(page, 'echo second')
      await expect(second.locator('.block-output')).toHaveText(/^second/)
      await expect(block.locator('.block-output')).toHaveText(/^hello-wrapped/)
    })

    test('marks failures with the exit code', async () => {
      const block = await run(wrapped.page, shell.fail)
      await expect(block).toHaveClass(/failed/)
      await expect(block.locator('.meta-exit')).toHaveText('exit 3')
    })

    test('reports exit 1 for a command that does not exist', async () => {
      const block = await run(wrapped.page, shell.notFound)
      await expect(block).toHaveClass(/failed/)
    })

    test('runs multi-line commands', async () => {
      const { page } = wrapped
      await waitReady(page)
      await input(page).click()
      const [first, ...rest] = shell.multi.split('\n')
      await page.keyboard.insertText(first)
      for (const line of rest) {
        await page.keyboard.press('Shift+Enter')
        await page.keyboard.insertText(line.trim())
      }
      await page.keyboard.press('Enter')
      const block = page.locator('.block').first()
      await expect(block.locator('.block-output')).toContainText('multi 2', { timeout: 15_000 })
    })

    test('keeps long output complete', async () => {
      const command = shell.profile === 'powershell' ? '1..300 | % { "line $_" }' : 'seq 1 300 | sed "s/^/line /"'
      const block = await run(wrapped.page, command)
      await expect(block.locator('.line')).toHaveCount(300)
      await expect(block.locator('.line').last()).toHaveText('line 300')
    })

    test('stays usable after a resize during a command', async () => {
      // A hidden window that is resized stops getting frames from the compositor.
      test.skip(!!process.env.WRAPPED_E2E_HIDDEN, 'precisa de uma janela visível')
      const { page, app } = wrapped
      await waitReady(page)
      const command = shell.profile === 'powershell' ? '1..3 | % { "tick $_"; Start-Sleep 1 }' : 'for i in 1 2 3; do echo tick $i; sleep 1; done'
      await input(page).click()
      await page.keyboard.insertText(command)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1200)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
      const block = page.locator('.block').first()
      await expect(block).not.toHaveClass(/running/, { timeout: 15_000 })
      await expect(block.locator('.block-output')).toContainText('tick 3')
      const next = await run(page, 'echo after-resize')
      await expect(next.locator('.block-output')).toHaveText(/^after-resize/)
    })

    test('takes over the pane for alternate screen programs', async () => {
      const { page } = wrapped
      await waitReady(page)
      const command = shell.profile === 'powershell'
        ? `powershell -NoProfile -c "[Console]::Out.Write([string][char]27+'[?1049hALT'); Start-Sleep 2; [Console]::Out.Write([string][char]27+'[?1049l')"`
        : `printf '\\033[?1049hALT'; sleep 2; printf '\\033[?1049l'`
      await input(page).click()
      await page.keyboard.insertText(command)
      await page.keyboard.press('Enter')
      await expect(page.locator('.alt-layer.on')).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('.alt-layer.on')).not.toBeVisible({ timeout: 10_000 })
      await waitReady(page)
    })

    test('interrupts with Ctrl+C', async () => {
      const { page } = wrapped
      await waitReady(page)
      await input(page).click()
      await page.keyboard.insertText(shell.profile === 'powershell' ? 'Start-Sleep 60' : 'sleep 60')
      await page.keyboard.press('Enter')
      const block = page.locator('.block').first()
      await expect(block).toHaveClass(/running/, { timeout: 15_000 })
      await page.waitForTimeout(500)
      await page.keyboard.press('Control+c')
      await expect(block).not.toHaveClass(/running/, { timeout: 10_000 })
      await run(page, 'echo alive')
    })

    test('clear removes the blocks', async () => {
      const { page } = wrapped
      await run(page, 'echo one')
      await waitReady(page)
      await input(page).click()
      await page.keyboard.insertText('clear')
      await page.keyboard.press('Enter')
      await expect(page.locator('.block')).toHaveCount(0, { timeout: 10_000 })
    })
  })
}

test('interactive programs read keys from the running block', async () => {
  wrapped = await launch({ settings: `[terminal]\ndefaultProfile = "${isWindows ? 'powershell' : 'bash'}"\nrestoreSession = false\n` })
  const { page } = wrapped
  await waitReady(page)
  await input(page).click()
  await page.keyboard.insertText(isWindows ? '$a = Read-Host "nome"; "ola $a"' : 'read -p "nome: " a; echo "ola $a"')
  await page.keyboard.press('Enter')
  const block = page.locator('.block').first()
  await expect(block).toHaveClass(/running/, { timeout: 15_000 })
  await page.waitForTimeout(800)
  await page.keyboard.type('eros')
  await page.keyboard.press('Enter')
  await expect(block).not.toHaveClass(/running/, { timeout: 10_000 })
  await expect(block.locator('.block-output')).toContainText('ola eros')
  await wrapped.close()
})

test('cmd runs in classic mode', async () => {
  test.skip(!isWindows, 'cmd.exe só existe no Windows')
  wrapped = await launch({ settings: '[terminal]\ndefaultProfile = "cmd"\nrestoreSession = false\n' })
  const { page } = wrapped
  await expect(page.locator('.alt-layer.on')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.keyboard.type('echo classic-ok')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const text = await page.evaluate(() => document.querySelector('.alt-layer canvas') ? 'canvas' : document.querySelector('.alt-layer')?.textContent)
  expect(text).toBeTruthy()
  await wrapped.close()
})
