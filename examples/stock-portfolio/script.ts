// My Portfolio: what your holdings are worth, today's change, total gain, and price alerts —
// things Apple's Stocks app doesn't do (it has no share counts, cost basis or alerts).
//
// Input: your holdings and alerts, one per line (edited in the shortcut's Text action):
//   AAPL 10 @ 150        10 shares bought at $150 (the "@ cost" part is optional)
//   VTI 25
//   alert TSLA below 200 (also "above"; the symbol doesn't have to be a holding)
//   alert move 3%        any holding moving 3% or more today (default 4%)
// Quotes come from Finnhub (free key at finnhub.io). Needs the FINNHUB_KEY secret, allowed
// for finnhub.io:  npx gluejs-ios secret FINNHUB_KEY --hosts finnhub.io --ask
// Updates the "Portfolio" widget every 30 minutes. Each alert fires once per day (Store).

interface Holding { symbol: string; shares: number; cost?: number }
interface Target { symbol: string; direction: 'above' | 'below'; price: number }
interface Quote { c: number; d: number | null; dp: number | null; pc: number }

function parse(text: string) {
  const holdings: Holding[] = [];
  const targets: Target[] = [];
  let moveAlert = 4;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let m;
    if ((m = /^alert\s+move\s+(\d+(?:\.\d+)?)\s*%?$/i.exec(line))) moveAlert = Number(m[1]);
    else if ((m = /^alert\s+([A-Z.\-]{1,10})\s+(above|below)\s+\$?(\d+(?:\.\d+)?)$/i.exec(line))) {
      targets.push({ symbol: m[1].toUpperCase(), direction: m[2].toLowerCase() as Target['direction'], price: Number(m[3]) });
    } else if ((m = /^([A-Z.\-]{1,10})\s+(\d+(?:\.\d+)?)(?:\s*@\s*\$?(\d+(?:\.\d+)?))?$/i.exec(line))) {
      holdings.push({ symbol: m[1].toUpperCase(), shares: Number(m[2]), cost: m[3] ? Number(m[3]) : undefined });
    } else {
      throw new Error(`Couldn't read "${line}". Use "AAPL 10 @ 150", "alert TSLA below 200" or "alert move 3%".`);
    }
  }
  return { holdings, targets, moveAlert };
}

async function quote(symbol: string): Promise<Quote> {
  const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`, {
    headers: { 'X-Finnhub-Token': Secrets.get('FINNHUB_KEY') },
  });
  if (response.status === 429) throw new Error('Finnhub rate limit reached; try again in a minute.');
  if (!response.ok) throw new Error(`Finnhub returned HTTP ${response.status} for ${symbol}.`);
  const q = await response.json() as Quote;
  if (!q.c) throw new Error(`No price for ${symbol}. Check the ticker symbol.`);
  return q;
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 });
const signed = (n: number, text: string) => `${n >= 0 ? '+' : '−'}${text.replace('-', '')}`;
const pct = (n: number) => signed(n, `${Math.abs(n).toFixed(1)}%`);

export default async function main(input: unknown): Promise<string> {
  if (!Secrets.has('FINNHUB_KEY')) throw new Error('Run the "Set Up FINNHUB_KEY" shortcut first (free key at finnhub.io).');
  const { holdings, targets, moveAlert } = parse(String(rawInput ?? input ?? ''));
  if (!holdings.length && !targets.length) return 'Add your holdings to the shortcut, like "AAPL 10 @ 150".';

  const symbols = [...new Set([...holdings.map((h) => h.symbol), ...targets.map((t) => t.symbol)])];
  const quotes = Object.fromEntries(await Promise.all(symbols.map(async (s) => [s, await quote(s)] as const)));

  let value = 0, previous = 0, cost = 0, costed = 0;
  for (const h of holdings) {
    const q = quotes[h.symbol];
    value += q.c * h.shares;
    previous += q.pc * h.shares;
    if (h.cost !== undefined) { cost += h.cost * h.shares; costed += q.c * h.shares; }
  }
  const dayChange = value - previous;
  const dayPct = previous ? (dayChange / previous) * 100 : 0;

  // Alerts, each at most once per day.
  const today = new Date().toDateString();
  const fired = Store.get<{ day: string; keys: string[] }>('portfolio:alerts');
  const seen = new Set(fired?.day === today ? fired.keys : []);
  const alerts: string[] = [];
  const raise = (key: string, message: string) => { if (!seen.has(key)) { seen.add(key); alerts.push(message); } };
  for (const h of holdings) {
    const dp = quotes[h.symbol].dp ?? 0;
    if (Math.abs(dp) >= moveAlert) raise(`move:${h.symbol}`, `${h.symbol} ${pct(dp)} today (${money(quotes[h.symbol].c)})`);
  }
  for (const t of targets) {
    const price = quotes[t.symbol].c;
    if (t.direction === 'below' ? price < t.price : price > t.price) {
      raise(`target:${t.symbol}:${t.direction}:${t.price}`, `${t.symbol} is ${t.direction} ${money(t.price)}: now ${money(price)}`);
    }
  }
  Store.set('portfolio:alerts', { day: today, keys: [...seen] });

  const movers = [...holdings].sort((a, b) => Math.abs(quotes[b.symbol].dp ?? 0) - Math.abs(quotes[a.symbol].dp ?? 0));
  if (holdings.length) {
    Widget.set('Portfolio', {
      title: `Portfolio ${money(value)}`,
      items: [
        { label: 'Today', value: `${signed(dayChange, money(dayChange))} (${pct(dayPct)})` },
        ...(cost ? [{ label: 'Total gain', value: `${signed(costed - cost, money(costed - cost))} (${pct(((costed - cost) / cost) * 100)})` }] : []),
        ...movers.slice(0, 3).map((h) => ({ label: h.symbol, value: `${money(quotes[h.symbol].c)} ${pct(quotes[h.symbol].dp ?? 0)}` })),
      ],
      tint: dayChange >= 0 ? 'green' : 'red',
    }, { refresh: 30 });
  }

  const summary = holdings.length ? `${money(value)}, ${signed(dayChange, money(dayChange))} (${pct(dayPct)}) today.` : '';
  return alerts.length ? `🔔 ${alerts.join('\n🔔 ')}${summary ? `\n${summary}` : ''}` : summary || 'No alerts.';
}
