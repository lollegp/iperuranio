import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encode} from 'gpt-tokenizer/encoding/o200k_base';
import {hash, render} from '../src/core.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const sizes = [50, 250, 1000];
const rounds = 5;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iperuranio-search-'));
const cwd = path.join(temp, 'project');
const home = path.join(temp, 'home');
const topics = [
  ['Cache the thumbnail preview.', 'Repeated downloads delayed the gallery.'],
  ['Memoize the chart palette.', 'The chart allocates colors on each render.'],
  ['Retry the nightly export.', 'A transient connection error can interrupt a batch.'],
  ['Keep the login redirect relative.', 'The return path must stay on the same origin.'],
  ['Compress historical reports.', 'Retaining the originals filled the archive.']
];

function seed(count) {
  const dir = path.join(cwd, '.iperuranio', 'decisions');
  fs.mkdirSync(dir, {recursive: true});
  const bodies = [];
  function add(text, reason, ticket, extra = {}) {
    const body = render({kind: 'decision', text, reason, ticket, ...extra});
    const id = hash(body);
    fs.writeFileSync(path.join(dir, id + '.md'), body);
    bodies.push(body);
    return id;
  }
  const first = add('Increase max-age from 2 to 10 minutes.', 'Reduce repeat requests to the origin.', 'ABC-1234');
  const current = add('Reduce max-age to 5 minutes.', 'Product information remained stale after updates.', 'ABC-1250', {supersedes: first});
  const react = add('Memoize the filter in CartList.', 'Profiling showed repeated work during render.', 'UI-41', {source:'src/CartList.tsx'});
  const retry = add('Retry every checkout submission.', 'A duplicate charge is possible after a timeout.', 'PAY-77', {kind:'rejected'});
  const token = add('Read the login token from sessionStorage.', 'Historical storage rationale unknown.', 'AUTH-29');
  const queries = [
    {name:'ticket', args:['ABC-1234'], expected:first, successor:current},
    {name:'Italian with ticket', args:['contenuto persistente','--ticket','ABC-1250'], expected:current},
    {name:'file', args:['render','--file','src/CartList.tsx'], expected:react},
    {name:'rejection', args:['duplicate charge checkout'], expected:retry},
    {name:'symbol', args:['sessionStorage'], expected:token},
    {name:'broad topic', args:['cache'], expected:current},
    {name:'paraphrase', args:['freshness window'], expected:current},
    {name:'absent identifier', args:['NonexistentLedgerSymbol'], expected:null}
  ];
  // Each larger archive contains the same decisions plus overlapping terminology.
  for (let i = bodies.length; i < count; i++) {
    const [text, reason] = topics[i % topics.length];
    add(text, reason, 'OPS-' + (2000 + i), {source:'packages/service-' + i + '/index.ts'});
  }
  return {queries, archiveTokens:encode(bodies.join('\n')).length};
}

function run(...args) {
  return execFileSync(process.execPath, [cli, ...args], {cwd, encoding:'utf8', env:{...process.env, HOME:home}});
}
function percentile(samples, fraction) {
  return [...samples].sort((a,b) => a-b)[Math.ceil(samples.length * fraction)-1];
}
function measure(count) {
  const {queries, archiveTokens} = seed(count);
  const results = new Map();
  const times = [];
  for (let round = 0; round <= rounds; round++) {
    for (let i = 0; i < queries.length; i++) {
      const q = queries[(i+round) % queries.length];
      const start = performance.now();
      const output = run('search', ...q.args);
      const elapsed = performance.now() - start;
      const {matches} = JSON.parse(output);
      assert.ok(matches.length <= 3);
      const rank = matches.findIndex(m => m.id === q.expected) + 1;
      if (q.successor) assert.ok(matches.find(m => m.id === q.expected)?.supersededBy.includes(q.successor));
      const item = {query:q.name, expected:q.expected, rank:rank || null, returned:matches.length, tokens:encode(output).length};
      if (round === 0) results.set(q.name, item);
      else {
        assert.deepEqual(item, results.get(q.name));
        times.push(elapsed);
      }
    }
  }
  const cases = [...results.values()];
  const positive = cases.filter(c => c.expected !== null);
  const hits = positive.filter(c => c.rank !== null);
  assert.ok(hits.length > 0);
  return {records:count, archiveTokens, samples:times.length,
    medianMs:+percentile(times, 0.5).toFixed(1), p95Ms:+percentile(times, 0.95).toFixed(1),
    top3Hits:hits.length, positiveQueries:positive.length,
    medianHitTokens:percentile(hits.map(c => c.tokens), 0.5), cases};
}

try {
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  execFileSync('git',['init','-q',cwd]);
  run('init','codex');
  const report = {node:process.version, platform:process.platform, arch:process.arch, cpu:os.cpus()[0]?.model,
    encoding:'o200k_base', rounds, results:sizes.map(measure)};
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
