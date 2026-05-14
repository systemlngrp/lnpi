# Hostinger Node Deployment

This app is not a static-only website. It needs:

- the Vite frontend build in `dist/`
- the Express backend in `server.ts`
- database environment variables for Hostinger MySQL

## Why FTP deploy is not enough

The browser requests:

- `/api/material-in`
- `/api/productions`
- `/api/consumptions`
- `/api/items`

These routes are created by `server.ts`, not by the static `dist/` folder.

If only `dist/` is uploaded to `public_html`, the frontend loads but `/api/*` returns `404`.

## Correct Hostinger deployment

Deploy this repository as a **Node.js Web App** in Hostinger hPanel.

Hostinger settings:

- Deployment type: `Node.js Apps`
- Source: `Import Git Repository`
- Repository: this repo
- Build command: `npm run build`
- Start command: `npm start`
- Output directory: `dist`
- Entry file: `server.js`

## Required environment variables

Add these in Hostinger Node.js app environment variables:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT`

## Notes

- `npm run build` now creates both:
  - `dist/` for the frontend
  - `server.js` for the Express backend runtime
- `server.ts` reads `process.env.PORT`, so Hostinger can assign the runtime port.
- The old FTP workflow is intentionally blocked because it deploys only the frontend and breaks live data.
