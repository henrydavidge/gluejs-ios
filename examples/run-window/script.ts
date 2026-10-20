// Run Window: the best free hour to run today, from your calendar, Apple Weather and your week
//
// Input: sections from Shortcuts, one line per item:
//   <<<title>>>, <<<start>>>, <<<end>>>, <<<allDay>>>  Get Upcoming Events
//   <<<hour>>>, <<<temp>>>, <<<rain>>>                 Get Weather Forecast (hourly): Date (ISO),
//                                                      Temperature ("21°C"/"70°F"), Precipitation Chance
//   <<<sunrise>>>, <<<sunset>>>                        Get Weather Forecast (daily), ISO dates
//   <<<distance>>>, <<<distanceStart>>>                Walking + Running Distance, last 7 days
// Picks the daylight hour between now and 9 PM that's free in your calendar, with the lowest
// chance of rain and a temperature closest to 55°F (13°C), and shows it on the "Run" widget
// with your distance so far this week. Makes no network requests.

type Sections = Record<string, string[]>;

function sections(text: string): Sections {
  const result: Sections = {};
  for (const part of text.split('<<<')) {
    const end = part.indexOf('>>>');
    if (end >= 0) result[part.slice(0, end)] = part.slice(end + 3).replace(/^\n/, '').replace(/\n+$/, '').split('\n');
  }
  return result;
}

const IDEAL_C = 13;
const LATEST_HOUR = 21;
const HOUR = 3_600_000;

function sameLength(data: Sections, keys: string[]) {
  const n = data[keys[0]]?.length ?? 0;
  for (const key of keys) {
    if ((data[key]?.length ?? 0) !== n) throw new Error(`Mismatched lists: ${n} ${keys[0]}, ${data[key]?.length ?? 0} ${key}`);
  }
  return n;
}

// "21°C" or "70°F" → °C. Returns NaN for anything else.
function celsius(text: string): number {
  const m = /(-?[\d.,]+)\s*°?\s*([CF])/i.exec(text);
  if (!m) return NaN;
  const value = parseFloat(m[1].replace(',', '.'));
  return m[2].toUpperCase() === 'F' ? (value - 32) * 5 / 9 : value;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '').toLowerCase();

export default function main(): string {
  const data = sections(String(rawInput ?? ''));
  const events = sameLength(data, ['title', 'start', 'end', 'allDay']);
  const busy = Array.from({ length: events }, (_, i) => ({ from: Date.parse(data.start[i]), to: Date.parse(data.end[i]), allDay: data.allDay[i] === 'Yes' }))
    .filter((e) => !e.allDay && Number.isFinite(e.from) && Number.isFinite(e.to));
  const hours = sameLength(data, ['hour', 'temp', 'rain']);
  if (!hours) throw new Error('No hourly forecast from Apple Weather. Is Location allowed for Shortcuts?');
  const imperial = /°F/.test(data.temp[0]);

  // Daylight today, from the daily forecast's first day.
  const sunrise = Date.parse(data.sunrise?.[0] ?? '');
  const sunset = Date.parse(data.sunset?.[0] ?? '');
  const isLight = (t: number) => !Number.isFinite(sunrise) || (t >= sunrise && t + HOUR <= sunset + 30 * 60_000);

  // This week's running distance (Monday to now), in the unit Health reports (km or mi).
  const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const distance = (data.distance ?? []).reduce((sum, v, i) =>
    Date.parse(data.distanceStart?.[i] ?? '') >= monday.getTime() ? sum + (parseFloat(v) || 0) : sum, 0);

  const now = Date.now();
  const options = Array.from({ length: hours }, (_, i) => ({
    from: Date.parse(data.hour[i]), temp: celsius(data.temp[i]), rain: parseFloat(data.rain[i]) || 0,
  })).map((h) => ({ ...h, to: h.from + HOUR }))
    .filter((h) => Number.isFinite(h.from) && Number.isFinite(h.temp))
    .filter((h) => h.from >= now - 15 * 60_000 && new Date(h.from).toDateString() === new Date().toDateString())
    .filter((h) => new Date(h.from).getHours() < LATEST_HOUR && isLight(h.from))
    .filter((h) => !busy.some((b) => b.from < h.to && b.to > h.from));
  console.log(`${busy.length} busy blocks, ${options.length} free daylight hours, ${distance.toFixed(1)} this week`);

  const deg = (c: number) => (imperial ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`);
  const week = `${distance.toFixed(1)} ${imperial ? 'mi' : 'km'} this week`;
  if (!options.length) {
    Widget.set('Run', { title: '🏃 Run', value: 'No window today', detail: `Busy or dark for the rest of today · ${week}`, tint: 'gray' });
    return `No free daylight hour left today. ${week}.`;
  }
  // Rain matters more than temperature: 10% rain costs as much as 1°C away from ideal.
  const best = options.reduce((a, b) =>
    (b.rain * 0.1 + Math.abs(b.temp - IDEAL_C)) < (a.rain * 0.1 + Math.abs(a.temp - IDEAL_C)) ? b : a);
  const why = `${deg(best.temp)}, ${best.rain}% rain`;
  Widget.set('Run', {
    title: '🏃 Best time to run',
    value: `${clock(best.from)}–${clock(best.to)}`,
    detail: `${why} · ${week}`,
    tint: best.rain >= 40 ? 'blue' : 'green',
  });
  return `Best time to run: ${clock(best.from)}–${clock(best.to)} (${why}). You're free then. ${week}.`;
}
