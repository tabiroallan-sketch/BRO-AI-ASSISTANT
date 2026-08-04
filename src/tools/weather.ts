import type { Tool } from './types.js';
import { fetchJson } from '../lib/http.js';

type GeocodingResponse = {
  results?: Array<{
    name: string;
    country?: string;
    admin1?: string;
    latitude: number;
    longitude: number;
  }>;
};

type ForecastResponse = {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  current_units?: Record<string, string>;
};

const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle (light)',
  57: 'Freezing drizzle (dense)',
  61: 'Slight rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain (light)',
  67: 'Freezing rain (heavy)',
  71: 'Slight snowfall',
  73: 'Snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

const REQUEST_TIMEOUT_MS = 8000;

export const weatherTool: Tool = {
  name: 'get_weather',
  description:
    'Get the current weather for a city or location. Takes a location name (e.g. "London", "New York"), looks it up, and returns temperature, apparent temperature, humidity, precipitation, wind speed and weather conditions.',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City or place name, e.g. "Tokyo" or "Paris, France".',
      },
    },
    required: ['location'],
  },
  async execute(args) {
    const location = typeof args.location === 'string' ? args.location.trim() : '';
    if (!location) {
      throw new Error('Missing "location" argument');
    }
    try {
      const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const geocoding = (await fetchJson<GeocodingResponse>(geocodingUrl, {
        timeoutMs: REQUEST_TIMEOUT_MS,
      })) as GeocodingResponse;
      const place = geocoding.results?.[0];
      if (!place) {
        return `Could not find any location matching "${location}".`;
      }

      const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto&forecast_days=1`;
      const forecast = (await fetchJson<ForecastResponse>(forecastUrl, {
        timeoutMs: REQUEST_TIMEOUT_MS,
      })) as ForecastResponse;
      const current = forecast.current;
      if (!current) {
        return `Weather data unavailable for ${place.name}.`;
      }

      const units = forecast.current_units ?? {};
      const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
      const condition =
        current.weather_code !== undefined
          ? (WEATHER_CODES[current.weather_code] ?? 'Unknown conditions')
          : 'Unknown conditions';
      const lines = [
        `Current weather in ${placeName}:`,
        `- Conditions: ${condition}`,
        `- Temperature: ${current.temperature_2m ?? 'n/a'}${units.temperature_2m ?? '°C'}`,
        `- Feels like: ${current.apparent_temperature ?? 'n/a'}${units.apparent_temperature ?? '°C'}`,
        `- Humidity: ${current.relative_humidity_2m ?? 'n/a'}${units.relative_humidity_2m ?? '%'}`,
        `- Precipitation: ${current.precipitation ?? 'n/a'}${units.precipitation ?? 'mm'}`,
        `- Wind: ${current.wind_speed_10m ?? 'n/a'}${units.wind_speed_10m ?? 'km/h'}`,
        `- Observed at: ${current.time ?? 'n/a'} (${forecast.timezone ?? 'local'})`,
      ];
      return lines.join('\n');
    } catch (error) {
      return `Weather lookup failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
