import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function checkout(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iperuranio-portable-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const project = fs.realpathSync(fs.mkdirSync(path.join(temp, 'shared project'), {recursive: true}));
  const home = fs.mkdirSync(path.join(temp, 'private home'), {recursive: true});
  execFileSync('git', ['init', '-q', project]);
  const env = {...process.env, HOME: home};
  const run = (args, input) => JSON.parse(execFileSync(process.execPath, [cli, ...args], {
    cwd: project, env, encoding: 'utf8', input: JSON.stringify(input)
  }));
  return {project, home, env, run};
}

test('portable enrollment preserves project instructions and starts MCP from an unrelated directory', t => {
  const {project, home, env, run} = checkout(t);
  const notes = path.join(project, 'AGENTS.md');
  const existing = '# Instructions\n\nKeep decisions traceable.\n';
  fs.writeFileSync(notes, existing);
  const generic = run(['init']);
  assert.equal(generic.agent, 'generic');
  assert.equal(generic.mode, 'portable');
  const once = fs.readFileSync(notes, 'utf8');
  assert.ok(once.includes(existing) && once.toLowerCase().includes('iperuranio'));

  const custom = run(['init', 'team-agent']);
  run(['init', 'team-agent']);
  assert.equal(fs.readFileSync(notes, 'utf8'), once);
  assert.equal(custom.mode, 'portable');
  assert.deepEqual(new Set(run(['doctor']).agents), new Set(['generic', 'team-agent']));
  assert.ok(!fs.existsSync(path.join(project, '.claude')));
  assert.ok(!fs.existsSync(path.join(project, '.codex')));

  const request = (id, method, params) => ({jsonrpc: '2.0', id, method, params});
  const input = [
    request(1, 'initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'fixture', version: '1'}}),
    {jsonrpc: '2.0', method: 'notifications/initialized'},
    request(2, 'tools/list', {}),
    request(3, 'tools/call', {name: 'memory_save', arguments: {text: 'Use structured cancellation.'}}),
    request(4, 'tools/call', {name: 'memory_save', arguments: {text: 'token=EXAMPLE_CREDENTIAL'}})
  ].map(m => JSON.stringify(m)).join('\n') + '\n';
  const responses = execFileSync(custom.mcp.command, custom.mcp.args, {cwd: home, env, input, encoding: 'utf8'})
    .trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(responses.map(r => r.id), [1, 2, 3, 4]);
  assert.equal(responses[0].result.serverInfo.name, 'iperuranio');
  assert.ok(responses[1].result.tools.some(tool => tool.name === 'memory_search'));
  const saved = JSON.parse(responses[2].result.content[0].text);
  assert.equal(saved.status, 'needs_review');
  assert.equal(JSON.parse(responses[3].result.content[0].text).status, 'blocked');
  assert.deepEqual(run(['pending']).ids, [saved.id]);
});

test('portable message hook captures enrolled project events once and keeps transcript paths private', t => {
  const {project, home, run} = checkout(t);
  run(['init', 'team-agent', '--auto-cache']);
  const other = path.join(home, 'other-project');
  execFileSync('git', ['init', '-q', other]);
  const event = {cwd: project, role: 'user', text: 'Decision: change max-age from 2 to 10 minutes.'};
  run(['hook', 'unregistered', 'message'], event);
  run(['hook', 'team-agent', 'message'], {...event, cwd: other});
  assert.deepEqual(run(['search', 'max-age']).matches, []);

  const transcript = path.join(home, 'other-conversation.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({role: 'user', text: 'Decision: keep private fixture data.'}) + '\n');
  for (let i = 0; i < 2; i++) run(['hook', 'team-agent', 'message'], {...event, transcript_path: transcript});
  run(['hook', 'team-agent', 'message'], {...event, text: 'Decision: token=EXAMPLE_CREDENTIAL'});
  assert.deepEqual(run(['pending']).ids, []);
  run(['init', 'codex']);
  const records = run(['search', 'max-age']).matches;
  assert.equal(records.length, 1);
  assert.match(records[0].snippet, /from 2 to 10 minutes/);
  const state = path.join(home, '.local', 'state', 'iperuranio');
  for (const f of fs.readdirSync(state, {recursive: true}).filter(name => name.endsWith('.json'))) {
    const data = fs.readFileSync(path.join(state, f), 'utf8');
    assert.ok(!data.includes(transcript) && !data.includes('EXAMPLE_CREDENTIAL'));
  }
});

test('invalid agent names leave a fresh checkout unenrolled', t => {
  const {project, env} = checkout(t);
  for (const name of ['../other', 'name; command', 'two words']) {
    const p = spawnSync(process.execPath, [cli, 'init', name], {cwd: project, env, encoding: 'utf8'});
    assert.notEqual(p.status, 0);
  }
  assert.deepEqual(fs.readdirSync(project), ['.git']);
});

test('Cursor and Gemini project launchers deliver scoped prompt and answer events to the same archive', t => {
  const {project, home, env, run} = checkout(t);
  const config = relative => JSON.parse(fs.readFileSync(path.join(project, relative), 'utf8'));
  const existing = {unrelated: {command: 'example'}};
  for (const [agent, dir, mcpPath, hooksPath] of [
    ['cursor', '.cursor', '.cursor/mcp.json', '.cursor/hooks.json'],
    ['gemini-cli', '.gemini', '.gemini/settings.json', '.gemini/settings.json']
  ]) {
    fs.mkdirSync(path.join(project, dir));
    fs.writeFileSync(path.join(project, mcpPath), JSON.stringify({mcpServers: existing}));
    assert.equal(run(['init', agent]).mode, 'native');
    run(['init', agent]);
    const cursor = agent === 'cursor';
    const {mcpServers} = config(mcpPath);
    assert.deepEqual(mcpServers.unrelated, existing.unrelated);
    const server = mcpServers.iperuranio;
    const responses = execFileSync(server.command, server.args.map(arg=>arg.replaceAll('${workspaceFolder}', project)), {
      cwd:cursor ? home : project, env, encoding:'utf8', input:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'
    });
    assert.ok(JSON.parse(responses).result.tools.some(tool=>tool.name==='memory_save'));
    const hooks = config(hooksPath).hooks;
    const deliver = (event, input) => {
      assert.equal(hooks[event].length, 1);
      const handler = hooks[event][0];
      return JSON.parse(execFileSync('sh', ['-c', cursor ? handler.command : handler.hooks[0].command], {
        cwd:project, env, encoding:'utf8', input:JSON.stringify(input)
      }));
    };
    const scope = cursor ? {workspace_roots:[project]} : {cwd:project};
    const prompt = 'We decided to cache the project manifest.';
    const reason = 'Reason: repeated reads are expensive.';
    const event = cursor ? 'beforeSubmitPrompt' : 'BeforeAgent';
    if (cursor) {
      assert.deepEqual(deliver(event, {workspace_roots:[project,home],prompt:'Decision: skip ambiguous workspace.'}), {continue:true});
      assert.deepEqual(run(['pending']).ids, []);
    }
    assert.deepEqual(deliver(event, {...scope,prompt}),cursor ? {continue:true} : {});
    deliver(cursor ? 'afterAgentResponse' : 'AfterAgent', {...scope,text:reason,prompt_response:reason});
    assert.equal(run(['pending']).ids.length, 2);
  }
});
