import { fetchJson } from '../../lib/http.js';
import { config } from '../../config/index.js';
import type { LeadProvider, LeadSearchParams, LeadSource, RawLead } from '../types.js';

const PLACES_TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const REQUEST_TIMEOUT_MS = 12000;

type GooglePlace = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  geometry?: {
    location?: { lat?: number; lng?: number };
  };
  types?: string[];
  opening_hours?: { open_now?: boolean; weekday_text?: string[] };
  website?: string;
  international_phone_number?: string;
  vicinity?: string;
  address_components?: Array<{
    long_name?: string;
    short_name?: string;
    types?: string[];
  }>;
};

type PlacesTextSearchResponse = {
  results?: GooglePlace[];
  status?: string;
  error_message?: string;
  next_page_token?: string;
};

type PlaceDetailsResponse = {
  result?: GooglePlace;
  status?: string;
  error_message?: string;
};

function getAddressComponent(place: GooglePlace, type: string): string | undefined {
  for (const component of place.address_components ?? []) {
    if (component.types?.includes(type)) {
      return component.long_name ?? component.short_name;
    }
  }
  return undefined;
}

export function mapGooglePlace(place: GooglePlace, placeUrl?: string): RawLead | null {
  const name = place.name?.trim();
  if (!name) return null;

  return {
    companyName: name,
    industry: (place.types ?? []).length > 1 ? place.types!.slice(1).join(', ') : place.types?.[0],
    phone: place.international_phone_number,
    address: place.formatted_address ?? place.vicinity,
    city: getAddressComponent(place, 'locality') ?? getAddressComponent(place, 'postal_town'),
    state: getAddressComponent(place, 'administrative_area_level_1'),
    country: getAddressComponent(place, 'country'),
    rating: place.rating,
    reviewCount: place.user_ratings_total,
    googleMapsUrl:
      placeUrl ??
      (place.place_id
        ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
        : undefined),
    source: 'google_maps',
    sourceId: place.place_id,
    sourceData: {
      coordinates: place.geometry?.location
        ? { lat: place.geometry.location.lat, lng: place.geometry.location.lng }
        : undefined,
      openNow: place.opening_hours?.open_now,
      hours: place.opening_hours?.weekday_text,
      types: place.types,
    },
  };
}

async function fetchPlaceDetails(placeId: string): Promise<GooglePlace> {
  const url = new URL(PLACE_DETAILS_URL);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set(
    'fields',
    'place_id,name,formatted_address,geometry,rating,user_ratings_total,types,website,international_phone_number,opening_hours,business_status,address_components,vicinity',
  );
  url.searchParams.set('key', config.googleMapsApiKey);
  const data = await fetchJson<PlaceDetailsResponse>(url.toString(), {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return data.result ?? {};
}

export const googleMapsProvider: LeadProvider = {
  id: 'google_maps',
  label: 'Google Maps',
  sources: ['google_maps'] as LeadSource[],
  supportedParams: [
    'query',
    'industry',
    'location',
    'city',
    'state',
    'country',
    'ratingMin',
    'limit',
  ],

  isConfigured(): boolean {
    return Boolean(config.googleMapsApiKey);
  },

  async search(params: LeadSearchParams): Promise<RawLead[]> {
    if (!config.googleMapsApiKey) {
      throw new Error(
        'Google Maps API key is not configured. Add GOOGLE_MAPS_API_KEY to your .env file.',
      );
    }

    const locationParts = [params.city, params.state, params.country, params.location].filter(
      Boolean,
    );
    const queryParts = [params.query || params.industry || '', ...locationParts].filter(Boolean);
    const query = queryParts.join(' ').trim();

    const url = new URL(PLACES_TEXT_SEARCH_URL);
    url.searchParams.set('query', query || 'businesses');
    url.searchParams.set('key', config.googleMapsApiKey);

    const data = await fetchJson<PlacesTextSearchResponse>(url.toString(), {
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (data.status === 'REQUEST_DENIED') {
      throw new Error(data.error_message ?? 'Google Maps API request denied. Check your API key.');
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      throw new Error('Google Maps API quota exceeded. Try again later.');
    }
    if (data.status === 'ZERO_RESULTS' || !data.results?.length) {
      return [];
    }

    const limit = params.limit ?? 20;
    const results: RawLead[] = [];

    for (const place of data.results.slice(0, limit)) {
      let fullPlace = place;
      if (place.place_id) {
        try {
          fullPlace = await fetchPlaceDetails(place.place_id);
        } catch {
          // Best-effort enrichment
        }
      }
      const lead = mapGooglePlace(fullPlace);
      if (lead) {
        if (params.ratingMin !== undefined && (lead.rating ?? 0) < params.ratingMin) {
          continue;
        }
        results.push(lead);
      }
    }
    return results;
  },

  async healthCheck() {
    if (!config.googleMapsApiKey) {
      return { ok: false, message: 'GOOGLE_MAPS_API_KEY not configured' };
    }
    const start = Date.now();
    try {
      const url = new URL(PLACES_TEXT_SEARCH_URL);
      url.searchParams.set('query', 'businesses in New York');
      url.searchParams.set('key', config.googleMapsApiKey);
      const data = await fetchJson<{ status?: string }>(url.toString(), { timeoutMs: 8000 });
      return {
        ok: data.status === 'OK' || data.status === 'ZERO_RESULTS',
        latencyMs: Date.now() - start,
      };
    } catch {
      return { ok: false, message: 'Google Maps API unreachable', latencyMs: Date.now() - start };
    }
  },
};
