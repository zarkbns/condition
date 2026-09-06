import type { Config } from 'tailwindcss';

/**
 * Landing-page Tailwind. Prefixed (`tw-`) and preflight-free, and content is
 * scoped to the landing page only — the app pages (policy/claim/receipt)
 * keep their globals.css styling untouched, and no bare utility name can
 * collide with an existing selector.
 *
 * Tokens mirror DESIGN.md (the zkPass structural reference), translated to
 * the project's strict monochrome: pure black canvas, white display type,
 * graded grays for body copy, hairline borders instead of shadows, zero
 * chromatic accents.
 */
const config: Config = {
  prefix: 'tw-',
  // Content globs are cwd-relative; Next runs PostCSS with cwd=frontend/
  // while a manual `npx tailwindcss` from the repo root uses the other
  // form. List both so the scan matches regardless of the invoking cwd.
  content: [
    './pages/index.tsx',
    './pages/_app.tsx',
    './frontend/pages/index.tsx',
    './frontend/pages/_app.tsx',
  ],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        canvas: '#000000',
        surface: '#0a0a0a',
        raised: '#101010',
        line: 'rgba(255,255,255,0.1)',
        'line-strong': 'rgba(255,255,255,0.2)',
        ink: '#ffffff',
        muted: '#b5b5b5',
        dim: '#a0a0a0',
        faint: '#5c5c5c',
      },
      fontFamily: {
        display: ['Georgia', '"Times New Roman"', 'Times', 'serif'],
        sans: ['"Inter Tight"', 'Inter', '-apple-system', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', '"Cascadia Code"', '"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      fontSize: {
        display: ['clamp(2.75rem, 7.5vw, 5.5rem)', { lineHeight: '0.96', letterSpacing: '-0.03em' }],
        'heading-lg': ['clamp(2rem, 5vw, 4.5rem)', { lineHeight: '1.0', letterSpacing: '-0.025em' }],
        heading: ['clamp(1.5rem, 3.4vw, 3.0625rem)', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'heading-sm': ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.012em' }],
        subheading: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        body: ['0.9375rem', { lineHeight: '1.6' }],
        stamp: ['0.6875rem', { lineHeight: '1.2', letterSpacing: '0.22em' }],
        micro: ['0.625rem', { lineHeight: '1.2', letterSpacing: '0.18em' }],
      },
      letterSpacing: {
        stamp: '0.22em',
        micro: '0.18em',
      },
      maxWidth: {
        page: '1280px',
      },
    },
  },
  plugins: [],
};

export default config;
