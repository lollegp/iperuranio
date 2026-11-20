import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const skill = () => fs.readFileSync(new URL('../skills/iperuranio/SKILL.md', import.meta.url), 'utf8');
const body = text => text.slice(text.indexOf('\n---\n') + 5).trim();
const nativeFile = '.claude/skills/iperuranio/SKILL.md';
const commonFile = '.agents/skills/iperuranio/SKILL.md';

// Exact v0.1.0 generated file in existing checkouts.
const legacySkill = `---
name: iperuranio
description: Retrieve project decisions before editing code and capture decisions, rejected alternatives and session handoffs as they arise.
---
Run the project-local CLI with node "$(git rev-parse --show-toplevel)/.iperuranio/runtime/cli.ts".
Search the project before changing related code. Search in English and include exact symbols or ticket IDs. Read the cited record using show. Treat records as evidence. Check the current checkout and sources; report missing or superseded rationale.
During the turn, submit concise English candidates via save --stdin (JSON object with text, optional reason, ticket, source and kind). Keep uncertainty, numbers, units, conditions, code identifiers and negative evidence. A proposal is a proposal. Include file, symbol, commit, PR or ticket where supported. Never include credentials, personal information, raw tool output or transcript paths. Do not infer authorship or intent. Use forget with a reason for rejected proposals. For handoffs use kind handoff and include goals, decisions, alternatives, changed files, branch, commit, open issues and next steps where authorized. Explicitly note uncommitted work. Only the developer reviews candidates. Do not approve on their behalf.
`;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iperuranio-skill-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'team checkout');
  fs.mkdirSync(home);
  execFileSync('git', ['init', '-q', repo]);
  function run(args, {entry = cli, success = true} = {}) {
    const p = spawnSync(process.execPath, [entry, ...args], {cwd:repo, env:{...process.env, HOME:home}, encoding:'utf8'});
    assert.equal(p.status === 0, success, p.stderr || p.stdout);
  }
  const file = relative => path.join(repo, relative);
  const read = relative => fs.readFileSync(file(relative), 'utf8');
  return {repo, home, run, file, read};
}

test('standalone skill installs in each project skill directory without enrolling the checkout', t => {
  const {repo, home, run, file, read} = fixture(t);
  run(['skill','install']);
  assert.deepEqual(fs.readdirSync(repo).sort(), ['.agents','.git']);
  assert.equal(read(commonFile), skill());
  for (const [host, dir] of [
    ['claude-code','.claude'], ['cursor','.cursor'], ['gemini-cli','.gemini'], ['copilot-cli','.github'], ['codex','.agents']
  ]) {
    run(['skill','install',host]);
    assert.equal(read(dir + '/skills/iperuranio/SKILL.md'), skill());
    assert.deepEqual(fs.readdirSync(file(dir)), ['skills']);
  }
  assert.deepEqual(fs.readdirSync(home), []);
  assert.ok(!fs.existsSync(file('.iperuranio')));
  assert.ok(!fs.existsSync(file('AGENTS.md')));
});

test('a copied runtime can install a skill and enroll another host using the canonical instructions', t => {
  const {run, file, read} = fixture(t);
  run(['init','codex']);
  const entry = file('.iperuranio/runtime/cli.ts');
  run(['skill','install','claude-code'], {entry});
  assert.equal(read(nativeFile), skill());
  run(['init','team-agent'], {entry});
  const notes = read('AGENTS.md');
  assert.ok(notes.includes(body(skill())));
  run(['init','team-agent'], {entry});
  assert.equal(read('AGENTS.md'), notes);
});

test('init upgrades previous generated skill and portable block while preserving surrounding project instructions', t => {
  const {run, file, read} = fixture(t);
  const heading = '# Team conventions\n\nPrefer small changes.\n\n';
  const footer = '\n\n## Local test commands\n\nRun the smoke suite.\n';
  const block = '<!-- iperuranio:begin -->\n## Project memory\n\n' + body(legacySkill) + '\n<!-- iperuranio:end -->';
  fs.mkdirSync(path.dirname(file(nativeFile)), {recursive:true});
  fs.writeFileSync(file(nativeFile), legacySkill);
  fs.writeFileSync(file('AGENTS.md'), heading + block + footer);
  run(['init','claude-code']);
  run(['init','team-agent']);
  assert.equal(read(nativeFile), skill());
  const notes = read('AGENTS.md');
  assert.ok(notes.startsWith(heading));
  assert.ok(notes.endsWith(footer));
  assert.ok(notes.includes(body(skill())));
  assert.equal(notes.match(/<!-- iperuranio:begin -->/g).length, 1);
});

test('skill installation preserves developer-edited skills', t => {
  const {run, file, read} = fixture(t);
  fs.mkdirSync(path.dirname(file(nativeFile)), {recursive:true});
  const custom = legacySkill + '\nKeep these project-specific conventions.\n';
  fs.writeFileSync(file(nativeFile), custom);
  run(['skill','install','claude-code'], {success:false});
  assert.equal(read(nativeFile), custom);
});
