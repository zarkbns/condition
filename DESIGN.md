# Condition — Design System

> Privacy-first parametric insurance on Midnight. The visual thesis is the
> product thesis: **nothing is decorative, nothing is colored, nothing hides.**
> Strict monochrome — black, white, and the grays between. Zero chromatic accents.

**Theme:** dark (pure black canvas)
**Lineage:** structural language (editorial display voice, bracketed metadata
stamps, hairline surface steps, section rhythm) adapted from the zkPass
reference teardown that `DESIGN.md` used to be. Every chromatic token from that
reference — `#c5ff4a` lime, olive, moss, the lime glow — has been **removed**.
Condition keeps the structure and drops the color.

---

## Source of truth — brand assets

| File | Dimensions | Measured | Role |
|------|-----------|----------|------|
| `assets/logowhite.png` | 735×431 | max channel Δ = 1, 323 gray levels, opaque | Lockup on dark. The wordmark + cat mark, white on black. |
| `assets/logoblack.png` | 735×431 | max channel Δ = 1, 364 gray levels, opaque | Lockup on light (print, invert contexts). |
| `assets/conditionflyer.png` | 735×431 | max channel Δ = 5, 630 gray levels, opaque | **Social/OG preview** — the only asset cleared for external framing. |
| `frontend/public/brand/mark-white.png` | 215×264 | exactly 1 color (#fff) + alpha | The cat mark, isolated, for dark surfaces. |
| `frontend/public/brand/mark-black.png` | 202×251 | single color + alpha | The cat mark, isolated, for light surfaces. |
| `frontend/public/brand/favicon.png` | 64×64 | black tile | Favicon + apple-touch-icon. |

Measured with a PNG decode pass (channel deltas + color census), not by eye:
the marks are genuinely achromatic. Any future asset must pass the same check —
**max channel Δ ≤ 2** or it does not ship.

### The mark

The Condition mark is a cat rendered in flat 1-bit black/white. It is the
project's only pictorial element, which makes scarcity the whole point of it.

**Use it in exactly four places:**

1. **Navigation brand** — `mark-white.png` at 22px, left of the wordmark, every page.
2. **Favicon / tab identity** — `favicon.png`, black tile.
3. **The receipt seal** — `mark-white.png` at 40–48px on the final receipt stage only. This is the product's "issued" stamp: the one moment the mark is allowed to be large.
4. **Empty states** — `mark-white.png` at 28–32px, `opacity: 0.18`, as a watermark behind the copy. A quiet signal that the surface is empty, not broken.

**Never** put the mark on: form cards, buttons, table rows, the journey rail,
stage headers, error notices, or repeated per-item. A logo that appears
everywhere is a logo that means nothing — and on a privacy product, cuteness
deployed at volume reads as unserious. The mark is a signature, not a pattern.

---

## Tokens — Colors (grayscale only)

Every value is achromatic: R = G = B. There is no accent color, no success
green, no warning amber, and — deliberately — **no error red**. Errors carry
weight, border, and label instead of hue (see *Error state*).

| Name | Value | Token | Role |
|------|-------|-------|------|
| Void | `#000000` | `--bg` | Page canvas. The absolute floor. |
| Ink well | `#050505` | `--bg-input` | Input fields — one step above the floor. |
| Carbon | `#0a0a0a` | `--bg-raised` | Cards, panels, raised surfaces. |
| Iron | `#161616` | `--bg-hover` | Hover fill on interactive rows and buttons. |
| Hairline | `#1c1c1c` | `--border` | Default 1px border. The workhorse divider. |
| Rule | `#2e2e2e` | `--border-strong` | Emphasized border: focus, active stage, error. |
| Ash | `#4d4d4d` | `--text-faint` | Tertiary: metadata, index numerals, disabled labels. |
| Smoke | `#8a8a8a` | `--text-dim` | Secondary: helper copy, stamps, neutral status. |
| Chalk | `#f0f0f0` | `--text` | Primary text and the "live/active" signal. |
| White | `#ffffff` | — | Hover state on Chalk, primary button fill. Never body text. |

**Signal semantics without hue.** The system has three states and expresses
them with luminance and stroke, not color:

| State | Treatment |
|-------|-----------|
| Live / confirmed | `#f0f0f0` dot + solid hairline border |
| Waiting / neutral | `#8a8a8a` dot + dashed border (`border-style: dashed`) |
| Down / error | `#f0f0f0` text on `#2e2e2e` border, **2px left rule**, `[ ERROR ]` stamp, no fill |

Red was removed on purpose: an error that needs color to be legible is an
error state that hasn't been designed. The `[ ERROR ]` bracket stamp plus the
left rule is louder than a hue, and it keeps the canvas achromatic.

---

## Tokens — Typography

Three voices, no more:

- **Display** — `Georgia, 'Times New Roman', Times, serif`, weight 400. Headlines
  and stage titles. Whisper-weight serif signals authority through restraint.
  Italic is the accent device (replacing the reference's colored accent word).
- **UI / body** — `"Inter Tight", Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`.
  400 body, 500 buttons and nav, 600 stamps.
- **Evidence** — `ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, monospace`.
  Hashes, addresses, timestamps, amounts. This is the proof layer: anything
  cryptographic is mono, always.

### Type scale

| Role | Size | Line height | Tracking | Use |
|------|------|-------------|----------|-----|
| display | clamp(2.75rem, 7.5vw, 5.5rem) | 0.96 | -0.03em | Hero headline only |
| heading-lg | clamp(2rem, 5vw, 4.5rem) | 1.0 | -0.025em | Closing CTA |
| heading | clamp(1.5rem, 3.4vw, 3.0625rem) | 1.05 | -0.02em | Section titles |
| heading-sm | 1.75rem | 1.15 | -0.012em | Card titles, stage titles |
| subheading | 1.25rem | 1.3 | -0.01em | Lead paragraphs |
| body | 0.9375rem | 1.6 | — | Prose |
| stamp | 0.6875rem | 1.2 | **0.22em**, uppercase | Bracketed metadata: `[ THE FLOW ]` |
| micro | 0.625rem | 1.2 | **0.18em**, uppercase | Pills, labels, table heads |

**The bracket is load-bearing.** Metadata stamps are wrapped in literal square
brackets — `[ PARAMETRIC INSURANCE · MIDNIGHT ]`, `[ ERROR ]`, `[ redacted ]`.
Never strip the brackets; they are the classified-document identity of the brand.

---

## Tokens — Spacing, shape, motion

- **Scale:** 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32 · 44 px
- **Page max-width:** 1280px (landing, full-bleed) · 1040px (app pages, reading container)
- **Section rhythm:** 80–128px vertical between bands; 24px gutter; card padding 32–40px
- **Radius:** cards **0px** (square, editorial) · buttons 4px · pills/tags 2px
- **Elevation:** none. No shadows, ever. Depth is the border-color step
  (`#1c1c1c` → `#2e2e2e`) and the surface step (`#000` → `#0a0a0a` → `#161616`).

### Motion

Quiet, short, eases out. Motion must never imply progress that isn't happening
(on a settlement product, a fake progress bar is a lie).

| Token | Value | Use |
|-------|-------|-----|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | All UI entrances, presses, color/border changes |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | On-screen movement, ambient pulse |

| Moment | Duration | Treatment |
|--------|----------|-----------|
| Press feedback | 60–120ms | `transform: scale(0.97)` |
| Border/background/color | 150ms | `var(--ease-out)` |
| Notice / panel entrance | 200ms | `opacity 0→1`, `translateY(4px)→0` |
| Indeterminate work (proving, settling) | 1.2s loop | 2px bottom sweep, `linear`, transform-only |
| Ambient liveness (status dot) | 2s loop | opacity 1 → 0.35, `var(--ease-in-out)` |

`prefers-reduced-motion`: keep comprehension aids (opacity, the busy bar's
presence), drop movement (translate, sweep). Never zero feedback.

---

## Components

**Primary button** — `#ffffff` fill, `#000000` text, 4px radius, 11px/22px pad,
12px/500/0.14em uppercase. Hover `#ffffff`→brighter border only. Active `scale(0.97)`.

**Ghost button** — transparent, 1px `#2e2e2e`, `#f0f0f0` text. Hover: border to
`#f0f0f0`, fill `#161616`.

**Card** — `#0a0a0a` on `#000` canvas, 1px `#1c1c1c`, 0 radius, 32–40px pad.
Title in display serif, body in Inter Tight 400 `#8a8a8a`.

**Dual-surface card** (pillars, stage panels) — a header strip on `#0a0a0a`
with a hairline bottom border carrying `[ LABEL ]` left and the index numeral
right, over a body zone on `#000`. Two surfaces, one border.

**Journey rail** — the six lifecycle stages as a horizontal rule of numerals
`01–06` with stage names beneath. States: reached = `#f0f0f0` numeral + solid
rule; current = `#f0f0f0` + `#2e2e2e` block behind it; unreached = `#4d4d4d`.
Connector is a 1px `#1c1c1c` line that becomes `#2e2e2e` once traversed. On
narrow viewports it collapses to a compact `03 / 06 · CURRENT STAGE` counter —
the rail must never eat vertical space on a phone.

**Mode banner** — one line, always visible on app pages, stating exactly which
runtime is driving: `LOCAL REFERENCE — in-browser protocol, nothing is written
on-chain` or `MIDNIGHT PREPROD — live contracts`. Links to the deployed
contracts and the explorer sit here, not inline in forms.

**Status pill** — mono micro text, 1px border, 2px radius. `SETTLED`/`ACTIVE`
in `#f0f0f0`; waiting states in `#8a8a8a` with dashed border.

**Evidence row** — `label` in `#4d4d4d` mono, value right-aligned in `#8a8a8a`
mono, hash strings truncated middle-out (`0x20acedd5…998608a2`) with the full
value in `title`. Never wrap a hash mid-character.

**Redacted value** — `[ redacted ]` in `#f0f0f0`. The privacy thesis rendered
as typography: the row exists, the content does not.

**Empty state** — mark watermark at 0.18 opacity, one line of `#8a8a8a` copy,
one ghost action. Never a spinner in an empty state.

**Error state** — `[ ERROR ]` stamp, 2px `#2e2e2e` left rule, `#f0f0f0` text on
`#050505`. No red. No icon glyph that isn't typographic.

---

## Layout & responsive

- **Desktop (≥1024px):** landing full-bleed 1280px with asymmetric two-column
  hero (copy 1.15fr / visual 0.85fr); app pages 1040px single column, journey
  rail horizontal.
- **Tablet (640–1023px):** hero stacks, receipt panel drops below; pillars 3→1
  at `md` breakpoint boundary; rail stays horizontal but numerals only.
- **Phone (<640px):** 20px side padding, display type clamps down, tables get
  `overflow-x: auto` with a hairline fade, buttons go full-width stacked in
  `.button-row`, journey rail collapses to the counter form, nav links fold
  behind the badge row. Touch targets ≥44px. No hover-dependent affordances
  (gate hover motion behind `@media (hover: hover) and (pointer: fine)`).

---

## Do / Don't

**Do**
- Keep every pixel achromatic; verify new assets by channel-delta census.
- Use the bracket stamp for anything that reads as metadata.
- Let mono carry anything cryptographic, and truncate hashes middle-out.
- Say what is not shown (`[ redacted ]`) rather than hiding the row.
- Reserve the cat mark for the four slots above.

**Don't**
- No chroma of any kind — not for success, not for error, not for a highlight.
- No shadows, no gradients, no glassmorphism, no rounded cards.
- No generic dashboard chrome: no avatar circles, no sidebar nav, no stat-tile
  grids, no colored status dots, no "AI slop" icon-in-a-box feature cards.
- No animation on high-frequency chrome, and no fake progress during real waits.
- Never let the browser imply an on-chain write it did not perform.

---

## Quick start — CSS custom properties

```css
:root {
  /* Surfaces — canvas → card → raised → hover, hairline-separated */
  --bg: #000000;
  --bg-raised: #0a0a0a;
  --bg-input: #050505;
  --bg-hover: #161616;
  --border: #1c1c1c;
  --border-strong: #2e2e2e;

  /* Text — white only, graded by luminance */
  --text: #f0f0f0;
  --text-dim: #8a8a8a;
  --text-faint: #4d4d4d;

  /* State — luminance and stroke, never hue */
  --ok: #f0f0f0;
  --warn: #8a8a8a;
  --danger: #f0f0f0; /* error text is bright, not red; see Error state */

  --mono: ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, monospace;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
}
```
