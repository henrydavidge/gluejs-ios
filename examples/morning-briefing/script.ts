// Morning Briefing: today's calendar plus the weather, for Apple Intelligence to turn into a plan
//
// Input: sections from Shortcuts, one line per item: Get Upcoming Events' <<<title>>>,
// <<<start>>> (ISO dates) and <<<allDay>>> (Yes/No); Apple Weather's daily <<<high>>>, <<<low>>>,
// <<<condition>>>; and its hourly <<<hour>>> (ISO dates) and <<<rain>>> (precipitation chance).
// Makes no network requests. Returns a short fact sheet; the shortcut's Use Model
// action (on-device by default) writes the briefing, so the calendar never leaves the phone.
// Updates the "Today" widget. Note: Apple's Shortcuts Gallery has a similar "Morning Report";
// this one is mainly a reference for reading Calendar and handing results to Use Model.

type Sections = Record<string, string[]>;

function sections(text: string): Sections {
  const result: Sections = {};
  for (const part of text.split('<<<')) {
    const end = part.indexOf('>>>');
    if (end >= 0) result[part.slice(0, end)] = part.slice(end + 3).replace(/^\n/, '').replace(/\n+$/, '').split('\n');
  }
  return result;
}

interface Event { title: string; start: Date; allDay: boolean }

function todaysEvents(data: Sections): Event[] {
  const titles = data.title ?? [], starts = data.start ?? [], allDay = data.allDay ?? [];
  if (titles.length !== starts.length || titles.length !== allDay.length) {
    throw new Error(`Mismatched event lists: ${titles.length} titles, ${starts.length} dates, ${allDay.length} all-day flags`);
  }
  const today = new Date().toDateString();
  return titles
    .map((title, i) => ({ title, start: new Date(starts[i]), allDay: allDay[i] === 'Yes' }))
    .filter((e) => e.title && e.start.toDateString() === today);
}

const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '');

function weather(data: Sections) {
  const high = data.high?.[0] ?? '', low = data.low?.[0] ?? '';
  const today = new Date().toDateString();
  const wet = (data.hour ?? []).map((h, i) => ({ t: Date.parse(h), rain: parseFloat(data.rain?.[i] ?? '') || 0 }))
    .find((h) => new Date(h.t).toDateString() === today && h.t >= Date.now() - 3_600_000 && h.rain >= 50);
  const condition = (data.condition?.[0] ?? '').toLowerCase();
  return {
    summary: `${low}–${high}${condition ? `, ${condition}` : ''}` +
      (wet ? `, rain likely from ${new Date(wet.t).toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '').toLowerCase()}` : ''),
    rainy: Boolean(wet),
  };
}


export default function main(): string {
  const text = String(rawInput ?? '');
  const events = todaysEvents(sections(text));
  const agenda = events.length
    ? events.map((e) => `${e.allDay ? 'All day' : clock(e.start)}: ${e.title}`).join('\n')
    : 'Nothing scheduled';
  const forecast = weather(sections(text));
  console.log(`${events.length} events today; ${forecast.summary}`);

  const facts = `It is ${new Date().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}.\n` +
    `Today's calendar:\n${agenda}\nWeather: ${forecast.summary}.`;

  Widget.set('Today', {
    title: `${forecast.rainy ? '☔' : '☀️'} ${forecast.summary}`.slice(0, 60),
    items: events.length
      ? events.slice(0, 5).map((e) => ({ label: e.title.slice(0, 60), value: e.allDay ? 'All day' : clock(e.start) }))
      : ['Nothing scheduled'],
    detail: `${events.length ? `${events.length} thing${events.length === 1 ? '' : 's'} today` : 'A free day'}${forecast.rainy ? ' · bring an umbrella' : ''}`,
    tint: forecast.rainy ? 'blue' : 'orange',
  });
  return facts;
}
