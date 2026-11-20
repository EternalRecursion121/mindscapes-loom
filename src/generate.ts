// Model shim. Swap `streamCompletion` for a real backend later; everything else
// only depends on its signature: given the context, yield text chunks.

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

export function shimCompletion(): string {
  return [LOREM, LOREM, LOREM].join(' ');
}

export interface StreamHandle {
  cancel(): void;
}

/** Streams the shim completion a few words at a time. */
export function streamCompletion(
  _context: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  opts: { leadingSpace?: boolean } = {},
): StreamHandle {
  const text = (opts.leadingSpace ? ' ' : '') + shimCompletion();
  const pieces = text.match(/\s*\S+/g) ?? [];
  let i = 0;
  const timer = window.setInterval(() => {
    const chunk = pieces.slice(i, i + 2).join('');
    i += 2;
    if (chunk) onChunk(chunk);
    if (i >= pieces.length) {
      window.clearInterval(timer);
      onDone();
    }
  }, 35);
  return { cancel: () => window.clearInterval(timer) };
}
