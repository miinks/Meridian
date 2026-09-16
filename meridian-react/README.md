# Meridian (React)

A React + Vite rebuild of Meridian — a quieter live flight map powered by
[OpenSky Network](https://opensky-network.org) positions and
[OpenFreeMap](https://openfreemap.org) tiles via MapLibre GL.

This is a faithful port of the original vanilla-JS app in the repository root.
All behaviour is preserved: live polling, bounding-box + worldwide search,
pause/resume with rate-limit handling, airborne-only filtering, follow mode,
trails, animated interpolation, and the flight detail sheet.

## Architecture

- **Frontend** (`src/`): React components render the HUD, results dropdown,
  detail sheet, and tooltip. The imperative map/polling/quota logic lives in
  `src/lib/controller.js` (`MeridianController`), which drives MapLibre and
  calls back into React via `setState` callbacks.
- **Backend proxy**: the browser cannot call OpenSky directly, so `/api/*` is
  proxied to the Python server (`../server.py`), which handles OAuth token
  refresh and rate-limit headers. In dev this proxy is configured in
  `vite.config.js`.

## Develop

The Python proxy and the Vite dev server run side by side:

```bash
# terminal 1 — OpenSky proxy on :8000
cd .. && PORT=8000 python3 server.py

# terminal 2 — Vite dev server on :5173 (proxies /api -> :8000)
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

Set `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` (or a `credentials.json` next
to `server.py`) for authenticated OpenSky access; otherwise it runs anonymously.

Override the proxy target with `MERIDIAN_API_TARGET` if the Python server runs
elsewhere.

## Scripts

- `npm run dev` — Vite dev server with HMR.
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the production build (also proxies `/api`).
- `npm run lint` — ESLint.
