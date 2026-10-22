#!/usr/bin/env node
// Builds docs/examples/ (one page per example, plus an index) and docs/sitemap.xml from the
// example cards on docs/index.html, so the landing page stays the single source.
//
//   npm run build-pages

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://gluejs.sireniallc.com';
const docs = new URL('../docs/', import.meta.url);
const read = (path) => readFileSync(new URL(path, docs), 'utf8');

// Card title → page slug, search-friendly title, and the example folder in this repository.
const PAGES = {
  'What the gym really costs': { slug: 'gym-cost-per-visit', title: 'Gym Cost-Per-Visit Tracker for iPhone', example: 'gym-visits' },
  'When should I run today?': { slug: 'best-time-to-run', title: 'Best Time to Run Today: Calendar + Weather Shortcut', example: 'run-window' },
  'Scale any recipe': { slug: 'recipe-scaler', title: 'Recipe Scaler Shortcut for iPhone', example: 'recipe-scaler' },
  'Migraine patterns': { slug: 'migraine-pressure-tracker', title: 'Migraine & Barometric Pressure Tracker for iPhone', example: 'migraine-patterns' },
  'Aurora alert': { slug: 'aurora-alert', title: 'Northern Lights (Aurora) Alert for iPhone', example: 'aurora-alert' },
  'What my portfolio is worth': { slug: 'stock-portfolio-widget', title: 'Stock Portfolio Widget & Price Alerts for iPhone', example: 'stock-portfolio' },
  'Caffeine cutoff': { slug: 'caffeine-tracker', title: 'Caffeine Tracker & Sleep Cutoff Widget for iPhone', example: 'caffeine-cutoff' },
  'Sourdough starter': { slug: 'sourdough-starter-timer', title: 'Sourdough Starter Peak Timer Widget for iPhone', example: 'sourdough-starter' },
};

const index = read('index.html');
const section = /<section id="examples">([\s\S]*?)<\/section>/.exec(index)[1];
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const cards = [...section.matchAll(/<article class="example">([\s\S]*?)<\/article>/g)].map(([, html]) => {
  const name = text(/<h3>([\s\S]*?)<\/h3>/.exec(html)[1]);
  const page = PAGES[name];
  if (!page) throw new Error(`No page settings for the example "${name}". Add it to PAGES.`);
  const ask = text(/<p class="ask">([\s\S]*?)<\/p>/.exec(html)[1]).replace(/^[“"]|[”"]$/g, '');
  return {
    ...page,
    name,
    tag: text(/<span class="tag">([\s\S]*?)<\/span>/.exec(html)[1]),
    ask,
    result: /<div class="result">([\s\S]*?)<\/div>/.exec(html)[1].trim(),
    chart: /<ol class="chart">[\s\S]*?<\/ol>/.exec(html)[0],
    details: /<dl>[\s\S]*?<\/dl>/.exec(html)[0],
  };
});

const header = `  <div class="wrap">
    <header class="site-header">
      <a class="brand" href="/"><img src="/assets/apple-touch-icon.png" alt="GlueJS app icon" width="34" height="34">GlueJS</a>
      <nav>
        <a href="/examples/">Examples</a>
        <a href="/#how">How it works</a>
        <a href="/#faq">FAQ</a>
        <a href="/#pricing">Pricing</a>
        <a href="/support.html">Support</a>
      </nav>
    </header>`;
const footer = `  <footer>
    <div class="wrap">
      <span>GlueJS by <a href="https://sireniallc.com/">Sirenia LLC</a></span>
      <span><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/support.html">Support</a> · <a href="/llms.txt">llms.txt</a> · <a href="https://github.com/henrydavidge/gluejs-ios">GitHub</a></span>
    </div>
  </footer>`;

function head({ title, description, path, jsonLd }) {
  const url = `${SITE}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#6d4aff">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="GlueJS">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/assets/og.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(title)}">
  <meta name="twitter:description" content="${escape(description)}">
  <meta name="twitter:image" content="${SITE}/assets/og.jpg">
  <link rel="icon" href="/assets/favicon.png">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="stylesheet" href="/style.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
`;
}

const breadcrumb = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${path}` })),
});

// The longest description that fits in a search result (about 155 characters).
const describe = (card) => [
  `${card.ask} A free iPhone shortcut built with GlueJS and Claude or ChatGPT.`,
  `${card.ask} Built with GlueJS and Claude or ChatGPT.`,
  `${card.ask} Built with GlueJS.`,
  card.ask,
].find((s) => s.length <= 158) ?? `${card.ask.slice(0, 154).replace(/\s+\S*$/, '')}…`;

mkdirSync(new URL('examples/', docs), { recursive: true });

for (const card of cards) {
  const path = `/examples/${card.slug}.html`;
  const others = cards.filter((c) => c !== card)
    .map((c) => `<li><a href="/examples/${c.slug}.html">${c.title}</a></li>`).join('\n          ');
  const html = head({
    title: `${card.title} · GlueJS`,
    description: describe(card),
    path,
    jsonLd: [
      breadcrumb([['GlueJS', '/'], ['Examples', '/examples/'], [card.title, path]]),
      {
        '@context': 'https://schema.org', '@type': 'TechArticle', headline: card.title, description: describe(card),
        url: `${SITE}${path}`, image: `${SITE}/assets/og.jpg`, inLanguage: 'en',
        author: { '@type': 'Organization', name: 'Sirenia LLC', url: 'https://sireniallc.com/' },
        publisher: { '@type': 'Organization', name: 'Sirenia LLC', url: 'https://sireniallc.com/' },
        about: { '@type': 'SoftwareApplication', name: 'GlueJS', operatingSystem: 'iOS', applicationCategory: 'UtilitiesApplication', url: `${SITE}/` },
      },
    ],
  }) + `${header}

    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">GlueJS</a> › <a href="/examples/">Examples</a> › ${card.name}</nav>

    <article class="example-page">
      <span class="tag">${card.tag}</span>
      <h1>${card.title}</h1>
      <p class="lede">A personal iPhone shortcut that GlueJS makes possible: no app to install beyond GlueJS, built by
        your AI in a few minutes from one sentence.</p>

      <div class="example">
        <h2>What to ask for</h2>
        <p class="ask">“${card.ask}”</p>
        <h2>What you get</h2>
        <div class="result">${card.result}</div>
        <h2>How it works</h2>
        ${card.chart}
        ${card.details}
      </div>

      <section>
        <h2>Build it</h2>
        <p>On a Mac with an AI coding agent such as Claude Code or ChatGPT's Codex, say:</p>
        <p class="ask">“Use GlueJS (gluejs.sireniallc.com) to make me a shortcut: ${card.ask}”</p>
        <p>Or start from this example and change it:</p>
        <pre><code>npx gluejs-ios@latest new my-${card.slug} --from ${card.example}
npx gluejs-ios@latest build my-${card.slug}</code></pre>
        <p>Open the <code>.shortcut</code> file it makes, tap <strong>Add Shortcut</strong> on your iPhone,
          and run it once. The full source is on
          <a href="https://github.com/henrydavidge/gluejs-ios/tree/main/examples/${card.example}">GitHub</a>, and
          <a href="/llms.txt">llms.txt</a> has everything your AI needs.</p>
      </section>

      <section>
        <h2>More things people build</h2>
        <ul class="related">
          ${others}
        </ul>
      </section>
    </article>
  </div>

${footer}
</body>
</html>
`;
  writeFileSync(new URL(`examples/${card.slug}.html`, docs), html);
}

// The examples index.
const list = cards.map((c) => `        <a class="example example-link" href="/examples/${c.slug}.html">
          <span class="tag">${c.tag}</span>
          <h2>${c.title}</h2>
          <p class="ask">“${c.ask}”</p>
          <div class="result">${c.result}</div>
        </a>`).join('\n');
writeFileSync(new URL('examples/index.html', docs), head({
  title: 'iPhone Shortcut Ideas with JavaScript: Examples · GlueJS',
  description: 'Personal iPhone shortcuts and widgets built with GlueJS: aurora alerts, caffeine tracking, gym costs, recipe scaling, migraine patterns and more.',
  path: '/examples/',
  jsonLd: [
    breadcrumb([['GlueJS', '/'], ['Examples', '/examples/']]),
    { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: cards.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/examples/${c.slug}.html`, name: c.title })) },
  ],
}) + `${header}

    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">GlueJS</a> › Examples</nav>
    <section>
      <h1>What people build with GlueJS</h1>
      <p class="lede">Small, specific iPhone shortcuts and widgets no big app will ever make for you. Each one is a
        sentence to Claude or ChatGPT; it writes the script and the shortcut, and you tap Add Shortcut.</p>
      <div class="examples">
${list}
      </div>
    </section>
  </div>

${footer}
</body>
</html>
`);

// The sitemap: every page, with when its file last changed in git (or today).
const today = new Date().toISOString().slice(0, 10);
const urls = ['/', '/examples/', ...cards.map((c) => `/examples/${c.slug}.html`),
  '/llms.txt', '/reference.md', '/support.html', '/privacy.html', '/terms.html'];
writeFileSync(new URL('sitemap.xml', docs), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);

console.log(`Wrote ${cards.length} example pages, examples/index.html and sitemap.xml`);
