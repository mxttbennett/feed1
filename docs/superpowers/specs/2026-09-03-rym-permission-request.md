# Permission request to Sonemic — RYM activity feed access

Supporting artefact for [2026-09-03-rymfeed-design.md](2026-09-03-rymfeed-design.md), which is
blocked until this is answered.

## Where to send it

`robots.txt` line 1 directs to `https://rateyourmusic.com/tos` for the express-permission process.
The contact address could not be retrieved from here — every automated request to the site returns
`403`, which is the whole reason this letter exists — so pull it from
`https://rateyourmusic.com/contact` in a browser. Prefer a named contact or support form over a
generic address if one is offered.

## Why this ask is worth making

RYM publishes a per-user RSS feed at `/~<username>/data/rss`. RSS has no human use case; publishing
it is an invitation to machine consumption. That sits in genuine tension with `robots.txt`'s
`User-agent: * / Disallow: /`, and the composition of the block list suggests the tension is
accidental rather than intended — of ~60 named agents, the overwhelming majority are LLM training
crawlers (`GPTBot`, `ClaudeBot`, `CCBot`, `Bytespider`, `PerplexityBot`, `anthropic-ai`,
`meta-externalagent`, `Google-Extended`) and the feed aggregators caught alongside them
(`AwarioRssBot`, `NewsNow`, `Jetslide`, `news-please`) are commercial content-republishing services.
Allow-lists exist only for bots that send traffic back: `googlebot`, `msnbot`, `Slurp`, `Twitterbot`.

That is a policy about content extraction at scale. It is not obviously a policy about a handful of
people reading their own feeds through a tool they chose. Express permission is the mechanism
`robots.txt` itself names for resolving exactly that gap.

## Draft

> **Subject:** Permission request — reading user activity RSS feeds for a small Discord bot
>
> Hello,
>
> I maintain a small open-source Discord bot for a private server of music friends. It is a hobby
> project with no commercial use, no advertising, and no public deployment — one server, about five
> people. Source: https://github.com/mxttbennett/feed1
>
> I would like to ask permission for one narrow thing. RYM publishes a per-user activity feed at
> `/~<username>/data/rss`. I would like the bot to read that feed for members who have explicitly
> opted in, so that when someone rates an album it can post a link to the release in our chat.
>
> Concretely, what I am asking to do:
>
> - **Only opted-in members, only their own feed.** Each person enables it for themselves with a
>   command; the bot never reads a feed belonging to someone who has not asked it to.
> - **One conditional `GET` per member per hour**, using `If-Modified-Since`/`ETag`. At our size
>   that is roughly five requests an hour — less traffic than one person browsing the site for a
>   minute. I am happy to make the interval longer, or to accept any rate limit or `Crawl-delay`
>   you would prefer.
> - **An honest, stable User-Agent** so you can identify, rate-limit, or block it at any time:
>   `feed1/2.x (+https://github.com/mxttbennett/feed1)`
> - **Nothing else on the site is touched.** No page fetches, no scraping, no crawling, no search.
>   The feed endpoint only.
> - **Nothing is retained.** The bot stores a single timestamp per member to know what it has
>   already posted. It does not archive, index, or republish RYM content anywhere beyond the one
>   private Discord channel those members are already in.
>
> If this is something you would rather not permit, I completely understand and will drop the idea —
> I would just rather ask than assume, given that `robots.txt` asks people to. If there is a
> preferred mechanism, a rate you would like me to stay under, or a different endpoint you would
> rather I used, I am glad to work within it.
>
> Thank you for RYM. It is where I have kept track of my listening for years.
>
> Best,
> Matt Bennett

## If they say yes

Implement `DirectRssSource` per the design doc:

- One conditional `GET` per member per interval; store and send `ETag`/`Last-Modified`.
- The exact User-Agent promised above, kept in sync with `package.json` version. Note that the bot
  currently sends **no** User-Agent on any request — `LastfmClient` sets none — so this is new code
  in the feed source, not an existing behaviour being reused.
- Whatever rate they specify becomes the floor for the feed source's `RateLimiter`, overriding the
  spec's 5 s default if theirs is slower.
- Their reply gets recorded in this file, dated, so a future reader knows the permission exists and
  on what terms.

## If they say no, or never reply

The spec stays shelved. Do not implement a workaround — a "no" or a silence is not an invitation to
route around the challenge. The alternative, if the feature is still wanted, is the self-reported
`-rate` design noted in the parent spec's **What remains**, which needs no permission because it
never touches the site.
