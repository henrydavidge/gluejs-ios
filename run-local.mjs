#!/usr/bin/env node
// Runs a GlueJS script on the Mac with mocked iOS APIs, the same way the app wraps it.
//
//   gluejs-ios run <script> [input | @file]
//
// Device data comes from Shortcuts, so pass it as input, e.g. the text a shortcut's Health
// actions produce. Store and Widget are saved under .glue-local/ in the current directory.
// fetch is Node's real one; unlike on the phone it isn't limited to http(s).
// Secrets come from environment variables: Secrets.get('GITHUB_TOKEN') reads
// GLUE_SECRET_GITHUB_TOKEN. As on the phone, Secrets.get returns a placeholder that fetch
// replaces with the value (in the URL, headers and body); the phone also checks the allowed hosts.
// Scripts that import npm packages are bundled exactly as for the phone.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadScript } from './bundle.mjs';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const USAGE = `Usage: gluejs-ios run <script> [input | @file]

Runs a script on this Mac the way GlueJS runs it on the iPhone. The input is parsed as JSON when
possible; @file reads it from a file. Store and Widget write to .glue-local/ here.
Secrets come from environment variables: Secrets.get('NAME') uses GLUE_SECRET_NAME.
GLUE_REFRESHING_WIDGET=<name> simulates a widget refresh.`;

const secretValue = (name) => {
  const value = process.env[`GLUE_SECRET_${name}`];
  if (value === undefined) throw new Error(`No secret named "${name}". Set GLUE_SECRET_${name} to try it locally.`);
  return value;
};
const placeholders = new Map(); // placeholder -> value
const Secrets = {
  names: () => Object.keys(process.env).filter((k) => k.startsWith('GLUE_SECRET_')).map((k) => k.slice(12)).sort(),
  has: (name) => process.env[`GLUE_SECRET_${name}`] !== undefined,
  get(name) {
    const value = secretValue(name);
    const placeholder = `glue-secret-${name}-${randomUUID()}`;
    placeholders.set(placeholder, value);
    return placeholder;
  },
  reveal: secretValue,
};

const insertSecrets = (text) => {
  for (const [placeholder, value] of placeholders) text = text.split(placeholder).join(value);
  return text;
};
const localFetch = (resource, init = {}) => {
  const url = insertSecrets(String(resource instanceof Request ? resource.url : resource));
  const headers = new Headers(init.headers ?? (resource instanceof Request ? resource.headers : undefined));
  for (const [key, value] of headers) headers.set(key, insertSecrets(value));
  const body = typeof init.body === 'string' ? insertSecrets(init.body) : init.body;
  return fetch(url, { ...init, headers, body });
};

const local = () => join(process.cwd(), '.glue-local');
const readJSON = (name) => {
  try {
    const parsed = JSON.parse(readFileSync(join(local(), name), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid object in ${name}`);
    return Object.assign(Object.create(null), parsed);
  }
  catch (error) { if (error.code === 'ENOENT') return Object.create(null); throw error; }
};
const writeJSON = (name, value) => { mkdirSync(local(), { recursive: true }); writeFileSync(join(local(), name), JSON.stringify(value, null, 2)); };

export const Store = {
  get(key) { const json = readJSON('store.json')[key]; return json === undefined ? undefined : JSON.parse(json); },
  set(key, value) {
    if (value === undefined) throw new TypeError('Store.set needs a value; use Store.delete to remove a key');
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('Store values must be JSON-serializable');
    const all = readJSON('store.json'); all[key] = json; writeJSON('store.json', all);
  },
  delete(key) { const all = readJSON('store.json'); delete all[key]; writeJSON('store.json', all); },
  keys() { return Object.keys(readJSON('store.json')).sort(); },
};

export const Widget = {
  set(name, content, options = {}) {
    const all = readJSON('widgets.json');
    all[name] = { content, refresh: options.refresh ?? null, updatedAt: new Date().toISOString() };
    writeJSON('widgets.json', all);
    console.error(`[widget "${name}"${options.refresh ? `, refresh ${options.refresh} min` : ''}] ${JSON.stringify(content)}`);
  },
  remove(name) { const all = readJSON('widgets.json'); delete all[name]; writeJSON('widgets.json', all); },
  names() { return Object.keys(readJSON('widgets.json')).sort(); },
};

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) return console.log(USAGE);
  if (!argv.length || argv.length > 2 || argv[0].startsWith('-')) throw new Error('Expected a script and an optional input. See gluejs-ios run --help.');
  const [file, inputArg] = argv;
  const rawInput = inputArg?.startsWith('@') ? readFileSync(inputArg.slice(1), 'utf8') : inputArg;
  const source = await loadScript(file);
  let input = rawInput ?? null;
  try { if (rawInput !== undefined) input = JSON.parse(rawInput); } catch {}

  const AsyncFunction = (async () => {}).constructor;
  const fn = new AsyncFunction('input', 'rawInput', 'refreshingWidget', 'Secrets', 'Store', 'Widget', 'sleep', 'fetch', source);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // GLUE_REFRESHING_WIDGET=<name> simulates a widget refresh run.
  const result = await fn(input, rawInput ?? null, process.env.GLUE_REFRESHING_WIDGET || null, Secrets, Store, Widget, sleep, localFetch);
  if (result !== undefined && result !== null) {
    // As on the phone, secret values and placeholders never appear in the output.
    let text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    for (const [placeholder, value] of placeholders) text = text.split(placeholder).join('•••').split(value).join('•••');
    console.log(text);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? String(error));
    process.exit(1);
  });
}
