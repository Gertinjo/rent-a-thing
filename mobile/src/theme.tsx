import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { storage } from './platform';

// ---------------------------------------------------------------------------
// Palettes — "warm marketplace": cream paper, warm browns, white cards; one accent colour.
// ---------------------------------------------------------------------------

export type Mode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

export const ACCENTS = {
  tangerine: { name: 'Terracotta', light: '#E2572B', dark: '#FF7A4D', onLight: '#FFFFFF', onDark: '#FFFFFF' },
  cobalt: { name: 'Cobalt', light: '#1A5CFF', dark: '#4D84FF', onLight: '#FFFFFF', onDark: '#FFFFFF' },
  ruby: { name: 'Ruby', light: '#D7263D', dark: '#FF4D61', onLight: '#FFFFFF', onDark: '#FFFFFF' },
  saffron: { name: 'Saffron', light: '#E09B00', dark: '#FFB21A', onLight: '#111111', onDark: '#111111' },
  graphite: { name: 'Graphite', light: '#1C1C1E', dark: '#F2F2F7', onLight: '#FFFFFF', onDark: '#111111' },
} as const;
export type AccentKey = keyof typeof ACCENTS;

const base = {
  light: {
    bg: '#FBF6EE', // cream paper
    grouped: '#F5EEE2',
    surface: '#FFFFFF', // cards
    surface2: '#F3EADC',
    fill: 'rgba(122,92,58,0.09)',
    text: '#2B2118', // warm espresso
    text2: '#7B6B59',
    text3: '#B9AA95',
    separator: 'rgba(98,70,40,0.12)',
    imageBg: '#EFE5D6',
    avatarBg: '#EADCC7',
    glassTint: 'rgba(255,251,244,0.62)',
    glassBorder: 'rgba(255,255,255,0.85)',
    glassHighlight: 'rgba(255,255,255,0.9)',
    shadow: 'rgba(80,50,20,0.12)',
    overlay: 'rgba(43,33,24,0.4)',
    success: '#2F8F4E',
    warning: '#C27803',
    danger: '#D33B2C',
    info: '#2563EB',
    star: '#F4A70B',
    calendarBooked: '#EBE1D2',
    calendarBlocked: '#DCCFBC',
    calendarPendingBg: '#FFF1CF',
  },
  dark: {
    bg: '#16120E', // warm charcoal
    grouped: '#16120E',
    surface: '#221C16',
    surface2: '#2D251D',
    fill: 'rgba(255,236,210,0.08)',
    text: '#F7EFE4',
    text2: '#B5A58F',
    text3: '#6F6253',
    separator: 'rgba(255,236,210,0.1)',
    imageBg: '#2A221A',
    avatarBg: '#3A3027',
    glassTint: 'rgba(40,32,25,0.55)',
    glassBorder: 'rgba(255,255,255,0.16)',
    glassHighlight: 'rgba(255,255,255,0.22)',
    shadow: 'rgba(0,0,0,0.5)',
    overlay: 'rgba(0,0,0,0.6)',
    success: '#32D74B',
    warning: '#FFB340',
    danger: '#FF453A',
    info: '#64A0FF',
    star: '#FFC233',
    calendarBooked: '#2D251D',
    calendarBlocked: '#3A3027',
    calendarPendingBg: '#3A2E10',
  },
};

export type Colors = (typeof base)['light'] & { accent: string; onAccent: string; accentSoft: string };

export interface Theme {
  scheme: Scheme;
  mode: Mode;
  accentKey: AccentKey;
  c: Colors;
  setMode: (m: Mode) => void;
  setAccent: (a: AccentKey) => void;
}

function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function buildColors(scheme: Scheme, accentKey: AccentKey): Colors {
  const a = ACCENTS[accentKey];
  const accent = scheme === 'dark' ? a.dark : a.light;
  return {
    ...base[scheme],
    accent,
    onAccent: scheme === 'dark' ? a.onDark : a.onLight,
    accentSoft: withAlpha(accent, scheme === 'dark' ? 0.22 : 0.12),
  };
}

// ---------------------------------------------------------------------------
// Provider (remembers the choice on the device)
// ---------------------------------------------------------------------------

const PREFS_KEY = 'rentathing.appearance';
const Ctx = createContext<Theme>(null as unknown as Theme);
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>('system');
  const [accentKey, setAccentState] = useState<AccentKey>('tangerine');

  useEffect(() => {
    storage
      .get(PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.mode) setModeState(p.mode);
        if (p.accent && p.accent in ACCENTS) setAccentState(p.accent);
      })
      .catch(() => {});
  }, []);

  const save = (m: Mode, a: AccentKey) => storage.set(PREFS_KEY, JSON.stringify({ mode: m, accent: a })).catch(() => {});
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    setAccentState((a) => (save(m, a), a));
  }, []);
  const setAccent = useCallback((a: AccentKey) => {
    setAccentState(a);
    setModeState((m) => (save(m, a), m));
  }, []);

  const scheme: Scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const value = useMemo<Theme>(
    () => ({ scheme, mode, accentKey, c: buildColors(scheme, accentKey), setMode, setAccent }),
    [scheme, mode, accentKey, setMode, setAccent],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `const useStyles = makeStyles((c) => ({...}))` then `const s = useStyles()` inside a component. */
type StyleMap = Parameters<typeof StyleSheet.create>[0];

export function makeStyles<S extends StyleMap>(fn: (c: Colors, scheme: Scheme) => S & StyleMap) {
  return (): Readonly<S> => {
    const { c, scheme } = useTheme();
    return useMemo(() => StyleSheet.create(fn(c, scheme)), [c, scheme]);
  };
}

// ---------------------------------------------------------------------------
// Type scale (iOS-like) and helpers
// ---------------------------------------------------------------------------

export const type = {
  largeTitle: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.4 },
  title2: { fontSize: 21, fontWeight: '700' as const, letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 23 },
  callout: { fontSize: 15, fontWeight: '400' as const },
  subhead: { fontSize: 14, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
};

export const categoryIcon: Record<string, string> = {
  tools: 'hammer-outline',
  garden: 'flower-outline',
  camping: 'bonfire-outline',
  bikes: 'bicycle-outline',
  photo: 'camera-outline',
  electronics: 'tv-outline',
  party: 'balloon-outline',
  sports: 'football-outline',
  kids: 'happy-outline',
  home: 'home-outline',
  music: 'musical-notes-outline',
  travel: 'airplane-outline',
  other: 'cube-outline',
};

export const categoryLabel: Record<string, string> = {
  tools: 'Tools & DIY',
  garden: 'Garden',
  camping: 'Camping',
  bikes: 'Bikes & scooters',
  photo: 'Photo & video',
  electronics: 'Electronics',
  party: 'Party & events',
  sports: 'Sports',
  kids: 'Kids & baby',
  home: 'Home & cleaning',
  music: 'Music',
  travel: 'Travel',
  other: 'Other',
};

/** Short examples shown when picking a category. */
/** Each category's colour pair for the tiles: [strong colour, soft background]. */
export const categoryColor: Record<string, [string, string]> = {
  tools: ['#C8571E', '#FFE2CC'],
  garden: ['#3B8A33', '#DDF1D3'],
  camping: ['#A87414', '#FBE8B8'],
  bikes: ['#2C68CC', '#D8E8FF'],
  photo: ['#8C40B0', '#F0DDF7'],
  electronics: ['#1C7D8F', '#D5EEF2'],
  party: ['#C63A62', '#FFDCE4'],
  sports: ['#4752C6', '#E1E6FF'],
  kids: ['#B07D06', '#FFF0C0'],
  home: ['#6B5A47', '#ECE4D8'],
  music: ['#C14C2B', '#FFE1D6'],
  travel: ['#1E7E69', '#D5F0E9'],
  other: ['#6A5C7D', '#ECE6F2'],
};

/** Tile colours that also work in dark mode. */
export function categoryTile(cat: string, scheme: Scheme): { fg: string; bg: string } {
  const [fg, bg] = categoryColor[cat] ?? categoryColor.other;
  return scheme === 'dark' ? { fg: bg, bg: fg + '40' } : { fg, bg };
}

export const categoryHint: Record<string, string> = {
  tools: 'Drills, saws, ladders',
  garden: 'Mowers, trimmers, wheelbarrows',
  camping: 'Tents, sleeping bags, stoves',
  bikes: 'Bikes, e-scooters, trailers',
  photo: 'Cameras, lenses, drones',
  electronics: 'Projectors, consoles, VR',
  party: 'Speakers, lights, tables',
  sports: 'Kayaks, skis, paddle boards',
  kids: 'Strollers, car seats, cots',
  home: 'Carpet cleaners, steamers',
  music: 'Guitars, keyboards, amps',
  travel: 'Luggage, roof boxes',
  other: 'Anything else',
};

export function statusStyle(status: string, c: Colors) {
  return (
    {
      pending: { color: c.warning, label: 'Awaiting reply' },
      accepted: { color: c.success, label: 'Confirmed' },
      declined: { color: c.danger, label: 'Declined' },
      cancelled: { color: c.text2, label: 'Cancelled' },
      completed: { color: c.text2, label: 'Completed' },
    } as Record<string, { color: string; label: string }>
  )[status] ?? { color: c.text2, label: status };
}

export const CURRENCY = '€';
export const money = (n: number) => `${CURRENCY}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;

export const fmtDate = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const fmtRange = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

/** Local YYYY-MM-DD (not UTC, so "today" matches the user's calendar). */
export const isoDay = (d: Date = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000);
