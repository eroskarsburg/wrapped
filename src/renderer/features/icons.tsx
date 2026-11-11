const paths = {
  tabs: 'M3 5h18v14H3zM3 9h18M9 5v4',
  drive: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  files: 'M6 3h8l4 4v14H6zM14 3v4h4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  git: 'M6 4v12M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 8c0 5-12 2-12 8',
  agent: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  // A gear: eight teeth around a hub.
  settings: 'M10.48 4.96L10.74 2.58H13.26L13.52 4.96L15.91 5.95L17.76 4.45L19.55 6.24L18.05 8.09L19.04 10.48L21.42 10.74V13.26L19.04 13.52L18.05 15.91L19.55 17.76L17.76 19.55L15.91 18.05L13.52 19.04L13.26 21.42H10.74L10.48 19.04L8.09 18.05L6.24 19.55L4.45 17.76L5.95 15.91L4.96 13.52L2.58 13.26V10.74L4.96 10.48L5.95 8.09L4.45 6.24L6.24 4.45L8.09 5.95ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
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
