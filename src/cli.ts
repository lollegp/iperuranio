#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {extract, generate} from './language.ts';
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {
  rootOf,
  inside,
  state,
  config,
  read,
  put,
  hash,
  draft,
  records,
  render,
  search,
  fail,
  sensitive
} from './core.ts';
import {init, hook} from './adapter.ts';
import {serve, invoke} from './mcp.ts';

const help = 'iperuranio init <codex|claude-code|copilot-cli> [--history-dir DIR] [--auto-cache]\nsearch QUERY [--ticket ID] [--file PATH] [--json] | show ID | history ID\nsave TEXT [--supersedes ID] | forget TEXT --reason WHY [--id ID] | save/forget --stdin\npending | review ID | doctor | mcp';

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || ['--help', 'help', '-h'].includes(cmd)) {
    console.log(help);
    return;
  }
  const root = rootOf();
  const {values: v, positionals: p} = parseArgs({
    args, allowPositionals: true, options: {
      'model-port': {type: 'string'},
      'history-dir': {type: 'string'},
      'auto-cache': {type: 'boolean'},
      ticket: {type: 'string'},
      file: {type: 'string'},
      json: {type: 'boolean'},
      reason: {type: 'string'},
      source: {type: 'string'},
      stdin: {type: 'boolean'},
      supersedes: {type: 'string'},
      id: {type: 'string'}
    }
  });
  if (cmd === 'init') return init(root, p[0], v['history-dir'], v['auto-cache'], v['model-port'] === undefined ? undefined : Number(v['model-port']));
  const {archive, local} = config(root);
  if (cmd === 'hook') {
    const result = hook(root, p[0], p[1], JSON.parse(fs.readFileSync(0, 'utf8')));
    if (local.modelPort && fs.existsSync(path.join(state(root), 'extract'))) {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'drain'], {
        cwd: root,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    }
    return result;
  }
  if (cmd === 'drain') {
    const dir = path.join(state(root), 'extract');
    if (!local.modelPort || !fs.existsSync(dir)) return {processed: 0};
    let processed = 0;
    for (const name of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      const file = path.join(dir, name);
      const lock = file + '.lock';
      try {
        fs.mkdirSync(lock);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (Date.now() - fs.statSync(lock).mtimeMs > 300000) fs.rmdirSync(lock);
        continue;
      }
      try {
        if (!fs.existsSync(file)) continue;
        const {text} = read(file);
        for (const item of await extract(local.modelPort, text)) {
          const candidate = draft(root, item);
          if (candidate.status === 'blocked') fail('Private review required');
          if (candidate.status === 'needs_review') put(path.join(state(root), 'evidence', candidate.id, hash(text) + '.json'), JSON.stringify({text}), true);
        }
        put(path.join(state(root), 'processed', name.slice(0, -5)), '');
        fs.unlinkSync(file);
        processed++;
      } finally {
        fs.rmdirSync(lock);
      }
    }
    return {processed};
  }
  if (cmd === 'mcp') return serve(root);
  if (cmd === 'doctor') return {
    agents: local.agents,
    history: local.history,
    records: records(root).length,
    autoCache: local.autoCache,
    hostTrust: 'check in client'
  };
  if (cmd === 'search') {
    if (!p[0]) fail('Missing query');
    let query = p[0];
    if (local.modelPort && !sensitive(query)) {
      try {
        const x = await generate(local.modelPort, 'Translate this search into concise English technical keywords. Keep identifiers. Return {"query":"..."}.', query);
        if (typeof x.query === 'string') query += ' ' + x.query;
      } catch { /* Local lexical search remains available. */
      }
    }
    return {matches: search(root, query, v.ticket, v.file)};
  }
  if (cmd === 'show' || cmd === 'history') return invoke(root, cmd === 'show' ? 'memory_explain' : 'memory_get_history', {id: p[0]});
  if (cmd === 'save' || cmd === 'forget') {
    const data = v.stdin ? JSON.parse(fs.readFileSync(0, 'utf8')) : {text: p[0]};
    for (const k of ['reason', 'ticket', 'supersedes', 'source']) if (v[k]) data[k] = v[k];
    if (cmd === 'forget') {
      data.kind = 'rejected';
      if (v.id) data.target = v.id;
      else {
        const exact = records(root).filter(r => r.body.split('\n').includes(data.text) && (!data.ticket || r.body.includes('ticket: ' + data.ticket + '\n')));
        if (exact.length > 1) return {status: 'ambiguous', ids: exact.map(x => x.id)};
        if (exact.length) data.target = exact[0].id;
      }
    }
    return draft(root, data);
  }
  const dir = path.join(state(root), 'drafts');
  if (cmd === 'pending') return {ids: fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => x.slice(0, -5)) : []};
  if (cmd === 'review') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) fail('Interactive terminal required');
    const id = p[0];
    if (!/^[a-f0-9]{24}$/.test(id)) fail('Invalid ID');
    const f = inside(dir, id + '.json');
    const data = read(f);
    const rl = createInterface({input: process.stdin, output: process.stdout});
    try {
      const proofs = path.join(state(root), 'evidence', id);
      if (fs.existsSync(proofs)) for (const n of fs.readdirSync(proofs)) console.log('Private source segment', JSON.stringify(read(path.join(proofs, n)).text));
      console.log('Private candidate\n' + render(data));
      const edit = await rl.question('English replacement for the text (Enter to keep): ');
      if (edit) data.text = edit;
      if (data.reason) {
        const r = await rl.question('English replacement for the reason (Enter to keep): ');
        if (r) data.reason = r;
      }
      const body = render(data);
      if (sensitive(body)) fail('Sensitive content detected');
      console.log(body);
      if (await rl.question('Verified English, fidelity, evidence and privacy for all repository readers? Type PUBLISH: ') !== 'PUBLISH') return {status: 'private'};
      const recordId = hash(body);
      put(inside(archive, recordId + '.md'), body, true);
      put(path.join(state(root), 'reviewed', id + '.json'), JSON.stringify({id: recordId}));
      fs.unlinkSync(f);
      return {status: 'saved', id: recordId};
    } finally {
      rl.close();
    }
  }
  fail('Unknown command');
}

try {
  const result = await main();
  if (result !== undefined) console.log(JSON.stringify(result));
} catch (e) {
  console.error(e.code ? 'iperuranio: ' + e.code : e instanceof SyntaxError ? 'Invalid JSON' : e.message);
  process.exitCode = 1;
}
