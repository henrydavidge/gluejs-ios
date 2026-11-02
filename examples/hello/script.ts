// Hello GlueJS: greets you, counts your runs and shows them on a widget
//
// Input: a name (asked by the shortcut). Saves a run count in Store ("hello:runs") and publishes
// a "Hello" widget, so one run shows the three things GlueJS adds to Shortcuts: JavaScript,
// values that persist between runs, and Home Screen widgets.

const name = typeof input === 'string' && input.trim() ? input.trim() : 'there';
const runs = (Store.get<number>('hello:runs') ?? 0) + 1;
Store.set('hello:runs', runs);

const hour = new Date().getHours();
const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

Widget.set('Hello', {
  title: '👋 Hello GlueJS',
  value: name,
  detail: `Run ${runs} · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
  tint: 'purple',
});

return `${greeting}, ${name}! This shortcut has run ${runs} time${runs === 1 ? '' : 's'}. Add the GlueJS widget to your Home Screen to see it there.`;
