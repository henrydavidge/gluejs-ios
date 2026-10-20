import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import github from '../examples/github/script.js';
import weather from '../examples/weather/script.js';

async function withFetch(fetch, work) {
  const originalFetch = globalThis.fetch;
  const originalSecrets = globalThis.Secrets;
  const originalWidget = globalThis.Widget;
  globalThis.fetch = fetch;
  globalThis.Secrets = { has: () => false };
  globalThis.Widget = { set: () => {} };
  try { return await work(); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalSecrets === undefined) delete globalThis.Secrets;
    else globalThis.Secrets = originalSecrets;
    if (originalWidget === undefined) delete globalThis.Widget;
    else globalThis.Widget = originalWidget;
  }
}

test('GitHub example labels issue counts as an upper bound for a full PR page', async () => {
  const report = await withFetch(async (input) => {
    const url = String(input);
    if (url.endsWith('/releases/latest')) return Response.json({message:'Not Found'}, {status:404});
    if (url.includes('/pulls')) return Response.json(Array.from({length:100}, () => ({})));
    return Response.json({ full_name:'example/repo', stargazers_count:1, forks_count:2,
      open_issues_count:250, pushed_at:'2026-10-01T00:00:00Z' });
  }, () => github('example/repo'));
  assert.match(report, /at most 150 issues, 100\+ pull requests/);
  await assert.rejects(() => github('owner/repo/extra'), /owner\/repo/);
});

function weatherFetch(hourly) {
  return async input => {
    if (String(input).includes('geocoding-api')) return Response.json({results:[{
      name:'Test City', latitude:1, longitude:2, timezone:'UTC',
    }]});
    return Response.json({current:{time:'2026-10-12T12:00', temperature_2m:20}, hourly,
      daily:{temperature_2m_max:[22,23], temperature_2m_min:[12,13], precipitation_sum:[0,0]},
    });
  };
}

test('weather example handles missing upcoming hours without stale data or a crash', async () => {
  const report = await withFetch(weatherFetch({time:[], temperature_2m:[], precipitation_probability:[]}), () => weather('Test City'));
  assert.match(report, /No upcoming hourly forecast/);
});

test('weather example does not report missing rain probabilities as zero', async () => {
  const report = await withFetch(weatherFetch({time:['2026-10-12T12:00'], temperature_2m:[20], precipitation_probability:[null]}), () => weather('Test City'));
  assert.match(report, /Rain probability is unavailable/);
  assert.doesNotMatch(report, /No umbrella needed/);
});

// Plain (non-module) scripts run as the body of an async function, like in the app.
async function runPlain(path, rawInput) {
  const widgets = {};
  const Widget = { set: (name, content, options) => { widgets[name] = { content, options }; } };
  const AsyncFunction = (async () => {}).constructor;
  const fn = new AsyncFunction('input', 'rawInput', 'Widget', 'console', readFileSync(new URL(path, import.meta.url), 'utf8'));
  const output = await fn(rawInput, rawInput, Widget, { log() {} });
  return { output, widgets };
}

const iso = (date) => new Date(date).toISOString();
const at = (daysAgo, hours, minutes = 0) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysAgo); d.setHours(hours, minutes);
  return d.getTime();
};

test('sleep example summarizes Shortcuts samples and publishes the Sleep widget', async () => {
  const night = (daysAgo) => [
    ['In Bed', at(daysAgo + 1, 23), at(daysAgo, 7)],
    ['Core', at(daysAgo + 1, 23, 10), at(daysAgo, 1)],
    ['Deep', at(daysAgo, 1), at(daysAgo, 2)],
    ['Awake', at(daysAgo, 2), at(daysAgo, 2, 5)],
    ['REM', at(daysAgo, 2, 5), at(daysAgo, 6, 50)],
  ];
  const samples = [...night(1), ...night(0)];
  const text = `<<<value>>>\n${samples.map((s) => s[0]).join('\n')}\n<<<start>>>\n${samples.map((s) => iso(s[1])).join('\n')}\n<<<end>>>\n${samples.map((s) => iso(s[2])).join('\n')}\n<<<source>>>\n\n`;
  const { output, widgets } = await runPlain('../examples/sleep/script.js', text);
  assert.match(output, /Last night: 7h 35m asleep/);
  assert.match(output, /Deep 1h 00m/);
  assert.match(output, /1-night average: 7h 35m/);
  assert.equal(widgets.Sleep.content.value, '7h 35m');
  assert.equal(widgets.Sleep.options, undefined);
});

test('heart rate example compares recent resting HR and HRV with the baseline', async () => {
  const lines = (values) => values.join('\n');
  // Days 6-8 are left out so no sample sits near the 7-day boundary.
  const days = Array.from({ length: 35 }, (_, d) => d).filter((d) => d < 6 || d > 8);
  const resting = days.map((d) => ({ v: d < 6 ? 60 : 55, t: at(d, 12) }));
  const hrv = days.map((d) => ({ v: d < 6 ? 40 : 50, t: at(d, 12) }));
  const today = [{ v: 58, t: at(0, 0, 10) }, { v: 90, t: at(0, 0, 20) }];
  const section = (name, rows) => `<<<${name}>>>\n${lines(rows.map((r) => r.v))}\n<<<${name}Start>>>\n${lines(rows.map((r) => iso(r.t)))}\n`;
  const { output, widgets } = await runPlain('../examples/heart-rate/script.js',
    section('today', today) + section('resting', resting) + section('hrv', hrv));
  assert.match(output, /Today: avg 74 bpm \(range 58–90\)/);
  assert.match(output, /Resting HR \(7d\): 60 bpm, \+5 bpm vs 4-week baseline/);
  assert.match(output, /HRV \(7d\): 40 ms, -10 ms vs baseline/);
  assert.deepEqual(widgets.Heart.content.items.map((i) => i.label), ['Today avg', 'Resting', 'HRV']);
});
