import { describe, expect, it } from 'vitest'
import { findLinks, parseShellHistory, resolveOutputPath } from '../../src/shared/logic'

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
})



describe('parseShellHistory', () => {
  it('reads bash history and skips timestamps', () => {
    expect(parseShellHistory('#1700000000\nls -la\n\ngit status\n', 'plain')).toEqual(['ls -la', 'git status'])
  })
  it('reads zsh extended history with continuation lines', () => {
    expect(parseShellHistory(': 1700000000:0;ls\n: 1700000001:2;for i in 1 2; do\\\necho $i\\\ndone\n', 'zsh'))
      .toEqual(['ls', 'for i in 1 2; do\necho $i\ndone'])
  })
  it('reads fish history', () => {
    expect(parseShellHistory('- cmd: git log\n  when: 1700000000\n- cmd: echo a\\nb\n  when: 1\n', 'fish')).toEqual(['git log', 'echo a\nb'])
  })
})
