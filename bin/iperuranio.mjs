#!/usr/bin/env node
import {registerHooks, stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';

const sources = new Set(['cli', 'core', 'adapter', 'mcp', 'language'].map(name => new URL('../src/' + name + '.ts', import.meta.url).href));
registerHooks({
  load(url, context, next) {
    if (!sources.has(url)) return next(url, context);
    return {format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8')), shortCircuit: true};
  }
});
await import('../src/cli.ts');
