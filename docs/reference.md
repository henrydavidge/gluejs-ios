# GlueJS reference (for coding agents)

GlueJS is an iPhone app that adds one Shortcuts action, **Run JavaScript**, plus **Save Secret**.
You (the agent) write a script and the shortcut around it on a Mac, build a signed `.shortcut`,
and the user installs it with one tap. This document is the complete contract. Type definitions:
[`gluejs.d.ts`](gluejs.d.ts). Everything here was verified on iOS 27 unless marked *unverified*.

The tools are the **`gluejs-ios`** npm package (`npx gluejs-ios --help`). It bundles and
type-checks scripts, builds signed `.shortcut` files, and ships this document
(`npx gluejs-ios docs`), the types and the examples.

## 1. Mental model

- **Shortcuts gets data in and acts on results.** Device data (Health, Calendar, Reminders,
  Location, Photos, Files, clipboard, other apps' actions) comes from Shortcuts actions and is
  passed to the script as text. Notifications, messages, clipboard writes etc. are Shortcuts
  actions that consume the script's output.
- **GlueJS only runs code.** Data shaping, math, text, `fetch` to web APIs and home devices,
  secrets, a small key-value `Store`, home-screen widgets. GlueJS never directly reads Health,
  contacts, location or photos. iOS may ask for Local Network access when a script contacts a
  home-network device.
- Keep shortcuts thin: one or more data-gathering actions → one Run JavaScript → one or two
  output actions. Put logic in JS. Generated Shortcuts actions are the brittle part.

## 2. Workflow

The tools are the npm package **`gluejs-ios`**. (Not `gluejs`: that's an unrelated old package.)
`npx` downloads them on first use, so nothing needs installing first:

```bash
npx gluejs-ios@latest new my-thing                        # my-thing/: script.ts, shortcut.json, tsconfig.json, gluejs.d.ts, package.json
npx gluejs-ios@latest run my-thing/script.ts '"hello"'    # type-check + run on the Mac (input: JSON, text or @file)
npx gluejs-ios@latest build my-thing                      # -> my-thing/dist/<shortcut name>.shortcut (signed)
```

- Run them from any directory; paths are relative to it. The output is
  `<folder>/dist/<the shortcut's "name">.shortcut` (e.g. `my-thing/dist/Moon Phase.shortcut`;
  the build prints the full path), plus an unsigned copy in `dist/unsigned/`.
- In a project you'll come back to, `npm install --save-dev gluejs-ios` once and drop `@latest`.
- `npx gluejs-ios examples` lists working examples; `npx gluejs-ios new my-thing --from <example>`
  copies one to start from. Add `dist/` to `.gitignore`.

Then tell the user: open `<folder>/dist/<name>.shortcut` on the Mac (it syncs to the iPhone via
iCloud) or AirDrop it, tap **Add Shortcut**, and **run it once by hand** before automating it
(first runs show one-time permission prompts; see §9).

**If you can't run commands** (you're a chat assistant without access to the user's Mac): give the
user the full contents of `script.ts` and `shortcut.json`, and these steps to paste into Terminal
in a new folder: `npx gluejs-ios@latest new my-thing`, write the two files into `my-thing/`
(e.g. with `cat > my-thing/script.ts <<'EOF' … EOF`), then `run` and `build` as above. Use inline
mode, and ask the user to paste back any error output. Keep the files small and self-contained.

**In a sandboxed agent** (e.g. Codex's default sandbox): `build` needs network access and must
run outside the sandbox, because signing talks to Apple's service; inside it, `shortcuts sign`
reports every file as "isn't in the correct format". Ask the user to approve running the build
with full access, or build with `--no-sign` and give the user the `shortcuts sign` command the
tool prints. If npx can't write its cache, prefix commands with `npm_config_cache=./.npm-cache`.

**Inline or file mode:**
- **Inline** (the default, `mode` omitted): the whole script is inside the shortcut. Use it for
  a user's first shortcut and for shortcuts they'll share with other people.
- **File** (`"mode": "file"` on the runScript action, or `new --file`): the shortcut runs
  `<name>.js` from iCloud Drive › GlueJS › Scripts. You install the shortcut once; afterwards
  `npx gluejs-ios push my-thing` updates the script and the next run (and refreshing widgets) use
  the new version. Use it when you'll keep iterating. It needs iCloud Drive on, the iPhone and
  Mac on the same Apple ID, and GlueJS opened once on the iPhone (that creates
  `~/Library/Mobile Documents/iCloud~com~sireniallc~GlueJS/Documents/Scripts` on the Mac; the
  build fails with that explanation if it's missing). `build` writes the script there; pass
  `--no-push` to build without touching iCloud Drive.
- Changing `shortcut.json` (actions, input, name) always needs a rebuild and reinstall.

**TypeScript or JavaScript:** `new` writes TypeScript, which catches mistakes on the Mac before
anything reaches the phone (§3). Both work everywhere.

Requirements:
- **Mac**: macOS 12 or later (for the `shortcuts` command that signs files), signed into iCloud
  (signing contacts Apple's service; if it fails with a server error, retry later), Node 20+.
  Without signing (`--no-sign`), building works anywhere, but iOS won't import unsigned files.
- **iPhone**: GlueJS installed, iOS 18 or later. Apple Intelligence actions (`useModel`) need
  iOS 26+ on an Apple Intelligence iPhone; everything else here was verified on iOS 27.

`gluejs-ios build` options (`--help` lists them): `--out DIR` (default `<folder>/dist`), `--no-sign`,
`--no-push` (don't write file-mode scripts), `--no-typecheck`, `--minify`, `--scripts-dir DIR`
(write file-mode scripts somewhere else, e.g. a Simulator's folder), `--simulator` (for a GlueJS
built in the Simulator without a team). Unknown options are errors.

## 3. Script contract

A script is the **body of an async function**: top-level `await` and `return` work. This works in
`.js` and `.ts` files alike. (Scripts that `import` npm packages use the module form instead; see
"Module scripts" below.)

```js
// First comment line = title shown in GlueJS's run log.
const data = input;                 // parsed input (see below)
console.log('debug info');          // goes to the run log, not to Shortcuts
return { ok: true };                // becomes the action's output
```

- `input`: the action's Input text, `JSON.parse`d if it parses (so `"7"` → `7`, `'{"a":1}'` →
  object), otherwise the raw string; `null` if no input was provided. An explicit empty string stays `''`.
- `rawInput`: the exact input string, or `null`.
- `refreshingWidget`: during a widget refresh (§4 Widget), the widget's name; otherwise `null`.
  Refreshes re-run the script with the same input, so skip one-time work when it's set:
  `if (!refreshingWidget) Store.set('log', [...log, entry])`.
- **Return value → Shortcuts output (Text):** string as-is; `undefined`/`null` → empty output;
  anything else → `JSON.stringify(value, null, 2)`. To use structured output in Shortcuts, return
  an object and add Shortcuts' "Get Dictionary from Input" (`raw` action, §6) — or just return
  the final human-readable text.
- **Throwing** (or a rejected promise) fails the Shortcuts action with
  `Script failed. Line N: <Error>: <message>` and stops the shortcut. Throw `new Error('…')` with
  a message the user can act on.
- **Time limit:** 25 s from start, including all awaits. Over it: `Script timed out after 25
  seconds`. Synchronous infinite loops cannot be interrupted; never write unbounded loops.
- Each run is a fresh JavaScriptCore context. No state survives except `Store` and widgets.

- **Time zone and language:** scripts run with the iPhone's time zone and language, so
  `new Date().getHours()` is local time and `toLocaleString()` uses the user's format. `gluejs-ios
  run` uses the Mac's; set `TZ=Europe/Paris` to test another zone. Pass `'en-US'` explicitly for
  output you parse later.

### TypeScript

A `.ts` file can be written either way: as a plain script (top-level code and `return`, as above)
or as a module (`export default async function main(input: unknown) { … }`). After bundling, the tools type-check with
their own TypeScript using the `tsconfig.json` next to the script (written by `gluejs-ios new`;
strict, `lib: ES2023 + DOM`, includes the folder's copy of `gluejs.d.ts`) or the same settings if
there's none. Type errors fail the build with tsc's messages; `--no-typecheck` skips the check.
`Store.get<T>(key)` is generic. Treat `input` as `unknown` and narrow it. The DOM lib declares
APIs GlueJS lacks (`document`, `XMLHttpRequest`, `Blob`, `FormData`): type-checking won't catch those.

### Module scripts (npm)

If the file contains `import`/`export` it is a module and must
`export default function main(input) { … }`, usually `async` (return value as above). Install packages
next to it (`npm init -y && npm install <pkg>` in the script's folder). The builder bundles
everything with esbuild (`platform: 'browser'`, target Safari 18, readable output) into one
script; nothing is downloaded on the phone. Globals (`fetch`, `Secrets`, `Store`, `Widget`,
`console`, `rawInput`) are available inside modules.

Works: pure-JS packages and SDKs that only need `fetch` (Octokit, zod, date-fns, most "edge
runtime" SDKs). Fails at build time, with an explanation: Node built-ins (`fs`, `net`,
`crypto` module, `path`, …). Fails at run time with a hint: `Buffer`, `process`, `require`.
Bundles run fast (a 2 MB script runs in ~0.1 s) but make inline shortcuts slow to open in the
Shortcuts editor; the builder warns above 200 KB. Use file mode, or `--minify` (about half the
size, but unreadable in the shortcut). The script is under **Show More** on the Run JavaScript
action, so it doesn't fill the editor either way.

## 4. Runtime APIs

Standard, as in browsers: `fetch`, `Headers`, `Request`, `Response`, `URL`, `URLSearchParams`,
`TextEncoder`, `TextDecoder` (UTF-8 only, no streaming), `atob`, `btoa`,
`crypto.getRandomValues`, `crypto.randomUUID`, `crypto.subtle.digest` (SHA-1/256/384/512),
`crypto.subtle.importKey('raw', …, {name:'HMAC', hash}, …)` + `sign`/`verify` (HMAC only),
`AbortController`, `AbortSignal` (`timeout`, `any`), `setTimeout`, `setInterval`,
`clearTimeout`, `clearInterval`, `queueMicrotask`, `Intl`, `console.{log,info,warn,error,debug}`.
Plus `sleep(ms)` → Promise. Not available: DOM, `XMLHttpRequest`, `WebSocket`, `Blob`, `FormData`,
`ReadableStream`, Node APIs. `navigator.language` is the device locale.

### fetch

- Schemes: `https:` and `http:` only. Plain http is allowed for home-network devices
  (Home Assistant, NAS, routers, `*.local`); iOS shows a Local Network permission prompt the
  first time. A redirect from https to http is refused.
- Per run: fresh ephemeral session, **no cookies, no cache**, `User-Agent: GlueJS/0.1 (iOS)`.
  Request timeout 30 s, resource timeout 60 s, request body ≤ 20 MB, response ≤ 50 MB.
- Bodies: string (default `text/plain;charset=UTF-8`), `URLSearchParams`, `ArrayBuffer`,
  typed arrays. For JSON: `body: JSON.stringify(x), headers: {'Content-Type':'application/json'}`.
- `response.body` is always `null` (no streaming): use `.text()`, `.json()`, `.arrayBuffer()`.
- Cross-origin redirects drop `Authorization`, `Proxy-Authorization` and `Cookie`.
- Can't set `Host`, `Content-Length`, `Transfer-Encoding`.

### Secrets

```js
Secrets.names()               // ['GITHUB_TOKEN', …]
Secrets.has('GITHUB_TOKEN')   // boolean
Secrets.get('GITHUB_TOKEN')   // placeholder string, e.g. "GLUE_SECRET_GITHUB_TOKEN_3f9a…"
Secrets.reveal('KEY')         // raw value; throws unless the user enabled raw access for KEY
```

- Use the placeholder exactly where the value goes: header value, URL (inserted
  percent-encoded), or body (inserted literally; must not need JSON escaping).
  `fetch` replaces it with the real value **only** if the request host matches the secret's
  allowed hosts, and only over https unless the host was allowed as `http://host`. Otherwise
  the request is refused before sending:
  `Secret X can't be sent to evil.com. It's only allowed for api.example.com; …`
- Never compute on the placeholder (hashing, base64, slicing, string length checks): you'd be
  computing on the placeholder, not the key. For signatures use `Secrets.reveal` and tell the
  user to enable "Scripts can read the value" (§7 `--raw`).
- Placeholders and values of secrets used so far in the run are checked in raw, JSON-escaped
  and URL-encoded forms. They are scrubbed from the run log and output. `Store.set` rejects
  them in keys or values; `Widget.set` rejects them in names, content and saved refresh settings
  (script, input, file name and caller). This is a safeguard against accidental persistence,
  not isolation from untrusted scripts: transformed values and secrets not yet used can evade it.
- Check `Secrets.has` and throw a helpful error if missing:
  `if (!Secrets.has('GITHUB_TOKEN')) throw new Error('Run the "Set Up GITHUB_TOKEN" shortcut first.')`.
- Storage: the user's iCloud Keychain (end-to-end encrypted; device-only if iCloud Keychain is
  off), with the allowed hosts and raw-access setting synced alongside. Set up once per Apple
  Account, not once per device; deleting in the Secrets tab deletes everywhere.
- Setting up a secret: §7.

### Store

```js
Store.get(key)            // parsed JSON value or undefined
Store.set(key, value)     // any JSON-serializable value; undefined is an error
Store.delete(key)
Store.keys()              // string[]
```

Shared by all scripts and the widget; persists across runs and app updates.
Key: 1–128 chars. Value ≤ 256 KB as JSON. Total ≤ 4 MB. Prefix keys with your script's name
(`'release-watch:nodejs/node'`) to avoid collisions. Individual mutations are serialized across
the app and widget extension, preserving writes to different keys. For the same key, the last
write wins; a `get` followed by `set` is not an atomic transaction. Mutations throw instead of
overwriting an unreadable or corrupt store.

- **Backups:** Store values and widgets are included in the phone's iCloud/computer backup and
  restore to a new phone; they don't sync live between devices. The run log is never backed up.
  Secrets are in the user's iCloud Keychain, so they're on all their devices and survive a new phone.

### Widget

```js
Widget.set('Weather', {
  title: 'Seattle',                       // ≤ 60 chars, optional
  value: '55°',                           // ≤ 40 chars  ┐ use value (+detail)
  detail: 'Rain at 4 PM',                 // ≤ 200 chars ┘ or items, not both
  // items: [{ label: 'Now', value: '55°' }, 'Dry tomorrow'],   // ≤ 6; label ≤ 60, value ≤ 40
  tint: 'blue',  // red orange yellow green mint teal blue indigo purple pink gray
}, { refresh: 60 });                       // optional, whole minutes 15–1440
Widget.remove('Weather');
Widget.names();
```

- **Names:** 1–40 characters: letters, numbers, spaces, `.`, `-`, `_` (no emoji; put emoji in
  `title` or `value`). Publishing the same name again replaces that widget.
- **Content:** `value` (+ optional `detail`) for one big number or phrase, or `items` (+ optional
  `detail`) for a short list; `title` and `tint` with either. Unknown fields, bad tints, oversize
  strings → throws (so typos don't make blank widgets). Numbers are accepted where strings are
  expected.
- **What shows where:** small: title, the value (shrinks to fit one line) or the first 4 items,
  and up to 2 lines of detail; medium: the same with up to 6 items and 3 lines of detail; Lock
  Screen (rectangular): the title and the value (or the first item). Keep `value` under ~12
  characters for a small widget. Every widget shows when it was published.
- **Adding it:** the user long-presses the Home Screen › **+** › **GlueJS**, picks a size, then
  touch-and-holds the widget › **Edit Widget** › picks the name. If only one widget is published
  it's shown automatically. A widget shows nothing until the shortcut has run once.
- **Without `refresh`:** shows the last published content; update by running the shortcut again
  (e.g. a daily Shortcuts automation).
- **With `refresh: N`:** the widget re-runs *this same script with this same input* roughly every
  N minutes (iOS decides exact timing; budget is a few dozen refreshes a day). Use it for web
  data. Data that came from Shortcuts (Health etc.) is frozen at the input of the publishing run.
  Refresh runs count toward the free plan and have a 15 s limit. **Free plan (3 runs a day):** use
  `refresh: 720` or more (about twice a day), or skip `refresh` and run the shortcut from a daily
  automation. Anything more frequent needs GlueJS Unlimited; say so when you build it. A widget
  that only depends on the date (a countdown, a moon phase) still needs a refresh or an
  automation to move forward. If a refresh fails or doesn't
  call `Widget.set` for that name, the widget keeps the last content published and the app shows
  the error. A completed `Widget.set` remains even if the script fails later; script failures
  don't roll back Store writes, widget updates or network requests.
- Home Screen widgets show when they were published (the time today, the date before that) and a
  ⚠︎ when the last refresh failed; the compact Lock Screen widget shows only the ⚠︎. Runs blocked by
  the free plan show as *Skipped* in the run log.

## 5. shortcut.json

```json
{
  "name": "Umbrella Check",
  "color": "lightBlue",
  "actions": [
    { "id": "city", "type": "ask", "prompt": "Which city?", "inputType": "Text", "default": "Seattle" },
    { "id": "report", "type": "runScript", "script": "script.js", "input": "${city}" },
    { "type": "notification", "title": "Weather", "body": "${report}" }
  ]
}
```

- Fields: `name`, `color`, `glyph`, `input`, `actions`. Unknown fields (in the shortcut or in
  an action) are build errors naming the shortcut and action, so typos don't build silently.
- `name` → the shortcut's name and the run-log label (default: the folder name). Nonempty, with
  no `/`, `\` or NUL. Names in a list must be unique (case-insensitively); they become file names.
- `color`: red darkOrange orange yellow green teal lightBlue blue darkBlue violet purple pink gray
  darkGray (default blue). `glyph`: Shortcuts' icon number (default 61440).
- Text fields accept `${id}` (output of an earlier action with that `id`) and
  `${shortcutInput}` (the shortcut's own input, e.g. from the share sheet). `${…}` inside
  script files is never touched.
- Actions run top to bottom; reference only earlier ids.
- Any action can take `"when": "${id}"`: it then runs only if that output isn't empty text
  (built as If … is not "" / End If; verified). Return `''` from a script to skip a notification:
  `{ "type": "notification", "body": "${alert}", "when": "${alert}" }`. (Shortcuts' own "has any
  value" treats an empty string as a value, so don't use a raw If for this.)
- `shortcut.json` may be a **list** of shortcut objects; each becomes its own `.shortcut`, sharing
  the folder's scripts (e.g. a one-tap "log" shortcut plus a weekly "report"; see
  the `migraine-patterns` example).
- Different file-mode scripts in the same build/push need distinct `file` names. Sharing a
  name is allowed only for identical code. Conflicts are rejected before any scripts are pushed;
  each file is replaced atomically so a reader cannot see a partially written bundle.
- `input` (optional) controls what the shortcut receives and where it appears; any of these
  requires an action that uses `${shortcutInput}`:

  ```json
  "input": { "shareSheet": true, "quickAction": true, "accepts": ["text", "url", "webPage"], "ifEmpty": "clipboard" }
  ```

  - `shareSheet`: listed in the share sheet's actions (Share → scroll down). This is how a user
    sends highlighted text or the page they're reading to a script.
  - `quickAction`: Mac right-click → Quick Actions / Services. *Shown on import; Mac behavior unverified.*
  - `accepts` (default `["text"]`): `text`, `richText`, `url`, `webPage`. The shortcut only appears
    in the share sheet for these types.
  - `ifEmpty`: when run with no input (from the Home Screen, Back Tap, the Action button),
    `clipboard` uses the clipboard, `ask` prompts for text.
  - What the script receives, verified: shared text → the text; a Safari page (`webPage`/`url`) →
    **the page's URL as a string**, not its content. Fetch the URL if you need the page.

## 6. Builder action types

| type | fields | output | notes |
|---|---|---|---|
| `runScript` | `script` (path, bundled) or `code` (script text, used as is); `input` (text); `mode` (`inline` default, or `file`); `file` (name, default: folder name) | Run JavaScript / Run Script File | `inline` embeds the bundled script; `file` references `<file>.js` in iCloud Drive › GlueJS › Scripts and the builder writes it there (§2). |
| `text` | `text` | Text | Use to assemble multi-part input. |
| `ask` | `prompt`, `inputType` (`Text`/`Number`/…), `default` | Provided Input | `default` doesn't show for `Number` *(known bug)*. |
| `showResult` | `text` | — | Pops a card; avoid in automations. |
| `notification` | `body`, `title` | — | Best final step for automations. |
| `copyToClipboard` | `value` (`${id}` only) | — | |
| `quickLook` | `value` (`${id}` only) | — | |
| `comment` | `text` | — | |
| `findHealthSamples` | `healthType`, `days` (default 7) | Health Samples | See §8 for type names and the sharing limit. |
| `healthSampleDetail` | `property`, `from` (`${id}`) | property name | `Value`, `Unit`, `Start Date`, `End Date`, `Duration`, `Source`, `Name`, `Type`. Returns one line per sample. |
| `logHealthSample` | `healthType`, `value`, `unit` (optional) | Health Sample | Apple's Log Health Sample. Verified: `Headache` with `value: 1` (logged as "Present"; severity can't be set from a file). Other types: confirm the unit by building one in Shortcuts. Asks for Health write access once. |
| `useModel` | `prompt` (text, may use `${id}`), `model`: `onDevice` (default), `cloud`, `cloudPro`, `chatGPT` | Response | Apple's Use Model (Apple Intelligence). Needs an Apple Intelligence iPhone with it turned on; `chatGPT` needs the ChatGPT extension (Settings › Apple Intelligence). Not available in the Simulator. See §8. |
| `weatherForecast` | `forecast`: `hourly` (default, ~25 h) or `daily` (~10 days) | Weather Forecast | Apple Weather for the current location. Asks Shortcuts for location once. |
| `weatherDetail` | `property`, `from` (`${id}`) | property name | `Date`, `Temperature`, `Feels Like`, `High`, `Low`, `Precipitation Chance`, `Condition`, `Humidity`, `Wind Speed`, `Pressure`, `UV Index`, `Visibility`, `Sunrise Time`, `Sunset Time`, `Location`. One line per hour/day. |
| `upcomingEvents` | `count` (default 20) | Upcoming Events | Next events from all calendars (holidays and subscriptions too), today's all-day events first. Filter to the day you want in the script. |
| `eventDetail` | `property`, `from` (`${id}`) | property name | `Title`, `Start Date`, `End Date`, `Is All Day` (`Yes`/`No`), `Location`, `Notes`, `Calendar`, `URL`. One line per event; **empty values are skipped**, so only use always-present properties side by side. |
| `formatDate` | `date` (`${id}`) | Formatted Date | ISO 8601 with offset; works on lists. Always format dates before passing them. |
| `saveSecret` | `name`, `hosts` (text or list), `valueFromEnv` or `value`, `allowRawAccess` | — | Prefer `gluejs-ios secret` (§7). |
| `raw` | `identifier`, `parameters`, `attachmentKeys`, `outputName` | `outputName` | Any Shortcuts action, e.g. `is.workflow.actions.detect.dictionary`. Strings with `${id}` become token strings; keys in `attachmentKeys` become single-variable attachments. |

To find an unknown action's identifier and parameter keys: ask the user to build it once in
Shortcuts and share the `.shortcut`, or (Simulator) read `~/Library/Developer/CoreSimulator/Devices/<udid>/data/Library/Shortcuts/Shortcuts.sqlite`, table `ZSHORTCUTACTIONS`,
column `ZDATA` (binary plist).

### Passing several lists to a script

Get Details on a list returns one value per line. Pass sections in one Text action and split
in JS — this is the pattern every Health example uses:

```json
{ "id": "payload", "type": "text", "text": "<<<value>>>\n${val}\n<<<start>>>\n${start}\n" }
```

```js
function sections(text) {
  const out = {};
  for (const part of String(text).split('<<<')) {
    const end = part.indexOf('>>>');
    if (end >= 0) out[part.slice(0, end)] = part.slice(end + 3).replace(/^\n/, '').replace(/\n$/, '').split('\n');
  }
  return out;
}
```

Always check that parallel lists have equal length and throw if not.

## 7. Secret setup (no typing in the app)

```bash
npx gluejs-ios secret HA_TOKEN --hosts http://homeassistant.local --ask       # user pastes it on the phone
GITHUB_TOKEN=ghp_… npx gluejs-ios secret GITHUB_TOKEN --hosts api.github.com  # key from the environment
npx gluejs-ios secret SIGNING_KEY --hosts api.example.com --ask --raw         # script may read it
```

Produces `dist/Set Up NAME.shortcut`. The user opens it, runs it once, confirms the dialog
("Save NAME in GlueJS? It can be sent to: …"), then deletes it. The confirmation always
appears and can't be bypassed; it protects against shortcuts that silently redirect keys.

- **Prefer `--ask`**: the file contains nothing secret. Without it, the key is read from the
  environment variable and embedded in the signed file (which passes through Apple's signing
  service); the unsigned copy is only kept in a private temporary folder. Keep `dist/` out of
  git, delete the file after use, and never write keys into `shortcut.json` or scripts.
- Hosts: exact host (`api.github.com`), wildcard subdomains (`*.example.com`), or `http://host`
  for plain-http home devices. Ports are ignored. Multiple: `--hosts a.com,b.com`.
- Re-running with the same name replaces the secret (the dialog says what it replaces).

## 8. Getting device data through Shortcuts

Health (`findHealthSamples` `healthType` values are Shortcuts' internal names; most match the
Health app label): `Heart Rate`, `Resting Heart Rate`, `Heart Rate Variability`, `Sleep`,
`Steps`, `Active Calories` (shown as "Active Energy"), `Walking + Running Distance`,
`Respiratory Rate`, `Oxygen Saturation`, `VO2 Max`, `Weight`, `Body Temperature`,
`Blood Glucose`, `Mindful Session`, `Flights Climbed`.

- Sleep `Value` lines are stage names: `In Bed`, `Core`, `Deep`, `REM`, `Awake`,
  `Asleep`/`Asleep Unspecified`. **`Source` is empty for sleep**, so Watch and iPhone records
  can't be separated; dedupe by merging overlapping intervals.
- Quantity `Value` lines are numbers; `Name` is `"56 count/min"`; `Unit` e.g. `count/min`.
- `days: N` means start date in the last N days. The window starts at local midnight N days ago,
  so `days: 7` on a Tuesday covers the previous Tuesday through today so far (7 full days plus
  today), and `days: 6` gives exactly 7 calendar days including today. Group by calendar day in
  the script and treat today as partial.
- **Steps, distance, energy, flights:** the iPhone and an Apple Watch both record the same walk,
  so adding up raw samples double-counts. Include `Source` (`healthSampleDetail`) and, for each
  hour, keep only the source with the larger total, then add up the hours. These types produce
  many samples (Steps: often 100+ a day), so a week usually hits the sharing limit below; ask
  for fewer days or tell the user about the setting.
- `Value`, `Start Date` and `End Date` have a line for every sample, so those lists line up.
  `Source` can be empty (always, for Sleep); check list lengths before pairing it with the others
  and ignore it if they differ.
- **Sharing limit:** with default settings Shortcuts refuses to pass more than roughly
  100–200 Health samples to another app: *"This action is trying to share 240 Health items,
  which is not allowed."* Fixes, in order of preference: query fewer days; or tell the user to
  enable Settings → Apps → Shortcuts → Advanced → **Allow Sharing Large Amounts of Data**.
  Heart Rate is recorded every few minutes (~150–300/day) — one day can already exceed it.
- **Write user data to Health, not Store**, when Health has a matching type (symptoms, mood,
  water, caffeine, mindful minutes…): it's backed up, synced, visible in the Health app and
  shareable with a doctor. (Store is in the phone's backup but doesn't sync between devices.) Log with `logHealthSample`, read back
  with `findHealthSamples`. See the `migraine-patterns` example.
- **No samples, or read access declined:** Find Health Samples shows *"No Samples Found … or you
  need to give Shortcuts access"* and, in testing, tapping OK stopped the shortcut. iOS asks for
  Health access only once per type; if the user declined, they must turn it on in Health ›
  profile › Apps › Shortcuts. iOS 27 also asks how much history to share ("Past 30 Days" or "All
  Recorded Data"): if a shortcut reads more than 30 days, tell the user to pick All.
- The first run asks for Shortcuts' Health access (per type) and then "Allow 'X' to share N
  health samples with 'GlueJS'?". Health data is unavailable while the phone is locked.

Calendar (verified): `upcomingEvents` → `eventDetail` for `Title`, `Start Date` (→ `formatDate`)
and `Is All Day` → one text payload with `<<<…>>>` sections → script filters to today. See
the `morning-briefing` example. `Location` and `Notes` lists leave out events without one, so they
can't be matched to titles by position. First run asks *"Allow 'X' to share 20 calendar events
with 'GlueJS'?"*.

Weather (verified): **prefer Apple Weather** (`weatherForecast` → `weatherDetail`) over a web
API. It's the user's own location with no town to type, and the script makes no network request.
Values carry the user's units and locale: `"21°C"`/`"70°F"`, `"16.78 km/h"`, `"1,017.84 mbar"`;
humidity is a fraction (`0.42`); precipitation chance is `0`–`100`. Run `Date`, `Sunrise Time` and
`Sunset Time` through `formatDate`. Hourly forecasts leave `High`, `Low`, `Sunrise Time` and
`Sunset Time` empty (use daily). Use a web API instead when you need history (Apple Weather only
forecasts), cloud-cover percentage, a place other than where the phone is, or coordinates.
See the `run-window` example.

AI (verified action shape and model names; the model itself only runs on a real device):
let the script do the data work and return a compact **fact sheet**, then `useModel` writes it
up. `onDevice` keeps everything on the phone, which matters for Health and personal logs; the
on-device model has a small context, so keep the fact sheet under ~2,000 words. Put the wording
instructions in the `useModel` prompt (visible to the user in Shortcuts), the facts in the
script. Apple's Shortcuts Gallery already has a "Morning Report" (weather + calendar +
reminders → Use Model); don't build that, build something only a script can compute.

Other device data: use `raw` actions (Find Calendar Events `is.workflow.actions.filter.calendarevents`,
Get Current Location `is.workflow.actions.getcurrentlocation`, Get Clipboard
`is.workflow.actions.getclipboard`, Get Current Weather `is.workflow.actions.weather.currentconditions`).
*Parameter shapes for these are unverified; build one in Shortcuts to confirm.*

## 9. What the user will see (tell them)

1. **Add Shortcut** sheet when opening the file.
2. First run: "Allow 'X' to run actions from 'GlueJS'?" → Allow. Runs started from a URL may also
   ask before showing output.
3. Health shortcuts: Shortcuts' Health permission sheet, then the share prompt (§8). Calendar,
   Safari pages and other personal items get the same kind of prompt: *"Allow 'X' to share 1 Safari
   item with 'GlueJS'?"*. Tell the user to pick **Always Allow** for anything they'll automate.
   Copy to Clipboard asks once too; skip it unless the user needs it.
4. Free plan: 3 runs/day from Shortcuts and widget refreshes, then
   *"You've used today's 3 free runs. Get GlueJS Unlimited…"*. The Playground and Run Again in
   the app are free. A self-refreshing widget (`refresh`) uses several runs a day, so it needs
   GlueJS Unlimited ($4.99/year); say so when you build one.
5. Automations must be run by hand once first, or they stall on these prompts.
6. **Triggers** (arriving somewhere, time of day, alarm stopped, opening an app, NFC tag, Focus)
   are automations, which a `.shortcut` file can't contain. Tell the user the exact steps, e.g.
   *Shortcuts › Automation › + › Arrive › choose the place › Run Immediately › pick "Gym Visit"*,
   and put the same steps in a `comment` action at the top of the shortcut.

## 10. Debugging

- **Run log** (GlueJS app → Runs): every run with caller (shortcut name), input, output, console,
  error with line number, and Run Again. Ask the user for a screenshot of the failing run.
- File-mode errors (also recorded in Runs): *"This shortcut runs x.js, which isn't in iCloud Drive ›
  GlueJS › Scripts"* (not pushed, or iCloud Drive off), *"x.js is still downloading from iCloud"*
  (retry). The Data tab lists the
  script files the phone sees and where it reads them from.
- `gluejs-ios run` executes in **Node**, not JavaScriptCore: it has Node globals and no secret host
  policy, http(s)-only check, or size limits. Secrets come from `GLUE_SECRET_<NAME>` env vars;
  as on the phone, `Secrets.get` returns a placeholder that `fetch` fills in, and values are hidden
  in the output;
  `Store`/`Widget` write to `./.glue-local/`; `GLUE_REFRESHING_WIDGET=<name>` simulates a widget refresh. Passing locally is necessary, not sufficient.
- Errors carry a plain-language hint in parentheses for common mistakes (Node or browser APIs,
  misspelled globals like `store`, unknown `Store`/`Widget`/`Secrets` methods, HTML parsed as JSON).
  They appear in Shortcuts' error alert and the run log, so users (and Shortcuts' own AI builder)
  can fix simple problems without these docs.
- Common failures: `Can't find variable: Buffer` (Node API, see §3); `Secret X can't be sent to …`
  (wrong host or http); `Unknown widget field "titel"`. If your script checks parallel lists (§6),
  unequal lengths usually mean a missing formatDate or a filtered list.

## 11. Templates

Web API → widget, refreshed hourly:

```js
// Bitcoin price widget
const res = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
if (!res.ok) throw new Error(`Coinbase returned HTTP ${res.status}`);
const { data } = await res.json();
Widget.set('BTC', { title: 'Bitcoin', value: `$${Math.round(data.amount).toLocaleString('en-US')}`, tint: 'orange' }, { refresh: 30 });
return data.amount;
```

Only notify when something changed (pair with a `notification` step that the shortcut skips
when output is empty — or just return a "no change" line):

```js
const key = 'status-watch:example';
const current = await (await fetch('https://status.example.com/api/v2/status.json')).json();
const previous = Store.get(key);
Store.set(key, current.status.indicator);
if (previous === current.status.indicator) return '';
return `Status changed: ${previous ?? 'unknown'} → ${current.status.indicator}`;
```

Home Assistant (secret allowed for `http://homeassistant.local`):

```js
const res = await fetch('http://homeassistant.local:8123/api/states/sensor.living_room_temperature', {
  headers: { Authorization: `Bearer ${Secrets.get('HA_TOKEN')}` },
});
const state = await res.json();
Widget.set('Living room', { title: 'Living room', value: `${state.state}°` }, { refresh: 15 });
return state.state;
```

More: `npx gluejs-ios examples` lists the packaged examples (Health, Calendar, Apple Weather,
Use Model, share sheet, location triggers, npm packages, secrets, refreshing widgets);
`npx gluejs-ios new <folder> --from <example>` copies one.

## 12. Rules of thumb

- Validate input shape first and throw clear errors; never assume Shortcuts sent what you expect.
- Return human-readable text for display steps; return JSON only when another action parses it.
- No unbounded loops; paginate with a cap; keep total work well under 25 s.
- One widget name per purpose; prefix Store keys.
- Never embed keys in scripts or `shortcut.json`; use §7.
- Prefer fewer Health days over asking the user to change Settings.
