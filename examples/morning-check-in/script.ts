// Morning Check-In: how recovered are you today, compared with your own normal?
//
// Input: sections from the shortcut's Find Health Samples actions, one line per sample:
//   <<<resting>>>/<<<restingStart>>>  Resting Heart Rate, last 21 days (value, ISO start date)
//   <<<hrv>>>/<<<hrvStart>>>          Heart Rate Variability, last 14 days
//   <<<sleep>>>/<<<sleepStart>>>/<<<sleepEnd>>>  Sleep stages since yesterday
// Looks at last night's sleep and this morning's resting heart rate and HRV against your
// median over the previous days, then updates the "Check-In" widget.
// GlueJS never reads Health itself: Shortcuts asks for access and passes the samples in.
// This is a wellness summary, not medical advice.

type Sections = Record<string, string[]>;

function sections(text: string): Sections {
  const result: Sections = {};
  for (const part of text.split('<<<')) {
    const end = part.indexOf('>>>');
    if (end >= 0) result[part.slice(0, end)] = part.slice(end + 3).replace(/^\n/, '').replace(/\n+$/, '').split('\n');
  }
  return result;
}

interface Reading { value: number; start: number }

function readings(data: Sections, name: string): Reading[] {
  const values = data[name] ?? [];
  const starts = data[`${name}Start`] ?? [];
  if (values.length !== starts.length) throw new Error(`Mismatched ${name} lists: ${values.length} values, ${starts.length} dates`);
  return values
    .map((v, i) => ({ value: parseFloat(v), start: Date.parse(starts[i]) }))
    .filter((r) => Number.isFinite(r.value) && Number.isFinite(r.start));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const DAY = 86_400_000;

// The last 24 hours vs. the median of the daily averages before that.
function compare(samples: Reading[]) {
  const cutoff = Date.now() - DAY;
  const today = average(samples.filter((r) => r.start >= cutoff).map((r) => r.value));
  const byDay: Record<string, number[]> = {};
  for (const r of samples.filter((r) => r.start < cutoff)) (byDay[new Date(r.start).toDateString()] ??= []).push(r.value);
  const usual = median(Object.values(byDay).map((xs) => average(xs)!));
  return { today, usual, days: Object.keys(byDay).length };
}

// Minutes asleep, merging overlapping stage samples (Watch and iPhone can both record sleep).
function minutesAsleep(data: Sections): number | null {
  const stages = data.sleep ?? [];
  const intervals = stages
    .map((stage, i) => ({ stage, start: Date.parse(data.sleepStart?.[i] ?? ''), end: Date.parse(data.sleepEnd?.[i] ?? '') }))
    .filter((s) => /^(Core|Deep|REM|Asleep)/.test(s.stage) && s.end > s.start && s.end > Date.now() - 18 * 3_600_000)
    .sort((a, b) => a.start - b.start);
  if (!intervals.length) return null;
  let total = 0;
  let [from, to] = [intervals[0].start, intervals[0].end];
  for (const s of intervals.slice(1)) {
    if (s.start > to) { total += to - from; [from, to] = [s.start, s.end]; } else to = Math.max(to, s.end);
  }
  return (total + to - from) / 60_000;
}

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;

export default function main(): string {
  const data = sections(String(rawInput ?? ''));
  const resting = compare(readings(data, 'resting'));
  const hrv = compare(readings(data, 'hrv'));
  const asleep = minutesAsleep(data);
  console.log(`resting ${JSON.stringify(resting)} hrv ${JSON.stringify(hrv)} sleep ${asleep}`);

  // Each signal scores 2 (as usual or better), 1 (a little off) or 0 (well off).
  const signals: { label: string; value: string; score: number; note?: string }[] = [];
  if (asleep != null) {
    const score = asleep >= 7 * 60 ? 2 : asleep >= 6 * 60 ? 1 : 0;
    signals.push({ label: 'Sleep', value: hm(asleep), score, note: score < 2 ? `you slept ${hm(asleep)}` : undefined });
  }
  if (resting.today != null && resting.usual != null && resting.days >= 5) {
    const diff = Math.round(resting.today - resting.usual);
    const score = diff >= 5 ? 0 : diff >= 3 ? 1 : 2;
    signals.push({
      label: 'Resting heart rate', value: `${Math.round(resting.today)} bpm (${diff > 0 ? '+' : ''}${diff})`, score,
      note: score < 2 ? `your resting heart rate is ${diff} bpm above your usual` : undefined,
    });
  }
  if (hrv.today != null && hrv.usual != null && hrv.days >= 5) {
    const change = Math.round((hrv.today / hrv.usual - 1) * 100);
    const score = change <= -20 ? 0 : change <= -10 ? 1 : 2;
    signals.push({
      label: 'HRV', value: `${Math.round(hrv.today)} ms (${change > 0 ? '+' : ''}${change}%)`, score,
      note: score < 2 ? `your HRV is ${-change}% below your usual` : undefined,
    });
  }
  if (!signals.length) return 'Not enough Health data yet. Wear your Apple Watch to sleep for a few nights.';

  const ratio = signals.reduce((a, s) => a + s.score, 0) / (2 * signals.length);
  const verdict = ratio >= 0.8 ? { title: 'Ready to go', emoji: '💪', tint: 'green' as const }
    : ratio >= 0.5 ? { title: 'Steady', emoji: '🙂', tint: 'yellow' as const }
    : { title: 'Take it easy', emoji: '🛋️', tint: 'orange' as const };

  Widget.set('Check-In', {
    title: `${verdict.emoji} ${verdict.title}`,
    items: signals.map((s) => ({ label: s.label, value: s.value })),
    tint: verdict.tint,
  });

  const notes = signals.map((s) => s.note).filter(Boolean);
  if (!notes.length) return `${verdict.emoji} ${verdict.title}. Sleep, resting heart rate and HRV all look like your normal.`;
  const reasons = (notes.length > 1 ? `${notes.slice(0, -1).join(', ')} and ${notes.at(-1)}` : notes[0]!).replace(/^./, (c) => c.toUpperCase());
  return `${verdict.emoji} ${verdict.title}. ${reasons}.` +
    (ratio < 0.5 ? ' That often follows a hard workout, stress, alcohol or a cold coming on — a lighter day may help.' : '');
}
