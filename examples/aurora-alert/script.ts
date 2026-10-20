// Aurora Alert: tells you when the northern (or southern) lights might be visible from where
// you are AND it's dark AND the sky is clear enough — at most once a night.
//
// Input: your town or city (set in the shortcut). Data, all free and keyless:
//   NOAA SWPC OVATION model: chance of aurora for every 1° of the globe, ~30–90 min ahead
//   NOAA SWPC Kp forecast: geomagnetic activity for the next 3 days
//   Open-Meteo: cloud cover and daylight for your location
// Returns '' when there's nothing to see, so the shortcut's notification only shows on good
// nights (it uses "when"). Run it every hour or so in the evening from automations.
// Updates the "Aurora" widget every hour.

const VISIBLE_FROM_DEGREES = 8; // aurora this far toward the pole can be seen low on the horizon
const ALERT_CHANCE = 10; // percent

type Place = { name: string; latitude: number; longitude: number; timezone: string };

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

// Highest OVATION chance between you and VISIBLE_FROM_DEGREES toward the pole, within ±6° of longitude.
function chanceNearby(grid: [number, number, number][], place: Place): number {
  const lon = (Math.round(place.longitude) + 360) % 360;
  const poleward = Math.sign(place.latitude) || 1;
  let best = 0;
  for (const [gLon, gLat, chance] of grid) {
    const dLon = Math.min(Math.abs(gLon - lon), 360 - Math.abs(gLon - lon));
    const dLat = (gLat - place.latitude) * poleward;
    if (dLon <= 6 && dLat >= -1 && dLat <= VISIBLE_FROM_DEGREES) best = Math.max(best, chance);
  }
  return best;
}

const kpLabel = (kp: number) => (kp >= 7 ? 'strong storm' : kp >= 5 ? 'storm' : kp >= 4 ? 'active' : 'quiet');

export default async function main(): Promise<string> {
  const city = String(rawInput ?? '').trim() || 'Fairbanks';
  const geo = await json<{ results?: Place[] }>(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`);
  const place = geo.results?.[0];
  if (!place) throw new Error(`Couldn't find a place called "${city}". Change the city in the shortcut.`);

  const [ovation, kpRows, weather] = await Promise.all([
    json<{ coordinates: [number, number, number][]; 'Forecast Time': string }>('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json'),
    json<{ time_tag: string; kp: number; observed: string }[]>('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json'),
    json<{ current: { cloud_cover: number; is_day: number }; hourly: { time: string[]; cloud_cover: number[]; is_day: number[] } }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=cloud_cover,is_day&hourly=cloud_cover,is_day&forecast_hours=12&timezone=auto`),
  ]);

  const chance = chanceNearby(ovation.coordinates, place);
  const now = Date.now();
  const tonight = kpRows.filter((r) => { const t = Date.parse(`${r.time_tag}Z`); return t >= now - 3 * 3_600_000 && t <= now + 12 * 3_600_000; });
  const peakKp = Math.max(0, ...tonight.map((r) => r.kp));
  const dark = weather.current.is_day === 0;
  const clouds = weather.current.cloud_cover;
  const darkHours = weather.hourly.cloud_cover.filter((_, i) => weather.hourly.is_day[i] === 0);
  const clearest = darkHours.length ? Math.min(...darkHours) : null;
  console.log(`${place.name}: ${chance}% nearby, Kp ${peakKp}, clouds ${clouds}%, dark ${dark}`);

  const good = chance >= ALERT_CHANCE && dark && clouds < 50;
  Widget.set('Aurora', {
    title: `🌌 ${place.name}`.slice(0, 60),
    value: `${chance}% chance`,
    detail: `Kp ${peakKp.toFixed(1)} tonight (${kpLabel(peakKp)}) · ${clouds}% clouds` +
      (dark ? '' : clearest !== null ? ` now, ${clearest}% at best after dark` : ''),
    tint: good ? 'green' : chance >= ALERT_CHANCE ? 'teal' : 'indigo',
  }, { refresh: 60 });

  if (!good || refreshingWidget) return '';
  const night = new Date(now - 12 * 3_600_000).toDateString(); // one alert per night, across midnight
  if (Store.get<string>('aurora:alerted') === night) return '';
  Store.set('aurora:alerted', night);
  return `🌌 Aurora possible now: ${chance}% chance ${Math.sign(place.latitude) >= 0 ? 'to the north' : 'to the south'}, ` +
    `Kp ${peakKp.toFixed(1)}, ${clouds}% cloud cover. Get away from city lights and look toward the horizon.`;
}
