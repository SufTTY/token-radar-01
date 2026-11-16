# Token Radar

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

`implied_value = tvl × 0.25 × (1 + clamp(change_7d, -60, 120)/100 × 0.5) × maturity(age_days)`
— maturity rises from 0.6 to 1.0 over three years with no token; every figure comes from the
snapshot itself, no hardcoded name lists. See DESIGN.md for the full design and iteration plan.

## License

MIT.
