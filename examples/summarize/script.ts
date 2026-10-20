// Summarize: a plain-language summary of an article or any text, from Claude
//
// Input: text shared from any app, or a web page link shared from Safari (the page is
// downloaded and its text extracted). Needs the ANTHROPIC_API_KEY secret, allowed for
// api.anthropic.com:  npx gluejs-ios secret ANTHROPIC_API_KEY --hosts api.anthropic.com --ask
// Get a key at console.anthropic.com. Each summary costs a fraction of a cent.

const MODEL = 'claude-haiku-5-5';
const MAX_CHARS = 60_000;

// Readable text from an HTML page: drops scripts, styles, navigation and tags.
function pageText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const body = /<article[\s\S]*<\/article>/i.exec(html)?.[0] ?? html;
  const text = body
    .replace(/<(script|style|nav|header|footer|aside|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  return { title: decode(title), text };
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"');

export default async function main(): Promise<string> {
  if (!Secrets.has('ANTHROPIC_API_KEY')) {
    throw new Error('Run the "Set Up ANTHROPIC_API_KEY" shortcut first (get a key at console.anthropic.com).');
  }
  let shared = String(rawInput ?? '').trim();
  if (!shared) return 'Share an article or some text to Summarize, or copy it first.';

  let source = 'the text you shared';
  if (/^https?:\/\/\S+$/.test(shared)) {
    const response = await fetch(shared, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`Couldn't open ${new URL(shared).hostname} (HTTP ${response.status}).`);
    const page = pageText(await response.text());
    source = page.title || new URL(shared).hostname;
    shared = page.text;
    console.log(`fetched "${source}": ${shared.length} characters`);
  }
  if (shared.length < 200) return `There isn't much to summarize in ${source}.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Secrets.get('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: 'You summarize things for a busy, non-expert reader on their phone. Reply with 3 short ' +
        'bullet points in plain language (start each with "•"), then one line starting "Why it matters:". ' +
        'No headings, no markdown, no preamble.',
      messages: [{ role: 'user', content: `Summarize this (${source}):\n\n${shared.slice(0, MAX_CHARS)}` }],
    }),
  });
  const result = await response.json() as { content?: { type: string; text?: string }[]; error?: { message: string } };
  if (!response.ok) throw new Error(`Claude returned HTTP ${response.status}: ${result.error?.message ?? 'unknown error'}`);
  const summary = result.content?.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!summary) throw new Error('Claude returned an empty summary.');
  return source === 'the text you shared' ? summary : `${source}\n\n${summary}`;
}
