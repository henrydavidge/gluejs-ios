// Turns a GlueJS script into the single self-contained source the app runs.
//
// Plain scripts (no import/export) are used as-is: the app runs them as the body of
// `async function (input) { ... }`, so they can `await` and `return` at top level.
//
// Module scripts can import npm packages installed next to them (`npm install date-fns`) and
// must `export default async function main(input) { ... }`. They're bundled with esbuild for
// JavaScriptCore: browser builds of packages, web APIs (fetch, URL, crypto.subtle, ...) and
// no Node built-ins. Everything is resolved here on the Mac; the phone never downloads code.
//
// TypeScript (.ts/.mts) scripts are always modules. After bundling they're type-checked with
// this package's TypeScript against gluejs.d.ts (see typecheck()).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** A file shipped with the package: `examples`, or gluejs.d.ts and reference.md from docs/. */
export function packageFile(name) {
  const path = join(TOOLS, name === 'examples' ? 'examples' : join('docs', name));
  if (existsSync(path)) return path;
  throw new Error(`${name} is missing from this copy of gluejs-ios. Reinstall it.`);
}

export const TYPES_FILE = 'gluejs.d.ts';

// Bundles larger than this are slow to open in the Shortcuts editor.
const LARGE_SCRIPT = 200 * 1024;

export function isTypeScript(path) {
  return ['.ts', '.mts'].includes(extname(path));
}

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events',
  'fs', 'http', 'http2', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring',
  'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

export function isModuleScript(source) {
  // Parse as a function body without executing it. A line-based regex misidentifies
  // imports in comments/templates and misses exports after another statement.
  const AsyncFunction = (async () => {}).constructor;
  try { new AsyncFunction(source); return false; }
  catch { return true; } // esbuild reports module syntax errors with source locations.
}

/** Returns the source to embed in a shortcut for the script at `path`. */
export async function loadScript(path, { typecheck: check = true, minify = false } = {}) {
  let source;
  try { source = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Script ${path} doesn't exist. Check "script" in shortcut.json.`);
    throw error;
  }
  if (!isTypeScript(path) && !isModuleScript(source)) return source;
  // Bundle before type-checking: esbuild's messages about missing packages and Node built-ins
  // are clearer than the type errors the same problems cause.
  const code = await bundle(path, { minify });
  if (isTypeScript(path) && check) typecheck(path);
  if (code.length > LARGE_SCRIPT) {
    console.warn(`${basename(path)} bundles to ${Math.round(code.length / 1024)} KB, which makes the shortcut slow to open.` +
      (minify ? '' : ' Build with --minify, or') + ' use "mode": "file" so the code stays out of the shortcut.');
  }
  return code;
}

/**
 * Type-checks a TypeScript script with this package's TypeScript. Uses the tsconfig.json next
 * to the script if there is one (`gluejs-ios new` writes one), otherwise strict defaults plus
 * the packaged gluejs.d.ts. Throws with tsc's diagnostics on errors.
 */
export function typecheck(path) {
  let tsc;
  try {
    const manifest = require.resolve('typescript/package.json');
    tsc = join(dirname(manifest), JSON.parse(readFileSync(manifest, 'utf8')).bin.tsc);
  } catch {
    throw new Error('TypeScript scripts need the TypeScript compiler, which is missing. Reinstall gluejs-ios, or build with --no-typecheck.');
  }
  const folder = dirname(resolve(path));
  let project = join(folder, 'tsconfig.json');
  let temp;
  if (!existsSync(project)) {
    const types = packageFile(TYPES_FILE);
    temp = mkdtempSync(join(tmpdir(), 'gluejs-tsc-'));
    project = join(temp, 'tsconfig.json');
    writeFileSync(project, JSON.stringify({ ...tsconfig(types), files: [resolve(path), types] }));
  }
  try {
    execFileSync(process.execPath, [tsc, '--noEmit', '-p', project], { stdio: 'pipe' });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    throw new Error(`Type errors in ${basename(path)}:\n${output || error.message}\n(Build with --no-typecheck to skip.)`);
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

/** The compiler options GlueJS scripts are checked with. `types` is the path to gluejs.d.ts. */
export function tsconfig(types) {
  return {
    compilerOptions: {
      target: 'ES2023',
      module: 'ESNext',
      moduleResolution: 'bundler',
      // DOM supplies fetch, URL, TextEncoder, crypto etc. GlueJS implements only the subset
      // listed in docs/reference.md (no document, window, XMLHttpRequest, Blob, FormData).
      lib: ['ES2023', 'DOM'],
      types: [],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
    },
    files: [types],
  };
}

export async function bundle(entry, { minify = false } = {}) {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    throw new Error('Bundling needs esbuild, which is missing. Reinstall gluejs-ios.');
  }

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [resolve(entry)],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: '__glueMain',
      platform: 'browser',
      // Paths in the bundle's comments are relative to the script, not to this Mac's folders.
      absWorkingDir: dirname(resolve(entry)),
      // The JavaScriptCore in iOS 18 matches Safari 18.
      target: 'safari18',
      conditions: ['worker', 'browser'],
      mainFields: ['browser', 'module', 'main'],
      define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
      // Readable by default: users can see and edit exactly what runs on their phone.
      minify,
      legalComments: 'inline',
      charset: 'utf8',
      logLevel: 'silent',
    });
  } catch (error) {
    throw new Error(describeBuildErrors(error, entry));
  }

  const code = result.outputFiles[0].text;
  // The app titles runs with the script's first comment line, so keep the original's title first.
  const title = /^\s*\/\/[ \t]*(\S.*)$/m.exec(readFileSync(entry, 'utf8').split(/\n\s*\n/)[0])?.[1];
  return [
    ...(title ? [`// ${title}`] : []),
    `// Bundled by GlueJS from ${basename(entry)} and its npm packages. Edit the original, not this copy.`,
    code.trimEnd(),
    `if (typeof __glueMain.default !== 'function') {`,
    `  throw new Error('Scripts with imports must export a default function: export default async function main(input) { ... }');`,
    `}`,
    `return await __glueMain.default(input);`,
    '',
  ].join('\n');
}

function describeBuildErrors(error, entry) {
  const messages = (error.errors ?? []).map((e) => {
    const where = e.location ? `${e.location.file}:${e.location.line}` : basename(entry);
    const missing = /Could not resolve "([^"]+)"/.exec(e.text)?.[1];
    const builtin = missing?.replace(/^node:/, '').split('/')[0];
    if (missing && (NODE_BUILTINS.has(builtin) || missing.startsWith('node:'))) {
      return `${where}: needs Node's built-in "${missing}" module, which isn't available on iOS. ` +
        `GlueJS scripts have web APIs (fetch, URL, TextEncoder, crypto.subtle) but not Node's. ` +
        `Look for a browser or edge-runtime version of the package.`;
    }
    if (missing) return `${where}: can't find "${missing}". Run \`npm install ${missing}\` next to the script.`;
    return `${where}: ${e.text}`;
  });
  return messages.length ? messages.join('\n') : String(error.message ?? error);
}
