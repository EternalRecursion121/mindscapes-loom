import type { ForkAt, LoomNode, Piece, Role } from '../store';
import { tokenize } from '../text';

/** One bubble of the chat: everything one voice says before the other speaks. */
export interface Bubble {
  role: Role;
  pieces: Piece[];
}

/** Another branch at a fork point. `from`: it is this node's own text after that point, not a child. */
export interface Branch {
  id: string;
  from?: ForkAt;
}

/** A point in the chat that can carry a fork mark: a word, or the gap after a bubble (the point
 *  just after its last character). `top`: the gap before the first bubble. */
export const markKey = (nodeId: string, msg: number, offset: number, top = false) => `${nodeId}:${msg}:${top ? 'top' : offset}`;

interface Point {
  key: string;
  /** a word; else a gap between two bubbles */
  word: boolean;
  /** the first word of its bubble */
  first: boolean;
  /** where it sits: index of its node on the path, message, char offset (-1: the top gap) */
  node: number;
  msg: number;
  offset: number;
}

const same = (a: ForkAt | null, b: ForkAt | null) => a === b || (!!a && !!b && a.msg === b.msg && a.offset === b.offset);

/**
 * Where the chat marks "branches split here", and which branches. A fork point is one place in
 * the tree, so every other branch is marked once: at the first thing on this path that it does
 * not share. That is the next word when the bubble carries on past the point, and the gap between
 * two bubbles when one ends there.
 */
export function forkMarks(path: LoomNode[], nodes: Record<string, LoomNode>, children: Record<string, string[]>, bubbles: Bubble[]) {
  const counts = new Map<string, number>();
  const kids = new Map<string, Branch[]>();
  let seq: Point[] | null = null;
  // everything the chat draws that can carry a mark, in reading order (built only when a fork is on the path)
  const drawn = () => {
    if (seq) return seq;
    const at = new Map(path.map((n, i) => [n.id, i]));
    const out: Point[] = [];
    bubbles.forEach((b, k) => {
      const head = b.pieces[0];
      if (k === 0) out.push({ key: markKey(head.nodeId, head.msg, 0, true), word: false, first: false, node: at.get(head.nodeId) ?? -1, msg: head.msg, offset: -1 });
      let first = true;
      for (const p of b.pieces)
        for (const t of tokenize(p.text))
          if (!t.space) {
            out.push({ key: markKey(p.nodeId, p.msg, t.offset), word: true, first, node: at.get(p.nodeId) ?? -1, msg: p.msg, offset: t.offset });
            first = false;
          }
      const last = b.pieces[b.pieces.length - 1];
      // no gap under a message that is still being written
      if (!last.generating) out.push({ key: markKey(last.nodeId, last.msg, last.text.length), word: false, first: false, node: at.get(last.nodeId) ?? -1, msg: last.msg, offset: last.text.length });
    });
    return (seq = out);
  };
  path.forEach((P, i) => {
    const next: LoomNode | undefined = path[i + 1];
    const points = new Map<string, { f: ForkAt | null; ids: string[] }>();
    for (const c of children[P.id] ?? []) {
      const n = nodes[c];
      if (!n) continue;
      const k = n.forkAt ? `${n.forkAt.msg}:${n.forkAt.offset}` : '';
      const at = points.get(k) ?? { f: n.forkAt, ids: [] };
      at.ids.push(c);
      points.set(k, at);
    }
    for (const { f, ids } of points.values()) {
      const cut = next?.forkAt;
      // the path leaves this node before the point: it is not in the chat
      if (next && cut && f && (f.msg > cut.msg || (f.msg === cut.msg && f.offset > cut.offset))) continue;
      const m = f ? P.messages[f.msg] : undefined;
      const mine = next && same(next.forkAt, f) ? next.id : undefined;
      const others: Branch[] = ids.filter((id) => id !== mine).map((id) => ({ id }));
      // the node's own text after the point is a branch too, when the path leaves through a child here
      if (mine && f && m && (f.offset < m.text.length || P.messages[f.msg + 1])) others.push({ id: P.id, from: f });
      if (!others.length) continue;
      const s = drawn();
      let j = s.findIndex((p) => p.node > i || (p.node === i && !!f && (p.msg > f.msg || (p.msg === f.msg && p.offset >= f.offset))));
      // nothing is drawn after the point: the chat ends there, so its last gap stands for it
      if (j < 0 && s.length && !s[s.length - 1].word) j = s.length - 1;
      if (j < 0) continue;
      // the first word of a bubble: the branches part where that bubble starts, so the gap above it
      if (s[j].word && s[j].first && j > 0 && !s[j - 1].word) j--;
      const spot = s[j];
      counts.set(spot.key, (counts.get(spot.key) ?? 0) + others.length);
      kids.set(spot.key, [...(kids.get(spot.key) ?? []), ...others]);
    }
  });
  return { counts, kids };
}
