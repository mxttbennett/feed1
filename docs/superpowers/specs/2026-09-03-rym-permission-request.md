# Permission request to Sonemic — RYM activity feed access

Supporting artefact for [2026-09-03-rymfeed-design.md](2026-09-03-rymfeed-design.md), which is
blocked until this is answered.

## Status: the API waitlist is already done

RYM runs an official data-access channel at `rateyourmusic.com/data-access/register-interest/`, and
**the registration was submitted well before this spec** (confirmed 2026-09-03). Its confirmation
reads:

> Your submission was received; thank you for your interest. We will let you know when our API is
> officially available, and will be additionally reaching out to individual users over the course of
> development for potential early/beta access.

That is a waitlist for a **future API**, not permission for the **existing RSS feed**. The two are
different asks:

| Ask | State |
|---|---|
| Access to a future official API | Submitted, awaiting an indefinite timeline |
| Express permission to read the published `/~<user>/data/rss` feed today | **Not yet asked** |

So the letter below is still worth sending, and the prior registration makes it a materially easier
one to say yes to: it establishes that the front door was used first and that this is a narrow
interim request, not an end run around the API programme.

There is **no terms page**: `rateyourmusic.com/data-access/` itself is a 404 (checked in a browser,
2026-09-03), so only the `register-interest` leaf exists. Nothing documents what is permitted for
existing endpoints, which rules out the possibility that the question is already answered in writing
and leaves asking as the only way to find out.

Send it by replying to whatever address acknowledged the registration — that thread is already the
right context and links the two requests together. `rateyourmusic.com/contact` is the fallback.

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
> I registered interest in the Sonemic data API a while ago and am happy to wait for it. I am
> writing about something much smaller in the meantime.
>
> I maintain an open-source Discord bot for a private server of music friends. It is a hobby project
> with no commercial use, no advertising, and no public deployment — one server, about five people.
> Source: https://github.com/mxttbennett/feed1
>
> RYM already publishes a per-user activity feed at `/~<username>/data/rss`. I would like permission
> for the bot to read that existing feed for members who have explicitly opted in, so that when
> someone rates an album it can post a link to the release in our chat. I am asking rather than
> assuming because `robots.txt` requests exactly that.
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
> If you would rather I simply waited for the official API, that is a completely fine answer and I
> will shelve it — I would just rather ask than assume. And if there is a rate you want me to stay
> under, a different endpoint you would prefer, or a note you want attached to my API registration
> for whenever early access happens, I am glad to work within any of it.
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
