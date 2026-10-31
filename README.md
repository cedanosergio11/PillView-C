# PillView 1.0.4.0

> **PillView-C** is a preview copy of [mpd-360-pill-calculator](https://github.com/cedanosergio11/mpd-360-pill-calculator) with the fixes from the Claude review (simulator trip tank fill, 10,000 ft well depth floor). Preview site: https://cedanosergio11.github.io/PillView-C/ — the live app below is the original.

MPD 360 kill-weight-mud (KMW) **pill calculator** and interactive **wellbore simulator**.

**Live:** https://cedanosergio11.github.io/mpd-360-pill-calculator/

This repository is now **PillView 1.0.4.0**. The old vanilla calculator (`app.js`, root `index.html`, `styles.css`) is gone. The app is a Vite + React + TypeScript workspace; HTML is generated from `src/routes/__root.tsx` (TanStack Start), not a root `index.html`.

**Version:** `1.0.4.0` (`src/lib/version.ts`) — GitHub Pages SPA. Full history in `CHANGELOG.md`.

## Quick start

```bash
npm i
npm test
npm run dev
```

Dev server listens on `http://localhost:8080`.

- `npm test` runs Vitest on `src/**/*.test.ts` (calc + simulator). `scripts/verify-calc.mjs` is a standalone EXAMPLE 1 regression.
- `npm run typecheck` for `tsc --noEmit`.
- `npm run build:pages` builds a static SPA for GitHub Pages (`dist/client`).

## Layout

| Area | Path |
|---|---|
| Workbook calculator | `src/lib/calc/` |
| Wellbore simulator | `src/lib/pill/` |
| UI (procedure, schematic, schedule) | `src/components/` |
| Routes / shell | `src/routes/` |

Auth is off: `src/lib/auth/provider.tsx` is a passthrough. Wells persist in `localStorage` on this device.

The old vanilla `app.js` is gone.
