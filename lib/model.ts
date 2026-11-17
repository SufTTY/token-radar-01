// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures. The model is fitted, not assumed: the
// snapshot's trading tokens (market cap over TVL, by age and seven-day growth) anchor a least-squares
// fit in log space, and a deterministic 20% holdout scores it out of sample. When the snapshot carries
// too few anchors, the house constants of radar-1 take over:
//
//   base       = tvl_usd x BASE_MULTIPLE
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2-fitted';

/**
 * The fitted model: coefficients read off the snapshot's own trading tokens. Every live-token protocol
 * with a market cap, a TVL and a listed date is an anchor; the model is a least-squares fit in log space
 *
 *   ln(mcap / tvl) = b0 + b1 x (change_7d / 100) + b2 x ln(age_days + 30)
 *
 * so implied value stays a function of the same three snapshot figures, but the constants are measured,
 * not assumed. A deterministic 20% holdout (slug hash) scores the fit out of sample.
 */
export interface Fit {
  fitted: boolean;
  anchors: number;
  train: number;
  holdout: number;
  b0: number;
  b1: number;
  b2: number;
  median_age_days: number;
  train_error_pct: number | null;
  holdout_error_pct: number | null;
  trimmed: number;
}

/** The house fit of last resort, when the snapshot carries too few anchors to fit on. */
export const HOUSE_FIT: Fit = {
  fitted: false,
  anchors: 0,
  train: 0,
  holdout: 0,
  b0: Math.log(0.25) - 0.5 * Math.log(30),
  b1: 0.5,
  b2: 0,
  median_age_days: 365,
  train_error_pct: null,
  holdout_error_pct: null,
  trimmed: 0,
};

const GROWTH_FLOOR = -60;
const GROWTH_CAP = 120;

/** A deterministic 0..4 bucket from a slug, so the holdout split is reproducible byte for byte. */
function slugBucket(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % 5;
}

/** Solve a 3x3 linear system by Gauss elimination; null when it is singular. */
function solve3(a: number[][], y: number[]): number[] | null {
  const m = a.map((row, i) => [...row, y[i]!]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-10) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= 3; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/** Ordinary least squares on rows of [1, g, lnAge]; null when it cannot be solved. */
function ols(rows: number[][]): number[] | null {
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const aty = [0, 0, 0];
  for (const [one, g, la, yv] of rows) {
    const x = [one, g, la];
    for (let i = 0; i < 3; i++) {
      aty[i]! += x[i]! * yv;
      for (let j = 0; j < 3; j++) ata[i]![j] = ata[i]![j]! + x[i]! * x[j]!;
    }
  }
  return solve3(ata, aty);
}

/** The median of a numeric array. */
function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? 0 : n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Fit the value model on the snapshot's trading tokens; fall back to the house fit when data is thin. */
export function fitModel(snapshot: Snapshot): Fit {
  const anchors = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null)
    .map((p) => {
      const g = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, p.change_7d ?? 0)) / 100;
      const age = ageDays(snapshot.as_of, p.listed_at) ?? 365;
      return { slug: p.slug, g, la: Math.log(age + 30), y: Math.log(p.mcap_usd! / p.tvl_usd), age, tvl: p.tvl_usd, mcap: p.mcap_usd! };
    })
    .filter((a) => Number.isFinite(a.y) && a.mcap < 1e13 && a.tvl >= 1_000_000);
  if (anchors.length < 10) return HOUSE_FIT;

  let sample = anchors.filter((a) => slugBucket(a.slug) !== 0);
  let fit = ols(sample.map((a) => [1, a.g, a.la, a.y]));
  if (fit === null) return HOUSE_FIT;
  // One trim pass: anchors the first fit misses by more than 1.5 log units (32x) are data errors, not comps.
  let trimmed = 0;
  if (sample.length >= 12) {
    const kept = sample.filter((a) => {
      const resid = Math.abs(a.y - (fit![0]! + fit![1]! * a.g + fit![2]! * a.la));
      if (resid > 1.5) { trimmed++; return false; }
      return true;
    });
    if (kept.length >= 8) {
      const refit = ols(kept.map((a) => [1, a.g, a.la, a.y]));
      if (refit !== null) { fit = refit; sample = kept; }
    }
  }

  const predict = (a: { tvl: number; mcap: number; g: number; la: number }): number => a.tvl * Math.exp(fit![0]! + fit![1]! * a.g + fit![2]! * a.la);
  const errPct = (list: typeof anchors): number | null => {
    if (list.length === 0) return null;
    return median(list.map((a) => Math.abs(predict(a) - a.mcap) / a.mcap)) * 100;
  };
  const holdout = anchors.filter((a) => slugBucket(a.slug) === 0);
  return {
    fitted: true,
    anchors: anchors.length,
    train: sample.length,
    holdout: holdout.length,
    b0: fit[0]!,
    b1: fit[1]!,
    b2: fit[2]!,
    median_age_days: median(anchors.map((a) => a.age)),
    train_error_pct: errPct(sample),
    holdout_error_pct: errPct(holdout),
    trimmed,
  };
}

/** One radar alert: a watchlist or board row the snapshot itself flags, with the reason. */
export interface Alert {
  slug: string;
  name: string;
  kind: 'surge' | 'new-launch' | 'top-mover';
  rank: number | null;
  detail: string;
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit, and the alerts it raises. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: Fit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  alerts: Alert[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets: fitted when the snapshot allows it. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, fit: Fit = HOUSE_FIT): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const ageForModel = age ?? fit.median_age_days;
  let implied: number;
  let growthMult: number;
  let maturityMult: number;
  if (fit.fitted) {
    // implied = tvl x exp(b0 + b1 x g + b2 x ln(age + 30)); the multipliers below decompose the same
    // number as base x growth x maturity, so the board's row and the dashboard's arithmetic agree.
    const lg = growthPct / 100;
    const lm = Math.log(ageForModel + 30);
    implied = protocol.tvl_usd * Math.exp(fit.b0 + fit.b1 * lg + fit.b2 * lm);
    growthMult = Math.exp(fit.b1 * lg);
    maturityMult = Math.exp(fit.b2 * (lm - Math.log(30)));
  } else {
    growthMult = 1 + (growthPct / 100) * model.growth_weight;
    maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    implied = protocol.tvl_usd * model.base_multiple * growthMult * maturityMult;
  }
  return { implied: Math.max(1, Math.round(implied)), growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; fit: Fit } {
  const fit = fitModel(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, fit);
    return { p, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // The fitted coefficients decompose into the row's three shown multipliers: base x growth x maturity
  // multiplies back to exactly the fitted implied value, so the page can recompute the board's number.
  const baseEff = fit.fitted ? Math.exp(fit.b0 + fit.b2 * Math.log(30)) : model.base_multiple;
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: Math.round(baseEff * 1e6) / 1e6,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, fit };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** The alerts the snapshot itself raises on the board: surges, fresh launches, top movers. */
export function buildAlerts(board: BoardRow[], snapshot: Snapshot): Alert[] {
  const watch = new Set(snapshot.watchlist);
  const alerts: Alert[] = [];
  // Watchlist surges first: a pre-token protocol the watchlist tracks whose TVL jumped this week.
  for (const r of board) {
    if (watch.has(r.slug) && r.change_7d !== null && r.change_7d >= 25) {
      alerts.push({ slug: r.slug, name: r.name, kind: 'surge', rank: r.rank, detail: `Watchlist TVL ${r.change_7d >= 0 ? '+' : ''}${r.change_7d.toFixed(1)}% in seven days, now ranked #${r.rank}.` });
    }
  }
  // Fresh launches: board rows listed within the last 45 days.
  for (const r of board) {
    if (r.age_days !== null && r.age_days <= 45) {
      alerts.push({ slug: r.slug, name: r.name, kind: 'new-launch', rank: r.rank, detail: `Listed ${r.age_days} day${r.age_days === 1 ? '' : 's'} ago, ranked #${r.rank} with no token on record.` });
    }
  }
  // Top movers across the whole board, beyond the watchlist floor.
  for (const r of board) {
    if (!watch.has(r.slug) && r.change_7d !== null && r.change_7d >= 60 && r.rank <= 50) {
      alerts.push({ slug: r.slug, name: r.name, kind: 'top-mover', rank: r.rank, detail: `Below the watchlist floor but TVL ${r.change_7d >= 0 ? '+' : ''}${r.change_7d.toFixed(1)}% in seven days, ranked #${r.rank}.` });
    }
  }
  // Dedupe: a slug keeps its first (strongest) alert.
  const seen = new Set<string>();
  const unique = alerts.filter((a) => (seen.has(a.slug) ? false : (seen.add(a.slug), true)));
  return unique.slice(0, 12);
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, fit } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: fit.fitted ? MODEL_VERSION : 'radar-1-house',
    fit,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    alerts: buildAlerts(board, snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
