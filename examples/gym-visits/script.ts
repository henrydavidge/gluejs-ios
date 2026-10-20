// Gym Visits: what each gym visit actually costs you this month
//
// Run by a location automation: Shortcuts › Automation › + › Arrive › your gym › Run Immediately.
// Input: your monthly membership price (set in the shortcut), e.g. "45" or "€39.90".
// Each run logs a visit in Store ("gym:visits"); arriving twice within 3 hours counts once
// (GPS can trigger "arrive" more than once). Updates the "Gym" widget.

export default function main(): string {
  const text = String(rawInput ?? '').trim();
  const price = parseFloat(text.replace(/[^\d.,]/g, '').replace(',', '.'));
  if (!Number.isFinite(price) || price <= 0) throw new Error('Put your monthly membership price in the shortcut, like 45.');
  const symbol = /[^\d.,\s]/.exec(text)?.[0] ?? '$';
  const money = (n: number) => `${symbol}${n.toFixed(2)}`;

  const now = Date.now();
  const visits = Store.get<number[]>('gym:visits') ?? [];
  const duplicate = visits.length > 0 && now - visits[visits.length - 1] < 3 * 3_600_000;
  if (!duplicate) visits.push(now);
  Store.set('gym:visits', visits.slice(-400));

  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const lastMonth = new Date(month); lastMonth.setMonth(month.getMonth() - 1);
  const thisMonth = visits.filter((t) => t >= month.getTime()).length;
  const previous = visits.filter((t) => t >= lastMonth.getTime() && t < month.getTime()).length;
  const perVisit = price / Math.max(thisMonth, 1);

  Widget.set('Gym', {
    title: '🏋️ Gym this month',
    value: `${thisMonth} visit${thisMonth === 1 ? '' : 's'}`,
    detail: `${money(perVisit)} per visit` + (previous ? ` · last month ${previous} (${money(price / previous)} each)` : ''),
    tint: perVisit <= 10 ? 'green' : perVisit <= 20 ? 'yellow' : 'orange',
  });

  if (duplicate) return '';
  const next = price / (thisMonth + 1);
  return `Visit ${thisMonth} this month: ${money(perVisit)} each so far. One more brings it to ${money(next)}.`;
}
