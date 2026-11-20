import { useEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';
import { NODE_H, ROOT_H, resolvedColor, threadColorMap, useLoom, useUi, type LoomNode } from '../store';

/*
 * The connectors between nodes, drawn as scattered trails of letters instead of lines.
 *
 * Each connector spells the child's own text (where the branch diverges). The layout is
 * procedural but fixed, seeded by the child's id, after the "you felt like you disappeared"
 * poster: letters bunch into clumps with uneven gaps, sizes vary a lot (a few are big),
 * and they sit close to the curve near the parent but wander further off it towards the
 * child, as if the branch were coming apart. Word gaps are tiny diamond dots.
 *
 * Nothing animates. One canvas behind the React Flow nodes, in flow coordinates; it is
 * redrawn only when the view moves or the loom changes, and only on-screen connectors draw.
 */

const BASE = 7; // letter size in world units
const STEP = 5.2; // average distance between letters along the curve
const FONT_PX = 48; // glyphs are drawn at this size and scaled, so the font is set once
const FONT = `${FONT_PX}px "Computer Modern Serif", Georgia, serif`;
const PLAIN = '#556557'; // muted dark green for connectors not on an open thread

interface Link {
  seed: number;
  childId: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  color: string;
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32): the same branch always scatters the same way. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1D value noise from a seeded table, for offsets that drift in clumps instead of jittering. */
function smoothNoise(r: () => number) {
  const table = Array.from({ length: 64 }, r);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[((i % 64) + 64) % 64];
    const b = table[(((i + 1) % 64) + 64) % 64];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u; // 0..1
  };
}

function buildLinks(): Link[] {
  const s = useLoom.getState();
  const colors = threadColorMap(s);
  const out: Link[] = [];
  const visible = (n: LoomNode | undefined): boolean => {
    for (let c = n; c; c = c.parentId ? s.nodes[c.parentId] : undefined) if (c.hidden) return false;
    return !!n;
  };
  for (const n of Object.values(s.nodes)) {
    if (!n.parentId || !visible(n)) continue;
    const P = s.nodes[n.parentId];
    const c = colors.get(n.id);
    out.push({
      seed: hashStr(n.id),
      childId: n.id,
      sx: P.x,
      // start inside the parent and end inside the child: the nodes cover the ends,
      // so the trail reads as running into and out of them
      sy: P.y + (P.isRoot ? ROOT_H * 0.8 : NODE_H / 2),
      tx: n.x,
      ty: n.y + NODE_H / 2,
      color: c === undefined ? getComputedStyle(document.documentElement).getPropertyValue('--connector').trim() || PLAIN : resolvedColor(c),
    });
  }
  return out;
}

/** The text a connector spells: the child's own words, repeated if the connector is longer. */
function spell(n: LoomNode | undefined, slots: number): string {
  const own = (n?.messages.map((m) => m.text).join(' ') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const src = own || 'weaving';
  let out = '';
  while (out.length < slots) out += (out ? ' ' : '') + src;
  return out.slice(0, slots);
}

/** Arc-length table of the connector's cubic bezier: [x, y, dx, dy, length] per sample. */
function curve(sx: number, sy: number, tx: number, ty: number) {
  const k = Math.max(60, Math.abs(ty - sy) * 0.5);
  const N = 64;
  const pts: number[] = [];
  let px = sx, py = sy, len = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const x = u * u * u * sx + 3 * u * u * t * sx + 3 * u * t * t * tx + t * t * t * tx;
    const y = u * u * u * sy + 3 * u * u * t * (sy + k) + 3 * u * t * t * (ty - k) + t * t * t * ty;
    const seg = Math.hypot(x - px, y - py);
    len += seg;
    const d = seg || 1;
    pts.push(x, y, (x - px) / d, (y - py) / d, len);
    px = x;
    py = y;
  }
  return { pts, len };
}

function at(c: { pts: number[] }, l: number) {
  const p = c.pts;
  for (let i = 5; i < p.length; i += 5) {
    if (p[i + 4] >= l) {
      const l0 = p[i - 1], l1 = p[i + 4];
      const f = l1 > l0 ? (l - l0) / (l1 - l0) : 0;
      return [p[i - 5] + (p[i] - p[i - 5]) * f, p[i - 4] + (p[i + 1] - p[i - 4]) * f, p[i + 2], p[i + 3]];
    }
  }
  const j = p.length - 5;
  return [p[j], p[j + 1], p[j + 2], p[j + 3]];
}

interface Glyph {
  ch: string;
  x: number;
  y: number;
  size: number;
  alpha: number;
}

/** Lay out one connector's letters in world space. Deterministic for a given seed, text and geometry. */
function layout(l: Link, text: string | null): Glyph[] {
  const c = curve(l.sx, l.sy, l.tx, l.ty);
  const r = rng(l.seed);
  const drift = smoothNoise(rng(l.seed ^ 0x9e3779b9));
  const slots = Math.ceil(c.len / (STEP * 0.8)) + 2;
  const word = text ?? spell(useLoom.getState().nodes[l.childId], slots);
  const out: Glyph[] = [];
  let pos = STEP * (0.3 + r() * 0.6);
  let i = 0;
  while (pos < c.len - 4 && i < word.length) {
    const ch = word[i];
    const prog = pos / c.len; // 0 at the parent, 1 at the child
    const spread = Math.pow(prog, 1.4); // letters loosen as the branch goes on
    const [x, y, dx, dy] = at(c, pos);

    // clumps: neighbours share a drift, so letters peel off the line in groups
    let off = (drift(i * 0.12) - 0.5) * 2 * (3 + 15 * spread);
    // now and then one letter is flung well away
    if (r() < 0.01 + 0.01 * spread) off += (r() < 0.5 ? -1 : 1) * (6 + r() * 8) * (0.5 + 0.5 * spread);
    // and letters slip along the line a little
    const slip = (r() - 0.5) * 1.5 * spread;
    // mostly small, a few big ones (heavy tail), bigger as they drift out
    const big = Math.pow(r(), 3.2);
    const size = ch === ' ' ? 0 : BASE * (0.6 + 0.5 * r() * r() + big * 1.1 + spread * 0.2);

    out.push({
      ch,
      x: x - dy * off + dx * slip,
      y: y + dx * off + dy * slip,
      size,
      alpha: 0.55 + 0.45 * (1 - spread * 0.6) * (0.6 + 0.4 * r()),
    });

    // uneven rhythm: tight inside clumps, wider gaps between them, wider still after a word
    const gap = ch === ' ' ? 1.3 : drift(i * 0.12 + 17) < 0.42 ? 0.7 : 1.05;
    pos += STEP * gap * (0.85 + r() * 0.3) + size * 0.1;
    i++;
  }
  return out;
}

export function EdgeLetters() {
  const host = useRef<HTMLDivElement>(null);
  const flow = useStoreApi();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const canvas = document.createElement('canvas');
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    let dpr = 1;
    let W = 0;
    let H = 0;

    let links = buildLinks();
    // layouts only change when the text or geometry changes; cache them per connector
    const cache = new Map<string, { key: string; glyphs: Glyph[] }>();
    const glyphsFor = (l: Link) => {
      const n = useLoom.getState().nodes[l.childId];
      const textLen = n ? n.messages.reduce((a, m) => a + m.text.length, 0) : 0;
      const key = `${l.sx},${l.sy},${l.tx},${l.ty},${textLen}`;
      const hit = cache.get(l.childId);
      if (hit && hit.key === key) return hit.glyphs;
      const glyphs = layout(l, null);
      cache.set(l.childId, { key, glyphs });
      return glyphs;
    };

    const drawGlyphs = (glyphs: Glyph[], color: string, z: number, ox: number, oy: number) => {
      ctx.fillStyle = color;
      for (const g of glyphs) {
        const x = g.x * z + ox;
        const y = g.y * z + oy;
        if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
        ctx.globalAlpha = g.alpha;
        const px = g.size * z;
        if (g.ch === ' ' || px < 2.6) {
          const rr = Math.max(0.8, Math.min(2, (px || BASE * z) * 0.16));
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.beginPath();
          ctx.moveTo(x, y - rr);
          ctx.lineTo(x + rr, y);
          ctx.lineTo(x, y + rr);
          ctx.lineTo(x - rr, y);
          ctx.fill();
          continue;
        }
        const k = (px / FONT_PX) * dpr;
        ctx.setTransform(k, 0, 0, k, x * dpr, y * dpr);
        ctx.fillText(g.ch, 0, 0);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      const [ox, oy, z] = flow.getState().transform;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of links) {
        const minX = Math.min(l.sx, l.tx) * z + ox - 80, maxX = Math.max(l.sx, l.tx) * z + ox + 80;
        const minY = Math.min(l.sy, l.ty) * z + oy - 80, maxY = Math.max(l.sy, l.ty) * z + oy + 80;
        if (maxX < 0 || minX > W || maxY < 0 || minY > H) continue;
        drawGlyphs(glyphsFor(l), l.color, z, ox, oy);
      }
      // the connector you are pulling out while shift-dragging a fork
      const fd = useUi.getState().forkDrag;
      const from = fd ? useLoom.getState().nodes[fd.fromId] : undefined;
      if (fd && from) {
        const ghost: Link = {
          seed: 7,
          childId: '',
          sx: from.x,
          sy: from.y + (from.isRoot ? ROOT_H : NODE_H),
          tx: fd.x,
          ty: fd.y - 18,
          color: '#B9A0BC',
        };
        drawGlyphs(layout(ghost, 'fork here '.repeat(40)), ghost.color, z, ox, oy);
      }
    };

    // redraw at most once per frame, only when something changed
    let queued = 0;
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(() => ((queued = 0), draw()));
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = el.clientWidth;
      H = el.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      // resizing clears the canvas: redraw now, in the same frame, or it shows blank while you
      // drag a chat window's edge (the canvas resizes every frame)
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const unsubs = [
      flow.subscribe(schedule),
      useLoom.subscribe((s, prev) => {
        if (s.structure !== prev.structure || s.activeTabId !== prev.activeTabId) links = buildLinks();
        if (s.nodes !== prev.nodes || s.structure !== prev.structure || s.activeTabId !== prev.activeTabId) schedule();
      }),
      useUi.subscribe((s, prev) => s.forkDrag !== prev.forkDrag && schedule()),
    ];
    // the colour tuner changed a colour
    const onTune = () => {
      links = buildLinks();
      schedule();
    };
    window.addEventListener('loom-tuned', onTune);
    // the web fonts may arrive after the first draw
    void document.fonts?.ready.then(schedule);

    return () => {
      cancelAnimationFrame(queued);
      window.removeEventListener('loom-tuned', onTune);
      ro.disconnect();
      unsubs.forEach((u) => u());
      canvas.remove();
    };
  }, [flow]);

  return <div className="edge-letters" ref={host} aria-hidden="true" />;
}
