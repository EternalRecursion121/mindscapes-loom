import { useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  PanOnScrollMode,
  ViewportPortal,
  useReactFlow,
  useStore as useFlowStore,
  type Node,
} from '@xyflow/react';
import { NODE_H, NODE_W, ROOT_H, ROOT_W, resolvedColor, sideWidth, threadColorMap, useLoom, useUi, visibleTabs, type LoomState } from '../store';
import { LoomNodeView, RootNodeView, type LoomData } from './nodes';
import { EdgeLetters } from './EdgeLetters';
import { ChromeLeft, ChromeRight } from '../Chrome';
import { useIsMobile } from '../useIsMobile';

const nodeTypes = { loom: LoomNodeView, root: RootNodeView };

/**
 * Turn the loom store into React Flow nodes. Runs only when the graph's shape changes.
 * There are no React Flow edges: the connectors are letter trails drawn by <EdgeLetters>.
 */
function buildNodes(s: LoomState) {
  const colorMap = threadColorMap(s);
  // the node each open chat is currently on (the active chat wins if two share a node)
  const heads = new Map<string, number>();
  const shown = visibleTabs(s);
  for (const t of [...shown.filter((t) => t.id !== s.activeTabId), ...shown.filter((t) => t.id === s.activeTabId)])
    heads.set(t.headId, t.color);
  const parked = new Map<string, number>();
  for (const t of s.tabs) if (!shown.includes(t)) parked.set(t.headId, t.color);
  const nodes: Node<LoomData>[] = [];
  const stack = [s.rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const n = s.nodes[id];
    if (!n) continue;
    const isRoot = !!n.isRoot;
    nodes.push({
      id,
      type: isRoot ? 'root' : 'loom',
      position: { x: n.x, y: n.y },
      width: isRoot ? ROOT_W : NODE_W,
      height: isRoot ? ROOT_H : NODE_H,
      data: {
        color: isRoot ? undefined : colorMap.get(id),
        selected: isRoot ? undefined : heads.get(id),
        // on a tab that's open but not the one showing in its window
        parked: isRoot || heads.has(id) ? undefined : parked.get(id),
      },
    });
    for (const c of s.children[id] ?? []) if (!s.nodes[c]?.hidden) stack.push(c);
  }
  return nodes;
}

/** The outline of the node you are about to create while shift-dragging (its connector is drawn by EdgeLetters). */
function ForkGhost() {
  const fd = useUi((s) => s.forkDrag);
  if (!fd) return null;
  const tx = fd.x;
  const ty = fd.y - 18;
  return (
    <ViewportPortal>
      <svg className="fork-ghost" width="1" height="1">
        <rect x={tx - NODE_W / 2} y={ty} width={NODE_W} height={NODE_H} rx="22" className="ghost-box" />
        <text x={tx} y={ty + NODE_H / 2 + 5} textAnchor="middle" className="ghost-label">
          release to fork
        </text>
      </svg>
    </ViewportPortal>
  );
}

const MIN_ZOOM = 0.06;
const MAX_ZOOM = 2.5;
/** how much faster than React Flow's default a trackpad pinch zooms */
const PINCH_SPEED = 4;

/**
 * Trackpad pinches arrive as wheel events with ctrlKey set. React Flow has no speed setting for
 * them, so they are handled here (before React Flow sees them): same maths, scaled by PINCH_SPEED,
 * zooming about the point under the fingers.
 */
function useFastPinch(ref: React.RefObject<HTMLDivElement>) {
  const rf = useReactFlow();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      const delta = -e.deltaY * unit * (isMac ? 10 : 1) * PINCH_SPEED;
      const { x, y, zoom } = rf.getViewport();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.pow(2, delta)));
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const k = next / zoom;
      rf.setViewport({ x: px - (px - x) * k, y: py - (py - y) * k, zoom: next });
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [rf, ref]);
}

/** When the active chat moves to a node that is off screen, glide the canvas over to it. */
const useIsMobileQuery = () => window.matchMedia('(max-width: 720px)').matches;

function useFollowActiveNode(wrap: React.RefObject<HTMLDivElement>) {
  const rf = useReactFlow();
  const head = useLoom((s) => s.tabs.find((t) => t.id === s.activeTabId)?.headId);
  useEffect(() => {
    const el = wrap.current;
    const n = head ? useLoom.getState().nodes[head] : undefined;
    if (!el || !n || n.isRoot) return;
    const { x, y, zoom } = rf.getViewport();
    const W = el.clientWidth;
    const H = el.clientHeight;
    // the chat windows cover the canvas's left side: only the part right of them counts as on screen
    const side = useIsMobileQuery() ? 0 : sideWidth(useLoom.getState());
    const left = (n.x - NODE_W / 2) * zoom + x;
    const top = n.y * zoom + y;
    const onScreen = left > side && top > 0 && left + NODE_W * zoom < W && top + NODE_H * zoom < H;
    if (!onScreen) rf.setCenter(n.x - side / 2 / zoom, n.y + NODE_H / 2, { zoom, duration: 350 });
  }, [head, rf, wrap]);
}

function minimapColor(n: Node) {
  const d = n.data as LoomData;
  return n.type === 'root' ? '#ECEAEF' : d.color === undefined ? '#365436' : resolvedColor(d.color);
}

const HandIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M5 3l0 16 4.4-4.1 2.9 6.6 2.6-1.1-2.9-6.5 6-.2z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

/** The hand (pan) and arrow (select) tools: a box of their own above the zoom controls. */
function ToolBox() {
  const tool = useUi((s) => (s.spaceHand ? 'hand' : s.tool));
  const pick = (t: 'select' | 'hand') => useUi.getState().set({ tool: t, menu: null });
  return (
    <Panel position="bottom-left" className="tool-box" aria-label="Canvas tools">
      <button type="button" className={`react-flow__controls-button${tool === 'hand' ? ' on' : ''}`} title="Hand: drag to pan (H, or hold space)" aria-label="Hand tool" aria-pressed={tool === 'hand'} onClick={() => pick('hand')}>
        <HandIcon />
      </button>
      <button type="button" className={`react-flow__controls-button${tool === 'select' ? ' on' : ''}`} title="Select: click, shift-click, drag a box (V)" aria-label="Select tool" aria-pressed={tool === 'select'} onClick={() => pick('select')}>
        <ArrowIcon />
      </button>
    </Panel>
  );
}

/** Tool shortcuts: V arrow, H hand, hold space for the hand, Esc clears, Delete removes the selection. */
function useToolKeys() {
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useUi.getState();
      if (e.key === 'v' || e.key === 'V') ui.set({ tool: 'select' });
      else if (e.key === 'h' || e.key === 'H') ui.set({ tool: 'hand' });
      else if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        ui.set({ spaceHand: true });
      } else if (e.key === 'Escape') ui.set({ selection: [] });
      else if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection.length) {
        e.preventDefault();
        useLoom.getState().deleteNodes(ui.selection);
        ui.set({ selection: [], menu: null });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') useUi.getState().set({ spaceHand: false });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
}

/**
 * Any press anywhere clears the selection, except: pressing a selected node (it may be dragged),
 * shift/ctrl/cmd + pressing a node (adding to the selection), right-clicking a node (its menu acts
 * on the selection) and presses inside a menu.
 */
function useClearSelectionOnClick() {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const ui = useUi.getState();
      if (!ui.selection.length) return;
      const t = e.target as HTMLElement;
      if (t.closest('.node-menu')) return;
      const nodeEl = t.closest<HTMLElement>('.react-flow__node');
      if (nodeEl && (e.button === 2 || e.shiftKey || e.metaKey || e.ctrlKey)) return;
      if (nodeEl && ui.selection.includes(nodeEl.dataset.id ?? '')) return;
      ui.set({ selection: [] });
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, []);
}

/** when the last box-select ended: the click that ends a box drag must not clear what it selected */
let boxEndedAt = 0;

/** Arrow tool, mouse only: drag on empty canvas to draw a box; nodes it touches are selected (shift adds). */
function useMarquee(wrap: React.RefObject<HTMLDivElement>, enabled: boolean) {
  const rf = useReactFlow();
  useEffect(() => {
    const el = wrap.current;
    if (!el || !enabled) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      const t = e.target as HTMLElement;
      // only on empty canvas: nodes, panels and controls live inside the pane too
      if (!t.closest('.react-flow__pane') || t.closest('.react-flow__node, .react-flow__panel, .react-flow__controls, .react-flow__minimap')) return;
      const r = el.getBoundingClientRect();
      const x0 = e.clientX - r.left;
      const y0 = e.clientY - r.top;
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      const before = add ? useUi.getState().selection : [];
      let moved = false;
      const move = (ev: PointerEvent) => {
        const x1 = ev.clientX - r.left;
        const y1 = ev.clientY - r.top;
        if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
        moved = true;
        const a = rf.screenToFlowPosition({ x: Math.min(e.clientX, ev.clientX), y: Math.min(e.clientY, ev.clientY) });
        const b = rf.screenToFlowPosition({ x: Math.max(e.clientX, ev.clientX), y: Math.max(e.clientY, ev.clientY) });
        const hit = Object.values(useLoom.getState().nodes)
          .filter((n) => !n.isRoot && !n.hidden)
          .filter((n) => n.x + NODE_W / 2 > a.x && n.x - NODE_W / 2 < b.x && n.y + NODE_H > a.y && n.y < b.y)
          .map((n) => n.id);
        useUi.getState().set({ marquee: { x0, y0, x1, y1 }, selection: [...new Set([...before, ...hit])], menu: null });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) boxEndedAt = performance.now();
        useUi.getState().set({ marquee: null });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    el.addEventListener('pointerdown', onDown, true);
    return () => el.removeEventListener('pointerdown', onDown, true);
  }, [wrap, enabled, rf]);
}

function Marquee() {
  const m = useUi((s) => s.marquee);
  if (!m) return null;
  return (
    <div
      className="marquee"
      style={{ left: Math.min(m.x0, m.x1), top: Math.min(m.y0, m.y1), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0) }}
      aria-hidden="true"
    />
  );
}

export function Canvas() {
  const structure = useLoom((s) => s.structure);
  const tidy = useLoom((s) => s.tidy);
  // level of detail: below this zoom nodes drop their text and outlines
  const lowDetail = useFlowStore((s) => s.transform[2] < 0.18);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => buildNodes(useLoom.getState()), [structure]);
  const wrap = useRef<HTMLDivElement>(null);
  useFastPinch(wrap);
  useFollowActiveNode(wrap);
  useToolKeys();
  useClearSelectionOnClick();
  const mobile = useIsMobile();
  const tool = useUi((s) => (s.spaceHand ? 'hand' : s.tool));
  // the arrow on a mouse: left-drag on empty canvas draws a selection box; the hand (and touch) pans
  const boxSelect = tool === 'select' && !mobile;
  useMarquee(wrap, boxSelect);

  return (
    <div className="canvas" ref={wrap} data-lod={lowDetail ? 'low' : 'high'} data-tool={tool}>
      {/* behind the nodes: the letter-trail connectors */}
      <EdgeLetters />
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        nodeOrigin={[0.5, 0]}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onlyRenderVisibleElements
        zoomOnDoubleClick={false}
        panOnDrag={boxSelect ? [1] : true}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        panOnScrollSpeed={1.3} // React Flow's default is 0.5
        zoomOnScroll={false}
        zoomOnPinch
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        onPaneClick={() => {
          if (performance.now() - boxEndedAt < 250) return; // the end of a box drag, not a click
          useUi.getState().set({ menu: null, selection: [] });
        }}
        // right click: our node menu instead of the browser's, at the cursor; nothing on empty canvas
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          const ui = useUi.getState();
          // right-clicking a node outside the selection selects just it; inside, the menu acts on all of them
          const isRoot = !!useLoom.getState().nodes[node.id]?.isRoot;
          if (!ui.selection.includes(node.id)) ui.set({ selection: isRoot ? [] : [node.id] });
          ui.set({ hover: null, menu: { nodeId: node.id, x: e.clientX, y: e.clientY } });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          useUi.getState().set({ menu: null });
        }}
        onMoveStart={() => useUi.getState().set({ menu: null, hover: null })}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={34} size={1.5} color="var(--dots)" />
        <ForkGhost />
        <ToolBox />
        <Controls showInteractive={false} position="bottom-left">
          <ControlButton onClick={tidy} title="Tidy the tree" aria-label="Tidy the tree">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="3" r="2" />
              <circle cx="3" cy="13" r="2" />
              <circle cx="13" cy="13" r="2" />
              <path d="M8 5v3M8 8H3v3M8 8h5v3" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </ControlButton>
        </Controls>
        <MiniMap
          style={{ width: 150, height: 100 }}
          pannable
          zoomable
          nodeColor={minimapColor}
          nodeBorderRadius={14}
          maskColor="rgba(12, 24, 17, 0.6)"
          bgColor="#14221a"
        />
      </ReactFlow>
      <Marquee />
      <ChromeLeft />
      <ChromeRight />
      <p className="canvas-hint">
        {tool === 'hand' ? (
          <>drag anywhere to pan · pinch to zoom · <kbd>V</kbd> for the arrow</>
        ) : (
          <>
            click to select · <kbd>shift</kbd>-click to add · drag empty space to box-select · drag to move · <kbd>shift</kbd> + drag a node to fork · <kbd>H</kbd> or hold <kbd>space</kbd> to pan
          </>
        )}
      </p>
    </div>
  );
}
