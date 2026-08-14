# feed1

A Last.fm Discord bot written in TypeScript. Now-playing, top-album charts,
who-knows rankings, a full crowns system, RateYourMusic link tooling, and rotating
server banners, on prefix commands (`-fm`, `-w`, `-wk`, ...).

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

GitHub Actions deploys `main` to an Oracle Cloud free-tier VM over SSH. Bump `version` in
`package.json` as part of your PR; each merge tags that version and publishes a
[GitHub Release](../../releases). Every merge bumps — see [VERSIONING.md](VERSIONING.md) for which
number and why, and [deploy/README.md](deploy/README.md) for the one-time setup and rollbacks.

## Commands

Run `-help` for the generated list; `-help <command>` for details, aliases, and usage.

`-banner` is the one command with its own subcommands. You build a pool of images with
`-banner add` — attach one, paste a link, or reply to a message that has one — then
`-banner start [interval]` rotates the server banner through them. `-banner gallery` flips
through the pool one image at a time. Images are stored on the bot's own disk, so nothing
depends on a third-party host staying up. Needs a server at boost level 1 or higher (Discord's
requirement for having a banner at all), and Manage Server for anything that changes state.
