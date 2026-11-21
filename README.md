# GTA VI trophy rarity forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/zynthlabsio/gta6-trophy-rarity-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/zynthlabsio/gta6-trophy-rarity-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecasts, for every Grand Theft Auto VI PlayStation 5 trophy, its earn rate
on [Exophase](https://www.exophase.com/game/grand-theft-auto-vi-psn/trophies/)
at 2026-11-26T00:00:00Z — the percent of the players Exophase tracks who
have earned it, a week after launch — as five quantiles per trophy.

Entry for the make.fun bounty
[gta6-trophy-rarity-forecast-01](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
by [Zynth Labs](https://make.fun) ($250 over 20 paid places).

## Program

`main.ts` (Node 22, standard library only, no network, deterministic) reads
every `<id>.in` case in `/input` (or `$MAKEFUN_INPUT_DIR`) and writes
`/output/<id>.out` (or `$MAKEFUN_OUTPUT_DIR`): `{"trophies": [{"id": n,
"q": [q05, q25, q50, q75, q95]}, ...]}`.

## Model

Three ingredients, all computed from the case file alone — see the header
comment in `main.ts` for the full reasoning:

1. **Trend in logit space.** Per trophy, a least-squares line of
   `logit(rate)` against `ln(1 + hours since release)` over the last 36
   hours of reads, read at the target, with the slope damped ×0.7 because
   adoption curves saturate.
2. **Dilution prior for a stale page.** Exophase refreshes counts on its own
   schedule: on launch night the page sat unchanged at 638 players tracked,
   then refreshed to 3,868 with every rate but the 100% one lower. A page
   whose tracked count has not moved for a long time is hiding a pending
   dilution; the shift grows with staleness and fades as the game ages.
3. **Honest spread.** Random walk (0.5 logit per √day) + trend-fit
   uncertainty + refresh uncertainty that grows with the expected dilution.

The trophy at exactly 100% is forecast hedged just under 100
(`[99.9, 99.97, 100, 100, 100]`).

## Local validation

The kit ships no practice answers, so practice losses were scored against
a proxy answer rebuilt only from aggregates the kit publishes (638 →
3,868 players, 943 → 4,276 trophies earned). Against it this entry scores
**0.214 (p00) / 0.206 (p01)** with 90% coverage 1.000, against the house
baseline's 1.387 / 1.387 with coverage 0.000 (the rules state the baseline
at ~1.51 loss, ~0.68pp typical miss, 0 coverage — the proxy lands close
enough to trust). The win holds under every split of the new earners
tried (0.217–0.274). Two runs write byte-identical outputs.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7vbpbe2y&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
