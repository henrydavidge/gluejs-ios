// Umbrella check: the next 12 hours for a city, using date-fns and zod from npm
//
// Input: a city name (default "San Francisco"). Uses Open-Meteo, which needs no API key.
// Publishes the "Weather" widget, which re-runs this script for the same city every hour.

import { format, parseISO } from 'date-fns';
import { z } from 'zod';

const GeoResults = z.object({
  results: z.array(z.object({
    name: z.string(),
    admin1: z.string().optional(),
    country: z.string().optional(),
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string(),
  })).optional(),
});

const Forecast = z.object({
  current: z.object({ time: z.string(), temperature_2m: z.number() }),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number()),
    precipitation_probability: z.array(z.number().nullable()),
  }),
  daily: z.object({
    temperature_2m_max: z.array(z.number()).min(2),
    temperature_2m_min: z.array(z.number()).min(2),
    precipitation_sum: z.array(z.number()).min(2),
  }),
});

async function getJSON(url, schema) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.hostname} returned HTTP ${response.status}`);
  return schema.parse(await response.json());
}

export default async function main(input) {
  const city = (typeof input === 'string' && input.trim()) || input?.city || 'San Francisco';
  const imperial = navigator.language === 'en-US';

  const geoURL = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geoURL.search = new URLSearchParams({ name: city, count: '1', language: 'en' });
  const place = (await getJSON(geoURL, GeoResults)).results?.[0];
  if (!place) return `Couldn't find a place called "${city}".`;

  const forecastURL = new URL('https://api.open-meteo.com/v1/forecast');
  forecastURL.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    timezone: place.timezone,
    current: 'temperature_2m',
    hourly: 'temperature_2m,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    forecast_days: '2',
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    precipitation_unit: imperial ? 'inch' : 'mm',
  });
  const forecast = await getJSON(forecastURL, Forecast);

  // Open-Meteo times are wall-clock times in the place's time zone, so compare them as
  // strings and format them without converting between time zones.
  const nowHour = forecast.current.time.slice(0, 13);
  const start = forecast.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour);
  if (start < 0) return `No upcoming hourly forecast is available for ${place.name}.`;
  const next = forecast.hourly.time.slice(start, start + 12).map((time, i) => ({
    time,
    rain: forecast.hourly.precipitation_probability[start + i] ?? null,
  }));
  const known = next.filter((h) => h.rain !== null);
  if (!known.length) return `Rain probability is unavailable for ${place.name}.`;
  const wettest = known.reduce((a, b) => (b.rain > a.rain ? b : a));
  const incomplete = known.length < 12;
  const wetHours = next.filter((h) => h.rain >= 40).length;
  console.log(`${place.name}: wettest hour ${wettest.time} at ${wettest.rain}%`);

  const deg = imperial ? '°F' : '°C';
  const round = Math.round;
  const where = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
  Widget.set('Weather', {
    title: place.name.slice(0, 60),
    items: [
      { label: 'Now', value: `${round(forecast.current.temperature_2m)}${deg}` },
      { label: 'Today', value: `${round(forecast.daily.temperature_2m_min[0])}–${round(forecast.daily.temperature_2m_max[0])}${deg}` },
      { label: 'Rain, 12 h', value: `${wettest.rain}%${wetHours ? ' ☔' : ''}` },
    ],
    tint: wetHours ? 'blue' : 'orange',
  }, { refresh: 60 });
  return [
    `${where}: ${round(forecast.current.temperature_2m)}${deg} now, ` +
      `${round(forecast.daily.temperature_2m_min[0])}–${round(forecast.daily.temperature_2m_max[0])}${deg} today`,
    wetHours
      ? `☔ Take an umbrella: ${wettest.rain}% chance of rain around ${format(parseISO(wettest.time), 'h a')} ` +
        `(${wetHours} of the next 12 hours look wet).`
      : incomplete ? `Hourly rain data is incomplete; the available hours peak at ${wettest.rain}%.`
      : `No umbrella needed: rain chance stays under 40% for the next 12 hours (max ${wettest.rain}%).`,
    `Tomorrow: ${round(forecast.daily.temperature_2m_min[1])}–${round(forecast.daily.temperature_2m_max[1])}${deg}, ` +
      `${forecast.daily.precipitation_sum[1]} ${imperial ? 'in' : 'mm'} of rain expected.`,
  ].join('\n');
}
