// Caffeine Cutoff: how much caffeine is still in you, and when it's low enough to sleep
//
// Input: what you just had — a drink name ("latte", "cold brew", "2 espresso", "green tea")
// or an amount ("150 mg"). Logged in Store ("caffeine:log", last 2 days). Caffeine is cleared
// with a half-life of about 5 hours (it varies from person to person; change HALF_LIFE_HOURS).
// Updates the "Caffeine" widget every 30 minutes; refreshes recalculate without logging.

const HALF_LIFE_HOURS = 5;
const SLEEP_FRIENDLY_MG = 50; // a common rule of thumb for bedtime

// Typical caffeine per serving, in mg.
const DRINKS: Record<string, number> = {
  espresso: 64, 'double espresso': 128, coffee: 95, 'drip coffee': 95, 'cold brew': 200,
  latte: 128, cappuccino: 128, americano: 128, 'flat white': 128, mocha: 128, decaf: 3,
  'black tea': 47, tea: 47, 'green tea': 28, matcha: 70, chai: 50,
  cola: 34, coke: 34, 'diet coke': 46, 'red bull': 80, monster: 160, 'energy drink': 160, 'pre-workout': 200,
};

type Dose = { t: number; mg: number; what: string };

function parseDrink(text: string, now: number): Dose | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const mg = /^(\d+(?:\.\d+)?)\s*(mg)?$/.exec(t);
  if (mg) return { t: now, mg: Number(mg[1]), what: `${mg[1]} mg` };
  const m = /^(\d+)\s*x?\s+(.+)$/.exec(t);
  const count = m ? Number(m[1]) : 1;
  const name = (m ? m[2] : t).replace(/s$/, '');
  const per = DRINKS[name] ?? DRINKS[`${name}s`];
  if (per === undefined) {
    throw new Error(`I don't know "${text.trim()}". Try ${Object.keys(DRINKS).slice(0, 8).join(', ')}, or an amount like "150 mg".`);
  }
  return { t: now, mg: per * count, what: count > 1 ? `${count} ${name}s` : name };
}

const remaining = (doses: Dose[], at: number) =>
  doses.reduce((sum, d) => (d.t <= at ? sum + d.mg * 0.5 ** ((at - d.t) / 3_600_000 / HALF_LIFE_HOURS) : sum), 0);

const clock = (ms: number) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${time} tomorrow`;
};

export default function main(): string {
  const now = Date.now();
  const doses = (Store.get<Dose[]>('caffeine:log') ?? []).filter((d) => now - d.t < 48 * 3_600_000);
  const dose = refreshingWidget ? null : parseDrink(String(rawInput ?? ''), now);
  if (dose) doses.push(dose);
  Store.set('caffeine:log', doses);

  const level = remaining(doses, now);
  // Exact time it falls under the threshold: level * 0.5^(h/half-life) = threshold.
  const hours = level > SLEEP_FRIENDLY_MG ? HALF_LIFE_HOURS * Math.log2(level / SLEEP_FRIENDLY_MG) : 0;
  const okAt = now + hours * 3_600_000;
  const today = doses.filter((d) => new Date(d.t).toDateString() === new Date().toDateString());

  Widget.set('Caffeine', {
    title: '☕ Caffeine',
    value: `${Math.round(level)} mg`,
    detail: (hours ? `Sleep-friendly after ${clock(okAt)}` : 'Sleep-friendly now') +
      ` · ${today.reduce((a, d) => a + d.mg, 0)} mg today`,
    tint: hours > 4 ? 'orange' : hours ? 'yellow' : 'green',
  }, { refresh: 30 });

  const logged = dose ? `Logged ${dose.what} (${dose.mg} mg). ` : '';
  return `${logged}You're at about ${Math.round(level)} mg` +
    (hours ? `; under ${SLEEP_FRIENDLY_MG} mg after ${clock(okAt)}.` : ', low enough for sleep.');
}
