// Did It: log a habit for today and keep a streak widget
//
// Input: the habit's name, e.g. "Workout" or "Read 20 pages" (default "Habit").
// Saves the days you logged in Store ("habit:<name>") and publishes a widget with the same
// name showing the current streak. Running it twice in one day counts once.
// Run it from a Home Screen icon, Back Tap, the Action button or an NFC tag.

const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function daysBefore(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return day(new Date(y, m - 1, d - n));
}

// Longest run of consecutive days in `days` that ends on `end`.
function runEndingOn(days: Set<string>, end: string): number {
  let count = 0;
  while (days.has(daysBefore(end, count))) count++;
  return count;
}

export default function main(input: unknown): string {
  const habit = (typeof input === 'string' && input.trim() ? input.trim() : 'Habit')
    .replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Habit';
  const key = `habit:${habit}`;
  const today = day(new Date());

  const logged = new Set(Store.get<string[]>(key) ?? []);
  const already = logged.has(today);
  logged.add(today);
  const sorted = [...logged].sort().slice(-400); // about a year is plenty
  Store.set(key, sorted);

  const days = new Set(sorted);
  const streak = runEndingOn(days, today);
  const best = Math.max(...sorted.map((d) => runEndingOn(days, d)));
  const lastWeek = Array.from({ length: 7 }, (_, i) => daysBefore(today, i)).filter((d) => days.has(d)).length;

  Widget.set(habit, {
    title: habit,
    value: `🔥 ${streak} ${streak === 1 ? 'day' : 'days'}`,
    detail: `Best ${best} · ${lastWeek} of the last 7 days`,
    tint: streak >= 7 ? 'orange' : 'yellow',
  });

  if (already) return `${habit} is already logged today. Streak: ${streak}.`;
  if (streak === 1) return best > 1 ? `${habit}: day 1 of a new streak. Your best is ${best}.` : `${habit}: day 1. See you tomorrow!`;
  if (streak === best) return `${habit}: ${streak} days in a row, your best yet! 🎉`;
  return `${habit}: ${streak} days in a row. Best: ${best}.`;
}
