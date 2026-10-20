#!/usr/bin/env node
// Updates the script files of a shortcut that uses "mode": "file", without rebuilding or
// reinstalling the shortcut: bundles/type-checks the script(s) and writes them to
// iCloud Drive › GlueJS › Scripts, which syncs to the iPhone.
//
//   gluejs-ios push <folder> [--scripts-dir DIR] [--no-typecheck] [--minify]

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadScripts, parseArgs, pushScripts, readDefinitions } from './build-shortcut.mjs';

export const USAGE = `Usage: gluejs-ios push <folder> [options]

Bundles the scripts of the folder's "mode": "file" actions and writes them to
iCloud Drive › GlueJS › Scripts. Installed shortcuts use the new version on their next run.

Options:
  --scripts-dir DIR    Write here instead of iCloud Drive (e.g. the Simulator's Scripts folder)
  --no-typecheck       Skip TypeScript type-checking
  --minify             Minify bundled scripts
  -h, --help           Show this help`;

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) return console.log(USAGE);
  const definitions = readDefinitions(args.folder);
  const fileActions = definitions.flatMap((d) => d.actions).filter((a) => a.type === 'runScript' && a.mode === 'file');
  if (!fileActions.length) throw new Error('This shortcut has no runScript action with "mode": "file", so its script is inside the shortcut. Rebuild it with `gluejs-ios build` and reinstall instead.');
  await loadScripts([{ actions: fileActions }], args.folder, args);
  for (const path of pushScripts(definitions, args.folder, args.scriptsDir)) console.log(`Pushed ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
