// Last night's sleep: stages, wake-ups and how it compares to your recent average
//
// Input: the shortcut's Find Health Samples (Sleep, last 9 days) results, as sections of
// one line per sample: <<<value>>> stage names, <<<start>>> and <<<end>>> ISO dates,
// <<<source>>> source names (Shortcuts leaves these empty for sleep). Also updates the
// "Sleep" widget.
//
// GlueJS never reads Health itself: Shortcuts asks for Sleep access and passes the samples in.

function sections(text) {
  const result = {};
  for (const part of String(text).split('<<<')) {
    const end = part.indexOf('>>>');
    if (end >= 0) result[part.slice(0, end)] = part.slice(end + 3).replace(/^\n/, '').replace(/\n$/, '').split('\n');
  }
  return result;
}

const STAGE = { 'In Bed': 'inBed', 'Core': 'core', 'Deep': 'deep', 'REM': 'rem', 'Awake': 'awake', 'Asleep': 'asleep', 'Asleep Unspecified': 'asleep' };
const data = sections(rawInput);
if (!data.value || !data.start || !data.end) throw new Error('Expected <<<value>>>, <<<start>>> and <<<end>>> sections from the shortcut.');
if (data.start.length !== data.value.length || data.end.length !== data.value.length) {
  throw new Error(`Mismatched lists: ${data.value.length} values, ${data.start.length} starts, ${data.end.length} ends`);
}
const samples = data.value.filter((v) => v !== '').map((value, i) => ({
  stage: STAGE[value] ?? value,
  start: data.start[i],
  end: data.end[i],
  minutes: (Date.parse(data.end[i]) - Date.parse(data.start[i])) / 60_000,
  source: data.source?.[i] || 'unknown source',
}));

const nightsToAverage = 7;
const ASLEEP = new Set(['core', 'deep', 'rem', 'asleep']);

// A sample belongs to the night that started on the calendar day 12 hours before it.
function nightKey(sample) {
  const shifted = new Date(new Date(sample.start).getTime() - 12 * 3_600_000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
}

// Total minutes covered by possibly-overlapping intervals.
function coveredMinutes(samples) {
  const intervals = samples
    .map((s) => [new Date(s.start).getTime(), new Date(s.end).getTime()])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = intervals[0] ?? [0, 0];
  for (const [start, end] of intervals.slice(1)) {
    if (start > curEnd) {
      total += curEnd - curStart;
      [curStart, curEnd] = [start, end];
    } else {
      curEnd = Math.max(curEnd, end);
    }
  }
  return (total + (curEnd - curStart)) / 60_000;
}

function summarize(samples) {
  // Use a single source so the Watch and phone don't double count. Prefer one that records
  // stages (core/deep/rem); the iPhone alone only knows "asleep".
  const score = {};
  for (const s of samples) {
    if (!ASLEEP.has(s.stage)) continue;
    score[s.source] = (score[s.source] ?? 0) + (s.stage === 'asleep' ? 0 : 100_000) + s.minutes;
  }
  const source = Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!source) return null;
  const mine = samples.filter((s) => s.source === source);
  const stage = (name) => coveredMinutes(mine.filter((s) => s.stage === name));
  const asleepSamples = mine.filter((s) => ASLEEP.has(s.stage));
  const awakeSamples = mine.filter((s) => s.stage === 'awake');
  return {
    source,
    asleep: coveredMinutes(asleepSamples),
    deep: stage('deep'),
    rem: stage('rem'),
    core: stage('core'),
    awake: coveredMinutes(awakeSamples),
    awakenings: awakeSamples.length,
    fellAsleep: new Date(Math.min(...asleepSamples.map((s) => new Date(s.start).getTime()))),
    wokeUp: new Date(Math.max(...asleepSamples.map((s) => new Date(s.end).getTime()))),
  };
}

const hm = (minutes) => {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};
const clock = (date) => {
  const h = date.getHours();
  return `${h % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

console.log(`${samples.length} sleep samples from ${[...new Set(samples.map((s) => s.source))].join(', ') || 'no sources'}`);

const nights = {};
for (const s of samples) (nights[nightKey(s)] ??= []).push(s);
const keys = Object.keys(nights).sort();
const lastKey = keys.at(-1);
const last = lastKey && summarize(nights[lastKey]);
if (!last) return 'No sleep data found for last night.';

const previous = keys.slice(0, -1).slice(-nightsToAverage).map((k) => summarize(nights[k])).filter(Boolean);
const avgAsleep = previous.length ? previous.reduce((a, n) => a + n.asleep, 0) / previous.length : null;

const pct = (m) => `${Math.round((m / last.asleep) * 100)}%`;
const lines = [
  `Last night: ${hm(last.asleep)} asleep (${clock(last.fellAsleep)} → ${clock(last.wokeUp)})`,
  `Deep ${hm(last.deep)} (${pct(last.deep)}) · REM ${hm(last.rem)} (${pct(last.rem)}) · Core ${hm(last.core)}`,
  `Awake ${Math.round(last.awake)} min across ${last.awakenings} wake-up${last.awakenings === 1 ? '' : 's'}`,
];
if (avgAsleep != null) {
  const diff = last.asleep - avgAsleep;
  lines.push(`${previous.length}-night average: ${hm(avgAsleep)} (${diff >= 0 ? '+' : '−'}${hm(Math.abs(diff))})`);
}
Widget.set('Sleep', {
  title: 'Last night',
  value: hm(last.asleep),
  detail: `Deep ${hm(last.deep)} · REM ${hm(last.rem)} · ${clock(last.fellAsleep)}–${clock(last.wokeUp)}`,
  tint: 'indigo',
});
return lines.join('\n');
