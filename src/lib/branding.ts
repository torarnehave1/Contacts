import { useEffect, useState } from 'react';

// A World host (e.g. contacts.sodesign.no) is served through the World's brand proxy, which
// answers /branding.json from the World's BRAND_CONFIG (brand:<host>, written by set_world_brand).
// On vegvisr.org hosts and localhost there is no brand: the app keeps its own look.
export type WorldBrand = {
  name: string;
  slogan: string;
  logoUrl: string;
  title: string;
  faviconUrl: string;
  fontsCssUrl: string;
  fontSans: string;
  fontDisplay: string;
  accent: string;
  lang: 'no' | 'en';
};

const isWorldHost = () => {
  const h = window.location.hostname;
  return !(h === 'localhost' || h === '127.0.0.1' || h.endsWith('vegvisr.org') || h.endsWith('.pages.dev'));
};

// Darken a #rrggbb colour for hover states.
const darken = (hex: string, f = 0.85) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
};

function apply(b: WorldBrand) {
  if (b.title) document.title = b.title;
  if (b.faviconUrl) {
    document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((l) => l.remove());
    for (const rel of ['icon', 'apple-touch-icon']) {
      const l = document.createElement('link');
      l.rel = rel;
      l.href = b.faviconUrl;
      document.head.appendChild(l);
    }
  }
  if (b.fontsCssUrl && !document.querySelector(`link[data-brand-fonts]`)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = b.fontsCssUrl;
    l.setAttribute('data-brand-fonts', '1');
    document.head.appendChild(l);
  }
  const root = document.documentElement.style;
  if (b.accent) {
    root.setProperty('--brand-accent', b.accent);
    root.setProperty('--brand-accent-dark', darken(b.accent));
  }
  if (b.fontSans) document.body.style.fontFamily = b.fontSans;
  if (b.fontDisplay) root.setProperty('--brand-font-display', b.fontDisplay);
  if (b.lang) document.documentElement.lang = b.lang;
}

let cached: Promise<WorldBrand | null> | null = null;

export function loadWorldBrand(): Promise<WorldBrand | null> {
  if (typeof window === 'undefined' || !isWorldHost()) return Promise.resolve(null);
  if (!cached) {
    cached = fetch('/branding.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const name = j?.brand?.name;
        if (!name || name === 'Vegvisr') return null; // the proxy's default: no brand set for this host
        const ed = j?.theme?.editor || {};
        const b: WorldBrand = {
          name,
          slogan: j.brand.slogan || '',
          logoUrl: j.brand.logoUrl || '',
          title: j.meta?.title || name,
          faviconUrl: j.meta?.faviconUrl || '',
          fontsCssUrl: ed.fontsCssUrl || '',
          fontSans: ed.fontSans || '',
          fontDisplay: ed.fontDisplay || '',
          accent: ed.accent || '',
          lang: ed.lang === 'no' ? 'no' : 'en',
        };
        apply(b);
        return b;
      })
      .catch(() => null);
  }
  return cached;
}

export function useWorldBrand(): WorldBrand | null {
  const [brand, setBrand] = useState<WorldBrand | null>(null);
  useEffect(() => {
    let live = true;
    loadWorldBrand().then((b) => live && setBrand(b));
    return () => { live = false; };
  }, []);
  return brand;
}
