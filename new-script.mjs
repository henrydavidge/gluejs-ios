#!/usr/bin/env node
// Creates a new GlueJS script folder, TypeScript by default:
//
//   gluejs-ios new my-thing [--name "My Thing"] [--js] [--file] [--from EXAMPLE]
//
// Writes script.ts (or script.js with --js), shortcut.json, package.json (for npm packages) and,
// for TypeScript, gluejs.d.ts and a tsconfig.json that uses it. --file makes the shortcut run the
// script from iCloud Drive (edits sync without reinstalling the shortcut; see the reference).
// --from copies one of the packaged examples instead.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageFile, tsconfig, TYPES_FILE } from './bundle.mjs';

export const USAGE = `Usage: gluejs-ios new <folder> [options]

Creates a script folder: script.ts, shortcut.json, package.json, tsconfig.json and gluejs.d.ts.

Options:
  --name NAME          The shortcut's name (default: from the folder name)
  --js                 Plain JavaScript instead of TypeScript
  --file               Run the script from iCloud Drive, so edits don't need a reinstall
  --from EXAMPLE       Copy an example instead (list them with gluejs-ios examples)
  -h, --help           Show this help`;

const TS_TEMPLATE = `// TITLE
//
// Input: describe what the shortcut passes in.

export default async function main(input: unknown): Promise<string> {
  const name = typeof input === 'string' && input.trim() ? input.trim() : 'world';
  return \`Hello, \${name}!\`;
}
`;

const JS_TEMPLATE = `// TITLE
//
// Input: describe what the shortcut passes in.

const name = typeof input === 'string' && input.trim() ? input.trim() : 'world';
return \`Hello, \${name}!\`;
`;

/** The packaged examples, with the first comment line of each script as its description. */
export function examples() {
  const root = packageFile('examples');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'shortcut.json')))
    .map((entry) => {
      const script = ['script.ts', 'script.js'].map((f) => join(root, entry.name, f)).find(existsSync);
      const title = script ? /^\/\/\s*(.+)/.exec(readFileSync(script, 'utf8'))?.[1] ?? '' : '';
      return { name: entry.name, title, path: join(root, entry.name) };
    });
}

function writeTypes(dir, script) {
  writeFileSync(join(dir, TYPES_FILE), readFileSync(packageFile(TYPES_FILE)));
  const config = tsconfig(TYPES_FILE);
  config.files = [script, TYPES_FILE];
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(config, null, 2) + '\n');
}

export function scaffold(folder, { name, js = false, file = false, from } = {}) {
  const dir = resolve(folder);
  if (existsSync(dir)) throw new Error(`${folder} already exists`);
  if (from) {
    const example = examples().find((e) => e.name === from);
    if (!example) throw new Error(`No example named "${from}". Examples: ${examples().map((e) => e.name).join(', ')}`);
    cpSync(example.path, dir, { recursive: true, filter: (path) => !/^\/?(node_modules|dist|\.glue-local)(\/|$)/.test(path.slice(example.path.length)) });
    if (existsSync(join(dir, 'script.ts'))) writeTypes(dir, 'script.ts');
    return dir;
  }
  mkdirSync(dir, { recursive: true });
  const title = name ?? basename(dir).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const script = js ? 'script.js' : 'script.ts';
  writeFileSync(resolve(dir, script), (js ? JS_TEMPLATE : TS_TEMPLATE).replace('TITLE', title));
  const run = { id: 'result', type: 'runScript', script, input: '${shortcutInput}' };
  if (file) run.mode = 'file';
  writeFileSync(resolve(dir, 'shortcut.json'), JSON.stringify({
    name: title,
    color: 'blue',
    actions: [run, { type: 'showResult', text: '${result}' }],
  }, null, 2) + '\n');
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name: basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-'), private: true, type: 'module' }, null, 2) + '\n');
  if (!js) writeTypes(dir, script);
  return dir;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) return console.log(USAGE);
  const options = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name' || arg === '--from') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++i];
    }
    else if (arg === '--js') options.js = true;
    else if (arg === '--file') options.file = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}. See gluejs-ios new --help.`);
    else rest.push(arg);
  }
  if (rest.length !== 1) throw new Error('Expected one folder name. See gluejs-ios new --help.');
  if (options.from && (options.name || options.js || options.file)) throw new Error('--from copies an example as it is; edit it afterwards instead of passing --name, --js or --file.');
  const dir = scaffold(rest[0], options);
  console.log(`Created ${dir}. Edit the script, then:\n  npx gluejs-ios run ${rest[0]}/${existsSync(join(dir, 'script.js')) ? 'script.js' : 'script.ts'} '<input>'\n  npx gluejs-ios build ${rest[0]}`);
  const { dependencies } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (dependencies) console.log(`It uses npm packages: run \`npm install\` in ${rest[0]} first.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
