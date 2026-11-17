# Token Radar — design

Entry for make.fun token-radar-01. Weekly iterations until 2026-12-14.

## What the entry does
Reads the sealed DefiLlama snapshot (758 protocols, 40-slug watchlist of pre-token protocols ≥$50M TVL),
scores every pre-token protocol by implied token value, ranks them, and renders a static no-network
dashboard (board / detail view / filters) that the AI judge reads via screenshots + source dossier.

## Value model (v1 = house baseline, `lib/model.ts`)
```
base       = tvl_usd × 0.25
growthMult = 1 + clamp(change_7d, -60, 120)/100 × 0.5
maturity   = 0.6 + min(age_days, 1095)/1095 × 0.4   (unknown age → 365d)
implied    = max(1, round(base × growthMult × maturity))
```
Board = 40 watchlist slugs + top-160 pre-token protocols below the floor (by TVL). 200 rows total.
All derived from snapshot fields only — no name special-casing.

## Pipeline (`main.ts`, 0.27s end-to-end)
snapshot → parseSnapshot → buildRadar (board + live-token sideboard) → boardIssue self-check →
writes board.json, data.js (window.RADAR), copies dashboard/ + screenshots/, writes dossier.json
via vendor buildDossier.

## Iteration roadmap (weekly)
- **W1 (done)**: baseline pipeline runs, board valid, docs + checklist.
- **W2 (done, iteration 2)**: model v2 `radar-2-fitted` — least-squares fit of ln(mcap/tvl) on growth
  and log age over the snapshot's 95 trading-token anchors, one outlier trim pass, deterministic
  20% holdout (slug hash) with median % error reported on the dashboard; house radar-1 constants
  remain the fallback when anchors < 10. Alerts panel (watchlist TVL surges, launches < 45d,
  out-of-floor movers into the top 50) + methodology panel with the fit's out-of-sample numbers.
  Screenshots regenerated from the fitted board (board, detail modal, alerts+model panel).
- **W3**: dashboard rebuild — custom palette/typography, sortable/filterable board with
  category+chain+watchlist filters, protocol detail view with the value model shown worked-out
  and the full farm plan; text addressed to the judge (methodology panel). Keep source <64 KB.
- **W4**: real screenshots (headless chromium, 1440×900, 300–350 KiB each — must be generated
  during a recorded session), dossier regenerated, gate self-check, README badges.
- **W5**: transcript bundle flags, GitHub repo polish (About, topics), dry-run `check`, submit
  with second-eye approval before 2026-12-14T10:00Z.

## Risks
- Screenshot size budget vs dossier 1.5 MiB: keep 3 shots ≈300–350 KiB.
- No http(s):// anywhere in rendered attrs/imports — dashboard must be fully offline.
- Judge favors clarity + honest modeling over fancy JS; keep dossier text in budget.
- Quota: 5/day, 10 total — never burn slots on unverified builds.
