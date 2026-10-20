# AGENTS.md

This repository is **gluejs-ios**: the tools, examples and documentation for GlueJS, the iPhone
app that adds a Run JavaScript action to Apple Shortcuts. The app itself is closed source.

## Writing GlueJS shortcuts and scripts (most tasks)

Read `docs/reference.md` completely before writing anything; `docs/gluejs.d.ts` has the types.
Short version:

1. Shortcuts gathers device data; the script does the logic; Shortcuts acts on the output.
2. `npx gluejs-ios new <folder> --file` (TypeScript, script synced via iCloud Drive).
3. `npx gluejs-ios run <folder>/script.ts '<input>'`, then `npx gluejs-ios build <folder>`.
   Later edits: `npx gluejs-ios push <folder>`.
4. Keys: `npx gluejs-ios secret NAME --hosts host --ask`. Never put keys in files.
5. Tell the user: open the `.shortcut` from `dist/`, Add Shortcut, run it once by hand.

## Changing the tools, examples or docs

- The package root is this repository's root: `cli.mjs` dispatches to the command files.
  `docs/` is the website (gluejs.sireniallc.com, GitHub Pages from `docs/` on `main`); the
  package also ships `docs/gluejs.d.ts`, `docs/reference.md` and `examples/`.
- Tests: `npm install && npm test`. Preview the site with `npm run serve-docs`.
- The script API (globals, `Store`, `Widget`, `Secrets`, `fetch` rules) is implemented by the app.
  Change `docs/reference.md` and `docs/gluejs.d.ts` together with the app release that changes it.
- Contracts installed shortcuts depend on: the intent names `RunJavaScriptIntent`,
  `RunScriptFileIntent`, `SaveSecretIntent` and their parameter names, the bundle ID
  `com.sireniallc.GlueJS`, team `MWP86NQ6Z7`, and the iCloud container
  `iCloud.com.sireniallc.GlueJS`.
- Publishing: bump `version` in `package.json`, `npm test`, `npm publish`.
