#!/usr/bin/env node
// Builds a signed .shortcut from a folder containing shortcut.json and the script(s) it runs.
//
//   gluejs-ios build <folder> [options]     (see USAGE below)
//
// shortcut.json:
//   {
//     "name": "Heart Rate Check",
//     "color": "red",
//     "actions": [
//       { "id": "days", "type": "ask", "prompt": "How many days?", "inputType": "Number", "default": "7" },
//       { "id": "report", "type": "runScript", "script": "script.js", "input": "{\"days\": ${days}}" },
//       { "type": "showResult", "text": "${report}" }
//     ]
//   }
//
// Optional "input": { "shareSheet": true, "quickAction": true, "accepts": ["text", "url", "webPage"],
// "ifEmpty": "clipboard" } puts the shortcut in the share sheet (see docs/reference.md §5).
//
// In text fields, ${id} inserts the output of the action with that id and ${shortcutInput}
// inserts the shortcut's input. Script files are embedded verbatim, so their own ${...}
// template literals are left alone. Scripts that import npm packages are bundled first
// (see bundle.mjs).

export const USAGE = `Usage: gluejs-ios build <folder> [options]

Builds every shortcut in <folder>/shortcut.json into <out>/<name>.shortcut, signed with
\`shortcuts sign\` (macOS, signed into iCloud). Scripts of "mode": "file" actions are written to
iCloud Drive › GlueJS › Scripts.

Options:
  --out DIR            Output folder (default: <folder>/dist)
  --no-sign            Write only the unsigned file (dist/unsigned/)
  --no-push            Don't write "mode": "file" scripts to iCloud Drive
  --no-typecheck       Skip TypeScript type-checking
  --minify             Minify bundled scripts (smaller, but harder to read in Shortcuts)
  --scripts-dir DIR    Write "mode": "file" scripts here instead of iCloud Drive
  --simulator          Target a Simulator build of GlueJS made without a development team
  --team-id ID         Override the app's team ID
  --bundle-id ID       Override the app's bundle ID
  --app-name NAME      Override the app's name
  -h, --help           Show this help`;

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadScript } from './bundle.mjs';

const DEFAULTS = {
  bundleId: 'com.sireniallc.GlueJS',
  appName: 'GlueJS',
  // The App Store app's team (Sirenia LLC). `--simulator` targets a Simulator build made without a
  // development team, which is signed as "FAKETEAMID" (verified on the iOS 27 Simulator).
  teamId: 'MWP86NQ6Z7',
  // iCloud Drive › GlueJS › Scripts on this Mac. It exists once GlueJS has run on a device signed
  // into the same iCloud account with iCloud Drive on.
  scriptsDir: join(homedir(), 'Library/Mobile Documents/iCloud~com~sireniallc~GlueJS/Documents/Scripts'),
};

export const SIMULATOR_TEAM_ID = 'FAKETEAMID';

/** The file name a `"mode": "file"` runScript action uses: `file`, or the folder's name. */
export function scriptFileName(action, folder) {
  let name = String(action.file ?? basename(folder)).trim();
  if (!name.toLowerCase().endsWith('.js')) name += '.js';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,99}\.js$/.test(name) || name.includes('..')) {
    throw new Error(`Invalid script file name "${name}". Use letters, numbers, spaces, dots, dashes or underscores.`);
  }
  return name;
}

/**
 * Writes the scripts of "mode": "file" runScript actions (with `code` already loaded) to the
 * Scripts folder. Returns the paths written.
 */
export function pushScripts(definition, folder, scriptsDir) {
  const definitions = Array.isArray(definition) ? definition : [definition];
  const pending = new Map();
  for (const action of definitions.flatMap((d) => d.actions)) {
    if (action.type !== 'runScript' || action.mode !== 'file') continue;
    const name = scriptFileName(action, folder);
    // iCloud Drive on typical Macs is case-insensitive. Validate the entire set before
    // updating any files, including actions belonging to different shortcuts.
    const key = name.toLowerCase();
    const previous = pending.get(key);
    if (previous && (previous.name !== name || previous.code !== action.code)) {
      throw new Error(`Conflicting scripts use "${name}". Give each different script a unique "file" name.`);
    }
    if (typeof action.code !== 'string') throw new Error(`No bundled code for "${name}".`);
    pending.set(key, { name, code: action.code });
  }
  const written = [];
  for (const { name, code } of pending.values()) {
    if (!existsSync(scriptsDir)) {
      const documents = resolve(scriptsDir, '..');
      if (!existsSync(documents)) {
        throw new Error(`${scriptsDir} doesn't exist. Open GlueJS on the iPhone once with iCloud Drive on (same Apple ID as this Mac) and wait for it to sync, or pass --scripts-dir.`);
      }
      mkdirSync(scriptsDir, { recursive: true });
    }
    const target = join(scriptsDir, name);
    const temporary = join(scriptsDir, `.${name}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, code, { flag: 'wx' });
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
    written.push(target);
  }
  return written;
}

// Shortcuts icon colors (WFWorkflowIconStartColor).
const COLORS = {
  red: 4282601983, darkOrange: 4251333119, orange: 4271458815, yellow: 4274264319,
  green: 4292093695, teal: 431817727, lightBlue: 1440408063, blue: 463140863,
  darkBlue: 946986751, violet: 2071128575, purple: 3679049983, pink: 3980825855,
  gray: 255, darkGray: 3031607807,
};

export function parseArgs(argv) {
  const args = { sign: true, typecheck: true, push: true, minify: false, out: null, ...DEFAULTS };
  const rest = [];
  const explicit = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--out', '--bundle-id', '--team-id', '--app-name', '--scripts-dir'].includes(arg) &&
        (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw new Error(`Missing value for ${arg}`);
    if (['--bundle-id', '--team-id', '--app-name'].includes(arg)) explicit.add(arg);
    if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg === '--no-sign') args.sign = false;
    else if (arg === '--no-push') args.push = false;
    else if (arg === '--minify') args.minify = true;
    else if (arg === '--simulator') { args.teamId = SIMULATOR_TEAM_ID; explicit.add('--team-id'); }
    else if (arg === '--no-typecheck') args.typecheck = false;
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--bundle-id') args.bundleId = argv[++i];
    else if (arg === '--team-id') args.teamId = argv[++i];
    else if (arg === '--app-name') args.appName = argv[++i];
    else if (arg === '--scripts-dir') args.scriptsDir = resolve(argv[++i]);
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}. See gluejs-ios build --help.`);
    else rest.push(arg);
  }
  if (rest.length !== 1) throw new Error(`Expected one folder with a shortcut.json, got ${rest.length ? rest.join(' ') : 'none'}. See gluejs-ios build --help.`);
  args.folder = resolve(rest[0]);
  // Next to the shortcut's files, so it's easy to find whichever directory the command ran in.
  args.out = args.out ? resolve(args.out) : join(args.folder, 'dist');
  return args;
}

// ---------------------------------------------------------------------------
// Shortcut model -> plist objects

const SHORTCUT_FIELDS = ['name', 'color', 'glyph', 'input', 'actions'];

// The fields each action type accepts, required ones first (marked with !). Every action also
// takes "type", "id" and "when". A misspelled field is an error rather than a silent default.
const ACTION_FIELDS = {
  runScript: ['script', 'code', 'input', 'mode', 'file'],
  text: ['text!'],
  ask: ['prompt!', 'inputType', 'default'],
  showResult: ['text!'],
  notification: ['body!', 'title'],
  copyToClipboard: ['value!'],
  quickLook: ['value!'],
  comment: ['text!'],
  findHealthSamples: ['healthType!', 'days'],
  healthSampleDetail: ['property!', 'from!'],
  logHealthSample: ['healthType!', 'value', 'unit'],
  useModel: ['prompt!', 'model'],
  weatherForecast: ['forecast'],
  weatherDetail: ['property!', 'from!'],
  upcomingEvents: ['count'],
  eventDetail: ['property!', 'from!'],
  formatDate: ['date!'],
  saveSecret: ['name!', 'hosts!', 'value', 'valueFromEnv', 'allowRawAccess'],
  raw: ['identifier!', 'parameters', 'attachmentKeys', 'outputName'],
};

function checkFields(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('each action must be an object');
  const fields = ACTION_FIELDS[action.type];
  if (!fields) throw new Error(`unknown type ${JSON.stringify(action.type)}. Types: ${Object.keys(ACTION_FIELDS).join(', ')}`);
  const names = fields.map((f) => f.replace('!', ''));
  for (const key of Object.keys(action)) {
    if (!['type', 'id', 'when', ...names].includes(key)) {
      throw new Error(`unknown field "${key}". ${action.type} takes ${names.join(', ')} (plus id, when).`);
    }
  }
  for (const field of fields.filter((f) => f.endsWith('!')).map((f) => f.slice(0, -1))) {
    if (action[field] === undefined) throw new Error(`needs "${field}"`);
  }
  if (action.type === 'runScript' && action.script === undefined && action.code === undefined) throw new Error('needs "script"');
}

export function buildShortcut(definition, { folder, bundleId, teamId, appName }) {
  if (typeof definition.name !== 'string' || !definition.name.trim() || /[\/\\\x00-\x1f]/.test(definition.name)) {
    throw new Error('Shortcut name must be nonempty and must not contain path separators or control characters');
  }
  if (!Array.isArray(definition.actions)) throw new Error('Shortcut actions must be an array');
  for (const key of Object.keys(definition)) {
    if (!SHORTCUT_FIELDS.includes(key)) throw new Error(`"${definition.name}": unknown field "${key}". A shortcut takes ${SHORTCUT_FIELDS.join(', ')}.`);
  }
  if (definition.color !== undefined && !COLORS[definition.color]) {
    throw new Error(`"${definition.name}": unknown color "${definition.color}". Colors: ${Object.keys(COLORS).join(', ')}.`);
  }
  const outputs = new Map(); // action id -> { uuid, name }
  let usesShortcutInput = false;

  // A text field that may contain ${id} references, as a WFTextTokenString.
  function tokenString(text) {
    text = String(text);
    let string = '';
    const attachmentsByRange = {};
    let last = 0;
    for (const match of String(text).matchAll(/\$\{(\w+)\}/g)) {
      string += text.slice(last, match.index);
      attachmentsByRange[`{${string.length}, 1}`] = reference(match[1]);
      string += '￼';
      last = match.index + match[0].length;
    }
    string += String(text).slice(last);
    if (Object.keys(attachmentsByRange).length === 0) return string;
    return { WFSerializationType: 'WFTextTokenString', Value: { string, attachmentsByRange } };
  }

  // A parameter that takes a single variable, as a WFTextTokenAttachment.
  function attachment(text) {
    const match = /^\$\{(\w+)\}$/.exec(String(text).trim());
    if (!match) throw new Error(`Expected a single \${id} reference, got ${JSON.stringify(text)}`);
    return { WFSerializationType: 'WFTextTokenAttachment', Value: reference(match[1]) };
  }

  function reference(id) {
    if (id === 'shortcutInput') {
      usesShortcutInput = true;
      return { Type: 'ExtensionInput' };
    }
    const output = outputs.get(id);
    if (!output) throw new Error(`\${${id}} refers to an action that doesn't exist or comes later`);
    if (!output.name) throw new Error(`Action "${id}" does not produce an output`);
    return { Type: 'ActionOutput', OutputUUID: output.uuid, OutputName: output.name };
  }

  const actions = definition.actions.flatMap((action, index) => {
    try { return buildAction(action); }
    catch (error) {
      const label = action && typeof action === 'object' ? `${action.type ?? 'action'}${action.id ? ` "${action.id}"` : ''}` : 'action';
      throw new Error(`"${definition.name}", action ${index + 1} (${label}): ${error.message}`);
    }
  });

  function buildAction(action) {
    checkFields(action);
    const uuid = randomUUID().toUpperCase();
    // "when": "${id}" runs the action only if that output isn't empty text (If … is not ""). Shortcuts'
    // "has any value" counts an empty string as a value, so it can't be used here.
    const condition = action.when === undefined ? null : { group: randomUUID().toUpperCase(), input: attachment(action.when) };
    const { identifier, parameters, outputName } = translate(action);
    if (action.id) {
      if (!/^\w+$/.test(action.id) || action.id === 'shortcutInput') throw new Error(`Invalid or reserved action id "${action.id}"`);
      if (outputs.has(action.id)) throw new Error(`Duplicate action id "${action.id}"`);
      outputs.set(action.id, { uuid, name: outputName });
    }
    const built = { WFWorkflowActionIdentifier: identifier, WFWorkflowActionParameters: { UUID: uuid, ...parameters } };
    if (!condition) return [built];
    const ifAction = (mode, extra = {}) => ({
      WFWorkflowActionIdentifier: 'is.workflow.actions.conditional',
      WFWorkflowActionParameters: { GroupingIdentifier: condition.group, WFControlFlowMode: mode, ...extra },
    });
    return [
      ifAction(0, { UUID: randomUUID().toUpperCase(), WFCondition: 5, WFConditionalActionString: '', WFInput: { Type: 'Variable', Variable: condition.input } }),
      built,
      ifAction(2, { UUID: randomUUID().toUpperCase() }),
    ];
  }

  function appIntentDescriptor(intent) {
    return { TeamIdentifier: teamId, BundleIdentifier: bundleId, Name: appName, AppIntentIdentifier: intent, ActionRequiresAppInstallation: true };
  }

  function translate(action) {
    switch (action.type) {
      case 'saveSecret': {
        // GlueJS's "Save Secret" action. The value comes from `value` (text, may use ${id}),
        // `valueFromEnv` (read at build time, so it never sits in shortcut.json) or `ask`
        // (an Ask for Input step is added before it). Running it asks the user to confirm.
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(action.name ?? '')) throw new Error(`saveSecret name "${action.name}" must start with a letter and use letters, numbers and _`);
        const hosts = Array.isArray(action.hosts) ? action.hosts.join(', ') : action.hosts;
        if (typeof hosts !== 'string' || !hosts.trim()) throw new Error('saveSecret needs hosts');
        let value = action.value;
        if (action.valueFromEnv !== undefined) {
          value = process.env[action.valueFromEnv];
          if (!value) throw new Error(`saveSecret: environment variable ${action.valueFromEnv} is not set`);
        }
        if (value === undefined) throw new Error('saveSecret needs value, valueFromEnv or a preceding ask step');
        return {
          identifier: `${bundleId}.SaveSecretIntent`,
          parameters: {
            AppIntentDescriptor: appIntentDescriptor('SaveSecretIntent'),
            ShowWhenRun: true,
            name: action.name,
            value: tokenString(value),
            hosts,
            allowRawAccess: action.allowRawAccess === true,
          },
        };
      }
      case 'runScript': {
        if (action.mode !== undefined && !['inline', 'file'].includes(action.mode)) throw new Error(`runScript mode must be "inline" or "file", got "${action.mode}"`);
        if (action.mode === 'file') {
          const parameters = {
            AppIntentDescriptor: appIntentDescriptor('RunScriptFileIntent'),
            ShowWhenRun: false,
            file: scriptFileName(action, folder),
            caller: definition.name,
          };
          if (action.input !== undefined) parameters.input = tokenString(action.input);
          return { identifier: `${bundleId}.RunScriptFileIntent`, parameters, outputName: 'Run Script File' };
        }
        const script = action.code ?? readFileSync(join(folder, action.script), 'utf8');
        const parameters = {
          AppIntentDescriptor: appIntentDescriptor('RunJavaScriptIntent'),
          ShowWhenRun: false,
          script,
          caller: definition.name,
        };
        if (action.input !== undefined) parameters.input = tokenString(action.input);
        return { identifier: `${bundleId}.RunJavaScriptIntent`, parameters, outputName: 'Run JavaScript' };
      }
      case 'text':
        return { identifier: 'is.workflow.actions.gettext', parameters: { WFTextActionText: tokenString(action.text) }, outputName: 'Text' };
      case 'ask': {
        const parameters = { WFAskActionPrompt: action.prompt, WFInputType: action.inputType ?? 'Text' };
        if (action.default !== undefined) parameters.WFAskActionDefaultAnswer = String(action.default);
        return { identifier: 'is.workflow.actions.ask', parameters, outputName: 'Provided Input' };
      }
      case 'showResult':
        return { identifier: 'is.workflow.actions.showresult', parameters: { Text: tokenString(action.text) } };
      case 'notification': {
        const parameters = { WFNotificationActionBody: tokenString(action.body) };
        if (action.title) parameters.WFNotificationActionTitle = tokenString(action.title);
        return { identifier: 'is.workflow.actions.notification', parameters };
      }
      case 'copyToClipboard':
        return { identifier: 'is.workflow.actions.setclipboard', parameters: { WFInput: attachment(action.value) } };
      case 'quickLook':
        return { identifier: 'is.workflow.actions.previewdocument', parameters: { WFInput: attachment(action.value) } };
      case 'comment':
        return { identifier: 'is.workflow.actions.comment', parameters: { WFCommentActionText: action.text } };
      case 'findHealthSamples': {
        // Apple's "Find Health Samples". healthType is Shortcuts' internal name, which can
        // differ from the label shown in the editor (e.g. "Active Energy" is stored as
        // "Active Calories"); "Heart Rate" and "Sleep" match their labels.
        const days = Number(action.days ?? 7);
        if (!Number.isInteger(days) || days <= 0) throw new Error('findHealthSamples days must be a positive integer');
        if (typeof action.healthType !== 'string' || !action.healthType) throw new Error('findHealthSamples needs healthType');
        const parameters = {
          WFContentItemFilter: {
            WFSerializationType: 'WFContentPredicateTableTemplate',
            Value: {
              WFActionParameterFilterPrefix: 1,
              WFContentPredicateBoundedDate: false,
              WFActionParameterFilterTemplates: [
                {
                  Bounded: true, Operator: 4, Property: 'Type', Removable: false,
                  Values: { Enumeration: { WFSerializationType: 'WFStringSubstitutableState', Value: action.healthType } },
                },
                // Operator 1001 = "is in the last", Unit 16 = days.
                { Bounded: true, Operator: 1001, Property: 'Start Date', Removable: false, Values: { Number: String(days), Unit: 16 } },
              ],
            },
          },
        };
        return { identifier: 'is.workflow.actions.filter.health.quantity', parameters, outputName: 'Health Samples' };
      }
      case 'healthSampleDetail': {
        // Apple's "Get Details of Health Sample"; works on a whole list, returning one value per sample.
        const properties = ['Type', 'Value', 'Unit', 'Start Date', 'End Date', 'Duration', 'Source', 'Name'];
        if (!properties.includes(action.property)) throw new Error(`healthSampleDetail property must be one of ${properties.join(', ')}`);
        return {
          identifier: 'is.workflow.actions.properties.health.quantity',
          parameters: { WFContentItemPropertyName: action.property, WFInput: attachment(action.from) },
          outputName: action.property,
        };
      }
      case 'logHealthSample': {
        // Apple's "Log Health Sample". Verified for "Headache" (a symptom; logs "Present" with
        // severity unspecified, which the file format can't set). Other types: build one in
        // Shortcuts to confirm the unit before relying on it.
        if (typeof action.healthType !== 'string' || !action.healthType) throw new Error('logHealthSample needs healthType');
        const parameters = { WFQuantitySampleType: action.healthType };
        if (action.value !== undefined) {
          parameters.WFQuantitySampleQuantity = {
            Value: { Magnitude: String(action.value), ...(action.unit ? { Unit: action.unit } : {}) },
            WFSerializationType: 'WFQuantityFieldValue',
          };
        }
        return { identifier: 'is.workflow.actions.health.quantity.log', parameters, outputName: 'Health Sample' };
      }
      case 'useModel': {
        // Apple's "Use Model" (Apple Intelligence or ChatGPT). Values verified in the iOS 27
        // Shortcuts editor. Needs an Apple Intelligence iPhone; ChatGPT needs the ChatGPT
        // extension turned on in Settings › Apple Intelligence.
        const models = { onDevice: 'Apple Intelligence on Device', cloud: 'Apple Intelligence', cloudPro: 'Apple Intelligence Pro', chatGPT: 'ChatGPT' };
        const model = action.model ?? 'onDevice';
        if (!models[model]) throw new Error(`useModel model must be one of ${Object.keys(models).join(', ')}`);
        if (typeof action.prompt !== 'string' || !action.prompt.trim()) throw new Error('useModel needs prompt');
        return {
          identifier: 'is.workflow.actions.askllm',
          parameters: { WFLLMModel: models[model], WFGenerativeResultType: 'Text', WFLLMPrompt: tokenString(action.prompt) },
          outputName: 'Response',
        };
      }
      case 'weatherForecast': {
        // Apple's "Get Weather Forecast" for the current location (asks for location once).
        // Hourly: the next ~25 hours. Daily: the next ~10 days.
        const forecast = action.forecast ?? 'hourly';
        if (!['hourly', 'daily'].includes(forecast)) throw new Error('weatherForecast forecast must be "hourly" or "daily"');
        return {
          identifier: 'is.workflow.actions.weather.forecast',
          parameters: { WFWeatherForecastType: forecast === 'daily' ? 'Daily' : 'Hourly' },
          outputName: 'Weather Forecast',
        };
      }
      case 'weatherDetail': {
        // Apple's "Get Details of Weather Conditions"; one line per hour or day. Values carry the
        // user's units ("21°C", "70°F", "16.78 km/h"); Date and the sunrise/sunset times need
        // formatDate. High, Low, Sunrise Time and Sunset Time are empty for hourly forecasts.
        const properties = ['Date', 'Temperature', 'Feels Like', 'High', 'Low', 'Precipitation Chance', 'Condition',
          'Humidity', 'Wind Speed', 'Pressure', 'UV Index', 'Visibility', 'Sunrise Time', 'Sunset Time', 'Location'];
        if (!properties.includes(action.property)) throw new Error(`weatherDetail property must be one of ${properties.join(', ')}`);
        return {
          identifier: 'is.workflow.actions.properties.weather.conditions',
          parameters: { WFContentItemPropertyName: action.property, WFInput: attachment(action.from) },
          outputName: action.property,
        };
      }
      case 'upcomingEvents': {
        // Apple's "Get Upcoming Events": the next `count` events from all calendars, including
        // holiday and subscribed calendars, starting with today's all-day events.
        const count = Number(action.count ?? 20);
        if (!Number.isInteger(count) || count <= 0) throw new Error('upcomingEvents count must be a positive integer');
        return { identifier: 'is.workflow.actions.getupcomingevents', parameters: { WFGetUpcomingItemCount: count }, outputName: 'Upcoming Events' };
      }
      case 'eventDetail': {
        // Apple's "Get Details of Calendar Events"; one line per event. Empty values (e.g. no
        // Location) are skipped, so only always-present properties line up across lists.
        const properties = ['Title', 'Start Date', 'End Date', 'Is All Day', 'Location', 'Notes', 'Calendar', 'URL'];
        if (!properties.includes(action.property)) throw new Error(`eventDetail property must be one of ${properties.join(', ')}`);
        return {
          identifier: 'is.workflow.actions.properties.calendarevents',
          parameters: { WFContentItemPropertyName: action.property, WFInput: attachment(action.from) },
          outputName: action.property,
        };
      }
      case 'formatDate':
        // Apple's "Format Date" as ISO 8601 (e.g. 2026-10-12T23:05:00-07:00), which scripts
        // can parse with Date.parse. Works on a single date or a list of dates.
        return {
          identifier: 'is.workflow.actions.format.date',
          parameters: { WFDateFormatStyle: 'ISO 8601', WFISO8601IncludeTime: true, WFDate: tokenString(action.date) },
          outputName: 'Formatted Date',
        };
      case 'raw': {
        // Escape hatch for any Shortcuts action: string parameters containing ${id} become
        // token strings, or single-variable attachments for keys listed in attachmentKeys.
        if (typeof action.identifier !== 'string') throw new Error('raw action needs identifier');
        const attachmentKeys = new Set(action.attachmentKeys ?? []);
        const parameters = {};
        for (const [key, value] of Object.entries(action.parameters ?? {})) {
          if (attachmentKeys.has(key)) parameters[key] = attachment(value);
          else if (typeof value === 'string' && /\$\{\w+\}/.test(value)) parameters[key] = tokenString(value);
          else parameters[key] = value;
        }
        return { identifier: action.identifier, parameters, outputName: action.outputName };
      }
      default:
        throw new Error(`Unknown action type "${action.type}"`);
    }
  }

  return {
    WFWorkflowClientVersion: '3036.0.4.2',
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: COLORS[definition.color] ?? COLORS.blue,
      WFWorkflowIconGlyphNumber: definition.glyph ?? 61440,
    },
    WFWorkflowImportQuestions: [],
    ...inputSettings(definition.input, usesShortcutInput),
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowActions: actions,
  };
}

// What the shortcut accepts as input, and where it appears (shortcut.json "input").
const INPUT_TYPES = {
  text: 'WFStringContentItem',
  richText: 'WFRichTextContentItem',
  url: 'WFURLContentItem',
  webPage: 'WFSafariWebPageContentItem',
};
const IF_EMPTY = {
  clipboard: { Name: 'WFWorkflowNoInputBehaviorGetClipboard', Parameters: {} },
  ask: { Name: 'WFWorkflowNoInputBehaviorAskForInput', Parameters: { ItemClass: 'WFStringContentItem' } },
};

function inputSettings(input = {}, usesShortcutInput) {
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('"input" must be an object');
  const known = ['shareSheet', 'quickAction', 'accepts', 'ifEmpty'];
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) throw new Error(`Unknown "input" option "${key}". Use ${known.join(', ')}.`);
  }
  const accepts = input.accepts ?? ['text'];
  if (!Array.isArray(accepts) || !accepts.length || accepts.some((t) => !INPUT_TYPES[t])) {
    throw new Error(`"input.accepts" must be a nonempty list of ${Object.keys(INPUT_TYPES).join(', ')}`);
  }
  if (input.ifEmpty !== undefined && !IF_EMPTY[input.ifEmpty]) {
    throw new Error(`"input.ifEmpty" must be ${Object.keys(IF_EMPTY).join(' or ')}`);
  }
  const receives = input.shareSheet || input.quickAction || input.ifEmpty;
  if (receives && !usesShortcutInput) {
    throw new Error('"input" is set but no action uses ${shortcutInput}, so the shortcut would ignore what it receives');
  }
  const types = [];
  if (input.shareSheet) types.push('ActionExtension');
  if (input.quickAction) types.push('QuickActions');
  return {
    WFWorkflowTypes: types,
    WFQuickActionSurfaces: input.quickAction ? ['Services'] : [],
    WFWorkflowInputContentItemClasses: accepts.map((t) => INPUT_TYPES[t]),
    WFWorkflowHasShortcutInputVariables: usesShortcutInput,
    ...(input.ifEmpty ? { WFWorkflowNoInputBehavior: IF_EMPTY[input.ifEmpty] } : {}),
  };
}

// ---------------------------------------------------------------------------
// XML plist writer

function escapeXML(string) {
  return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toPlist(value) {
  const lines = [];
  const write = (v, indent) => {
    const pad = '\t'.repeat(indent);
    if (typeof v === 'string') lines.push(`${pad}<string>${escapeXML(v)}</string>`);
    else if (typeof v === 'boolean') lines.push(`${pad}<${v}/>`);
    else if (typeof v === 'number') lines.push(Number.isInteger(v) ? `${pad}<integer>${v}</integer>` : `${pad}<real>${v}</real>`);
    else if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(`${pad}<array/>`); return; }
      lines.push(`${pad}<array>`);
      for (const item of v) write(item, indent + 1);
      lines.push(`${pad}</array>`);
    } else if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 0) { lines.push(`${pad}<dict/>`); return; }
      lines.push(`${pad}<dict>`);
      for (const key of keys) {
        lines.push(`${pad}\t<key>${escapeXML(key)}</key>`);
        write(v[key], indent + 1);
      }
      lines.push(`${pad}</dict>`);
    } else {
      throw new Error(`Can't write ${v} to a plist`);
    }
  };
  write(value, 0);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    ...lines,
    '</plist>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------

/** shortcut.json holds one shortcut, or a list of shortcuts that share the folder's scripts. */
export function readDefinitions(folder) {
  const path = join(folder, 'shortcut.json');
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No shortcut.json in ${folder}. Create a folder with \`gluejs-ios new <folder>\`.`);
    throw error;
  }
  let json;
  try { json = JSON.parse(text); }
  catch (error) { throw new Error(`${path} isn't valid JSON: ${error.message}`); }
  const definitions = Array.isArray(json) ? json : [json];
  if (!definitions.length) throw new Error('shortcut.json has no shortcuts');
  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object' || !Array.isArray(definition.actions)) {
      throw new Error(`${path}: each shortcut needs an "actions" list.`);
    }
  }
  return definitions;
}

/** Bundles the scripts of runScript actions that don't already carry `code`. */
export async function loadScripts(definitions, folder, { typecheck = true, minify = false } = {}) {
  for (const action of definitions.flatMap((d) => d.actions)) {
    if (action?.type === 'runScript' && action.code === undefined && typeof action.script === 'string') {
      action.code = await loadScript(join(folder, action.script), { typecheck, minify });
    }
  }
}

/** Signs `unsigned` into `signed` with macOS's `shortcuts sign`, explaining common failures. */
export function sign(unsigned, signed) {
  try {
    execFileSync('shortcuts', ['sign', '--mode', 'anyone', '--input', unsigned, '--output', signed], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Signing needs the `shortcuts` command, which comes with macOS 12 or later. On another system, build with --no-sign and sign on a Mac.');
    }
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    if (/NSURLErrorDomain|\b50[0-4]\b|network|offline/i.test(output)) {
      throw new Error(`Apple's shortcut signing service didn't respond (${output.split('\n')[0]}). It's usually temporary: try again in a few minutes.`);
    }
    if (/iCloud|account|sign in/i.test(output)) {
      throw new Error(`Signing needs this Mac to be signed into iCloud (System Settings › Apple Account).\n${output}`);
    }
    throw new Error(`shortcuts sign failed: ${output || error.message}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) return console.log(USAGE);
  const definitions = readDefinitions(args.folder);
  await loadScripts(definitions, args.folder, args);
  const outputNames = new Set();
  const prepared = definitions.map((definition) => {
    const name = definition.name ?? basename(args.folder);
    if (typeof name !== 'string' || !name.trim() || /[/\\\0]/.test(name)) {
      throw new Error('Shortcut "name" must be nonempty text without path separators or NUL.');
    }
    if (outputNames.has(name.toLowerCase())) throw new Error(`Duplicate shortcut name "${name}" would overwrite an output file.`);
    outputNames.add(name.toLowerCase());
    return { name, plist: toPlist(buildShortcut({ ...definition, name }, args)) };
  });
  if (args.push) for (const path of pushScripts(definitions, args.folder, args.scriptsDir)) console.log(`Pushed ${path}`);
  for (const { name, plist } of prepared) buildOne(name, plist, args);
}

function buildOne(name, plist, args) {
  const outDir = resolve(args.out);
  const unsignedDir = join(outDir, 'unsigned');
  mkdirSync(unsignedDir, { recursive: true });
  // `shortcuts sign` only accepts files ending in .shortcut, and the file name becomes the shortcut name.
  const unsigned = join(unsignedDir, `${name}.shortcut`);
  writeFileSync(unsigned, plist);
  console.log(`Wrote ${unsigned}`);

  if (!args.sign) return;
  const signed = join(outDir, `${name}.shortcut`);
  sign(unsigned, signed);
  console.log(`Signed ${signed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
