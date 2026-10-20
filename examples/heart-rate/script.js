// Heart rate check: today's range, plus resting heart rate and HRV against a 4-week baseline
//
// Input: three Find Health Samples results from the shortcut, as sections of one line per
// sample: <<<today>>>/<<<todayStart>>> (Heart Rate, last day), <<<resting>>>/<<<restingStart>>>
// (Resting Heart Rate, 35 days) and <<<hrv>>>/<<<hrvStart>>> (Heart Rate Variability, 35 days).
// Also updates the "Heart" widget. GlueJS never reads Health itself.

function sections(text) {
  const result = {};
  for (const part of String(text).split('<<<')) {
    const end = part.indexOf('>>>');
    if (end >= 0) result[part.slice(0, end)] = part.slice(end + 3).replace(/^\n/, '').replace(/\n$/, '').split('\n');
  }
  return result;
}

// Pairs a values section with its start dates: [{ value, start }].
function series(data, name) {
  const values = data[name] ?? [];
  const starts = data[`${name}Start`] ?? [];
  if (values.length !== starts.length) throw new Error(`Mismatched ${name} lists: ${values.length} values, ${starts.length} dates`);
  return values
    .map((v, i) => ({ value: parseFloat(v), start: Date.parse(starts[i]) }))
    .filter((s) => Number.isFinite(s.value) && Number.isFinite(s.start));
}

const RECENT_DAYS = 7;
const now = Date.now();
const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const cutoff = now - RECENT_DAYS * 86_400_000;

const average = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n, digits = 0) => (n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits);
const signed = (n, unit) => `${n > 0 ? '+' : ''}${round(n, 1)} ${unit}`;

// Recent week vs. the four weeks before it.
function trend(samples) {
  return {
    recent: average(samples.filter((s) => s.start >= cutoff).map((s) => s.value)),
    baseline: average(samples.filter((s) => s.start < cutoff).map((s) => s.value)),
  };
}

const data = sections(rawInput);
const today = series(data, 'today').filter((s) => s.start >= startOfToday).map((s) => s.value);
const resting = trend(series(data, 'resting'));
const hrv = trend(series(data, 'hrv'));
console.log(`${today.length} readings today`);

const lines = [];
const items = [];
if (today.length) {
  const avg = round(average(today));
  lines.push(`Today: avg ${avg} bpm (range ${Math.min(...today)}–${Math.max(...today)})`);
  items.push({ label: 'Today avg', value: `${avg} bpm` });
} else {
  lines.push('Today: no heart rate readings yet');
}
if (resting.recent != null) {
  let line = `Resting HR (${RECENT_DAYS}d): ${round(resting.recent, 1)} bpm`;
  if (resting.baseline != null) line += `, ${signed(resting.recent - resting.baseline, 'bpm')} vs 4-week baseline`;
  lines.push(line);
  items.push({ label: 'Resting', value: `${round(resting.recent)} bpm` });
}
if (hrv.recent != null) {
  let line = `HRV (${RECENT_DAYS}d): ${round(hrv.recent)} ms`;
  if (hrv.baseline != null) line += `, ${signed(hrv.recent - hrv.baseline, 'ms')} vs baseline`;
  lines.push(line);
  items.push({ label: 'HRV', value: `${round(hrv.recent)} ms` });
}

if (items.length) Widget.set('Heart', { title: 'Heart', items, tint: 'red' });
return lines.join('\n');
