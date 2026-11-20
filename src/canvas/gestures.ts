import { useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useLoom, useUi } from '../store';

const DRAG_THRESHOLD = 6;
const DOUBLE_CLICK_MS = 300;
import { TOOLTIP_DELAY_MS as HOVER_DELAY_MS } from '../floating';

type Mode = 'fork-pending' | 'move-pending' | 'fork' | 'move';

/**
 * Pointer handling shared by every node (arrow tool; the hand tool lets drags fall through to pan):
 *  - click                       -> select it (mouse); on touch, select and open the node menu
 *  - shift / ctrl / cmd + click  -> add it to or remove it from the selection
 *  - double click                -> open in chat
 *  - drag                        -> move it (and every other selected node with it)
 *  - shift + drag                -> fork: drag out a ghost child, drop it to write the next message there
 */
export function useNodeGestures(id: string) {
  const rf = useReactFlow();
  const st = useRef<{
    sx: number;
    sy: number;
    mode: Mode;
    ox: number;
    oy: number;
    /** where every node being moved started (the whole selection, if this node is in it) */
    group?: Record<string, { x: number; y: number }>;
    touch: boolean;
  } | null>(null);
  const clickTimer = useRef<number>();
  const hoverTimer = useRef<number>();
  const lastClick = useRef(0);
  const cursor = useRef({ x: 0, y: 0 });

  const ui = useUi.getState;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    window.clearTimeout(hoverTimer.current);
    const n = useLoom.getState().nodes[id];
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    st.current = {
      sx: e.clientX,
      sy: e.clientY,
      mode: e.shiftKey ? 'fork-pending' : 'move-pending',
      ox: p.x - n.x,
      oy: p.y - n.y,
      touch: e.pointerType !== 'mouse',
    };
    ui().set({ hover: null });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    cursor.current = { x: e.clientX, y: e.clientY };
    const s = st.current;
    if (!s) return;
    const dist = Math.hypot(e.clientX - s.sx, e.clientY - s.sy);
    if ((s.mode === 'fork-pending' || s.mode === 'move-pending') && dist > DRAG_THRESHOLD) {
      window.clearTimeout(clickTimer.current);
      ui().set({ menu: null, hover: null });
      if (s.mode === 'move-pending') {
        useLoom.getState().commit(); // one undo step per drag
        const sel = ui().selection;
        const ids = sel.includes(id) && sel.length > 1 ? sel : [id];
        const nodes = useLoom.getState().nodes;
        s.group = Object.fromEntries(ids.filter((k) => nodes[k] && !nodes[k].isRoot || k === id).map((k) => [k, { x: nodes[k].x, y: nodes[k].y }]));
      }
      s.mode = s.mode === 'fork-pending' ? 'fork' : 'move';
    }
    if (s.mode === 'fork-pending' || s.mode === 'move-pending') return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (s.mode === 'fork') ui().set({ forkDrag: { fromId: id, x: p.x, y: p.y } });
    else if (s.group) {
      const here = s.group[id];
      const dx = p.x - s.ox - here.x;
      const dy = p.y - s.oy - here.y;
      useLoom.getState().moveNodes(Object.fromEntries(Object.entries(s.group).map(([k, q]) => [k, { x: q.x + dx, y: q.y + dy }])));
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = st.current;
    st.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!s || cancelled) {
      ui().set({ forkDrag: null });
      return;
    }
    const dist = Math.hypot(e.clientX - s.sx, e.clientY - s.sy);

    if (s.mode === 'fork') {
      const fd = ui().forkDrag;
      ui().set({ forkDrag: null });
      // an empty branch you write yourself: it opens in the chat with the cursor in the chat box
      if (fd) useLoom.getState().forkForWriting(id, { x: fd.x, y: fd.y - 18 });
      return;
    }
    if (s.mode === 'move' || dist > DRAG_THRESHOLD) return;

    // a click
    const now = performance.now();
    if (now - lastClick.current < DOUBLE_CLICK_MS) {
      window.clearTimeout(clickTimer.current);
      lastClick.current = 0;
      ui().set({ menu: null, selection: [] }); // opening a node clears the selection
      useLoom.getState().openInChat(id);
      return;
    }
    lastClick.current = now;
    // select: a modifier adds or removes this node, a plain click picks just this one
    const sel = ui().selection;
    const isRoot = !!useLoom.getState().nodes[id]?.isRoot;
    if (!isRoot) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) ui().set({ selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
      else ui().set({ selection: sel.includes(id) ? [] : [id] }); // clicking a selected node (without dragging) clears
    } else if (!(e.shiftKey || e.metaKey || e.ctrlKey)) ui().set({ selection: [] });
    // on touch there is no right-click, so a tap also opens the node menu (after the double-tap window)
    if (s.touch) {
      const at = { x: e.clientX, y: e.clientY };
      clickTimer.current = window.setTimeout(() => ui().set({ menu: { nodeId: id, ...at }, hover: null }), DOUBLE_CLICK_MS);
    }
  };

  const onPointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
    cursor.current = { x: e.clientX, y: e.clientY };
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      const u = ui();
      if (u.forkDrag || u.menu || st.current) return;
      u.set({ hover: { nodeId: id, ...cursor.current } });
    }, HOVER_DELAY_MS);
  };

  const onPointerLeave = () => {
    window.clearTimeout(hoverTimer.current);
    if (ui().hover?.nodeId === id) ui().set({ hover: null });
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => finish(e, false),
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => finish(e, true),
    onPointerEnter,
    onPointerLeave,
  };
}
