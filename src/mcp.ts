import {createInterface} from 'node:readline';
import {records, search, draft, fail} from './core.ts';

const definitions = [
  ['memory_search', 'Search project decisions', {query: 'string'}, ['query']],
  ['memory_save', 'Stage an English candidate for human review', {
    text: 'string',
    reason: 'string',
    ticket: 'string',
    source: 'string',
    kind: 'string',
    supersedes: 'string'
  }, ['text']],
  ['memory_explain', 'Read the evidence for a decision', {id: 'string'}, ['id']],
  ['memory_get_history', 'Follow linked records', {id: 'string'}, ['id']],
  ['memory_get_handoff', 'Search project handoffs', {query: 'string'}, ['query']],
  ['memory_challenge', 'Stage a challenge to a decision', {
    id: 'string',
    text: 'string',
    reason: 'string'
  }, ['id', 'text']]
];

export function invoke(root: string, name: string, a: any) {
  if (name === 'memory_search') return search(root, a.query);
  if (name === 'memory_save') return draft(root, a);
  if (name === 'memory_challenge') return draft(root, {
    text: a.text,
    reason: a.reason,
    target: a.id,
    kind: 'challenge'
  });
  if (name === 'memory_get_handoff') return search(root, a.query, '', '', 'handoff');
  const all = records(root);
  const r = all.find(x => x.id === a.id);
  if (!r) fail('Unknown record');
  if (name === 'memory_explain') return r;
  if (name !== 'memory_get_history') fail('Unknown tool');
  const related = new Set([r.id]);
  for (let size = -1; size !== related.size;) {
    size = related.size;
    for (const row of all) for (const link of row.body.matchAll(/^(?:supersedes|target): ([a-f0-9]{24})$/gm))
      if (related.has(row.id) || related.has(link[1])) {
        related.add(row.id);
        related.add(link[1]);
      }
  }
  return all.filter(x => related.has(x.id));
}

export async function serve(root: string) {
  for await(const line of createInterface({input: process.stdin})) {
    let id = null;
    try {
      const m = JSON.parse(line);
      if (m.id === undefined) continue;
      id = m.id;
      let result;
      if (m.method === 'initialize') result = {
        protocolVersion: '2025-06-18',
        capabilities: {tools: {}},
        serverInfo: {name: 'iperuranio', version: '0.1.0'}
      };
      else if (m.method === 'ping') result = {};
      else if (m.method === 'tools/list') result = {
        tools: definitions.map(([name, description, props, required]) => ({
          name,
          description,
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries(Object.entries(props).map(([k, type]) => [k, {type}])),
            required,
            additionalProperties: false
          }
        }))
      };
      else if (m.method === 'tools/call') result = {
        content: [{
          type: 'text',
          text: JSON.stringify(invoke(root, m.params.name, m.params.arguments ?? {}))
        }]
      };
      else {
        console.log(JSON.stringify({jsonrpc: '2.0', id, error: {code: -32601, message: 'Method not found'}}));
        continue;
      }
      console.log(JSON.stringify({jsonrpc: '2.0', id, result}));
    } catch {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {code: -32602, message: 'Invalid request or unavailable record'}
      }));
    }
  }
}
