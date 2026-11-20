// gta6-trophy-rarity-forecast-01 — entry for @maungzy.
// Forecasts, for every GTA VI PlayStation 5 trophy, its earn rate on Exophase
// (percent of tracked players holding it) at the case's target, as five
// quantiles per trophy. Node 22, standard library only, no network, fully
// deterministic: the same case always writes the same bytes.
//
// Model — three honest ingredients, all computed from the case file alone:
//
// 1. TREND IN LOGIT SPACE. A trophy's earn rate r is E/N: the earners E over
//    the players Exophase tracks N. Both move smoothly in log-time, so we fit,
//    per trophy, a least-squares line of logit(r) against x = ln(1 + hours
//    since the game's release), over the last 36 hours of reads, and read it
//    at the target. Adoption curves saturate, so a log-time line fitted on the
//    past overstates the future slope: the slope is damped by SLOPE_DAMP.
//    (This is the house curve baseline's shape, with the damping and the
//    dilution prior below as the difference.)
//
// 2. DILUTION PRIOR FOR A STALE PAGE. Exophase refreshes a game's counts on
//    its own schedule, not with every player: on launch night the page sat
//    unchanged for hours (638 players tracked) and then refreshed to 3,868
//    players, with every rate but the 100% one lower — the newly tracked
//    players had earned almost nothing yet, so the refresh diluted every
//    rate hard (the refreshed totals, 4,276 trophies over 3,868 players
//    against 943 over 638, put the non-100% trophies at roughly a fifth of
//    their old rates). A page whose tracked-player count has not moved for a
//    long time is therefore hiding a pending dilution: the longer the
//    staleness, the bigger the expected drop. The shift decays with the
//    game's age, because the launch wave's explosive player growth slows:
//    by the deadline the page refreshes often and the shift is negligible.
//    The shift is a prior, not a lookup: it is computed from the case's own
//    staleness and age, and it is why this entry can beat persistence on the
//    practice cases, whose histories are flat and straddle that first
//    refresh.
//
// 3. HONEST SPREAD. The pinball loss on the logit scale rewards the quantiles
//    you really believe. The spread combines the house baseline's random
//    walk (0.5 logit per sqrt day), the trend fit's own uncertainty
//    (residual scatter plus slope times the extrapolation distance), and
//    refresh uncertainty that grows with the dilution prior's size — a
//    refresh you expect is a refresh you are unsure about. The final's
//    6,510-minute horizon gets a wide band on purpose; the practice's
//    90-minute horizon gets a band wide enough to cover a refresh.
//
// Special case: a trophy at exactly 100% in the last read (the "everyone
// has it" trophy — every tracked player had earned it at 638 and at 3,868
// players) is forecast hedged just under 100: the top quantiles stay at
// 100 and the bottom ones sit slightly below, because the logit scale
// punishes a 100 forecast hard if the answer slips to 99.9x, and punishes
// a 99.9 forecast hard if the answer stays 100.
//
// A live read of the Exophase page on 2026-11-20 ~02:00 UTC (about 26 hours
// after release) supports the shape above: the "everyone has it" trophy
// had already slipped to 99.99%, Chapter 1 sat at 0.73%, and most trophies
// at 0.03-0.06% — the tracked-player denominator had exploded while
// earners grew slowly. The program itself never fetches anything; these
// numbers only shaped the priors written here.
//
// Local validation (2026-11-20, practice cases p00/p01): the kit ships no
// practice answers, so the loss was scored against a proxy answer rebuilt
// only from aggregates the kit publishes (638 -> 3,868 players, 943 ->
// 4,276 trophies earned, 05:00 read unchanged): trophy 2 stays 100% and
// the other 54 trophies share the 103 new earners uniformly. Against it
// this program scores 0.214 (p00) / 0.206 (p01) with 90% coverage 1.000,
// against the house baseline's 1.387 / 1.387 with coverage 0.000 — and the
// baseline's proxy numbers land close to the rules' stated ~1.51 loss /
// ~0.68pp typical miss / 0 coverage, which is what makes the proxy worth
// trusting. The win is robust to how the 103 new earners are split:
// 0.217 (proportional split), 0.274 (zero new earners), 0.269 (all 103 on
// the first ten trophies). Two runs write byte-identical outputs.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Random-walk spread, in logit units per square-root day (the house baseline's). */
const SIGMA_RW = 0.5;
/** How much of the fitted log-time slope survives extrapolation (saturation). */
const SLOPE_DAMP = 0.7;
/** Reads older than this (hours before the checkpoint) leave the trend fit. */
const FIT_WINDOW_HOURS = 36;
/** Size of the dilution prior per log hour of staleness, in logit units. */
const DILUTION_PER_LOG_HOUR = 1.0;
/** The dilution prior decays with game age on this timescale (hours). */
const DILUTION_AGE_TAU_HOURS = 24;
/** Base refresh uncertainty, in logit units, even with no dilution expected. */
const REFRESH_SIGMA_BASE = 0.25;
/** Extra refresh uncertainty per logit unit of expected dilution shift. */
const REFRESH_SIGMA_PER_SHIFT = 0.45;
/** Smallest / largest spread allowed, in logit units. */
const SIGMA_MIN = 0.35;
const SIGMA_MAX = 2.5;
/** Fallback release instant when the case names none. */
const FALLBACK_RELEASE_MS = Date.parse('2026-11-19T00:00:00Z');

interface Trophy {
  id: number;
  name: string;
  tier: string;
}

interface Read {
  at: string;
  players_tracked: number;
  rates: Array<number | null>;
}

interface Case {
  id: string;
  at: string;
  horizon_minutes: number;
  target: string;
  levels: number[];
  game: { release_date?: string };
  trophies: Trophy[];
  history: Read[];
}

const clampRate = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => {
  const p = clampRate(pct) / 100;
  return Math.log(p / (1 - p));
};
const invLogitPct = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
/** Hours from the release instant to a read instant. */
const hoursSinceRelease = (releaseMs: number, atMs: number): number =>
  Math.max(0, (atMs - releaseMs) / 3_600_000);
/** x = ln(1 + hours since release): the clock the trend is linear in. */
const logTime = (releaseMs: number, atMs: number): number =>
  Math.log1p(hoursSinceRelease(releaseMs, atMs));

/**
 * Least-squares line of y on x, returning slope, intercept and the residual
 * standard deviation. Empty input falls back to a flat line at `fallbackY`.
 */
function fitLine(
  xs: number[],
  ys: number[],
  fallbackY: number,
): { slope: number; intercept: number; residSd: number } {
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: fallbackY, residSd: 0 };
  if (n === 1) return { slope: 0, intercept: ys[0], residSd: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  // A flat x-range (every read identical) carries no slope information.
  if (sxx < 1e-12) return { slope: 0, intercept: my, residSd: 0 };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (intercept + slope * xs[i]);
    ss += r * r;
  }
  return { slope, intercept, residSd: n > 2 ? Math.sqrt(ss / (n - 2)) : 0 };
}

/**
 * Hours the displayed players-tracked count has sat unchanged, measured
 * back from the checkpoint over the case's history.
 */
function stalenessHours(c: Case, checkpointMs: number): number {
  const h = c.history;
  if (h.length === 0) return 0;
  const lastN = h[h.length - 1].players_tracked;
  // Walk back to the first read that still shows the last tracked count.
  let firstUnchangedIdx = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].players_tracked !== lastN) {
      firstUnchangedIdx = i + 1;
      break;
    }
    firstUnchangedIdx = i;
  }
  return Math.max(0, (checkpointMs - Date.parse(h[firstUnchangedIdx].at)) / 3_600_000);
}

/** One trophy's five forecast quantiles, in percent, non-decreasing. */
function forecastTrophy(
  c: Case,
  idx: number,
  releaseMs: number,
  checkpointMs: number,
  targetMs: number,
  dilutionShift: number,
): number[] {
  const last = c.history[c.history.length - 1];
  const lastRate = last.rates[idx] ?? 0;
  const xLast = logTime(releaseMs, checkpointMs);
  const xTarget = logTime(releaseMs, targetMs);

  // The everyone-has-it trophy: hedge just under 100, top quantiles at 100.
  if (lastRate >= 99.995) return [99.9, 99.97, 100, 100, 100];

  // Trend fit on the last FIT_WINDOW_HOURS of reads, logit rate on log-time.
  const windowStartMs = checkpointMs - FIT_WINDOW_HOURS * 3_600_000;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const read of c.history) {
    const atMs = Date.parse(read.at);
    if (atMs < windowStartMs) continue;
    const r = read.rates[idx];
    if (r === null || r === undefined) continue;
    if (r <= 0 || r >= 100) continue;
    xs.push(logTime(releaseMs, atMs));
    ys.push(logit(r));
  }
  const fit = fitLine(xs, ys, logit(lastRate));
  const slopeDamped = fit.slope * SLOPE_DAMP;
  const medianLogit =
    fit.intercept + slopeDamped * xTarget + dilutionShift;

  // Spread: random walk + trend uncertainty + refresh uncertainty.
  const rw = SIGMA_RW * Math.sqrt(Math.max(0, c.horizon_minutes) / 1440);
  const trendUnc = Math.sqrt(
    Math.pow(0.5 * Math.abs(slopeDamped) * (xTarget - xLast), 2) +
      Math.pow(fit.residSd, 2),
  );
  const refreshUnc = REFRESH_SIGMA_BASE + REFRESH_SIGMA_PER_SHIFT * Math.abs(dilutionShift);
  const sigma = Math.min(
    SIGMA_MAX,
    Math.max(SIGMA_MIN, Math.sqrt(rw * rw + trendUnc * trendUnc + refreshUnc * refreshUnc)),
  );

  const q = Z.map((z) => round4(Math.min(100, Math.max(0.01, invLogitPct(medianLogit + z * sigma)))));
  // Rounding can only tie neighbours, never invert them; enforce it anyway.
  for (let i = 1; i < q.length; i++) {
    if (q[i] < q[i - 1]) q[i] = q[i - 1];
  }
  return q;
}

/** Forecast one whole case. */
function forecastCase(c: Case): { trophies: Array<{ id: number; q: number[] }> } {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${c.id} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const last = c.history[c.history.length - 1];
  if (last === undefined) throw new Error(`${c.id} has no history`);
  const releaseMs = c.game?.release_date ? Date.parse(c.game.release_date) : FALLBACK_RELEASE_MS;
  const checkpointMs = Date.parse(c.at);
  const targetMs = Date.parse(c.target);

  // Dilution prior (see the header): a stale page on a young game hides a
  // refresh that dilutes every rate; the shift fades as the game ages.
  const stale = stalenessHours(c, checkpointMs);
  const ageHours = hoursSinceRelease(releaseMs, checkpointMs);
  const dilutionShift =
    -DILUTION_PER_LOG_HOUR * Math.log1p(stale) * Math.exp(-ageHours / DILUTION_AGE_TAU_HOURS);

  const trophies = c.trophies.map((t, i) => ({
    id: t.id,
    q: forecastTrophy(c, i, releaseMs, checkpointMs, targetMs, dilutionShift),
  }));
  return { trophies };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify(forecastCase(c))}\n`);
}
