import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iperuranio-'));
  t.after(() => fs.rmSync(tmp, {recursive: true, force: true}));
  const cwd = fs.realpathSync(fs.mkdirSync(path.join(tmp, 'project'), {recursive: true}));
  const home = fs.realpathSync(fs.mkdirSync(path.join(tmp, 'home'), {recursive: true}));
  execFileSync('git', ['init', '-q', cwd]);

  function run(args, input = '', ok = true, entry = cli) {
    const p = spawnSync(process.execPath, [entry, ...args], {
      cwd,
      env: {...process.env, HOME: home},
      encoding: 'utf8',
      input
    });
    assert.equal(p.status, ok ? 0 : 1, p.stderr);
    return ok ? p.stdout.trim().split('\n').map(s => JSON.parse(s)).at(-1) : p.stderr;
  }

  return {cwd, home, run};
}

test('project adapters preserve configuration and isolate private candidates', t => {
  const {cwd, run} = fixture(t);
  fs.mkdirSync(path.join(cwd, '.claude'));
  fs.writeFileSync(path.join(cwd, '.claude/settings.json'), '{"existing":true}');
  for (const agent of ['codex', 'claude-code', 'copilot-cli', 'claude-code']) run(['init', agent, '--history-dir', 'docs/decisions']);
  const cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.claude/settings.json')));
  assert.equal(cfg.existing, true);
  assert.equal(cfg.hooks.Stop.length, 1);
  run(['init', 'codex', '--history-dir', '../outside'], '', false);
  const a = run(['save', '--stdin'], JSON.stringify({text: 'Consider memoizing the list.', kind: 'proposal'}));
  assert.equal(a.status, 'needs_review');
  assert.equal(run(['save', '--stdin'], JSON.stringify({
    text: 'Consider memoizing the list.',
    kind: 'proposal'
  })).id, a.id);
  assert.equal(run(['save', 'token=FAKE_CREDENTIAL']).status, 'blocked');
  assert.equal(run(['pending']).ids.length, 1);
  assert.deepEqual(run(['search', 'memoizing']), {matches: []});
  assert.equal(run(['forget', 'Use memoization', '--reason', 'No measurable gain']).status, 'needs_review');
});
test('incremental transcript recovery after abandonment, English record, cross-agent retrieval and replay', t => {
  const {cwd, home, run} = fixture(t);
  run(['init', 'claude-code', '--auto-cache']);
  run(['init', 'codex']);
  const p = path.join(home, '.claude/projects/fixture/session.jsonl');
  fs.mkdirSync(path.dirname(p), {recursive: true});
  fs.writeFileSync(p, '');
  const e = JSON.stringify({cwd, transcript_path: p});
  run(['hook', 'claude-code', 'SessionStart'], e);
  const lines = ['Decisione: cambiare max-age da 2 a 10 minuti.', 'Decision: token=FAKE_CREDENTIAL'].map(content => JSON.stringify({
    type: 'user',
    message: {role: 'user', content}
  }));
  fs.appendFileSync(p, lines.join('\n') + '\n');
  for (let i = 0; i < 2; i++) run(['hook', 'codex', 'SessionStart'], JSON.stringify({cwd}));
  const found = run(['search', 'contenuto persistente']).matches;
  assert.equal(found.length, 1);
  assert.match(found[0].snippet, /from 2 to 10 minutes/);
  assert.equal(run(['doctor']).records, 1);
  assert.deepEqual(run(['pending']).ids, []);
  const message = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {name: 'memory_explain', arguments: {id: found[0].id}}
  }) + '\n';
  const response = run(['mcp'], message, true, path.join(cwd, '.iperuranio/runtime/cli.ts'));
  assert.match(response.result.content[0].text, /from 2 to 10/);
});
test('sensitive hook payload never becomes an archive or draft; symlink escape refused', t => {
  const {run, cwd, home} = fixture(t);
  run(['init', 'codex', '--auto-cache']);
  run(['hook', 'codex', 'UserPromptSubmit'], JSON.stringify({
    cwd,
    prompt: 'Decisione: cambiare max-age da 2 a 10 minuti. email joe@example.org'
  }));
  assert.deepEqual(run(['pending']).ids, []);
  assert.equal(run(['doctor']).records, 0);
  fs.symlinkSync(home, path.join(cwd, '.iperuranio/decisions'));
  run(['doctor'], '', false);
});
test('standalone distribution works inside node_modules and installs its own runnable runtime', t => {
  const {cwd, run} = fixture(t);
  const pkg = path.join(cwd, 'node_modules/iperuranio');
  fs.mkdirSync(pkg, {recursive: true});
  for (const f of ['bin', 'src', 'skills', 'package.json']) fs.cpSync(path.join(path.dirname(cli), '..', f), path.join(pkg, f), {recursive: true});
  run(['init', 'codex'], '', true, path.join(pkg, 'bin/iperuranio.mjs'));
  assert.deepEqual(run(['doctor'], '', true, path.join(cwd, '.iperuranio/runtime/cli.ts')).agents, ['codex']);
});
test('two-way local translation verification with synthetic responses', async () => {
  const {extract} = await import('../src/language.ts');
  const orig = globalThis.fetch;
  const responses = [{items: [{kind: 'proposal', text: 'Use 30 s only for batch; untested.'}]}, {verified: false}];
  try {
    globalThis.fetch = async url => {
      assert.equal(url, 'http://127.0.0.1:8080/v1/chat/completions');
      return {ok: true, json: async () => ({choices: [{message: {content: JSON.stringify(responses.shift())}}]})};
    };
    await assert.rejects(() => extract(8080, 'Potremmo usare 30 s solo per il batch. Non verificato.'), /review/);
  } finally {
    globalThis.fetch = orig;
  }
});
test('separable technical statement survives a credential in the original prompt privately', t => {
  const {cwd, home, run} = fixture(t);
  run(['init', 'claude-code', '--auto-cache']);
  run(['hook', 'claude-code', 'UserPromptSubmit'], JSON.stringify({
    cwd,
    prompt: 'Decisione: cambiare max-age da 2 a 10 minuti.\nAuthorization: Bearer syntheticTestValue'
  }));
  assert.equal(run(['pending']).ids.length, 1);
  assert.equal(run(['doctor']).records, 0);
  const files = fs.readdirSync(home, {recursive: true}).filter(f => f.endsWith('.json'));
  const data = files.map(f => fs.readFileSync(path.join(home, f), 'utf8')).join('');
  assert.ok(data.includes('2 a 10'));
  assert.ok(!data.includes('syntheticTestValue'));
});
