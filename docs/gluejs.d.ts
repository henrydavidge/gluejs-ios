// GlueJS script globals. Full reference: reference.md next to this file (docs/reference.md).
//
// Use in an editor or type checker:  /// <reference path="./gluejs.d.ts" />
// Standard web globals (fetch, URL, TextEncoder, crypto.subtle digest/HMAC, AbortController,
// timers, Intl, console) come from TypeScript's "dom" lib; GlueJS supports the subset listed
// in the reference (no DOM, XMLHttpRequest, WebSocket, Blob, FormData, streams).

export {};

declare global {
  /**
   * The Run JavaScript action's Input, `JSON.parse`d when it parses, otherwise the raw string;
   * `null` when absent; an explicit empty string stays ''. Also passed as `main(input)` in modules.
   */
  const input: unknown;
  /** The exact input text, or null. */
  const rawInput: string | null;
  /** During a widget refresh, the name of the widget being refreshed; otherwise null. */
  const refreshingWidget: string | null;

  /** Resolves after `ms` milliseconds. */
  function sleep(ms: number): Promise<void>;

  /**
   * API keys the user saved in GlueJS (via a Save Secret setup shortcut or the Secrets tab).
   * `get` returns a per-run placeholder that `fetch` replaces with the real value only for
   * the secret's allowed hosts (https, or http when allowed as `http://host`).
   */
  const Secrets: {
    names(): string[];
    has(name: string): boolean;
    /** Placeholder to put in a header, URL or body. Throws if the secret doesn't exist. */
    get(name: string): string;
    /** The raw value. Throws unless the user enabled "Scripts can read the value". */
    reveal(name: string): string;
  };

  type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

  /**
   * Persistent JSON key-value store shared by all scripts and the widget.
   * Keys 1–128 chars; value ≤ 256 KB as JSON; total ≤ 4 MB. Rejects keys/values containing
   * secrets used so far in this run, including JSON/URL-encoded forms. Each mutation is
   * serialized across processes; get + set is not a transaction. Mutations throw on corrupt storage.
   */
  const Store: {
    get<T extends JSONValue = JSONValue>(key: string): T | undefined;
    set(key: string, value: JSONValue): void;
    delete(key: string): void;
    keys(): string[];
  };

  type WidgetTint = 'red' | 'orange' | 'yellow' | 'green' | 'mint' | 'teal' | 'blue' | 'indigo' | 'purple' | 'pink' | 'gray';

  interface WidgetValueContent {
    /** ≤ 60 characters. */
    title?: string | number;
    /** Large value, ≤ 40 characters. */
    value: string | number;
    /** ≤ 200 characters. */
    detail?: string | number;
    tint?: WidgetTint;
  }

  interface WidgetItemsContent {
    title?: string | number;
    /** Up to 6 rows. label ≤ 60 chars, value ≤ 40 chars. */
    items: Array<string | { label: string | number; value?: string | number }>;
    detail?: string | number;
    tint?: WidgetTint;
  }

  interface WidgetDetailContent {
    title?: string | number;
    detail: string | number;
    tint?: WidgetTint;
  }

  /** Home-screen widgets. The user adds the GlueJS widget and picks a name. */
  const Widget: {
    /**
     * Publish content under `name` (1–40 letters, numbers, spaces, `.`, `-`, `_`).
     * `refresh`: whole minutes, 15–1440; the widget re-runs this script with this input
     * about that often. Throws on unknown fields, bad tints, oversize text, or secrets used so
     * far in this run appearing in the name, content or saved refresh settings (including input).
     * An update persists even if the script later fails. Refreshes cannot re-fetch Shortcuts input.
     */
    set(
      name: string,
      content: WidgetValueContent | WidgetItemsContent | WidgetDetailContent,
      options?: { refresh?: number },
    ): void;
    remove(name: string): void;
    names(): string[];
  };
}
