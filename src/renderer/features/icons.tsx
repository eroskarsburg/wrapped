const paths = {
  tabs: 'M3 5h18v14H3zM3 9h18M9 5v4',
  drive: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  files: 'M6 3h8l4 4v14H6zM14 3v4h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  git: 'M6 4v12M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 8c0 5-12 2-12 8',
  agent: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12l2-1 1-3-1-2 2-2 2 1 3-1 1-2h2l1 2 3 1 2-1 2 2-1 2 1 3 2 1v2l-2 1-1 3 1 2-2 2-2-1-3 1-1 2h-2l-1-2-3-1-2 1-2-2 1-2-1-3-2-1z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  chevron: 'M6 9l6 6 6-6',
  play: 'M7 5l12 7-12 7z',
  stop: 'M6 6h12v12H6z',
  splitRight: 'M4 5h16v14H4zM12 5v14',
  splitDown: 'M4 5h16v14H4zM4 12h16',
  share: 'M12 4v12M7 9l5-5 5 5M5 20h14',
  folder: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  file: 'M6 3h8l4 4v14H6z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  redo: 'M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a6 6 0 1 0 2 5',
  down: 'M12 4v16M6 14l6 6 6-6',
  sync: 'M4 8h13l-3-3M20 16H7l3 3',
  chat: 'M4 5h16v11H9l-5 4z',
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name]} />
    </svg>
  )
}
