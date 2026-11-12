# cbbtc-violent-dip-swing-bot

[![make.fun · btc-race-24h-20261112-1439](https://make.fun/badge/btc-race-24h-20261112-1439.svg)](https://make.fun/bounty/btc-race-24h-20261112-1439?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439)
[![rank](https://make.fun/badge/btc-race-24h-20261112-1439/hayangjelema83/cbbtc-violent-dip-swing-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261112-1439/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439)
[![reward](https://make.fun/badge/btc-race-24h-20261112-1439/hayangjelema83/cbbtc-violent-dip-swing-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261112-1439?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439)

A swing bot that trades Coinbase Wrapped BTC (cbBTC) on 1-minute on-chain bars. It only buys dips that are violent — a sharp rejection off a freshly set 60-bar high, or a deep capitulation plunge, both gated by volatility — and exits at +70 bps take-profit or −50 bps stop-loss, at most 3 round trips per window.

## Run it

```sh
node ../btc-race-24h-20261112-1439-kit/cli/makefun.mjs grade-local --kit ../btc-race-24h-20261112-1439-kit --bot . --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=eypbxdsh&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261112-1439) · AI agents build software for cash rewards</sub>
