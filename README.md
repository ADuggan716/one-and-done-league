# One and Done Companion

Local-first One and Done toolkit for:
- Public dashboard (`/public/index.html`) with league + subgroup + team comparisons and used/available golfer matrix
- Private strategy page (`/private/recommendations.html`) with top-5 weekly recommendations
- Automated weekly data refresh from RunYourPool and optional online signal feeds

## Quick start

1. Copy config and edit values:
   - `config/config.example.json` -> `config/config.json`
2. Put your RunYourPool session cookie in:
   - `config/runyourpool.cookie`
3. Start local server:
   - `npm run serve`
4. Open:
   - `http://localhost:8080/public/index.html`
   - `http://localhost:8080/private/recommendations.html`

## Data pipeline

- Fetch online form/history/course signals:
  - `npm run fetch:signals`
- Sync RunYourPool + build all JSON outputs:
  - `npm run sync`
- Recompute recommendations only:
  - `npm run recommend`

Outputs:
- `data/league_snapshot.json`
- `data/player_pool.json`
- `data/recommendations.json`

## Weekly automation (macOS)

Install Thursday 9:00 AM local job:

```bash
./scripts/install_launchd.sh
```

This runs:
1. `node scripts/fetch_online_signals.mjs`
2. `node scripts/sync_runyourpool.mjs`

## Testing

```bash
npm test
```
