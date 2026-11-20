import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

const EDGE = 8; // never closer than this to the window edge

/**
 * A submenu that always stays on screen. It opens beside its row: to the right if it fits, else
 * to the left if it fits, else (narrow screens, e.g. phones) below the whole menu, nudged sideways,
 * or above the menu if there is no room below. Measured after render; hidden until placed.
 */
export function Flyout({ anchor, children }: { anchor: RefObject<HTMLElement>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const row = anchor.current;
    const el = ref.current;
    if (!row || !el) return;
    const a = row.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
    let left: number;
    let top: number;
    if (a.right - 1 + w <= W - EDGE) {
      left = a.right - 1; // beside, to the right
      top = clamp(a.top - 1, EDGE, H - h - EDGE);
    } else if (a.left + 1 - w >= EDGE) {
      left = a.left + 1 - w; // beside, to the left
      top = clamp(a.top - 1, EDGE, H - h - EDGE);
    } else {
      // no room beside (phones): below the whole menu, or above it, nudged sideways so it reads
      // as a separate layer and never covers the menu it came from
      const menu = (row.closest('.node-menu') ?? row).getBoundingClientRect();
      const NUDGE = 18;
      left = menu.left + NUDGE + w <= W - EDGE ? menu.left + NUDGE : menu.right - NUDGE - w;
      left = clamp(left, EDGE, W - w - EDGE);
      top = menu.bottom + 4 + h <= H - EDGE ? menu.bottom + 4 : menu.top - 4 - h;
      top = clamp(top, EDGE, H - h - EDGE);
    }
    setPos({ left, top });
  }, [anchor]);

  return (
    <div
      className="node-menu sub"
      role="menu"
      ref={ref}
      style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>
  );
}
