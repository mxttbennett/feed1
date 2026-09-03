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
existing endpoints, which leaves asking as the only way to find out.

### Where to send it: the contact form, logged in

**Route: `rateyourmusic.com/contact`, while signed in.** Researched 2026-09-03 — there is no
published support email. Every avenue funnels to that form, and its own instruction is to be logged
in or supply a valid address if you want a reply.

Logged-in is the better channel on the merits, not a fallback: it binds the request to a long-lived
account with real contribution history, and the request concerns that account's own feed. A mail
from a personal address carries none of that.

| Route | Verdict |
|---|---|
| `rateyourmusic.com/contact`, signed in | **Use this** |
| `dmca-request@sonemic.com` | Real, but the Copyright Agent mailbox. Wrong channel; do not use |
| Sonemic, Inc., 1700 7th Ave Ste 116 PMB 137, Seattle WA 98101 | Real, disproportionate |
| `support@` / `api@` / `hello@` on either domain | No evidence they exist. Do not guess |

Both domains run Google Workspace, so a guessed address would deliver if it happened to be right —
which is exactly why guessing is the wrong move rather than a harmless one.

Context worth knowing: third parties openly sell RYM scraper APIs. That is not license for
anything, but it explains the aggressive posture, and it means a request that visibly distinguishes
itself from commercial scraping is worth making.

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

## Do not send AI-written prose

RYM's feedback page states:

> Please note: Messages written with ChatGPT or other AI tools will be ignored.

So this file deliberately **does not contain a letter to copy**. An earlier revision did; it was
removed. Sending it would have been ignored at best, and disguising it to get past the filter is the
same move as routing around the Cloudflare challenge — working around a stated position rather than
respecting it.

Write the message yourself. The substance below is the whole point of the request and it was always
Matt's; only the sentences need to be his too.

### Substance to cover

- The Sonemic API waitlist is already submitted; happy to wait. This is a smaller interim ask.
- Small Discord bot, ~5 friends, hobby, no commercial use, not publicly hosted.
  Repo: https://github.com/mxttbennett/feed1
- The ask: read the per-user activity feed RYM already publishes, opt-in members only, each only
  their own feed.
- Volume: ~5 conditional `GET`s an hour total. Happy to go slower or accept any limit they set.
- A stable User-Agent carrying the repo URL, so they can identify, throttle, or block it any time.
- Nothing retained but one timestamp per member; no archiving, indexing, or reposting beyond the one
  private channel.
- A no, or "wait for the API", is a fine answer.
- The endpoint currently 403s every non-browser client, so a yes also needs that User-Agent allowed
  at the Cloudflare edge — otherwise permission alone still yields 403.

Four or five sentences carries all of it. A signed-in account with fifteen years of contributions
asking about its own feed does not need to argue hard, and brevity reads as human.

### Tells that trip the filter

Avoid: em dashes; bolded bullet lead-ins; no contractions; balanced tricolons ("no crawling, no
search, nothing else"); pre-emptively answering every objection in parallel bullets; connective
phrases like "one practical note".

## If they say yes

Implement `DirectRssSource` per the design doc:

- One conditional `GET` per member per interval; store and send `ETag`/`Last-Modified`.
- **Confirm the edge allowlist actually landed before writing code.** Permission is necessary but
  not sufficient: the Cloudflare challenge sits in front of RYM's application, so a sincere yes
  without a matching edge rule still yields `403`. Verify with one manual request first.
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
