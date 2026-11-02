#!/usr/bin/env node
// Builds the ready-to-install sample shortcuts in docs/samples/, signed for the App Store GlueJS,
// so people (and App Review) can try GlueJS on an iPhone without a Mac.
//
//   npm run build-samples      (macOS, signed into iCloud)

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const SAMPLES = ['hello', 'habit-streak', 'caffeine-cutoff', 'recipe-scaler'];

const out = join(root, 'docs', 'samples');
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'gluejs-samples-'));
try {
  for (const example of SAMPLES) {
    const folder = join(root, 'examples', example);
    const json = JSON.parse(readFileSync(join(folder, 'shortcut.json'), 'utf8'));
    const name = (Array.isArray(json) ? json[0] : json).name;
    execFileSync(process.execPath, [join(root, 'cli.mjs'), 'build', folder, '--out', join(temp, example), '--no-push'], { stdio: 'inherit' });
    copyFileSync(join(temp, example, `${name}.shortcut`), join(out, `${name}.shortcut`));
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
  for (const example of SAMPLES) rmSync(join(root, 'examples', example, '.glue-local'), { recursive: true, force: true });
}
console.log(`Signed ${SAMPLES.length} samples into docs/samples/`);
