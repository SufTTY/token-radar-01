# token-radar-01 — deliverable checklist

Competition: make.fun "Build the best token launch radar" — $1,325 pot, deadline **2026-12-14T10:00Z**.
Scoring: AI judge compares dashboards pairwise (screenshots + source via dossier.json); Bradley-Terry win rate over Swiss rounds + playoff. Rewards to top 10 of final heat.

## Gate (Valid = all 7 pass) — iteration 2 self-check: all 7 verified 2026-11-17
- [x] `dashboard/`: index.html + ≥1 .css + ≥1 .js; ≤400 files, ≤4 MiB; names `[A-Za-z0-9._-]`; **no http(s):// in HTML attrs, CSS, or JS import/require/dynamic-import specifiers** (visible text/comments OK) — verified: 3 files, 33 KB, 0 network refs
- [x] `board.json`: object with `rows` array, 100–4,000 rows, ≤8 MiB; each row: `slug` (snapshot protocol, unique, ≤128 chars no ws), non-empty `name`, positive int `rank`, positive int `implied_value_usd` ≤1e14, `farm_steps` 3–12 strings each 20–600 chars trimmed — verified: 200 rows, self-check 0 issues
- [x] sorted_by_value: ranks exactly 1..N; implied_value non-increasing by rank; not all-equal values — verified
- [x] coverage: **all 40 watchlist slugs present** (watchlist is floor, not ceiling — ≥60 more rows needed) — verified: 40/40, 200 rows
- [x] farm_steps validity (above) — concrete steps with cost + time — verified
- [x] `screenshots/`: 3–4 PNG/JPEG, ≤512 KiB each, long side ≤1440, short side ≥800; **target 300–350 KiB each** — verified: 3 PNGs 144–218 KiB, 1440×900, regenerated from the fitted board
- [x] `dossier.json`: byte-exact `buildDossier('/output', {text_max_bytes: 65536})` output, ≤1.5 MiB — verified: 908 KB

## Judge criteria (priority order)
1. Working radar: covers watchlist, ranks by stated implied value, screenshots agree with code
2. Value model: implied value derives from TVL, change_7d, age-without-token — **no hardcoded name lists**; separates live-token from pre-token
3. Farm plans: concrete cost + time per step, not slogans
4. Dashboard UX: sortable, filterable, readable at a glance, per-protocol detail view
5. Looks made: chosen palette, consistent spacing, real typography — not a pasted framework

## Repo / intake
- [ ] main.ts at repo root, runs on Node 22.18+ (stdlib only), reads /input/snapshot.json, writes /output (MAKEFUN_OUTPUT_DIR for local runs)
- [ ] `vendor/makefun-board.ts` from kit, present
- [ ] LICENSE with SPDX-License-Identifier: MIT
- [ ] README with the three make.fun badge images + make.fun links, no `{owner}` placeholders
- [ ] GitHub About: make.fun homepage + topic `makefun`
- [ ] Public GitHub repo (SufTTY/<slug>), commit_sha on a branch, pushed **before** submit
- [ ] Transcripts: session.json handed over via kit `bundle` (harness/model/instructions/system-prompt flags set; ≥2 file writes to entrypoint; ≥5 assistant text turns)
- [ ] Quota: ≤5/day, ≤10 total for us; last submission before deadline is final — **do not submit without second-eye approval**

## Run record (mandatory from 2026-11-17)
- [ ] bundle flags: --harness Hermes --provider nous --model <served id, not "auto"> --effort default --instructions withheld:<why> --system-prompt withheld:<why> --mcp none
