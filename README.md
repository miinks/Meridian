# Meridian

A quieter live flight map powered by
[OpenSky Network](https://opensky-network.org) positions and
[OpenFreeMap](https://openfreemap.org) tiles via MapLibre GL.

The site is the React + Vite app at the repo root.
`server.py` is the OpenSky API proxy (browsers cannot call OpenSky directly).

## Develop

```bash
# terminal 1 — OpenSky proxy on :8000
PORT=8000 python3 server.py

# terminal 2 — Vite on :5173 (proxies /api -> :8000)
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

Set `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` (or a `credentials.json` next
to `server.py`) for authenticated OpenSky access; otherwise it runs anonymously.

After `npm run build`, `server.py` can also serve the production bundle from
`dist/`.

Override the proxy target with `MERIDIAN_API_TARGET` if the Python server runs
elsewhere.

## Scripts

- `npm run dev` — Vite dev server with HMR.
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the production build (also proxies `/api`).
- `npm run lint` — ESLint.
- `npm run airports` — rebuild `public/airports.json` from OurAirports.
- `npm run airlines` — rebuild `public/airlines.json` from OpenFlights.

## Citation

Matthias Schäfer, Martin Strohmeier, Vincent Lenders, Ivan Martinovic and Matthias Wilhelm.
"Bringing Up OpenSky: A Large-scale ADS-B Sensor Network for Research".
In Proceedings of the 13th IEEE/ACM International Symposium on Information Processing in Sensor Networks (IPSN), pages 83-94, April 2014.
