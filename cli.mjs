#!/usr/bin/env node
// gluejs-ios: build GlueJS shortcuts and scripts on a Mac. See USAGE.

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { packageFile, TYPES_FILE } from './bundle.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const USAGE = `gluejs-ios ${version}: build shortcuts that use GlueJS's Run JavaScript action.

Usage: gluejs-ios <command> [options]

Commands:
  new <folder>         Create a script folder (TypeScript, shortcut.json, types)
  run <script> [input] Run a script on this Mac with the phone's APIs mocked
  build <folder>       Build the folder's signed .shortcut file(s) into dist/
  push <folder>        Update the iCloud copy of a "mode": "file" script
  secret NAME          Build a one-time shortcut that saves an API key on the iPhone
  examples             List the examples (copy one with new --from)
  docs [--types]       Print the reference for agents (or gluejs.d.ts)

Run gluejs-ios <command> --help for a command's options, and gluejs-ios docs for the
full reference (shortcut.json, actions, the script API). Website: https://gluejs.sireniallc.com`;

const COMMANDS = {
  new: './new-script.mjs',
  run: './run-local.mjs',
  build: './build-shortcut.mjs',
  push: './push-script.mjs',
  secret: './setup-secret.mjs',
};

let showStack = Boolean(process.env.GLUE_DEBUG);

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  // A failing script's stack trace points at the line that failed.
  if (command === 'run') showStack = true;
  if (!command || command === 'help' || command === '--help' || command === '-h') return console.log(USAGE);
  if (command === '--version' || command === '-v') return console.log(version);
  if (command === 'docs') {
    if (rest.some((a) => a !== '--types')) throw new Error('Usage: gluejs-ios docs [--types]');
    return process.stdout.write(readFileSync(packageFile(rest.includes('--types') ? TYPES_FILE : 'reference.md'), 'utf8'));
  }
  if (command === 'examples') {
    const { examples } = await import('./new-script.mjs');
    const list = examples();
    const width = Math.max(...list.map((e) => e.name.length));
    for (const e of list) console.log(`${e.name.padEnd(width)}  ${e.title}`);
    return console.log('\nCopy one with: gluejs-ios new <folder> --from <example>');
  }
  if (!COMMANDS[command]) throw new Error(`Unknown command "${command}". Run gluejs-ios --help.`);
  const module = await import(COMMANDS[command]);
  await module.main(rest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(showStack ? error.stack : error.message);
    process.exit(1);
  });
}
