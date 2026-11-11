import { describe, expect, it } from 'vitest'
import { commandRequest, findLinks, formatAgo, parseGitStats, unmetafy, modelRequestOptions, parseShellHistory, predictNextCommand, resolveOutputPath } from '../../src/shared/logic'

const targets = (text: string) => findLinks(text).map((link) => link.target)

describe('findLinks', () => {
  it('finds URLs and drops sentence punctuation', () => {
    expect(targets('veja https://example.com/a?b=1.')).toEqual(['https://example.com/a?b=1'])
  })
  it('finds Windows, Unix and home paths', () => {
    expect(targets('C:\\Users\\eu\\a.txt e /etc/hosts e ~/notas/x.md')).toEqual(['C:\\Users\\eu\\a.txt', '/etc/hosts', '~/notas/x.md'])
  })
  it('finds relative paths with an extension and a line suffix', () => {
    const [link] = findLinks('src/main/pty.ts:42:7 - error TS2322')
    expect(link).toMatchObject({ target: 'src/main/pty.ts', line: 42, column: 7, url: false })
    expect('src/main/pty.ts:42:7 - error'.slice(link.from, link.to)).toBe('src/main/pty.ts:42:7')
  })
  it('ignores prose and lone slashes', () => {
    expect(targets('and/or e 1/2 e / sozinha')).toEqual([])
  })
  it('keeps balanced parentheses in URLs and drops a closing one', () => {
    expect(targets('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
    expect(targets('(veja https://example.com/a)')).toEqual(['https://example.com/a'])
  })
  it('does not split a path inside a word', () => {
    expect(targets('foo/bar.ts')).toEqual(['foo/bar.ts'])
    expect(targets('http://x.dev/a/b.js')).toEqual(['http://x.dev/a/b.js'])
  })
})

describe('resolveOutputPath', () => {
  it('resolves relative paths against the block directory', () => {
    expect(resolveOutputPath('src/a.ts', '/home/eu/proj', '/home/eu')).toBe('/home/eu/proj/src/a.ts')
    expect(resolveOutputPath('../b.ts', '/home/eu/proj', '/home/eu')).toBe('/home/eu/b.ts')
    expect(resolveOutputPath('src\\a.ts', 'C:\\proj', 'C:\\Users\\eu')).toBe('C:\\proj\\src\\a.ts')
  })
  it('keeps absolute paths and expands the home directory', () => {
    expect(resolveOutputPath('/etc/hosts', '/tmp', '/home/eu')).toBe('/etc/hosts')
    expect(resolveOutputPath('~/x', '/tmp', '/home/eu')).toBe('/home/eu/x')
  })
  it('stops at the root instead of turning the path relative', () => {
    expect(resolveOutputPath('../../../../x', '/home/eu', '/home/eu')).toBe('/x')
    expect(resolveOutputPath('..\\..\\..\\x', 'C:\\proj', 'C:\\Users\\eu')).toBe('C:\\x')
  })
})



describe('parseShellHistory', () => {
  it('reads bash history and skips timestamps', () => {
    expect(parseShellHistory('#1700000000\nls -la\n\ngit status\n', 'plain')).toEqual(['ls -la', 'git status'])
  })
  it('keeps bash commands that end in a backtick and joins PowerShell continuations', () => {
    expect(parseShellHistory('echo `date`\nls\n', 'plain')).toEqual(['echo `date`', 'ls'])
    expect(parseShellHistory('Get-Item `\n-Path x\nls\n', 'powershell')).toEqual(['Get-Item `\n-Path x', 'ls'])
  })
  it('reads zsh extended history with continuation lines', () => {
    expect(parseShellHistory(': 1700000000:0;ls\n: 1700000001:2;for i in 1 2; do\\\necho $i\\\ndone\n', 'zsh'))
      .toEqual(['ls', 'for i in 1 2; do\necho $i\ndone'])
  })
  it('reads fish history', () => {
    expect(parseShellHistory('- cmd: git log\n  when: 1700000000\n- cmd: echo a\\nb\n  when: 1\n', 'fish')).toEqual(['git log', 'echo a\nb'])
  })
})

describe('modelRequestOptions', () => {
  it('turns on adaptive thinking, effort and fallbacks on current models', () => {
    expect(modelRequestOptions('claude-opus-5-5', 'high')).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
  })
  it('leaves fallbacks out where the API has none', () => {
    const haiku = modelRequestOptions('claude-haiku-5-5', 'low')
    expect(haiku.fallbacks).toBeUndefined()
    expect(haiku.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
  })
  it('sends nothing extra to models without adaptive thinking', () => {
    expect(modelRequestOptions('claude-haiku-4-5', 'high')).toEqual({})
  })
})

describe('commandRequest', () => {
  it('reads a request after the hash', () => {
    expect(commandRequest('# listar arquivos grandes')).toBe('listar arquivos grandes')
    expect(commandRequest('#mostrar portas abertas')).toBe('mostrar portas abertas')
  })
  it('ignores normal commands and a lone hash', () => {
    expect(commandRequest('ls -la')).toBeNull()
    expect(commandRequest('#')).toBeNull()
    expect(commandRequest('echo # nao')).toBeNull()
  })
})

describe('predictNextCommand', () => {
  const h = (...commands: string[]) => commands.map((command) => ({ command }))
  it('picks the most frequent follow-up', () => {
    expect(predictNextCommand(h('git add .', 'git commit', 'ls', 'git add .', 'git commit', 'git add .', 'git status'), 'git add .')).toBe('git commit')
  })
  it('breaks ties with the most recent and skips repeats', () => {
    expect(predictNextCommand(h('make', 'make', 'make test', 'make', 'make run'), 'make')).toBe('make run')
  })
  it('prefers follow-ups from the same directory', () => {
    const history = [
      { command: 'npm i', cwd: '/a' }, { command: 'npm run dev', cwd: '/a' },
      { command: 'npm i', cwd: '/b' }, { command: 'npm test', cwd: '/b' },
      { command: 'npm i', cwd: '/b' }, { command: 'npm test', cwd: '/b' },
    ]
    expect(predictNextCommand(history, 'npm i', '/a')).toBe('npm run dev')
    expect(predictNextCommand(history, 'npm i', '/b')).toBe('npm test')
  })
  it('returns null without data', () => {
    expect(predictNextCommand(h('ls'), 'ls')).toBeNull()
  })
})

describe('formatAgo', () => {
  const now = 10 ** 12
  it('describes elapsed time', () => {
    expect(formatAgo(now - 5_000, now)).toBe('agora')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('há 5 min')
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('há 3 h')
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe('há 2 d')
    expect(formatAgo(now - 65 * 86_400_000, now)).toBe('há 2 meses')
  })
})

describe('parseGitStats', () => {
  it('sums lines, counts binaries and untracked files', () => {
    expect(parseGitStats('10\t2\tsrc/a.ts\n-\t-\timg.png\n1\t0\tb.md\n', ' M src/a.ts\n?? novo.txt\n?? outro.txt\n'))
      .toEqual({ files: 5, added: 11, removed: 2 })
  })
  it('is empty for a clean tree', () => {
    expect(parseGitStats('', '')).toEqual({ files: 0, added: 0, removed: 0 })
  })
})

describe('regressions found while testing', () => {
  it('runs a pasted script that starts with a comment instead of asking the model', () => {
    expect(commandRequest('# instala dependencias\nnpm install')).toBeNull()
  })
  it('does not link versions and fractions', () => {
    expect(findLinks('node/20.1 e 3/4.5 e pkg/v1.2').map((l) => l.target)).toEqual([])
    expect(findLinks('./dist/v1.2 lib/x.so.6 src/a.test.ts:9').map((l) => l.target)).toEqual(['./dist/v1.2', 'lib/x.so.6', 'src/a.test.ts'])
  })
  it('decodes accented commands from a metafied zsh history', () => {
    // "É" is C3 89 in UTF-8, and 0x89 is in the metafied range: zsh writes C3 83 A9.
    const bytes = Uint8Array.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0xc3, 0x83, 0xa9])
    expect(new TextDecoder().decode(unmetafy(bytes))).toBe('echo É')
  })
})

describe('regressions found in review', () => {
  const first = (text: string) => findLinks(text)[0]
  it('reads the line suffix on absolute and Windows paths', () => {
    expect(first('at (/home/x/a.js:3:1)')).toMatchObject({ target: '/home/x/a.js', line: 3, column: 1 })
    expect(first('C:\\Users\\x\\a.ts:10:2 erro')).toMatchObject({ target: 'C:\\Users\\x\\a.ts', line: 10, column: 2 })
    expect(first('http://localhost:3000/a')).toMatchObject({ target: 'http://localhost:3000/a', line: undefined })
  })
  it('opens file:// URLs as paths', () => {
    expect(findLinks('error at file:///home/x/a.js:3:1').map((l) => [l.target, l.line])).toEqual([['/home/x/a.js', 3]])
  })
  it('skips protocol versions and media types, and git diff prefixes', () => {
    expect(findLinks('HTTP/1.1 200 application/vnd.api text/html npm/10.2').length).toBe(0)
    expect(first('--- a/src/main.ts').target).toBe('src/main.ts')
    expect(first('+++ b/src/main.ts').target).toBe('src/main.ts')
    expect(first('veja a/src/main.ts').target).toBe('a/src/main.ts')
  })
  it('resolves paths of a WSL pane inside the distro', () => {
    const cwd = '\\\\wsl.localhost\\Ubuntu\\home\\x\\proj'
    expect(resolveOutputPath('/home/x/a.ts', cwd, 'C:\\Users\\x')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\x\\a.ts')
    expect(resolveOutputPath('src/a.ts', cwd, 'C:\\Users\\x')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\x\\proj\\src\\a.ts')
  })
})
