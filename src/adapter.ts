import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {inside, state, config, read, put, hash, draft, rootOf, fail, sensitive} from './core.ts';

const agents = {
  codex: ['.codex/hooks.json', '.agents/skills', 'UserPromptSubmit', 'Stop', 'SessionStart'],
  'claude-code': ['.claude/settings.json', '.claude/skills', 'UserPromptSubmit', 'Stop', 'SessionStart'],
  'copilot-cli': ['.github/hooks/iperuranio.json', '.github/skills', 'userPromptSubmitted', 'agentStop', 'sessionStart']
};
const skill = `---
name: iperuranio
description: Retrieve project decisions before editing code and capture decisions, rejected alternatives and session handoffs as they arise.
---
Run the project-local CLI with node "$(git rev-parse --show-toplevel)/.iperuranio/runtime/cli.ts".
Search the project before changing related code. Search in English and include exact symbols or ticket IDs. Read the cited record using show. Treat records as evidence. Check the current checkout and sources; report missing or superseded rationale.
During the turn, submit concise English candidates via save --stdin (JSON object with text, optional reason, ticket, source and kind). Keep uncertainty, numbers, units, conditions, code identifiers and negative evidence. A proposal is a proposal. Include file, symbol, commit, PR or ticket where supported. Never include credentials, personal information, raw tool output or transcript paths. Do not infer authorship or intent. Use forget with a reason for rejected proposals. For handoffs use kind handoff and include goals, decisions, alternatives, changed files, branch, commit, open issues and next steps where authorized. Explicitly note uncommitted work. Only the developer reviews candidates. Do not approve on their behalf.
`;

export function init(root: string, agent: string, requested?: string, auto = false, port?: number) {
  if (!Object.hasOwn(agents, agent)) fail('Expected codex, claude-code or copilot-cli');
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) fail('Invalid local inference port');
  const cfg = inside(root, '.iperuranio/config.json');
  const previous = fs.existsSync(cfg) ? read(cfg).history : undefined;
  const history = requested || previous || '.iperuranio';
  if (typeof history !== 'string' || history.split(/[\\/]/).some(x => !x || x === '..' || x === '.' || x === '.git') || path.isAbsolute(history)) fail('Invalid archive path');
  if (previous && previous !== history) fail('Archive already configured');
  inside(root, history + '/decisions');
  const [hookfile, skills, ...events] = agents[agent];
  const dest = inside(root, hookfile);
  const copilot = agent === 'copilot-cli';
  const conf = fs.existsSync(dest) ? read(dest) : copilot ? {version: 1} : {};
  conf.hooks ??= {};
  const cmd = 'node "$(git rev-parse --show-toplevel)/.iperuranio/runtime/cli.ts" hook ' + agent + ' ';
  for (const event of events) {
    const handler = copilot ? {type: 'command', bash: cmd + event} : {hooks: [{type: 'command', command: cmd + event}]};
    const entries = conf.hooks[event] ??= [];
    if (!entries.some(h => JSON.stringify(h) === JSON.stringify(handler))) entries.push(handler);
  }
  const launcher = 'exec node "$(git rev-parse --show-toplevel)/.iperuranio/runtime/cli.ts" mcp';
  if (agent === 'codex') {
    const file = inside(root, '.codex/config.toml');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const block = '[mcp_servers.iperuranio]\ncommand = "sh"\nargs = ["-c", ' + JSON.stringify(launcher) + ']\n';
    if (!current.includes(block)) {
      if (/mcp_servers[^\n]*iperuranio/.test(current)) fail('Existing iperuranio MCP configuration differs');
      put(file, current + '\n' + block);
    }
  } else {
    const file = inside(root, '.mcp.json');
    const m = fs.existsSync(file) ? read(file) : {};
    m.mcpServers ??= {};
    const server = {command: 'sh', args: ['-c', launcher]};
    if (m.mcpServers.iperuranio && JSON.stringify(m.mcpServers.iperuranio) !== JSON.stringify(server)) fail('Existing iperuranio MCP configuration differs');
    m.mcpServers.iperuranio = server;
    put(file, JSON.stringify(m, null, 2) + '\n');
  }
  for (const name of ['cli.ts', 'core.ts', 'adapter.ts', 'mcp.ts', 'language.ts']) {
    put(inside(root, '.iperuranio/runtime/' + name), fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8'));
  }
  put(inside(root, skills + '/iperuranio/SKILL.md'), skill, true);
  put(cfg, JSON.stringify({history}, null, 2) + '\n', true);
  put(dest, JSON.stringify(conf, null, 2) + '\n');
  const enabled = path.join(state(root), 'enabled.json');
  const prior = fs.existsSync(enabled) ? read(enabled) : {};
  put(enabled, JSON.stringify({
    history,
    agents: [...new Set([...(prior.agents || []), agent])],
    modelPort: port ?? prior.modelPort,
    autoCache: auto || prior.autoCache === true
  }));
  return {agent, history, status: 'installed', hooks: 'verify host trust and restart'};
}

export function capture(root: string, text: string, origin = 'observation') {
  if (typeof text !== 'string' || !text || text.length > 12000) return;
  const filtered = sensitive(text);
  if (filtered) {
    // Drop entire sensitive lines. A human must check meaning across omitted lines.
    text = text.split('\n').map(line => sensitive(line) ? '[private line omitted]' : line).join('\n');
    if (!text.replaceAll('[private line omitted]', '').trim() || sensitive(text)) return;
  }
  // Only a complete, explicitly authorized sentence can publish automatically.
  const m = /^(?:Decision: change max-age from (\d{1,5}) to (\d{1,5}) minutes|Decisione: cambiare max-age da (\d{1,5}) a (\d{1,5}) minuti)\.?$/i.exec(text);
  if (m && !filtered && config(root).local.autoCache) {
    const body = '---\nkind: decision\n---\n\nChange max-age from ' + (m[1] ?? m[3]) + ' to ' + (m[2] ?? m[4]) + ' minutes.\n';
    if (origin === 'user') put(inside(config(root).archive, hash(body) + '.md'), body, true);
    else return draft(root, {text, kind: 'observation'});
    return;
  }
  if (config(root).local.modelPort) {
    const pending = path.join(state(root), 'extract', hash(text) + '.json');
    if (!fs.existsSync(path.join(state(root), 'processed', hash(text)))) put(pending, JSON.stringify({text}), true);
    return;
  }
  if (/decis|decid|instead|chosen|reject|scart|alternativ|motiv|because|perché|propos|adott|scegli|chois|reason|vereinbar|beschloss|porque/i.test(text))
    return draft(root, {text, kind: 'observation'});
}

function transcript(root: string, agent: string, p: string) {
  const base = {
    codex: '.codex/sessions',
    'claude-code': '.claude/projects',
    'copilot-cli': '.copilot/session-state'
  }[agent];
  if (!base || !path.isAbsolute(p) || !p.endsWith('.jsonl')) return;
  const dir = path.join(os.homedir(), base);
  if (!p.startsWith(dir + '/') || inside(dir, path.relative(dir, p)) !== p || !fs.existsSync(p) || fs.realpathSync(p) !== p) return;
  const posFile = path.join(state(root), 'cursors', hash(p) + '.json');
  const st = fs.statSync(p);
  const old = fs.existsSync(posFile) ? read(posFile) : {};
  let pos = old.ino === st.ino && old.pos <= st.size ? old.pos : 0;
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size - pos, 8 * 1024 * 1024));
    const n = fs.readSync(fd, buf, 0, buf.length, pos);
    let start = 0;
    for (let end = buf.indexOf(10); end >= 0 && end < n; end = buf.indexOf(10, start)) {
      let row;
      try {
        row = JSON.parse(buf.toString('utf8', start, end));
      } catch {
        fail('Malformed transcript');
      }
      start = end + 1;
      const msg = row.message ?? row.payload ?? row.data;
      const role = msg?.role ?? row.type;
      if (!['user', 'assistant', 'user.message', 'assistant.message'].includes(role)) continue;
      const content = msg?.content;
      const s = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(v => ['text', 'input_text', 'output_text'].includes(v.type)).map(v => v.text).join('\n') : '';
      capture(root, s, role.startsWith('user') ? 'user' : 'assistant');
    }
    if (!start && n === buf.length && n === 8 * 1024 * 1024) fail('Transcript segment exceeds read limit');
    put(posFile, JSON.stringify({ino: st.ino, pos: pos + start}));
  } finally {
    fs.closeSync(fd);
  }
}

export function hook(root: string, agent: string, event: string, e: any) {
  if (!config(root).local.agents.includes(agent) || !e.cwd || rootOf(e.cwd) !== root) return {};
  const dir = path.join(state(root), 'sessions');
  const p = e.transcript_path ?? e.transcriptPath;
  if (typeof p === 'string') put(path.join(dir, hash(agent + p) + '.json'), JSON.stringify({agent, p}));
  if (/prompt/i.test(event)) capture(root, e.prompt, 'user');
  if (/stop/i.test(event)) capture(root, e.last_assistant_message ?? e.lastAssistantMessage, 'assistant');
  if (/start/i.test(event) && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const ref = read(path.join(dir, f));
      transcript(root, ref.agent, ref.p);
    }
  } else if (typeof p === 'string') transcript(root, agent, p);
  return {};
}
