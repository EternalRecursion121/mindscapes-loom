import { useLayoutEffect, useState, type RefObject } from 'react';

/** How long you hover before a tooltip appears. */
export const TOOLTIP_DELAY_MS = 900;

const GAP = 6; // distance from the cursor for menus
/** tooltips sit a little further out so the cursor arrow doesn't cover them */
export const TOOLTIP_GAP = { x: 12, y: 18 };
const EDGE = 8; // never closer than this to the window edge
const SUBMENU_ROOM = 130; // rough height a submenu needs below its row

/**
 * Place a floating box (tooltip or menu) next to the cursor: below-right by default, flipped to
 * the left and/or above when it would otherwise leave the window. Measures the box after it
 * renders; it stays hidden until placed. Also says which way submenus should open.
 */
export function useNearCursor(ref: RefObject<HTMLElement>, x: number, y: number, gap: { x: number; y: number } = { x: GAP, y: GAP }) {
  const [p, setP] = useState({ left: x + gap.x, top: y + gap.y, subLeft: false, subUp: false, ready: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    let left = x + gap.x;
    if (left + w > W - EDGE) left = x - gap.x - w;
    let top = y + gap.y;
    if (top + h > H - EDGE) top = y - GAP - h;
    left = Math.max(EDGE, Math.min(left, W - w - EDGE));
    top = Math.max(EDGE, Math.min(top, H - h - EDGE));
    setP({ left, top, subLeft: left + 2 * w + EDGE > W, subUp: top + h + SUBMENU_ROOM > H, ready: true });
  }, [ref, x, y, gap.x, gap.y]);
  return {
    style: { left: p.left, top: p.top, visibility: p.ready ? ('visible' as const) : ('hidden' as const) },
    subClass: `${p.subLeft ? ' sub-left' : ''}${p.subUp ? ' sub-up' : ''}`,
  };
}
