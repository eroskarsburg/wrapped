import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASE, POSIX, SHELL, countTo, input, isWindows, launch, run, waitReady, type App } from './helpers'

let wrapped: App
test.afterEach(async () => {
  await wrapped?.close().catch(() => undefined)
})

test('opens, closes and restores tabs', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+Shift+T')
  await expect(page.getByTestId('tab-row')).toHaveCount(2)
  await page.keyboard.press('Control+Shift+W')
  await expect(page.getByTestId('tab-row')).toHaveCount(1)
  await page.keyboard.press('Control+Alt+T')
  await expect(page.getByTestId('tab-row')).toHaveCount(2)
  await page.getByTestId('tab-row').first().dblclick()
  await page.keyboard.type('renomeada')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tab-row').first()).toContainText('renomeada')
})

test('splits panes and syncs input between them', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+Shift+D')
  await expect(page.locator('[data-pane]')).toHaveCount(2)
  await expect(page.locator('.input-editor:not(.waiting)')).toHaveCount(2, { timeout: 20_000 })
  await page.keyboard.press('Control+Alt+I')
  await input(page).click()
  await page.keyboard.insertText('echo sincronizado')
  await page.keyboard.press('Enter')
  await expect(page.locator('.block-output', { hasText: 'sincronizado' })).toHaveCount(2, { timeout: 15_000 })
  await page.keyboard.press('Control+Shift+X')
  await expect(page.locator('[data-pane]')).toHaveCount(1)
})

test('filters a block and finds across blocks', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  const block = await run(page, countTo(50))
  await block.locator('.block-header').hover()
  await block.locator('button[title="Filtrar saída"]').click()
  await block.locator('.block-filter > input').fill('item 4')
  await expect(block.locator('.line')).toHaveCount(11)
  await block.locator('.block-filter > input').press('Escape')
  await expect(block.locator('.line')).toHaveCount(50)
  await page.keyboard.press('Control+Shift+F')
  await page.locator('.find-bar > input').fill('item 7')
  await expect(page.locator('.find-bar .muted')).toHaveText(/\/1\d?$/)
  await expect(page.locator('mark.current')).toHaveCount(1)
})

test('copies, bookmarks, collapses and selects blocks', async () => {
  wrapped = await launch({ settings: BASE })
  const { page, app } = wrapped
  const block = await run(page, 'echo copiar-isto')
  await block.locator('.block-header').hover()
  await block.locator('[data-action=copy-output]').click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('copiar-isto')
  await block.locator('button[title="Marcar"]').click()
  await expect(block.locator('.meta-mark')).toBeVisible()
  await block.locator('button[title="Recolher"]').click()
  await expect(block.locator('.block-collapsed')).toBeVisible()
  await input(page).click()
  await page.keyboard.press('Control+ArrowUp')
  await expect(block).toHaveClass(/selected/)
})

test('hides secrets in the output until revealed', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  const secret = `ghp_${'a1'.repeat(18)}`
  const block = await run(page, `echo "${secret}"`)
  await expect(block.locator('.block-output')).not.toContainText(secret)
  await expect(block.locator('.secret')).toHaveCount(1)
  await block.locator('.block-header').hover()
  await block.locator('button[title="Revelar secrets"]').click()
  await expect(block.locator('.block-output')).toContainText(secret)
})

test('suggests from history and accepts with the right arrow', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, 'echo autosugestao-unica')
  await waitReady(page)
  await input(page).click()
  await page.keyboard.type('echo auto')
  await expect(page.locator('.ghost')).toHaveText('sugestao-unica')
  await page.keyboard.press('ArrowRight')
  await expect(input(page)).toHaveText('echo autosugestao-unica')
})

test('accepts the history suggestion with Tab', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, 'echo sugestao-com-tab')
  await waitReady(page)
  await input(page).click()
  await page.keyboard.type('echo suges')
  await expect(page.locator('.ghost')).toHaveText('tao-com-tab')
  await page.keyboard.press('Tab')
  await expect(input(page)).toHaveText('echo sugestao-com-tab')
  await expect(page.locator('.completions')).toHaveCount(0)
})

test('walks history with the arrows and searches it with Ctrl+R', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, 'echo primeiro')
  await run(page, 'echo segundo')
  await waitReady(page)
  await input(page).click()
  await page.keyboard.press('ArrowUp')
  await expect(input(page)).toHaveText('echo segundo')
  await page.keyboard.press('ArrowUp')
  await expect(input(page)).toHaveText('echo primeiro')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(input(page)).toHaveText('')
  await page.keyboard.press('Control+r')
  await page.getByTestId('command-search').getByPlaceholder('Buscar no histórico').fill('prim')
  await page.keyboard.press('Enter')
  await expect(input(page)).toHaveText('echo primeiro')
})

test('completes commands and paths with Tab', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await input(page).click()
  await page.keyboard.type('git chec')
  await page.keyboard.press('Tab')
  await expect(page.locator('.completion.selected')).toContainText('checkout', { timeout: 8000 })
  await page.keyboard.press('Tab')
  await expect(input(page)).toHaveText(/git checkout\s/)
})

test('underlines unknown commands and suggests a correction', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await input(page).click()
  await expect.poll(async () => {
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText('gti')
    return page.locator('.tok-error').count()
  }, { timeout: 30_000 }).toBeGreaterThan(0)
  await page.keyboard.press('Enter')
  const button = page.locator('.correction')
  await expect(button).toContainText('git', { timeout: 15_000 })
  await button.click()
  await expect(input(page)).toHaveText('git')
})

test('runs workflows with arguments from the palette', async () => {
  wrapped = await launch({ settings: BASE })
  const { page, home } = wrapped
  await waitReady(page)
  writeFileSync(join(home, 'workflows', 'saudacao.yaml'), [
    'name: Saudação de teste',
    'command: echo "ola {{nome}}"',
    'arguments:',
    '  - name: nome',
    '    default_value: mundo',
  ].join('\n'))
  await expect.poll(async () => {
    await page.keyboard.press('Control+Shift+P')
    await page.getByTestId('palette').locator('input').fill('Saudação de teste')
    const found = await page.locator('.palette-item').filter({ hasText: 'Saudação' }).count()
    if (!found) await page.keyboard.press('Escape')
    return found
  }, { timeout: 10_000 }).toBe(1)
  await page.keyboard.press('Enter')
  await page.getByTestId('param-dialog').locator('input').fill('eros')
  await page.keyboard.press('Enter')
  await expect(input(page)).toHaveText('echo "ola eros"')
})

test('launches a tab config with panes, commands and params', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wrapped-e2e-'))
  mkdirSync(join(home, 'tab_configs'), { recursive: true })
  writeFileSync(join(home, 'tab_configs', 'dev.toml'), `
name = "Dev de teste"
title = "{{projeto}}"

[[panes]]
id = "root"
split = "horizontal"
children = ["a", "b"]

[[panes]]
id = "a"
type = "terminal"
commands = ["echo painel-a-{{projeto}}"]

[[panes]]
id = "b"
type = "terminal"
shell = "bash"
commands = ["echo painel-b"]

[params.projeto]
default = "demo"
`)
  wrapped = await launch({ settings: BASE, home })
  const { page } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette').locator('input').fill('Dev de teste')
  await page.keyboard.press('Enter')
  await page.getByTestId('param-dialog').locator('input').fill('alfa')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tab-row').last()).toContainText('alfa')
  await expect(page.locator('.block-output', { hasText: 'painel-a-alfa' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.block-output', { hasText: 'painel-b' })).toBeVisible({ timeout: 20_000 })
})

test('custom profiles set env, startup commands and their own theme', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wrapped-e2e-'))
  mkdirSync(join(home, 'profiles'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'meu.toml'), `
name = "Meu terminal"
${isWindows ? 'command = "powershell.exe"\nkind = "powershell"' : 'command = "bash"\nkind = "bash"'}
theme = "dracula"
color = "#ff00ff"
startup = ["echo perfil-${isWindows ? '$env:' : '$'}MINHA_VAR"]

[env]
MINHA_VAR = "funciona"
`)
  wrapped = await launch({ settings: '[terminal]\ndefaultProfile = "user-meu"\nrestoreSession = false\n', home })
  const { page } = wrapped
  await expect(page.locator('.block-output', { hasText: 'perfil-funciona' })).toBeVisible({ timeout: 20_000 })
  const background = await page.locator('[data-pane]').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(background).toBe('rgb(40, 42, 54)')
})

test('creates a profile in the settings screen', async () => {
  wrapped = await launch({ settings: BASE })
  const { page, home } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+,')
  await page.getByTestId('settings').getByRole('button', { name: 'Perfis' }).click()
  await page.getByTestId('new-profile').click()
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Criado na tela')
  await page.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(page.locator('.profile-row', { hasText: 'Criado na tela' })).toBeVisible()
  expect(readFileSync(join(home, 'profiles', 'criado_na_tela.toml'), 'utf8')).toContain('Criado na tela')
})

test('chooses font, size and weight with live preview', async () => {
  wrapped = await launch({ settings: BASE })
  const { page, home } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+,')
  const picker = page.getByTestId('font-picker')
  await picker.getByRole('checkbox', { name: 'Só monoespaçadas' }).uncheck()
  const first = picker.locator('.font-option:not(.on)').first()
  await expect(first).toBeVisible({ timeout: 15_000 })
  const family = (await first.getAttribute('data-family'))!
  const option = picker.locator(`.font-option[data-family="${family}"]`)
  await option.hover()
  await expect(picker.getByTestId('font-preview')).toContainText(`Prévia: ${family}`)
  await option.click()
  await expect(option).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-mono'))).toContain(family)
  await picker.getByRole('spinbutton', { name: 'Tamanho da fonte' }).fill('18')
  await picker.getByRole('radio', { name: /Bold/ }).first().click()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size'))).toBe('18px')
  await expect.poll(() => readFileSync(join(home, 'settings.toml'), 'utf8')).toContain('fontWeight = "bold"')
  const saved = readFileSync(join(home, 'settings.toml'), 'utf8')
  expect(saved).toContain('fontSize = 18')
  expect(saved).toContain('fontWeight = "bold"')
  expect(saved).toContain(family)
})

test('downloads a popular web font and uses it in the terminal', async () => {
  wrapped = await launch({ settings: BASE })
  const { page, home } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+,')
  const picker = page.getByTestId('font-picker')
  await picker.getByRole('textbox', { name: 'Buscar fonte' }).fill('Space Mono')
  const option = picker.locator('.font-option[data-family="Space Mono"]')
  await expect(option).toContainText('da web', { timeout: 20_000 })
  await option.click()
  await expect(option).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => document.fonts.check('15px "Space Mono"') && getComputedStyle(document.documentElement).getPropertyValue('--font-mono'))).toContain('Space Mono')
  expect(existsSync(join(home, 'fonts', 'space-mono', '400.woff2'))).toBe(true)
  await expect.poll(() => readFileSync(join(home, 'settings.toml'), 'utf8')).toContain('Space Mono')
})

test('draws live programs with the configured font', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  // The xterm WebGL renderer sets fonts with a leading space, which Chromium would reject.
  const font = await page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d')!
    context.font = ' normal 20px monospace'
    return context.font
  })
  expect(font).toBe('20px monospace')
})

test('changes the theme and persists settings', async () => {
  wrapped = await launch({ settings: BASE })
  const { page, home } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette').locator('input').fill('Tema: Gruvbox')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'))).toBe('#282828')
  await expect.poll(() => readFileSync(join(home, 'settings.toml'), 'utf8')).toContain('gruvbox-dark')
})

test('applies window opacity and moves the input', async () => {
  wrapped = await launch({ settings: `[appearance]\nwindowOpacity = 80\ninputPosition = "top"\n${BASE}` })
  const { page, app } = wrapped
  await waitReady(page)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity())).toBeCloseTo(0.8)
  await expect(page.locator('.terminal-pane.input-top')).toBeVisible()
})

test('rebinds a shortcut through keybindings.yaml', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wrapped-e2e-'))
  writeFileSync(join(home, 'keybindings.yaml'), 'palette: ctrl-shift-L\n')
  wrapped = await launch({ settings: BASE, home })
  const { page } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+Shift+L')
  await expect(page.getByTestId('palette')).toBeVisible()
})

test('supports vim keys in the input', async () => {
  wrapped = await launch({ settings: `[input]\nvim = true\n${BASE}` })
  const { page } = wrapped
  await waitReady(page)
  await input(page).click()
  await page.keyboard.press('i')
  await page.keyboard.type('echo abc')
  await page.keyboard.press('Escape')
  await page.keyboard.press('x')
  await expect(input(page)).toHaveText('echo ab')
})

test('restores tabs and blocks after a restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wrapped-e2e-'))
  const first = await launch({ settings: `[terminal]\ndefaultProfile = "${SHELL}"\n`, home, keepHome: true })
  await run(first.page, 'echo sobrevive-ao-reinicio')
  await first.page.waitForTimeout(1500)
  await first.close()
  wrapped = await launch({ home })
  await expect(wrapped.page.locator('.block-output', { hasText: 'sobrevive-ao-reinicio' })).toBeVisible({ timeout: 15_000 })
})

test('shows output printed while idle as a background block', async () => {
  wrapped = await launch({ settings: `[terminal]\ndefaultProfile = "${POSIX}"\nrestoreSession = false\n` })
  const { page } = wrapped
  await run(page, '(sleep 1; echo tarefa-em-segundo-plano) &')
  await expect(page.locator('.block.background', { hasText: 'tarefa-em-segundo-plano' })).toBeVisible({ timeout: 10_000 })
})

test('opens files, renders markdown and shows git changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrapped-repo-'))
  writeFileSync(join(dir, 'nota.txt'), 'conteudo original\n')
  writeFileSync(join(dir, 'leia.md'), '# Titulo\n\ntexto\n')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, `cd "${dir}"; git init -q; git add .; git -c user.name=t -c user.email=t@t commit -qm init`)
  await expect(page.locator('.chip-git')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Control+Shift+B')
  await page.locator('.file-row', { hasText: 'nota.txt' }).click()
  await expect(page.locator('.code-host .cm-content')).toContainText('conteudo original')
  await page.locator('.code-host .cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('linha nova')
  await page.keyboard.press('Control+s')
  await expect.poll(() => readFileSync(join(dir, 'nota.txt'), 'utf8')).toContain('linha nova')
  await page.locator('.file-row', { hasText: 'leia.md' }).click()
  await expect(page.locator('.markdown h1')).toHaveText('Titulo')
  await page.keyboard.press('Control+Shift+J')
  await page.locator('button[title="Atualizar"]').first().click()
  await page.locator('.file-row', { hasText: 'nota.txt' }).click()
  await expect(page.locator('.diff .add', { hasText: 'linha nova' })).toBeVisible()
})

test('lets programs write the clipboard through OSC 52', async () => {
  wrapped = await launch({ settings: `[terminal]\ndefaultProfile = "${POSIX}"\nrestoreSession = false\n` })
  const { page, app } = wrapped
  await run(page, `printf '\\033]52;c;%s\\007' "$(printf osc52-ok | base64)"`)
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('osc52-ok')
})

test('turns URLs into links and selects paths as a unit', async () => {
  wrapped = await launch({ settings: `[terminal]\ncopyOnSelect = true\ndefaultProfile = "${SHELL}"\nrestoreSession = false\n` })
  const { page, app } = wrapped
  const path = isWindows ? 'C:\\Temp\\arquivo.txt' : '/tmp/pasta/arquivo.txt'
  const block = await run(page, `echo "veja https://example.com/docs e ${path}"`)
  await expect(block.locator('a.link')).toHaveCount(2)
  await block.locator('a.link').nth(1).dblclick()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(path)
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path)
  await expect(page.locator('.code-pane')).toHaveCount(0)
})

test('registers the global hotkey from the settings', async () => {
  wrapped = await launch({ settings: `[hotkey]\nmode = "quake"\nkeybinding = "Control+Alt+F11"\n${BASE}` })
  const { page, app } = wrapped
  await waitReady(page)
  expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F11'))).toBe(true)
})

test('runs notebook shell cells in the terminal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'wrapped-e2e-'))
  mkdirSync(join(home, 'notebooks'), { recursive: true })
  writeFileSync(join(home, 'notebooks', 'nb.md'), '# Caderno\n\n```shell\necho celula-executada\n```\n')
  wrapped = await launch({ settings: BASE, home })
  const { page } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+Shift+Y')
  await page.locator('.drive-item', { hasText: 'Caderno' }).click()
  await page.locator('.run-cell').click()
  await expect(page.locator('.block-output', { hasText: 'celula-executada' })).toBeVisible({ timeout: 15_000 })
})

test('agent stays off by default and asks before running commands', async () => {
  const requests: { body: any; beta?: string | string[] }[] = []
  const server = createServer((request, response) => {
    let data = ''
    request.on('data', (chunk) => (data += chunk))
    request.on('end', () => {
      requests.push({ body: JSON.parse(data), beta: request.headers['anthropic-beta'] })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const send = (type: string, payload: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`)
      const usage = { input_tokens: 1, output_tokens: 1 }
      send('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage } })
      if (requests.length === 1) {
        send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'run_command', input: {} } })
        send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: 'echo do-agente' }) } })
        send('content_block_stop', { index: 0 })
        send('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
      } else {
        send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Pronto, comando executado.' } })
        send('content_block_stop', { index: 0 })
        send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
      }
      send('message_stop', {})
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste'
  try {
    wrapped = await launch({ settings: BASE })
    const { page } = wrapped
    await waitReady(page)
    await page.keyboard.press('Control+Shift+A')
    const panel = page.getByTestId('agent-panel')
    await panel.getByRole('button', { name: 'Ativar' }).click()
    await panel.locator('textarea').fill('rode um echo')
    await page.keyboard.press('Enter')
    const allow = panel.getByRole('button', { name: 'Permitir' })
    await expect(allow).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.block-output', { hasText: 'do-agente' })).toHaveCount(0)
    await allow.click()
    await expect(page.locator('.block-output', { hasText: 'do-agente' })).toBeVisible({ timeout: 15_000 })
    await expect(panel.locator('.msg.assistant')).toContainText('Pronto, comando executado.', { timeout: 15_000 })
    const toolResult = requests[1].body.messages.at(-1).content[0]
    expect(toolResult.type).toBe('tool_result')
    expect(toolResult.content).toContain('do-agente')
    expect(requests[0].body.model).toBe('claude-opus-5-5')
    expect(requests[0].body.fallbacks).toBe('default')
    expect(String(requests[0].beta)).toContain('server-side-fallback-2026-07-01')
  } finally {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_API_KEY
    server.close()
  }
})

test("keeps the user's PROMPT_COMMAND hooks running in bash", async () => {
  test.skip(isWindows, 'mesma integração; o perfil abaixo usa o bash do PATH')
  const home = mkdtempSync(join(tmpdir(), 'wrapped-e2e-'))
  mkdirSync(join(home, 'profiles'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'hook.toml'), `
name = "Com hook"
command = "bash"
kind = "bash"

[env]
PROMPT_COMMAND = "__hook_status=$?; __hook_count=$(( \${__hook_count:-0} + 1 )); PS1='custom> '"
`)
  wrapped = await launch({ settings: '[terminal]\ndefaultProfile = "user-hook"\nrestoreSession = false\n', home })
  const { page } = wrapped
  await run(page, 'echo primeiro')
  const block = await run(page, 'echo "hooks-$__hook_count"')
  await expect(block.locator('.block-output')).toHaveText(/^hooks-[2-9]/)
  // A hook that rewrites PS1 must not take the markers away: the next blocks still end.
  await run(page, '(exit 7)')
  const status = await run(page, 'echo "status-$__hook_status"')
  await expect(status.locator('.block-output')).toHaveText(/^status-7/)
  // Tools such as zoxide check that their hook is still listed in PROMPT_COMMAND.
  const listed = await run(page, '[[ ${PROMPT_COMMAND[*]} == *__hook_count* ]] && echo listado')
  await expect(listed.locator('.block-output')).toHaveText(/^listado/)
})

test('turns a "#" request into a command without running it', async () => {
  const bodies: any[] = []
  const server = createServer((request, response) => {
    let data = ''
    request.on('data', (chunk) => (data += chunk))
    request.on('end', () => {
      bodies.push(JSON.parse(data))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify({ command: 'echo gerado-pela-ia', explanation: 'Imprime um texto.' }) }],
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste'
  try {
    wrapped = await launch({ settings: `[agent]\nenabled = false\n${BASE}` })
    const { page } = wrapped
    await waitReady(page)
    await input(page).click()
    await page.keyboard.insertText('# imprima um texto')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('input-notice')).toContainText('Ative o Agent Mode')
    await page.keyboard.press('Control+Shift+A')
    await page.getByTestId('agent-panel').getByRole('button', { name: 'Ativar' }).click()
    await page.keyboard.press('Control+Shift+A')
    await input(page).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(input(page)).toHaveText('echo gerado-pela-ia', { timeout: 15_000 })
    await expect(page.getByTestId('input-notice')).toHaveText('Imprime um texto.')
    await expect(page.locator('.block')).toHaveCount(0)
    const body = bodies.at(-1)
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.output_config).toEqual(expect.objectContaining({ effort: 'low', format: expect.objectContaining({ type: 'json_schema' }) }))
    expect(body.messages[0].content).toContain('imprima um texto')
    await page.keyboard.press('Enter')
    await expect(page.locator('.block .block-output')).toHaveText(/^gerado-pela-ia/, { timeout: 15_000 })
  } finally {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_API_KEY
    server.close()
  }
})

test('suggests the command that usually comes next', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, 'echo passo-um')
  await run(page, 'echo passo-dois')
  await run(page, 'echo passo-um')
  await waitReady(page)
  await expect(page.locator('.ghost')).toHaveText('echo passo-dois')
  await input(page).click()
  await page.keyboard.press('Tab')
  await expect(input(page)).toHaveText('echo passo-dois')
})

test('maximizes a pane and keeps the others running', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await page.keyboard.press('Control+Shift+D')
  await expect(page.locator('.input-editor:not(.waiting)')).toHaveCount(2, { timeout: 20_000 })
  await page.keyboard.press('Control+Shift+Enter')
  await expect(page.locator('[data-pane]:visible')).toHaveCount(1)
  await expect(page.locator('.maximized-badge')).toContainText('2 panes')
  await run(page, 'echo so-no-maximizado')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.locator('[data-pane]:visible')).toHaveCount(1)
  await expect(page.locator('[data-pane]:visible .block')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+Enter')
  await expect(page.locator('[data-pane]:visible')).toHaveCount(2)
  await expect(page.locator('.block-output', { hasText: 'so-no-maximizado' })).toBeVisible()
})

test('jumps between bookmarked blocks', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  const first = await run(page, 'echo marcado-1')
  await run(page, 'echo comum')
  const third = await run(page, 'echo marcado-2')
  for (const block of [first, third]) {
    await block.locator('.block-header').hover()
    await block.locator('button[title="Marcar"]').click()
  }
  await input(page).click()
  await page.keyboard.press('Control+Alt+ArrowUp')
  await expect(third).toHaveClass(/selected/)
  await page.keyboard.press('Control+Alt+ArrowUp')
  await expect(first).toHaveClass(/selected/)
  await page.keyboard.press('Control+Alt+ArrowDown')
  await expect(third).toHaveClass(/selected/)
})

test('shows status and filters failures in the history search', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, 'echo deu-certo')
  await run(page, isWindows ? 'cmd /c "exit 4"' : '(exit 4)')
  await waitReady(page)
  await input(page).click()
  await page.keyboard.press('Control+r')
  const search = page.getByTestId('command-search')
  await expect(search.locator('.palette-item', { hasText: 'deu-certo' }).locator('.badge-ok')).toHaveText('ok')
  await expect(search.locator('.palette-item', { hasText: 'exit 4' }).locator('.badge-fail')).toHaveText('exit 4')
  await search.getByLabel('só os que falharam').check()
  await expect(search.locator('.palette-item')).toHaveCount(1)
})

test('shows a git diff chip that opens the changes panel', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrapped-repo-'))
  writeFileSync(join(dir, 'a.txt'), 'um\n')
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await run(page, `cd "${dir}"; git init -q; git add .; git -c user.name=t -c user.email=t@t commit -qm init`)
  await expect(page.locator('.chip-git')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.chip-diff')).toHaveCount(0)
  writeFileSync(join(dir, 'a.txt'), 'um\ndois\ntres\n')
  writeFileSync(join(dir, 'novo.txt'), 'x\n')
  await run(page, 'echo atualiza')
  await expect(page.locator('.chip-diff')).toHaveText('2 arquivos +2 −0', { timeout: 10_000 })
  await page.locator('.chip-diff').click()
  await expect(page.locator('.file-row', { hasText: 'novo.txt' })).toBeVisible()
})

test('turns the new features off through the settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrapped-repo-'))
  writeFileSync(join(dir, 'a.txt'), 'um\n')
  wrapped = await launch({
    settings: `[appearance]\npromptChips = ["cwd", "git"]\n[input]\nnextCommandSuggestions = false\n[agent]\ncommandGeneration = false\n[terminal]\nfileLinks = false\ndefaultProfile = "${SHELL}"\nrestoreSession = false\n`,
  })
  const { page } = wrapped
  await run(page, `cd "${dir}"; git init -q; git add .; git -c user.name=t -c user.email=t@t commit -qm init`)
  writeFileSync(join(dir, 'a.txt'), 'um\ndois\n')
  const block = await run(page, 'echo "https://example.com e src/main/pty.ts:3"')
  await expect(block.locator('a.link')).toHaveCount(1)
  await expect(page.locator('.chip-git')).toBeVisible()
  await expect(page.locator('.chip-diff')).toHaveCount(0)
  // The same command ran before, so a prediction would show here if the setting were on.
  await run(page, 'echo depois')
  await run(page, 'echo "https://example.com e src/main/pty.ts:3"')
  await waitReady(page)
  await expect(page.locator('.ghost')).toHaveCount(0)
  // With generation off, "#" goes to the shell as the comment it is, and nothing asks the model.
  await input(page).click()
  await page.keyboard.insertText('# so um comentario')
  await page.keyboard.press('Enter')
  await expect(input(page)).toHaveText('')
  await expect(page.getByTestId('input-notice')).toHaveCount(0)
  const after = await run(page, 'echo segue-vivo')
  await expect(after.locator('.block-output')).toHaveText(/^segue-vivo/)
})

test('brings a hidden pane to the front when it gets the focus while another is maximized', async () => {
  wrapped = await launch({ settings: BASE })
  const { page } = wrapped
  await waitReady(page)
  await run(page, 'echo pane-da-esquerda')
  await page.keyboard.press('Control+Shift+D')
  await expect(page.locator('.input-editor:not(.waiting)')).toHaveCount(2, { timeout: 20_000 })
  await page.keyboard.press('Control+Shift+Enter')
  await expect(page.locator('[data-pane]:visible .block')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette').locator('.palette-item', { has: page.locator('.palette-type', { hasText: 'sessão' }) }).first().click()
  await expect(page.locator('[data-pane]:visible')).toHaveCount(1)
  await expect(page.locator('[data-pane]:visible .block-output')).toHaveText(/^pane-da-esquerda/)
  await page.keyboard.press('Control+Shift+X')
  await expect(page.locator('[data-pane]:visible')).toHaveCount(1)
  await expect(page.locator('.maximized-badge')).toHaveCount(0)
})
