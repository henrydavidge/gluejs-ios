// Sourdough Starter: tap when you feed it; a widget tells you when it'll peak
//
// Input: your usual feeding and kitchen, e.g. "1:2:2 at 70F" (starter:flour:water ratio and
// kitchen temperature; °F or °C). Each run logs a feeding; widget refreshes just recalculate.
// The estimate is a baker's rule of thumb, not a lab model: a 1:1:1 feed peaks in about
// 4½ hours at 75°F/24°C, bigger feeds take longer, and every 15°F/8°C cooler roughly doubles it.
// Tweak BASE_HOURS after watching your own starter for a few days.

const BASE_HOURS: Record<number, number> = { 1: 4.5, 2: 6.5, 3: 8, 4: 9, 5: 10, 10: 13 }; // by feed ratio at 75°F

function parse(text: string) {
  const ratio = /1\s*:\s*(\d+)/.exec(text)?.[1];
  const temp = /(-?\d+(?:\.\d+)?)\s*°?\s*([FC])\b/i.exec(text);
  const feed = Number(ratio ?? 1);
  const fahrenheit = temp ? (temp[2].toUpperCase() === 'C' ? Number(temp[1]) * 9 / 5 + 32 : Number(temp[1])) : 72;
  return { feed, fahrenheit };
}

function peakHours(feed: number, fahrenheit: number): number {
  const known = Object.keys(BASE_HOURS).map(Number).sort((a, b) => a - b);
  const nearest = known.reduce((best, k) => (Math.abs(k - feed) < Math.abs(best - feed) ? k : best));
  return BASE_HOURS[nearest] * 2 ** ((75 - fahrenheit) / 15);
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const span = (ms: number) => {
  const m = Math.round(Math.abs(ms) / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

export default function main(): string {
  const { feed, fahrenheit } = parse(String(rawInput ?? ''));
  const now = Date.now();
  if (!refreshingWidget) Store.set('sourdough:fed', now);
  const fed = Store.get<number>('sourdough:fed');
  if (!fed) return 'Run Fed Starter after your next feeding.';

  const peak = fed + peakHours(feed, fahrenheit) * 3_600_000;
  const tooLate = peak + 4 * 3_600_000; // collapsing and hungry after a few hours past peak
  const state = now < peak - 3_600_000 ? 'rising' : now < peak + 3_600_000 ? 'peak' : now < tooLate ? 'falling' : 'hungry';
  const headline = {
    rising: `Peaks around ${clock(peak)}`,
    peak: 'At its peak — bake now',
    falling: 'Past peak — use soon or feed',
    hungry: 'Hungry — time to feed',
  }[state];

  Widget.set('Starter', {
    title: '🍞 Starter',
    value: state === 'rising' ? `peak in ${span(peak - now)}` : headline.split(' — ')[0],
    detail: `${state === 'rising' ? headline : (headline.split(' — ')[1] ?? headline).replace(/^./, (c) => c.toUpperCase())} · fed ${clock(fed)} (1:${feed}:${feed}, ${Math.round(fahrenheit)}°F)`,
    tint: state === 'peak' ? 'green' : state === 'rising' ? 'yellow' : 'orange',
  }, { refresh: 30 });

  return refreshingWidget ? headline : `Fed at ${clock(fed)}. ${headline} (about ${span(peak - fed)} at ${Math.round(fahrenheit)}°F).`;
}
