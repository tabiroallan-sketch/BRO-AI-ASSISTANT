import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export type TimeoutInit = RequestInit & { timeoutMs?: number };

export function fetchWithTimeout(url: string, init: TimeoutInit = {}): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

type Ipv4Range = { base: number; prefix: number };
type Ipv6Range = { base: bigint; prefix: number };

const IPV4_PRIVATE_RANGES: Ipv4Range[] = [
  { base: 0, prefix: 8 }, // 0.0.0.0/8
  { base: 10 << 24, prefix: 8 }, // 10.0.0.0/8
  { base: (100 << 24) | (64 << 16), prefix: 10 }, // 100.64.0.0/10
  { base: 127 << 24, prefix: 8 }, // 127.0.0.0/8
  { base: (169 << 24) | (254 << 16), prefix: 16 }, // 169.254.0.0/16 (metadata)
  { base: (172 << 24) | (16 << 16), prefix: 12 }, // 172.16.0.0/12
  { base: (192 << 24) | (168 << 16), prefix: 16 }, // 192.168.0.0/16
  { base: (198 << 24) | (18 << 16), prefix: 15 }, // 198.18.0.0/15
];

const IPV6_PRIVATE_RANGES: Ipv6Range[] = [
  { base: 0n, prefix: 128 }, // :: (unspecified)
  { base: 1n, prefix: 128 }, // ::1 (loopback)
  { base: 0xffffn << 32n, prefix: 96 }, // ::ffff:0:0/96 (IPv4-mapped)
  { base: 0xfc00n << 112n, prefix: 7 }, // fc00::/7 (ULA)
  { base: 0xfe80n << 112n, prefix: 10 }, // fe80::/10 (link-local)
];

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED_RE = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function ipv4ToNumber(address: string): number | null {
  const match = IPV4_RE.exec(address);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return null;
  }
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
}

function v4PrefixMask(prefix: number): number {
  if (prefix >= 32) {
    return 0xffffffff;
  }
  if (prefix <= 0) {
    return 0;
  }
  return ((1 << prefix) - 1) << (32 - prefix);
}

function isBlockedIpv4(value: number): boolean {
  const unsigned = value >>> 0;
  for (const range of IPV4_PRIVATE_RANGES) {
    const mask = v4PrefixMask(range.prefix) >>> 0;
    if ((unsigned & mask) === (range.base & mask)) {
      return true;
    }
  }
  return false;
}

function ipv6ToBigInt(address: string): bigint | null {
  let addr = address.replace(/^\[|\]$/g, '').toLowerCase();
  const zoneIndex = addr.indexOf('%');
  if (zoneIndex !== -1) {
    addr = addr.slice(0, zoneIndex);
  }
  if (addr.includes('.')) {
    const separator = addr.lastIndexOf(':');
    const ipv4Part = addr.slice(separator + 1);
    const value = ipv4ToNumber(ipv4Part);
    if (value === null) {
      return null;
    }
    const hex = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
      .map((octet) => octet.toString(16).padStart(2, '0'))
      .join('');
    addr = `${addr.slice(0, separator + 1)}${hex}`;
  }
  const parts = addr.split('::');
  if (parts.length > 2) {
    return null;
  }
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const hextets: number[] = [];
  for (const part of head) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null;
    }
    hextets.push(parseInt(part, 16));
  }
  const headLength = head.length;
  for (const part of tail) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null;
    }
    hextets.push(parseInt(part, 16));
  }
  if (parts.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) {
      return null;
    }
    hextets.splice(headLength, 0, ...new Array<number>(fill).fill(0));
  }
  if (hextets.length !== 8) {
    return null;
  }
  let value = 0n;
  for (const hextet of hextets) {
    value = (value << 16n) | BigInt(hextet);
  }
  return value;
}

function v6PrefixMask(prefix: number): bigint {
  if (prefix >= 128) {
    return ~0n;
  }
  if (prefix <= 0) {
    return 0n;
  }
  return ~((1n << BigInt(128 - prefix)) - 1n);
}

function isBlockedIpv6(value: bigint): boolean {
  for (const range of IPV6_PRIVATE_RANGES) {
    const mask = v6PrefixMask(range.prefix);
    if ((value & mask) === (range.base & mask)) {
      return true;
    }
  }
  return false;
}

function isBlockedAddress(address: string): boolean {
  if (address.includes(':')) {
    const mapped = IPV4_MAPPED_RE.exec(address);
    if (mapped) {
      const value = ipv4ToNumber(mapped[1]!);
      return value === null || isBlockedIpv4(value);
    }
    const value = ipv6ToBigInt(address);
    if (value === null) {
      return true;
    }
    return isBlockedIpv6(value);
  }
  const value = ipv4ToNumber(address);
  if (value === null) {
    return true;
  }
  return isBlockedIpv4(value);
}

const RESOLVE_CACHE_MS = 60_000;
const hostCache = new Map<string, { allowed: boolean; expiresAt: number }>();

async function isPublicHost(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  const cached = hostCache.get(lower);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed;
  }
  const isAllowed = await resolvePublicHost(lower);
  hostCache.set(lower, { allowed: isAllowed, expiresAt: Date.now() + RESOLVE_CACHE_MS });
  return isAllowed;
}

async function resolvePublicHost(hostname: string): Promise<boolean> {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return false;
  }
  if (isIP(hostname) !== 0) {
    return !isBlockedAddress(hostname);
  }
  let addresses: string[];
  try {
    addresses = (await lookup(hostname, { all: true, verbatim: true })).map(
      (result) => result.address,
    );
  } catch {
    return false;
  }
  if (addresses.length === 0) {
    return false;
  }
  return addresses.every((address) => !isBlockedAddress(address));
}

export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  return isPublicHost(url.hostname);
}

export async function assertPublicHttpUrl(raw: string, label = 'URL'): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid ${label}.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`"${raw}" is not a valid http(s) ${label}.`);
  }
  if (!(await isPublicHost(url.hostname))) {
    throw new Error(`"${raw}" points to a private or internal address and is not allowed.`);
  }
  return url;
}

export async function fetchJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'bro-agent/0.1',
        ...options.headers,
      },
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new HttpError(response.status, `HTTP ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'User-Agent': 'bro-agent/0.1',
        ...options.headers,
      },
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new HttpError(response.status, `HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
