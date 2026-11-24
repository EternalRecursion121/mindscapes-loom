import { create } from 'zustand';
import { otherRole, type Role } from '../store';

/** whose voice what you type goes in. alternate: the other voice to the last message's */
export type TypeAs = 'user' | 'assistant' | 'alternate';

interface ChatPrefs {
  /** the model answers by itself when you send a message */
  autoPrompt: boolean;
  typeAs: TypeAs;
  set(p: Partial<Pick<ChatPrefs, 'autoPrompt' | 'typeAs'>>): void;
}

const KEY = 'mindscapes-loom-interview-chat-v1';

function saved(): Pick<ChatPrefs, 'autoPrompt' | 'typeAs'> {
  const d = { autoPrompt: true, typeAs: 'user' as TypeAs };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof o.autoPrompt === 'boolean') d.autoPrompt = o.autoPrompt;
    if (o.typeAs === 'user' || o.typeAs === 'assistant' || o.typeAs === 'alternate') d.typeAs = o.typeAs;
  } catch {
    /* no storage (private window): the choices last until the page closes */
  }
  return d;
}

/** The chat box's two choices (the ⋮ menu). They hold for every chat and are kept in this browser. */
export const useChatPrefs = create<ChatPrefs>((set, get) => ({
  ...saved(),
  set(p) {
    set(p);
    try {
      localStorage.setItem(KEY, JSON.stringify({ autoPrompt: get().autoPrompt, typeAs: get().typeAs }));
    } catch {
      /* see saved() */
    }
  },
}));

/** The voice your next message goes in. `last`: the voice of the chat's last words. */
export const voiceFor = (typeAs: TypeAs, last: Role | null): Role => (typeAs === 'user' ? 'user' : typeAs === 'assistant' ? 'model' : last ? otherRole(last) : 'user');
