const PATHS: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  download: 'M12 3v12m0 0 5-5m-5 5-5-5M4 21h16',
  upload: 'M12 21V9m0 0 5 5m-5-5-5 5M4 3h16',
  bug: 'M8 9h8v7a4 4 0 0 1-8 0V9zM12 9V6M9 6a3 3 0 0 1 6 0M4 13h4M16 13h4M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2',
  layers: 'm12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  rotate: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M10 21h.01M17 21h.01',
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  front: 'M12 19V5m0 0-6 6m6-6 6 6',
  back: 'M12 5v14m0 0 6-6m-6 6-6-6',
  image: 'M4 5h16v14H4zM4 15l5-5 5 5 2-2 4 4M15 9h.01',
  target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  perspective: 'M6 4h12l3 16H3L6 4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6 6 18',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
}

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
