import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';

export const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

export function fail(message: string): never {
  throw new Error(message);
}

export function rootOf(dir = process.cwd()) {
  return fs.realpathSync(execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim());
}

export function inside(base: string, rel: string) {
  const dest = path.resolve(base, rel);
  if (!dest.startsWith(base + path.sep)) fail('Path outside project');
  for (let p = dest; p !== base; p = path.dirname(p)) {
    if (fs.lstatSync(p, {throwIfNoEntry: false})?.isSymbolicLink()) fail('Symbolic link refused');
  }
  return dest;
}

export function put(file: string, data: string, exclusive = false) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const tmp = file + '.' + randomUUID();
  fs.writeFileSync(tmp, data, {mode: 0o600, flag: 'wx', flush: true});
  try {
    if (exclusive) {
      try {
        fs.linkSync(tmp, file);
      } catch (e) {
        if (e.code !== 'EEXIST' || fs.readFileSync(file, 'utf8') !== data) throw e;
      }
    } else fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, {force: true});
  }
}

export const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function state(root: string) {
  const home = fs.realpathSync(os.homedir());
  const dir = inside(home, '.local/state/iperuranio/' + hash(root));
  if (dir.startsWith(root + '/')) fail('Private state inside project');
  return dir;
}

export function config(root: string) {
  const settings = read(inside(root, '.iperuranio/config.json'));
  const local = read(path.join(state(root), 'enabled.json'));
  if (local.history !== settings.history) fail('Archive path needs local initialization');
  return {archive: inside(root, settings.history + '/decisions'), local};
}

export function sensitive(s: string) {
  // oxlint-disable-next-line no-control-regex -- Control bytes are intentionally rejected by the privacy filter.
  return /[\x00-\x08\x0b-\x1f\x7f]|[\w.+-]+@[\w.-]+\.[a-z]{2,}|-----BEGIN .*PRIVATE KEY|\b(?:bearer|basic)\s+[a-z\d+/=._-]{6,}|(?:password|passwd|api[_-]?key|token|secret|authorization|cookie)\s*[:=]\s*\S|(?:gh[pousr]_|github_pat_|sk-|AKIA|xox[baprs]-)[A-Za-z0-9_-]{8,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+|:\/\/|\/(?:Users|home)\/|\b[A-Za-z0-9+/=_-]{40,}\b/i.test(s);
}

export function draft(root: string, fields: any) {
  config(root);
  const {text, reason = '', ticket = '', source = '', supersedes = '', target = '', kind = 'decision'} = fields;
  if (![text, reason, ticket, source, supersedes, target].every(x => typeof x === 'string' && x.length <= 12000) || !text.trim() ||
    !['decision', 'proposal', 'rejected', 'handoff', 'challenge', 'observation'].includes(kind)) fail('Invalid candidate');
  if (ticket && !/^[A-Z][A-Z0-9]{0,15}-\d+$/.test(ticket)) fail('Invalid ticket');
  if (kind === 'rejected' && !reason.trim()) fail('Missing rejection reason');
  for (const ref of [supersedes, target].filter(Boolean)) if (!records(root).some(r => r.id === ref)) fail('Unknown referenced record');
  const value = {kind, text: text.trim(), reason: reason.trim(), ticket, source, supersedes, target};
  if (sensitive(Object.values(value).join('\n'))) return {status: 'blocked'};
  const id = hash(JSON.stringify(value));
  const receipt = path.join(state(root), 'reviewed', id + '.json');
  if (fs.existsSync(receipt)) return {status: 'reviewed', id: read(receipt).id};
  put(path.join(state(root), 'drafts', id + '.json'), JSON.stringify(value), true);
  return {id, status: 'needs_review'};
}

export function records(root: string) {
  const {archive} = config(root);
  if (!fs.existsSync(archive)) return [];
  return fs.readdirSync(archive).filter(n => /^[a-f0-9]{24}\.md$/.test(n)).map(n => {
    const body = fs.readFileSync(inside(archive, n), 'utf8');
    return {id: n.slice(0, -3), body};
  });
}

export function render(v: any) {
  return ['---', 'kind: ' + v.kind, ...['ticket', 'target', 'supersedes'].filter(k => v[k]).map(k => k + ': ' + v[k]), '---', '', v.text,
    ...(v.reason ? ['', 'Reason: ' + v.reason] : []), ...(v.source ? ['', 'Evidence: ' + v.source] : []), ''].join('\n');
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\d_-]+/gu) || [];
const synonyms = [['cache', 'caché', 'scadenza', 'expiration', 'persistente', 'stale', 'max-age'], ['motivo', 'reason', 'pourquoi', 'perché', 'why'], ['accesso', 'login', 'connexion'], ['scartata', 'rejected', 'descartada'], ['contenuto', 'content', 'contenu'], ['render', 'rendering', 're-render', 'renderizzazioni']];

export function search(root: string, query: string, ticket = '', file = '', kind = '') {
  const terms = new Set(words(query));
  const expanded = synonyms.filter(g => g.some(w => terms.has(w))).flat();
  const all = records(root);
  return all.map(r => {
    const tokens = new Set(words(r.body));
    const score = [...terms].reduce((n, w) => n + (tokens.has(w) ? 4 : 0), 0) + expanded.filter(w => tokens.has(w)).length;
    const matches = (!kind || r.body.startsWith('---\nkind: ' + kind + '\n')) && (!ticket || r.body.includes('ticket: ' + ticket + '\n')) && (!file || r.body.includes(file));
    const lines = r.body.split('\n').filter(Boolean);
    const snippet = lines.slice(lines.lastIndexOf('---') + 1).join(' ').slice(0, 700);
    return {
      id: r.id,
      score: matches ? score : 0,
      snippet,
      kind: lines[1]?.slice(6),
      supersededBy: all.filter(x => x.body.includes('\nsupersedes: ' + r.id + '\n')).map(x => x.id)
    };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3);
}
