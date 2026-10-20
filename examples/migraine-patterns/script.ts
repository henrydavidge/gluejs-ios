// Migraine Patterns: do your migraines line up with barometric pressure drops?
//
// Input: first line is your town; then <<<start>>> with one ISO date per line — the start of
// each Headache logged in Apple Health in the last 90 days (the "Migraine" shortcut logs them
// with one tap; Shortcuts reads them back and passes them in). Returns a plain-text fact sheet:
// the pressure change in the 24 hours before each migraine vs. how pressure usually changes
// where you live, plus time of day and weekday, and the next day's forecast. The shortcut hands
// it to Apple Intelligence's on-device model to write up, so the headache history never leaves
// the phone (only the town goes to Open-Meteo). Not medical advice.

type Episode = { t: number };

const DROP_HPA = 5; // a "big drop": at least this much lower than 24 hours earlier

async function pressure(town: string) {
  const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(town)}`)).json() as
    { results?: { name: string; latitude: number; longitude: number }[] };
  const place = geo.results?.[0];
  if (!place) throw new Error(`Couldn't find a place called "${town}". Change the town in the shortcut.`);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&hourly=pressure_msl&past_days=92&forecast_days=2&timeformat=unixtime';
  const data = await (await fetch(url)).json() as { hourly: { time: number[]; pressure_msl: (number | null)[] } };
  return { place: place.name, times: data.hourly.time.map((s) => s * 1000), hpa: data.hourly.pressure_msl };
}

// Change over the previous 24 hours at hour i, or null when data is missing.
const change24 = (hpa: (number | null)[], i: number) =>
  i >= 24 && hpa[i] != null && hpa[i - 24] != null ? (hpa[i] as number) - (hpa[i - 24] as number) : null;

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : 'n/a');
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} hPa`;

export default async function main(): Promise<string> {
  const text = String(rawInput ?? '');
  const town = text.split('\n')[0].trim() || 'London';
  const starts = /<<<start>>>\n?([\s\S]*)/.exec(text)?.[1] ?? '';
  const log: Episode[] = starts.split('\n').map((line) => ({ t: Date.parse(line.trim()) })).filter((e) => Number.isFinite(e.t));

  const { place, times, hpa } = await pressure(town);
  const now = Date.now();
  const inWindow = log.filter((e) => e.t >= times[24] && e.t <= now);
  const lines = [`Location: ${place}. Migraines logged in Health in the last 3 months: ${inWindow.length}.`];

  // Typical 24-hour changes over the same period, for comparison.
  const past = times.map((t, i) => (t <= now ? change24(hpa, i) : null)).filter((c): c is number => c !== null);
  const bigDropShare = past.filter((c) => c <= -DROP_HPA).length / (past.length || 1);

  if (inWindow.length >= 3) {
    const before = inWindow
      .map((e) => change24(hpa, times.findIndex((t) => t > e.t) - 1))
      .filter((c): c is number => c !== null);
    const drops = before.filter((c) => c <= -DROP_HPA).length;
    const avg = before.reduce((a, b) => a + b, 0) / (before.length || 1);
    lines.push(
      `Pressure change in the 24 hours before a migraine: average ${signed(avg)}; a drop of ${DROP_HPA}+ hPa before ${drops} of ${before.length} (${pct(drops, before.length)}).`,
      `For comparison, drops that big happen ${Math.round(bigDropShare * 100)}% of the time here.`,
      drops / (before.length || 1) > bigDropShare * 1.5 && drops >= 2
        ? 'So migraines followed big pressure drops more often than chance would suggest.'
        : 'So there is no clear link to pressure drops in this data yet.',
    );
    const part = (h: number) => (h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening');
    const count = (keys: string[]) => Object.entries(keys.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}))
      .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
    lines.push(
      `Time of day: ${count(inWindow.map((e) => part(new Date(e.t).getHours())))}.`,
      `Weekday: ${count(inWindow.map((e) => new Date(e.t).toLocaleDateString('en-US', { weekday: 'long' })))}.`,
    );
  } else {
    lines.push('Not enough migraines logged yet to look for patterns; at least 3 are needed.');
  }

  // Heads-up from the forecast: the largest 24-hour drop starting now.
  const nowIndex = times.findIndex((t) => t > now) - 1;
  let worst = 0, worstAt = now;
  for (let i = nowIndex + 1; i < times.length && i <= nowIndex + 30; i++) {
    const c = change24(hpa, i);
    if (c !== null && c < worst) { worst = c; worstAt = times[i]; }
  }
  lines.push(worst <= -DROP_HPA
    ? `Forecast: pressure is expected to fall ${signed(worst)} over the 24 hours to ${new Date(worstAt).toLocaleString('en-US', { weekday: 'long', hour: 'numeric' })}.`
    : 'Forecast: no big pressure drop expected in the next day.');
  return lines.join('\n');
}
