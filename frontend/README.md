# Plague Inc. Tracker frontend

The Vite/React frontend reads live game data through the backend's SSE stream
and historical daily snapshots through its read-only REST API. It does not
write snapshots locally or poll `/live` every 250 ms.

## Development

Start the backend first (defaults to `127.0.0.1:3001`), then run:

```powershell
npm install
npm run dev
```

Vite serves the frontend on port 5173 and proxies `/api` to
`http://127.0.0.1:3001`, including the long-lived SSE connection. The default
API base URL is same-origin `/api/v1`; set `VITE_API_BASE_URL` to override it.
No backend CORS change is required for the default development setup.

```powershell
npm test
npm run build
npm run lint
```

The data layer is in `src/api`, the live and history hooks in `src/hooks`, and
pure metric/formatting/chart helpers in `src/domain`. LIVE stores only the
latest snapshot; HISTORY reads only observed daily points from SQLite via
REST. A new live `sessionId` replaces the active snapshot instead of mixing
sessions. EventSource reconnects automatically and is closed when the final
React subscriber unmounts.

The dashboard uses a dark desktop-first layout with day/date/session summary,
global population cards, cure indicator, and searchable country details. LIVE
shows only the latest SSE snapshot; its historical charts intentionally live in
HISTORY, which reads observed daily points through REST. Chart X values are
authoritative game days, so missing days are not interpolated. Population
percentages are presentation-only and use original population as denominator.

Country IDs remain raw backend IDs in API requests and storage. HISTORY loads
the selected session's country list from `/sessions/:sessionId/countries`, so
country selection and history work when no game is running. Display labels
only replace underscores with spaces and capitalize words; no 58-country
mapping is hardcoded.
