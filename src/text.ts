export interface Token {
  text: string;
  /** char offset inside the node's text */
  offset: number;
  space: boolean;
}

const TOKEN_RE = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_]/gu;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    out.push({ text: m[0], offset: m.index ?? 0, space: /^\s+$/.test(m[0]) });
  }
  return out;
}

/** First and last few words for the node preview. */
export function preview(text: string, n = 7): { head: string; tail: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= n * 2) return { head: words.join(' '), tail: '' };
  return { head: words.slice(0, n).join(' '), tail: words.slice(-n + 2).join(' ') };
}
