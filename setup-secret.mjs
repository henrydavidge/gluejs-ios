#!/usr/bin/env node
// Builds a one-time setup shortcut that saves an API key in GlueJS on the phone.
//
//   GITHUB_TOKEN=... gluejs-ios secret GITHUB_TOKEN --hosts api.github.com [--from-env VAR] [--raw]
//   gluejs-ios secret HA_TOKEN --hosts http://homeassistant.local --ask
//
// The value is read from an environment variable (default: the secret's own name) at build time,
// or with --ask the shortcut asks for it when run. Output: dist/Set Up <NAME>.shortcut, signed.
// Running it shows a confirmation listing the hosts; after that the user can delete it.
// Unless --ask is used, the signed file contains the key: don't commit or share it.

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildShortcut, parseArgs as parseBuildArgs, sign, toPlist } from './build-shortcut.mjs';

export const USAGE = `Usage: gluejs-ios secret NAME --hosts HOST[,HOST] [options]

Builds "Set Up NAME.shortcut", which saves a secret in GlueJS on the iPhone after the user
confirms. Scripts read it with Secrets.get('NAME'); fetch only sends it to HOST.

Options:
  --hosts LIST         Hosts the secret may be sent to (https unless written http://host)
  --ask                The shortcut asks for the value when run (nothing secret in the file)
  --from-env VAR       Read the value from VAR (default: the environment variable NAME)
  --raw                Let scripts read the raw value with Secrets.reveal
  --out DIR            Output folder (default: ./dist)
  --no-sign            Write the unsigned file only
  --team-id, --bundle-id, --app-name, --simulator   As for gluejs-ios build
  -h, --help           Show this help`;

export function setupDefinition({ name, hosts, fromEnv, ask, raw }) {
  const actions = [];
  const save = { type: 'saveSecret', name, hosts, allowRawAccess: raw };
  if (ask) {
    actions.push({ id: 'value', type: 'ask', prompt: `Paste the value for ${name}`, inputType: 'Text' });
    save.value = '${value}';
  } else {
    save.valueFromEnv = fromEnv ?? name;
  }
  actions.push(save);
  return { name: `Set Up ${name}`, color: 'gray', actions };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) return console.log(USAGE);
  const name = argv[0];
  if (!name || name.startsWith('-')) throw new Error('Expected a secret name first. See gluejs-ios secret --help.');
  const opts = { name, raw: false, ask: false };
  const passthrough = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hosts' || arg === '--from-env') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw new Error(`Missing value for ${arg}`);
      opts[arg === '--hosts' ? 'hosts' : 'fromEnv'] = argv[++i];
    }
    else if (arg === '--ask') opts.ask = true;
    else if (arg === '--raw') opts.raw = true;
    else if (['--no-push', '--no-typecheck', '--minify', '--scripts-dir'].includes(arg) || !arg.startsWith('-')) {
      throw new Error(`gluejs-ios secret doesn't take ${arg}. See gluejs-ios secret --help.`);
    }
    else passthrough.push(arg);
  }
  if (!opts.hosts) throw new Error('--hosts is required, e.g. --hosts api.github.com');
  if (opts.ask && opts.fromEnv) throw new Error('Use either --ask or --from-env, not both.');
  const args = parseBuildArgs([...passthrough, '.']);
  const definition = setupDefinition(opts);
  const plist = toPlist(buildShortcut(definition, args));
  const outDir = resolve(args.out);
  if (!args.sign) {
    mkdirSync(join(outDir, 'unsigned'), { recursive: true });
    const unsigned = join(outDir, 'unsigned', `${definition.name}.shortcut`);
    writeFileSync(unsigned, plist, { mode: 0o600 });
    chmodSync(unsigned, 0o600);
    return console.log(`Wrote ${unsigned}${opts.ask ? '' : '. It contains the key: delete it after signing.'}`);
  }
  // The unsigned copy holds the key in plain text, so it lives only in a private temporary folder.
  const temp = mkdtempSync(join(tmpdir(), 'gluejs-secret-'));
  try {
    const unsigned = join(temp, `${definition.name}.shortcut`);
    writeFileSync(unsigned, plist, { mode: 0o600 });
    mkdirSync(outDir, { recursive: true });
    const signed = join(outDir, `${definition.name}.shortcut`);
    sign(unsigned, signed);
    chmodSync(signed, 0o600);
    console.log(opts.ask
      ? `Signed ${signed}. Open it on the iPhone and run it once; it asks for the value.`
      : `Signed ${signed}. It contains the key: open it on the iPhone, run it once, then delete it here and there.`);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
