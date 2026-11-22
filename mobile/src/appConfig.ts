import { useEffect, useState } from 'react';

import { api, AppConfig } from './api';

const FALLBACK: AppConfig = {
  platform_fee_percent: 10,
  fee_periods: [],
  currency: 'EUR',
  currency_symbol: '€',
  home_city: { name: 'Prishtina', lat: 42.6629, lng: 21.1655, radius_km: 12 },
};

let cached: AppConfig | null = null;
let pending: Promise<AppConfig> | null = null;

/** /config, fetched once per app start (fallback values if the server can't be reached). */
export function loadConfig(): Promise<AppConfig> {
  if (cached) return Promise.resolve(cached);
  pending ??= api
    .config()
    .then((c) => (cached = { ...FALLBACK, ...c }))
    .catch(() => {
      pending = null;
      return FALLBACK;
    });
  return pending;
}

export function useAppConfig(): AppConfig {
  const [cfg, setCfg] = useState<AppConfig>(cached ?? FALLBACK);
  useEffect(() => {
    let alive = true;
    loadConfig().then((c) => alive && setCfg(c));
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

/** Name of the home city, e.g. "Prishtina". */
export const useHomeCity = () => useAppConfig().home_city.name;
