# feed1

A Last.fm Discord bot written in TypeScript. Now-playing, top-album charts,
who-knows rankings, a full crowns system, and RateYourMusic link tooling, on prefix
commands (`-fm`, `-w`, `-wk`, ...).

The pre-rewrite JavaScript codebase is preserved at the git tag [`legacy`](../../tree/legacy).

## Stack

- Node 22, TypeScript (strict), discord.js v14 (prefix commands via Message Content intent)
- better-sqlite3 + Drizzle ORM, migrations applied automatically at startup
- node-canvas for chart images, vitest for the test suite

## Development

```sh
npm install
cp .env.example .env    # fill in the DEV bot token + Last.fm API key
npm run dev
```

`npm test` runs the suite; `npm run typecheck` and `npm run lint` do what they say.
`npm run smoke` drives a running dev bot over real Discord (see `test/live/smoke.ts`).

## Deployment

GitHub Actions deploys `main` to an Oracle Cloud free-tier VM over SSH.
See [deploy/README.md](deploy/README.md) for the one-time setup.

## Commands

Run `-help` for the generated list; `-help <command>` for details, aliases, and usage.
