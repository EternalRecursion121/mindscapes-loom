import { generate } from './model/client';
import type { ChatTurn } from './model/protocol';
import type { Piece } from './store';

/* The model: a small chat model running in this browser (see model/). */

export interface StreamHandle {
  cancel(): void;
}

/**
 * The conversation as chat turns, merged the way the chat shows it (one bubble = one turn): one
 * voice never has two turns in a row, so a piece in the voice of the turn before it carries that
 * turn on, with nothing in between. A piece with no words is no turn, except the last: that is
 * where the model writes.
 */
export function turnsOf(pieces: Pick<Piece, 'role' | 'text'>[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  pieces.forEach((p, i) => {
    if (!p.text && i < pieces.length - 1) return;
    const role = p.role === 'model' ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += p.text;
    else turns.push({ role, content: p.text });
  });
  return turns;
}

/**
 * Streams the model's continuation of the last piece. Its turn is left open, so an empty model
 * message becomes a reply and a half-written message (yours or the model's) is carried on.
 */
export function streamCompletion(pieces: Piece[], onChunk: (chunk: string) => void, onDone: (failed: boolean) => void): StreamHandle {
  return generate(turnsOf(pieces), onChunk, onDone);
}
