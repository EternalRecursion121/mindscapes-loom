// Turns the single-file build into an artifact page body (no doctype/html/head/body wrappers).
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist-single/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>/, '')
  .replace(/<meta name="viewport"[^>]*>/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(process.argv[2], head.trim() + '\n' + body.trim() + '\n');
