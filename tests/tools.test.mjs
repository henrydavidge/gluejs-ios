import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { isModuleScript, loadScript } from '../bundle.mjs';
import { buildShortcut, parseArgs, readDefinitions, toPlist } from '../build-shortcut.mjs';
import { Store, Widget } from '../run-local.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = { folder: root, bundleId: 'com.example.GlueJS', teamId: 'TEAM', appName: 'GlueJS' };

test('module detection handles comments, templates and same-line exports', () => {
  assert.equal(isModuleScript('/*\nimport example\n*/\nreturn 42'), false);
  assert.equal(isModuleScript('return `\nexport default is text\n`'), false);
  assert.equal(isModuleScript('const x = 42; export default () => x'), true);
  assert.equal(isModuleScript('return await sleep(1)'), false);
});

test('detected modules bundle and execute', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue-module-'));
  try {
    const path = join(folder, 'script.js');
    writeFileSync(path, 'const x = 42; export default (input) => x + input;');
    const source = await loadScript(path);
    assert.equal(await new ((async () => {}).constructor)('input', source)(3), 45);
  } finally { rmSync(folder, { recursive: true }); }
});

test('CLI requires option values', () => {
  for (const flag of ['--out', '--bundle-id', '--team-id', '--app-name']) {
    assert.throws(() => parseArgs(['examples/sleep', flag]), /Missing value/);
    assert.throws(() => parseArgs(['examples/sleep', flag, '--no-sign']), /Missing value/);
  }
});

test('shortcut names cannot escape the output directory', () => {
  for (const name of ['../escaped', 'folder/name', 'folder\\name', '', 'a\n']) {
    assert.throws(() => buildShortcut({ name, actions: [] }, options), /Shortcut name/);
  }
});

test('shortcut tokens use UTF-16 offsets and leave JavaScript templates intact', () => {
  const code = 'return `${input}`;';
  const model = buildShortcut({ name: 'Test', actions: [
    { type: 'runScript', id: 'result', code, input: '${shortcutInput}' },
    { type: 'showResult', text: '👋 ${result}' },
  ] }, options);
  assert.equal(model.WFWorkflowActions[0].WFWorkflowActionParameters.script, code);
  assert.equal(model.WFWorkflowHasShortcutInputVariables, true);
  const token = model.WFWorkflowActions[1].WFWorkflowActionParameters.Text.Value;
  assert.ok(token.attachmentsByRange['{3, 1}']);
  assert.doesNotThrow(() => toPlist(model));
});

test('invalid output references produce useful errors', () => {
  assert.throws(() => buildShortcut({ name: 'Test', actions: [
    { type: 'comment', id: 'note', text: 'hello' }, { type: 'showResult', text: '${note}' },
  ] }, options), /does not produce an output/);
  assert.throws(() => buildShortcut({ name: 'Test', actions: [
    { type: 'text', id: 'shortcutInput', text: 'hello' },
  ] }, options), /reserved action id/);
});

test('CLI works from a path with spaces and creates a valid unsigned plist', () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue tools '));
  try {
    cpSync(join(root, 'build-shortcut.mjs'), join(folder, 'build-shortcut.mjs'));
    cpSync(join(root, 'bundle.mjs'), join(folder, 'bundle.mjs'));
    const out = join(folder, 'output');
    execFileSync(process.execPath, [join(folder, 'build-shortcut.mjs'), join(root, 'examples/sleep'), '--out', out, '--no-sign']);
    const file = join(out, 'unsigned', "Last Night's Sleep.shortcut");
    assert.match(readFileSync(file, 'utf8'), /RunJavaScriptIntent/);
    if (process.platform === 'darwin') execFileSync('plutil', ['-lint', file]);
  } finally { rmSync(folder, { recursive: true }); }
});

test('local Store and Widget mocks persist under .glue-local', () => {
  const previous = process.cwd();
  const folder = mkdtempSync(join(tmpdir(), 'glue-local-'));
  process.chdir(folder);
  try {
    Store.set('k', { a: 1 });
    assert.deepEqual(Store.get('k'), { a: 1 });
    assert.deepEqual(Store.keys(), ['k']);
    Store.delete('k');
    assert.equal(Store.get('k'), undefined);
    assert.throws(() => Store.set('k'), /needs a value/);
    Widget.set('w', { value: 1 }, { refresh: 30 });
    assert.deepEqual(Widget.names(), ['w']);
    assert.equal(JSON.parse(readFileSync(join(folder, '.glue-local', 'widgets.json'), 'utf8')).w.refresh, 30);
  } finally {
    process.chdir(previous);
    rmSync(folder, { recursive: true });
  }
});

test('all shipped example scripts load and compile', async () => {
  for (const example of readdirSync(resolve(root, 'examples')).filter((e) => existsSync(resolve(root, 'examples', e, 'shortcut.json')))) {
    const definitions = readDefinitions(resolve(root, 'examples', example));
    for (const action of definitions.flatMap((d) => d.actions).filter((a) => a.type === 'runScript' && a.script)) {
      const source = await loadScript(resolve(root, 'examples', example, action.script));
      assert.doesNotThrow(() => new ((async () => {}).constructor)('input', source), example);
    }
  }
});

test('saveSecret builds a GlueJS Save Secret action from an environment variable or an ask step', async () => {
  const { setupDefinition } = await import('../setup-secret.mjs');
  const args = { folder: '.', bundleId: 'com.sireniallc.GlueJS', teamId: 'T', appName: 'GlueJS' };
  process.env.GLUE_TEST_TOKEN = 'ghp_example';
  try {
    const fromEnv = buildShortcut(setupDefinition({ name: 'GITHUB_TOKEN', hosts: 'api.github.com', fromEnv: 'GLUE_TEST_TOKEN', raw: false }), args);
    const action = fromEnv.WFWorkflowActions[0];
    assert.equal(action.WFWorkflowActionIdentifier, 'com.sireniallc.GlueJS.SaveSecretIntent');
    assert.equal(action.WFWorkflowActionParameters.AppIntentDescriptor.AppIntentIdentifier, 'SaveSecretIntent');
    assert.equal(action.WFWorkflowActionParameters.name, 'GITHUB_TOKEN');
    assert.equal(action.WFWorkflowActionParameters.value, 'ghp_example');
    assert.equal(action.WFWorkflowActionParameters.hosts, 'api.github.com');
    assert.equal(action.WFWorkflowActionParameters.allowRawAccess, false);
  } finally {
    delete process.env.GLUE_TEST_TOKEN;
  }

  const asked = buildShortcut(setupDefinition({ name: 'HA_TOKEN', hosts: 'http://homeassistant.local', ask: true, raw: true }), args);
  assert.equal(asked.WFWorkflowActions[0].WFWorkflowActionIdentifier, 'is.workflow.actions.ask');
  const value = asked.WFWorkflowActions[1].WFWorkflowActionParameters.value;
  assert.equal(value.WFSerializationType, 'WFTextTokenString');
  assert.equal(asked.WFWorkflowActions[1].WFWorkflowActionParameters.allowRawAccess, true);

  assert.throws(() => buildShortcut(setupDefinition({ name: 'MISSING', hosts: 'a.com', fromEnv: 'GLUE_TEST_UNSET_VAR' }), args), /not set/);
  assert.throws(() => buildShortcut(setupDefinition({ name: '1bad', hosts: 'a.com', ask: true }), args), /must start with a letter/);
});

test('file mode emits Run Script File and pushes the bundled script', async () => {
  const { pushScripts, scriptFileName } = await import('../build-shortcut.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'glue-file-'));
  const scripts = join(folder, 'Scripts');
  try {
    const definition = { name: 'Weather', actions: [{ id: 'r', type: 'runScript', mode: 'file', script: 'script.js', code: 'return 1', input: '${shortcutInput}' }] };
    const plist = buildShortcut(definition, { folder: join(folder, 'weather'), bundleId: 'com.sireniallc.GlueJS', teamId: 'T', appName: 'GlueJS' });
    const action = plist.WFWorkflowActions[0];
    assert.equal(action.WFWorkflowActionIdentifier, 'com.sireniallc.GlueJS.RunScriptFileIntent');
    assert.equal(action.WFWorkflowActionParameters.file, 'weather.js');
    assert.equal(action.WFWorkflowActionParameters.script, undefined);
    assert.throws(() => pushScripts(definition, join(folder, 'weather'), join(folder, 'missing', 'Scripts')), /doesn't exist/);
    mkdirSync(scripts);
    const [written] = pushScripts(definition, join(folder, 'weather'), scripts);
    assert.equal(readFileSync(written, 'utf8'), 'return 1');
    assert.equal(scriptFileName({ file: 'other' }, folder), 'other.js');
    assert.throws(() => scriptFileName({ file: '../evil' }, folder), /Invalid script file name/);
    assert.throws(() => buildShortcut({ name: 'X', actions: [{ type: 'runScript', mode: 'cloud', code: '' }] }, { folder }), /mode must be/);
  } finally { rmSync(folder, { recursive: true }); }
});

test('file pushes reject colliding scripts before replacing any existing file', async () => {
  const { pushScripts } = await import('../build-shortcut.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'glue-collision-'));
  try {
    const action = (code, file = 'shared.js') => ({ type: 'runScript', mode: 'file', code, file });
    const definitions = [{ actions: [action('return 1')] }, { actions: [action('return 2')] }];
    writeFileSync(join(folder, 'shared.js'), 'original');
    assert.throws(() => pushScripts(definitions, folder, folder), /Conflicting scripts/);
    assert.equal(readFileSync(join(folder, 'shared.js'), 'utf8'), 'original');
    assert.throws(() => pushScripts({ actions: [action('one'), action('two', 'SHARED.js')] }, folder, folder), /Conflicting scripts/);
    assert.throws(() => pushScripts({ actions: [action('valid'), action(undefined, 'missing.js')] }, folder, folder), /No bundled code/);
    assert.equal(readFileSync(join(folder, 'shared.js'), 'utf8'), 'original');
    assert.deepEqual(pushScripts([{ actions: [action('same')] }, { actions: [action('same')] }], folder, folder), [join(folder, 'shared.js')]);
    assert.equal(readFileSync(join(folder, 'shared.js'), 'utf8'), 'same');
    assert.deepEqual(readdirSync(folder), ['shared.js'], 'no temporary files left behind');
  } finally { rmSync(folder, { recursive: true }); }
});

test('push CLI supports inline code and build CLI detects cross-shortcut file collisions', () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue-push-cli-'));
  try {
    const definition = { name: 'A', actions: [{ type: 'runScript', mode: 'file', file: 'shared.js', code: 'return 1' }] };
    writeFileSync(join(folder, 'shortcut.json'), JSON.stringify(definition));
    execFileSync(process.execPath, [join(root, 'push-script.mjs'), folder, '--scripts-dir', folder]);
    assert.equal(readFileSync(join(folder, 'shared.js'), 'utf8'), 'return 1');
    const conflict = { name: 'B', actions: [{ ...definition.actions[0], code: 'return 2' }] };
    writeFileSync(join(folder, 'shortcut.json'), JSON.stringify([definition, conflict]));
    for (const tool of ['push-script.mjs', 'build-shortcut.mjs']) {
      assert.throws(() => execFileSync(process.execPath, [join(root, tool), folder, '--scripts-dir', folder, '--out', join(folder, 'dist'), '--no-sign'], { stdio: 'pipe' }), /Conflicting scripts/);
      assert.equal(readFileSync(join(folder, 'shared.js'), 'utf8'), 'return 1');
    }
  } finally { rmSync(folder, { recursive: true }); }
});

test('local Store supports prototype-like keys and preserves corrupt data', () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue-local-store-'));
  const original = process.cwd();
  try {
    process.chdir(folder);
    assert.equal(Store.get('constructor'), undefined);
    for (const key of ['__proto__', 'constructor', 'toString']) {
      Store.set(key, { count: 1 });
      assert.deepEqual(Store.get(key), { count: 1 });
    }
    assert.throws(() => Store.set('fn', () => 1), /JSON-serializable/);
    for (const damaged of ['damaged', 'null', '[]', '42']) {
      writeFileSync(join(folder, '.glue-local/store.json'), damaged);
      assert.throws(() => Store.set('new', 1));
      assert.equal(readFileSync(join(folder, '.glue-local/store.json'), 'utf8'), damaged);
    }
  } finally { process.chdir(original); rmSync(folder, { recursive: true }); }
});

test('builder rejects output path traversal and duplicate shortcut names before writing', () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue-output-names-'));
  try {
    for (const definitions of [
      { name: '../escaped', actions: [] },
      [{ name: 'Same', actions: [] }, { name: 'same', actions: [] }],
    ]) {
      writeFileSync(join(folder, 'shortcut.json'), JSON.stringify(definitions));
      assert.throws(() => execFileSync(process.execPath, [join(root, 'build-shortcut.mjs'), folder, '--no-sign', '--out', join(folder, 'dist')], { stdio: 'pipe' }), /path separators|Duplicate shortcut name/);
      assert.equal(existsSync(join(folder, 'dist')), false);
      assert.equal(existsSync(join(folder, 'escaped.shortcut')), false);
    }
  } finally { rmSync(folder, { recursive: true }); }
});

test('new-script scaffolds a type-checked TypeScript folder that builds', async () => {
  const { scaffold } = await import('../new-script.mjs');
  const parent = mkdtempSync(join(tmpdir(), 'glue-new-'));
  try {
    const dir = scaffold(join(parent, 'hello-there'), { file: true });
    const definition = JSON.parse(readFileSync(join(dir, 'shortcut.json'), 'utf8'));
    assert.equal(definition.name, 'Hello There');
    assert.equal(definition.actions[0].mode, 'file');
    const source = await loadScript(join(dir, 'script.ts'));
    const run = new ((async () => {}).constructor)('input', source);
    assert.equal(await run('GlueJS'), 'Hello, GlueJS!');
    writeFileSync(join(dir, 'script.ts'), 'export default async function main(): Promise<number> { return "nope"; }\n');
    await assert.rejects(() => loadScript(join(dir, 'script.ts')), /Type errors in script.ts[\s\S]*TS2322/);
    assert.ok(await loadScript(join(dir, 'script.ts'), { typecheck: false }));
  } finally { rmSync(parent, { recursive: true }); }
});

test('input settings put a shortcut in the share sheet and Quick Actions', () => {
  const actions = [{ type: 'runScript', id: 'r', code: 'return input', input: '${shortcutInput}' }];
  const plain = buildShortcut({ name: 'Test', actions }, options);
  assert.deepEqual(plain.WFWorkflowTypes, []);
  assert.deepEqual(plain.WFWorkflowInputContentItemClasses, ['WFStringContentItem']);
  assert.equal(plain.WFWorkflowNoInputBehavior, undefined);

  const shared = buildShortcut({ name: 'Test', actions,
    input: { shareSheet: true, quickAction: true, accepts: ['text', 'url', 'webPage'], ifEmpty: 'clipboard' } }, options);
  assert.deepEqual(shared.WFWorkflowTypes, ['ActionExtension', 'QuickActions']);
  assert.deepEqual(shared.WFQuickActionSurfaces, ['Services']);
  assert.deepEqual(shared.WFWorkflowInputContentItemClasses, ['WFStringContentItem', 'WFURLContentItem', 'WFSafariWebPageContentItem']);
  assert.equal(shared.WFWorkflowNoInputBehavior.Name, 'WFWorkflowNoInputBehaviorGetClipboard');
  assert.doesNotThrow(() => toPlist(shared));

  assert.throws(() => buildShortcut({ name: 'Test', actions, input: { accepts: ['image'] } }, options), /input.accepts/);
  assert.throws(() => buildShortcut({ name: 'Test', actions, input: { ifEmpty: 'nothing' } }, options), /input.ifEmpty/);
  assert.throws(() => buildShortcut({ name: 'Test', actions, input: { sharesheet: true } }, options), /Unknown "input" option/);
  assert.throws(() => buildShortcut({ name: 'Test', input: { shareSheet: true },
    actions: [{ type: 'runScript', code: 'return 1', input: '' }] }, options), /no action uses \$\{shortcutInput\}/);
});

test('calendar actions build Get Upcoming Events and Get Details of Calendar Events', () => {
  const model = buildShortcut({ name: 'Test', actions: [
    { id: 'events', type: 'upcomingEvents', count: 5 },
    { id: 'title', type: 'eventDetail', property: 'Title', from: '${events}' },
    { type: 'runScript', code: 'return input', input: '${title}' },
  ] }, options);
  const [events, title] = model.WFWorkflowActions;
  assert.equal(events.WFWorkflowActionIdentifier, 'is.workflow.actions.getupcomingevents');
  assert.equal(events.WFWorkflowActionParameters.WFGetUpcomingItemCount, 5);
  assert.equal(title.WFWorkflowActionIdentifier, 'is.workflow.actions.properties.calendarevents');
  assert.equal(title.WFWorkflowActionParameters.WFContentItemPropertyName, 'Title');
  assert.throws(() => buildShortcut({ name: 'Test', actions: [
    { id: 'events', type: 'upcomingEvents' }, { type: 'eventDetail', property: 'Attendees', from: '${events}' },
  ] }, options), /eventDetail property/);
});

test('useModel builds Apple\'s Use Model action with verified model names', () => {
  const model = buildShortcut({ name: 'Test', actions: [
    { id: 'facts', type: 'text', text: 'hi' },
    { id: 'reply', type: 'useModel', model: 'onDevice', prompt: 'Summarize: ${facts}' },
    { type: 'showResult', text: '${reply}' },
  ] }, options);
  const action = model.WFWorkflowActions[1];
  assert.equal(action.WFWorkflowActionIdentifier, 'is.workflow.actions.askllm');
  assert.equal(action.WFWorkflowActionParameters.WFLLMModel, 'Apple Intelligence on Device');
  assert.equal(action.WFWorkflowActionParameters.WFLLMPrompt.WFSerializationType, 'WFTextTokenString');
  for (const [key, name] of [['cloud', 'Apple Intelligence'], ['cloudPro', 'Apple Intelligence Pro'], ['chatGPT', 'ChatGPT']]) {
    const m = buildShortcut({ name: 'Test', actions: [{ type: 'useModel', model: key, prompt: 'x' }] }, options);
    assert.equal(m.WFWorkflowActions[0].WFWorkflowActionParameters.WFLLMModel, name);
  }
  assert.throws(() => buildShortcut({ name: 'Test', actions: [{ type: 'useModel', model: 'gpt5', prompt: 'x' }] }, options), /useModel model/);
});

test('"when" wraps an action in If <value> is not empty … End If', () => {
  const model = buildShortcut({ name: 'Test', actions: [
    { id: 'alert', type: 'runScript', code: 'return ""', input: '' },
    { type: 'notification', title: 'T', body: '${alert}', when: '${alert}' },
  ] }, options);
  const [, open, inner, close] = model.WFWorkflowActions;
  assert.equal(open.WFWorkflowActionIdentifier, 'is.workflow.actions.conditional');
  assert.equal(open.WFWorkflowActionParameters.WFControlFlowMode, 0);
  assert.equal(open.WFWorkflowActionParameters.WFCondition, 5);
  assert.equal(open.WFWorkflowActionParameters.WFConditionalActionString, '');
  assert.equal(inner.WFWorkflowActionIdentifier, 'is.workflow.actions.notification');
  assert.equal(close.WFWorkflowActionParameters.WFControlFlowMode, 2);
  assert.equal(close.WFWorkflowActionParameters.GroupingIdentifier, open.WFWorkflowActionParameters.GroupingIdentifier);
});

test('shortcut.json may hold several shortcuts that share a folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-multi-'));
  writeFileSync(join(dir, 'shortcut.json'), JSON.stringify([{ name: 'A', actions: [] }, { name: 'B', actions: [] }]));
  assert.deepEqual(readDefinitions(dir).map((d) => d.name), ['A', 'B']);
  rmSync(dir, { recursive: true });
});

test('logHealthSample builds Apple\'s Log Health Sample action', () => {
  const model = buildShortcut({ name: 'Test', actions: [{ type: 'logHealthSample', healthType: 'Headache', value: 1 }] }, options);
  const action = model.WFWorkflowActions[0];
  assert.equal(action.WFWorkflowActionIdentifier, 'is.workflow.actions.health.quantity.log');
  assert.equal(action.WFWorkflowActionParameters.WFQuantitySampleType, 'Headache');
  assert.equal(action.WFWorkflowActionParameters.WFQuantitySampleQuantity.Value.Magnitude, '1');
  assert.throws(() => buildShortcut({ name: 'Test', actions: [{ type: 'logHealthSample' }] }, options), /healthType/);
});

test('weather actions build Apple Weather forecast and detail actions', () => {
  const model = buildShortcut({ name: 'Test', actions: [
    { id: 'f', type: 'weatherForecast', forecast: 'daily' },
    { id: 'hi', type: 'weatherDetail', property: 'High', from: '${f}' },
    { type: 'runScript', code: 'return input', input: '${hi}' },
  ] }, options);
  const [forecast, detail] = model.WFWorkflowActions;
  assert.equal(forecast.WFWorkflowActionIdentifier, 'is.workflow.actions.weather.forecast');
  assert.equal(forecast.WFWorkflowActionParameters.WFWeatherForecastType, 'Daily');
  assert.equal(detail.WFWorkflowActionIdentifier, 'is.workflow.actions.properties.weather.conditions');
  assert.equal(detail.WFWorkflowActionParameters.WFContentItemPropertyName, 'High');
  assert.throws(() => buildShortcut({ name: 'Test', actions: [{ type: 'weatherForecast', forecast: 'weekly' }] }, options), /hourly/);
  assert.throws(() => buildShortcut({ name: 'Test', actions: [
    { id: 'f', type: 'weatherForecast' }, { type: 'weatherDetail', property: 'Cloud Cover', from: '${f}' },
  ] }, options), /weatherDetail property/);
});

test('every example shortcut passes field validation', async () => {
  for (const example of readdirSync(resolve(root, 'examples')).filter((e) => existsSync(resolve(root, 'examples', e, 'shortcut.json')))) {
    for (const definition of readDefinitions(resolve(root, 'examples', example))) {
      const actions = definition.actions.map((a) => (a.type === 'runScript' ? { ...a, code: 'return 1' } : a));
      assert.doesNotThrow(() => buildShortcut({ ...definition, actions }, { ...options, folder: resolve(root, 'examples', example) }), example);
    }
  }
});

test('misspelled or missing fields fail with the shortcut and action named', () => {
  assert.throws(() => buildShortcut({ name: 'T', actions: [{ type: 'text', id: 'greeting', txt: 'hi' }] }, options),
    /"T", action 1 \(text "greeting"\): unknown field "txt"\. text takes text/);
  assert.throws(() => buildShortcut({ name: 'T', actions: [{ type: 'comment', text: 'x' }, { type: 'showResult' }] }, options),
    /action 2 \(showResult\): needs "text"/);
  assert.throws(() => buildShortcut({ name: 'T', actions: [{ type: 'showresult', text: 'x' }] }, options), /unknown type "showresult"/);
  assert.throws(() => buildShortcut({ name: 'T', colour: 'red', actions: [] }, options), /unknown field "colour"/);
  assert.throws(() => buildShortcut({ name: 'T', color: 'mauve', actions: [] }, options), /unknown color "mauve"/);
});

test('missing files and bad JSON get plain explanations', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue-missing-'));
  try {
    assert.throws(() => readDefinitions(folder), /No shortcut.json in .*gluejs-ios new/);
    writeFileSync(join(folder, 'shortcut.json'), '{ "name": "T", ');
    assert.throws(() => readDefinitions(folder), /isn't valid JSON/);
    await assert.rejects(() => loadScript(join(folder, 'script.ts')), /script.ts doesn't exist/);
  } finally { rmSync(folder, { recursive: true }); }
});

test('bundles say which Node built-in is missing before type-checking', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue-builtin-'));
  try {
    writeFileSync(join(folder, 'script.ts'), "import { readFileSync } from 'node:fs';\nexport default async function main() { return readFileSync('x', 'utf8'); }\n");
    await assert.rejects(() => loadScript(join(folder, 'script.ts')), /built-in "node:fs" module, which isn't available on iOS/);
  } finally { rmSync(folder, { recursive: true }); }
});

test('bundles carry no absolute paths from this Mac', async () => {
  const source = await loadScript(resolve(root, 'examples/recipe-scaler/script.ts'));
  assert.doesNotMatch(source, /\/Users\/|\/private\/|\/tmp\//);
});

test('new --from copies an example with its own gluejs.d.ts', async () => {
  const { scaffold, examples } = await import('../new-script.mjs');
  assert.ok(examples().some((e) => e.name === 'recipe-scaler' && /Scale Recipe/.test(e.title)));
  const parent = mkdtempSync(join(tmpdir(), 'glue-from-'));
  try {
    const dir = scaffold(join(parent, 'mine'), { from: 'recipe-scaler' });
    assert.ok(existsSync(join(dir, 'gluejs.d.ts')));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).files, ['script.ts', 'gluejs.d.ts']);
    assert.ok(await loadScript(join(dir, 'script.ts')));
    assert.throws(() => scaffold(join(parent, 'other'), { from: 'nope' }), /No example named "nope"/);
  } finally { rmSync(parent, { recursive: true }); }
});

test('the CLI dispatches commands and rejects unknown options', () => {
  const cli = join(root, 'cli.mjs');
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /Commands:/);
  assert.match(execFileSync(process.execPath, [cli, 'build', '--help'], { encoding: 'utf8' }), /--no-push/);
  assert.match(execFileSync(process.execPath, [cli, 'docs', '--types'], { encoding: 'utf8' }), /declare/);
  assert.throws(() => execFileSync(process.execPath, [cli, 'build', join(root, 'examples/sleep'), '--no-sing'], { stdio: 'pipe' }), /Unknown option --no-sing/);
  assert.throws(() => execFileSync(process.execPath, [cli, 'bild'], { stdio: 'pipe' }), /Unknown command "bild"/);
});

test('run-local hands out secret placeholders that fetch fills in, and hides values in output', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => res.end(req.headers.authorization ?? ''));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const folder = mkdtempSync(join(tmpdir(), 'glue-secret-run-'));
  try {
    writeFileSync(join(folder, 'script.js'), `const token = Secrets.get('TOKEN');
const echoed = await (await fetch('http://127.0.0.1:${server.address().port}', { headers: { Authorization: 'Bearer ' + token } })).text();
return { placeholder: token !== 'abc123', sent: echoed === 'Bearer abc123', token };`);
    const output = await new Promise((done, fail) => {
      execFile(process.execPath, [join(root, 'cli.mjs'), 'run', join(folder, 'script.js')],
        { env: { ...process.env, GLUE_SECRET_TOKEN: 'abc123' } }, (error, stdout) => (error ? fail(error) : done(stdout)));
    });
    assert.deepEqual(JSON.parse(output), { placeholder: true, sent: true, token: '•••' });
  } finally {
    server.close();
    rmSync(folder, { recursive: true });
  }
});

test('shortcuts target the App Store team by default and FAKETEAMID with --simulator', () => {
  assert.equal(parseArgs(['examples/sleep']).teamId, 'MWP86NQ6Z7');
  assert.equal(parseArgs(['examples/sleep', '--simulator']).teamId, 'FAKETEAMID');
});

test('bundles keep the script\'s title comment first, for the run log', async () => {
  const source = await loadScript(resolve(root, 'examples/recipe-scaler/script.ts'));
  assert.match(source.split('\n')[0], /^\/\/ Scale Recipe: multiply every ingredient amount/);
  assert.match(source.split('\n')[1], /^\/\/ Bundled by GlueJS/);
});

test('the npm package ships no installed dependencies from the examples', () => {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }));
  const paths = pack.files.map((f) => f.path);
  assert.ok(!paths.some((p) => p.includes('node_modules') || p.endsWith('package-lock.json')), 'node_modules or lockfiles in the package');
  assert.ok(paths.includes('docs/reference.md') && paths.includes('docs/gluejs.d.ts') && paths.includes('examples/recipe-scaler/script.ts'));
  assert.ok(pack.files.length < 150, `${pack.files.length} files`);
});

test('TypeScript written as a plain script (top-level return) runs like a .js plain script', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'glue-plain-ts-'));
  try {
    const path = join(folder, 'script.ts');
    writeFileSync(path, "// Plain TS\nconst n: number = Number(input ?? 1);\nWidget.set('W', { value: n * 2 });\nreturn `double: ${n * 2}`;\n");
    const source = await loadScript(path);
    const Widget = { set() {} };
    assert.equal(await new ((async () => {}).constructor)('input', 'Widget', source)(21, Widget), 'double: 42');
    // Type errors point at the user's line, not the wrapper's.
    writeFileSync(path, "const ok = 1;\nconst n: number = 'nope';\nreturn n;\n");
    await assert.rejects(() => loadScript(path), /script\.ts\(2,7\): error TS2322/);
    // Syntax errors too.
    writeFileSync(path, "const ok = 1;\nconst = ;\nreturn ok;\n");
    await assert.rejects(() => loadScript(path), /script\.ts:2/);
  } finally { rmSync(folder, { recursive: true }); }
});

test('new --from works for examples without a package.json, and builds go to <folder>/dist', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'glue-from-js-'));
  try {
    execFileSync(process.execPath, [join(root, 'cli.mjs'), 'new', 'hr', '--from', 'heart-rate'], { cwd: parent, stdio: 'pipe' });
    assert.ok(existsSync(join(parent, 'hr', 'script.js')));
    execFileSync(process.execPath, [join(root, 'cli.mjs'), 'build', 'hr', '--no-sign'], { cwd: parent, stdio: 'pipe' });
    assert.ok(readdirSync(join(parent, 'hr', 'dist', 'unsigned')).some((f) => f.endsWith('.shortcut')));
    assert.equal(existsSync(join(parent, 'dist')), false);
  } finally { rmSync(parent, { recursive: true }); }
});

test('examples lists each example with its whole opening sentence', () => {
  const out = execFileSync(process.execPath, [join(root, 'cli.mjs'), 'examples'], { encoding: 'utf8' });
  assert.match(out, /aurora-alert\s+Aurora Alert: .*visible from where you are AND it's dark/);
});

test('a signing failure inside a sandbox explains itself and gives the manual command', async () => {
  const { sign } = await import('../build-shortcut.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'glue-sign-sandbox-'));
  const previous = process.env.PATH;
  try {
    // A fake `shortcuts` that fails the way it does inside Codex's sandbox.
    writeFileSync(join(folder, 'shortcuts'), "#!/bin/sh\necho \"Error: The file couldn't be opened because it isn't in the correct format.\" >&2\nexit 1\n", { mode: 0o755 });
    process.env.PATH = `${folder}:${previous}`;
    assert.throws(() => sign(join(folder, 'in.shortcut'), join(folder, 'out.shortcut')),
      /outside the sandbox[\s\S]*shortcuts sign --mode anyone --input ".*in\.shortcut" --output ".*out\.shortcut"/);
  } finally {
    process.env.PATH = previous;
    rmSync(folder, { recursive: true });
  }
});
