import type { ChatTurn } from './protocol';

/** The part of a tokenizer the prompt needs. */
export interface TemplateTokenizer {
  chat_template?: unknown;
  apply_chat_template(turns: ChatTurn[], options: { tokenize: false; add_generation_prompt: false }): unknown;
}

export interface Prompt {
  text: string;
  /** false when the model has no chat template and the turns were just joined */
  templated: boolean;
  /** spaces cut off the end of the open turn: the model's next token brings its own */
  trimmed: boolean;
  /** the open turn already has words, so this is a continuation rather than a fresh reply */
  continues: boolean;
}

// stands in for "the text stops here" while the template is filled in; never reaches the model
const CUT = '⟦loom-open-turn⟧';
// ChatML's system turn, for system = 'none' on models whose template always adds one
const CHATML_SYSTEM = /^<\|im_start\|>system\n[\s\S]*?<\|im_end\|>\n/;

/**
 * The text the model carries on from. The last turn is left OPEN (no end-of-turn marker after
 * it), so the model continues that turn, whoever's it is: an empty model turn gives a reply, a
 * half-written one is carried on from its last word.
 */
export function buildPrompt(tok: TemplateTokenizer, turns: ChatTurn[], system?: string): Prompt {
  const all = turns.length ? turns.map((t) => ({ ...t })) : [{ role: 'assistant' as const, content: '' }];
  const open = all[all.length - 1];
  const spaces = /[ \t]+$/.exec(open.content);
  if (spaces) open.content = open.content.slice(0, spaces.index);
  const continues = open.content.length > 0;
  const rest = { trimmed: !!spaces, continues };
  if (tok.chat_template) {
    try {
      const lead: ChatTurn[] = system && system !== 'none' ? [{ role: 'system', content: system }] : [];
      const marked = [...lead, ...all.slice(0, -1), { ...open, content: open.content + CUT }];
      let text = String(tok.apply_chat_template(marked, { tokenize: false, add_generation_prompt: false }));
      const at = text.lastIndexOf(CUT);
      if (at >= 0) {
        text = text.slice(0, at);
        if (system === 'none') text = text.replace(CHATML_SYSTEM, '');
        return { text, templated: true, ...rest };
      }
    } catch {
      /* a template that refuses these turns (two of one role in a row, say): plain text below */
    }
  }
  return { text: all.map((t) => t.content).join('\n'), templated: false, ...rest };
}
