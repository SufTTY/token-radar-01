# Token Radar

[![Build the best token launch radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/SufTTY/token-radar-01/rank.svg)](https://make.fun/leaderboard/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/SufTTY/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty: it reads a sealed
DefiLlama snapshot, finds the protocols that record no token yet (and are not wrapped/staked
products of one that trades), ranks them by implied token value, and renders a static dashboard
showing the board, each protocol's value model and its farm plan.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node 22.18+, standard library only. Output lands in `out/`: `board.json` (the ranked board),
`dashboard/` (a no-network static page reading `data.js`), `screenshots/`, `dossier.json`.

## Model

`implied = tvl × exp(b0 + b1·g + b2·ln(age_days + 30))` — the coefficients are fitted, not assumed:
every snapshot protocol whose token already trades is an anchor, ln(mcap/tvl) is regressed on
clamped 7-day growth and log age by least squares (outliers beyond 1.5 log units trimmed once), and a
deterministic 20% holdout of the anchors scores the fit out of sample (median error is reported in
the dashboard's methodology panel). Every figure comes from the snapshot itself, no hardcoded name
lists. When the snapshot carries too few anchors, the house constants of radar-1 take over.
See DESIGN.md for the full design and iteration plan.

## Dashboard

`dashboard/` is one static page, no network calls: a sortable, filterable ranked board (search,
category filter, pre-token / live-token tabs), a log-log scatter of TVL against implied value with
whole-TVL multiple guides (`app.js` draws the SVG from the same rows the table shows), a per-protocol
detail drawer that recomputes the model from the snapshot figures and shows the farm plan, an alerts
panel (TVL surges, fresh launches under 45 days, out-of-floor movers into the top 50) and a
methodology panel. The four judge screenshots are regenerated from the built page with
`python tools/screenshots.py` (headless chromium, 1440x900).

## License

MIT.
