# gluejs-ios

Tools for building Apple Shortcuts that use **GlueJS**, the iPhone app that adds a
**Run JavaScript** action to Shortcuts. Written for AI coding agents like Claude Code and ChatGPT’s Codex: you describe what you want, the
agent writes the script and the shortcut around it, and you install the result with one tap.

```bash
npx gluejs-ios new my-thing --file             # script.ts, shortcut.json, tsconfig.json, gluejs.d.ts
npx gluejs-ios run my-thing/script.ts '"hi"'   # type-check and run on the Mac
npx gluejs-ios build my-thing                  # -> dist/<name>.shortcut, signed
npx gluejs-ios push my-thing                   # later edits reach the phone without reinstalling
npx gluejs-ios secret API_KEY --hosts api.example.com --ask
npx gluejs-ios examples                        # then: npx gluejs-ios new mine --from <example>
npx gluejs-ios docs                            # the complete reference, for agents
```

What it does:

- **Bundles** scripts and their npm packages with esbuild for the iPhone's JavaScriptCore,
  and explains what can't work there (Node built-ins).
- **Type-checks** TypeScript against GlueJS's API (`Store`, `Widget`, `Secrets`, `input`).
- **Builds** `.shortcut` files from a short `shortcut.json`: Health, Calendar, Apple Weather,
  Apple Intelligence, notifications, the share sheet and any other Shortcuts action, wired to the
  script. Typos in field names are errors, not silently broken shortcuts.
- **Signs** them with macOS's `shortcuts sign`, so iOS will import them.

Requirements: macOS 12 or later signed into iCloud (for signing), Node 20+, and GlueJS on an
iPhone with iOS 18 or later. Add `dist/` to `.gitignore`.

Agents: read the reference first (`npx gluejs-ios docs`, or `reference.md` in this package).

## Contributing

Issues and pull requests are welcome at https://github.com/henrydavidge/gluejs-ios. Run
`npm install && npm test` before sending changes; `AGENTS.md` has the layout. The website is
`docs/`; preview it with `npm run serve-docs`.

MIT licensed. GlueJS and the GlueJS app are by Sirenia LLC.
