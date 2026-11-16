# Keeping a Notification count fresh without live push

Research for [#5](https://github.com/Merronsk/cohort-005-project/issues/5). Facts and trade-offs only; the choice is a later decision.

**Question:** What does React Router (framework mode) offer for keeping an unread Notification count in the app header fresh on page load and navigation (root/layout loader revalidation, `shouldRevalidate`, `useRevalidator` polling, fetchers), and what does each cost per request in this app?

## Version note

The issue says "React Router 7", but this app is on **React Router 8.3.0** (`react-router`, `@react-router/dev`, `@react-router/node`, `@react-router/serve` all pinned to `8.3.0` in `package.json`; confirmed in `node_modules/react-router/package.json`). The reactrouter.com docs fetched for this note were for 8.5.1. Every behavioural claim below was checked against the installed 8.3.0 source in `node_modules/react-router/dist/development/`.

## How this app is set up today

- `react-router.config.ts`: `ssr: true`. That makes it framework mode with SSR, where the revalidation defaults differ from Data mode and SPA mode (see below).
- `app/root.tsx` has **no loader**. Only the `layout.app.tsx` loader feeds the chrome (sidebar and DevUI).
- `app/routes/layout.app.tsx` is a pathless layout around every in-app route (`/dashboard`, `/courses/*`, `/instructor/*`, `/admin/*`, `/settings`, `/team`, `/redeem/:code`). Its loader is where a header count would most naturally go.
- No route exports `shouldRevalidate` or `clientLoader`, no component uses `useRevalidator`, and no `<Link prefetch>` is used (all checked with `grep` across `app/`).
- 14 files under `app/` use `useFetcher`. `app/components/youtube-player.tsx` posts to `/api/video-tracking` with a plain `fetch()`, which bypasses the router.
- The database is `better-sqlite3` through Drizzle (`app/db/index.ts`). Queries are synchronous and in-process: there is no network round trip, but each query blocks the Node event loop while it runs.

### What the `layout.app` loader does on every call

On each call it does the following, all synchronously:

| Work | Queries |
| --- | --- |
| `getAllUsers()` (for DevUI) | 1, which returns the whole users table |
| Session cookie parse, done twice (`getCurrentUserId`, `getDevCountry`) | 0 (cookie only) |
| `getUserById` | 1 |
| `getRecentlyProgressedCourses` (limit 3) | 1 |
| For each recent course (up to 3): `getCompletedLessonCount` (3), `getTotalLessonCount` (2), `calculateProgress(..., false)` (3) | about 8 per course, up to about 24 |
| `isTeamAdmin` | 1 or 2 |

That comes to **about 5 to 29 SQLite queries per layout loader run**, depending on how many courses the user has recent progress in. An unread-count query (a single `count(*)`, ideally indexed on recipient and read state) would add 1 query to this.

## Fact 1: the layout loader already re-runs on every navigation and every successful submission

The docs say ([Route Module → shouldRevalidate](https://reactrouter.com/start/framework/route-module#shouldrevalidate)):

> "In framework mode with SSR, route loaders are automatically revalidated after all navigations and form submissions (this is different from Data Mode)."

[Revalidation Optimization](https://reactrouter.com/how-to/optimize-revalidation) gives the defaults:

- Framework mode with SSR: "active loaders are revalidated on navigations and successful submissions (`Link`, `Form`, `fetcher.submit`)". "Failed submissions returning a 4xx/5xx status do not trigger revalidations by default."
- SPA mode and Data mode, by contrast, revalidate on GET navigations only when params or search params change, or when the URL is exactly the same.

The installed source shows the mechanism:

- `lib/router/router.js` `getMatchesToLoad` computes a Data-mode-style `defaultShouldRevalidate`. It is true only when the URL is the same, the search changed, the route instance's pathname changed, or `isRevalidationRequired` is set. A pathless layout's match pathname does not change between `/dashboard` and `/courses`, so under Data-mode rules it would *not* re-run.
- Framework mode overrides that. `lib/dom/ssr/single-fetch.js` `singleFetchLoaderNavigationStrategy` calls `m.shouldCallHandler(defaultShouldRevalidate)` with `defaultShouldRevalidate = !actionStatus || actionStatus < 400`, which is **true for every GET navigation and every successful action**. Only a route's own `shouldRevalidate` export can say no.
- Single fetch: a client navigation makes **one** HTTP request, `GET /<path>.data`. The `_routes=` filter is added only if some matched route opted out (`foundOptOutRoute`, which is set by a `shouldRevalidate` returning false or by a `clientLoader`). The server honours that filter in `lib/server-runtime/single-fetch.js` `singleFetchLoaders` (`filterMatchesToLoad`). Without the filter, the server runs **all matched loaders**.

**Consequence for this app:** no route opts out, so every client-side `<Link>`/`<NavLink>` navigation inside the app layout, and every successful `<Form>`/`fetcher.submit` (14 files), already re-runs the `layout.app` loader on the server alongside the leaf loader, in one request. A count returned from that loader would be fresh on initial SSR, on every in-app navigation, and after every successful mutation **at no extra HTTP requests**. The marginal cost is the one extra `count(*)` query per navigation or submission.

Gaps in this approach:

- The count is not refreshed while the user stays on a page and something happens elsewhere (for example, another user creates a Notification for them). It updates on their next navigation or submission.
- A 4xx/5xx action result does not revalidate by default (see the quote above).
- A plain `fetch()` to a resource route does not go through the router and does not revalidate ([Revalidation Optimization](https://reactrouter.com/how-to/optimize-revalidation)). `youtube-player.tsx` is the existing example.
- Navigations to `/`, `/login` and `/signup` sit outside `layout.app`, so they do not run its loader.

## Fact 2: `shouldRevalidate` is how you *reduce* layout re-runs, and it changes the request shape

- `export function shouldRevalidate(args)` lets a route opt its own loader out. "It does not skip parent or sibling loaders." Returning `defaultShouldRevalidate` keeps the default ([Route Module](https://reactrouter.com/start/framework/route-module#shouldrevalidate)). The args include `currentUrl`, `nextUrl`, `currentParams`, `nextParams`, `formMethod`, `formAction`, `actionResult`, `actionStatus` and `defaultShouldRevalidate` (`getMatchesToLoad` in `router.js`).
- Call-site override: `defaultShouldRevalidate={false}` on `<Form>`/`<Link>`/`useSubmit`/`fetcher.submit` skips revalidation for one interaction. Routes without `shouldRevalidate` use that value directly ([Revalidation Optimization](https://reactrouter.com/how-to/optimize-revalidation)).
- In single fetch, once any matched route opts out, the client sends `_routes=<ids of the loaders that should run>`, and the server runs only those (`single-fetch.js` both sides).
- The docs warn: "Always returning `false` can leave this route's UI out of sync with the server". It also skips param changes and explicit `useRevalidator` calls ([Revalidation Optimization](https://reactrouter.com/how-to/optimize-revalidation)).

**Trade-off for the count:** if the layout loader were ever opted out of navigations (for example, to avoid its 5 to 29 queries on each click), a count in that loader would also stop refreshing on those navigations. The count would then have to live somewhere that still re-runs, such as a separate fetcher or a cheaper dedicated loader. `shouldRevalidate` is per route, not per field, so the count cannot be split from the rest of the layout data within one loader.

## Fact 3: `useRevalidator` re-runs the loaders of the current page on demand (polling, focus)

- [`useRevalidator`](https://reactrouter.com/api/hooks/useRevalidator): "Revalidate the data on the page for reasons outside of normal data mutations like Window focus or polling on an interval." It returns `{ revalidate(): Promise<void>, state }`. The docs show a focus example and do not include a polling example. The page also warns that if you use it for CRUD, "you're probably missing" `Form`/`fetcher`.
- Source (`router.js` `revalidate()`): it calls `interruptActiveLoads()`, which sets `isRevalidationRequired = true` and aborts in-flight fetcher loads, then calls `startNavigation(...)` to the current location. If a navigation is already in progress, it revalidates that navigation instead. If a submission is in progress, it waits for it.
- **Per-call cost in this app:** one `GET /<current path>.data` request that runs the `layout.app` loader (5 to 29 queries) **plus the current leaf route's loader** (whatever that page loads, for example course or instructor analytics data). It also re-runs any active `fetcher.load` fetchers. `useRevalidator` cannot target only the layout. Doing so would need `shouldRevalidate` on the leaf routes to say no (which then sends `_routes`).
- Polling cost is that per-call cost × (1 / interval) × open tabs. Focus-only revalidation costs one such request per tab focus. Neither is built in: you write a `useEffect` with `setInterval` or a `focus`/`visibilitychange` listener yourself. Pausing while the tab is hidden is also up to you. `revalidator.state` exposes `"loading"`, which the existing `NavigationLoadingBar` in `root.tsx` does not read (it reads `useNavigation().state`), so a background poll would not flash it.

## Fact 4: `useFetcher().load()` against a resource route fetches just the count

- Fetchers have independent state, and `useFetcher({ key })` lets several components share one fetcher ([useFetcher](https://reactrouter.com/api/hooks/useFetcher)). `fetcher.load(href)` calls that route's loader without navigating.
- Source (`single-fetch.js` `singleFetchLoaderFetcherStrategy`): a fetcher load requests `GET /<route>.data?_routes=<that route id>`, so **only that one loader runs** on the server. For a tiny `api/notifications/unread-count` resource route, that is one session parse plus one `count(*)`.
- Revalidation: "`fetcher.load` only revalidates by default after action submissions and explicit `useRevalidator` calls, not on search-param or param-driven navigations" ([Revalidation Optimization](https://reactrouter.com/how-to/optimize-revalidation)). The source agrees: for revalidating fetchers, `defaultShouldRevalidate = isRevalidationRequired` (`getMatchesToLoad`). It also only revalidates fetchers whose route is in the current matches or was loaded by `fetcher.load`, and it skips them on initial hydration.
- So a fetcher-held count is **not** refreshed by plain `<Link>` navigation unless the component calls `fetcher.load` again (for example, in an effect keyed on `useLocation()`). Each such call is one extra HTTP request per navigation, but a cheap one. It **is** refreshed after every successful `Form`/`fetcher.submit` anywhere in the app.
- **Not SSR'd:** a fetcher runs only on the client, after hydration. The first paint has no count (or a placeholder) unless the layout loader also provides an initial value.
- Polling with a fetcher (`setInterval(() => fetcher.load(...))`) costs one request and one query per tick, instead of re-running the whole page's loaders as `useRevalidator` does.
- Resource routes are already a pattern here: `app/routes/api.*.ts` are action-only resource routes registered in `app/routes.ts`. A loader-only `api` route would follow the same registration.

## Cost summary (per trigger, this app)

| Approach | Fresh on SSR | Fresh on in-app navigation | Fresh after successful submit | Fresh while idle on a page | Extra HTTP requests | Server work per refresh |
| --- | --- | --- | --- | --- | --- | --- |
| Count in `layout.app` loader (default revalidation) | Yes | Yes (already re-runs) | Yes | No | 0 | +1 `count(*)` on top of the existing 5–29 layout queries plus the leaf loader |
| Same, with `shouldRevalidate` trimming layout re-runs | Yes | Only when allowed | Only when allowed | No | 0 | Less than above when skipped, but the count goes stale on skipped navigations |
| `useRevalidator` on interval/focus (with either of the above) | — | — | — | Yes, at poll/focus granularity | 1 per tick or focus, per tab | The whole current page: layout (5–29 queries) + leaf loader + active fetcher loads |
| `useFetcher().load()` of a count resource route | No (client-only, unless the layout seeds it) | Only if re-called on location change (+1 request) | Yes (auto) | Yes if polled | 1 per load | 1 session parse + 1 `count(*)` |

## Sources

- Installed source, `react-router@8.3.0`, `node_modules/react-router/dist/development/`:
  - `lib/router/router.js`: `getMatchesToLoad`, `isNewRouteInstance`, `shouldRevalidateLoader`, `revalidate`, `interruptActiveLoads`, `getDataStrategyMatch.shouldCallHandler`
  - `lib/dom/ssr/single-fetch.js`: `singleFetchLoaderNavigationStrategy`, `singleFetchLoaderFetcherStrategy`, `fetchAndDecodeViaTurboStream`
  - `lib/server-runtime/single-fetch.js`: `singleFetchLoaders` (`_routes` → `filterMatchesToLoad`)
  - `lib/hooks.js`: `useRevalidator`
  - `lib/dom/ssr/routes.js`: `getShouldRevalidateFunction` (the SPA-mode params-only default)
- Docs (reactrouter.com, 8.5.1 at time of reading): [Route Module: shouldRevalidate](https://reactrouter.com/start/framework/route-module#shouldrevalidate), [Revalidation Optimization](https://reactrouter.com/how-to/optimize-revalidation), [useRevalidator](https://reactrouter.com/api/hooks/useRevalidator), [useFetcher](https://reactrouter.com/api/hooks/useFetcher), [Using Fetchers](https://reactrouter.com/how-to/fetchers)
- App files: `package.json`, `react-router.config.ts`, `app/root.tsx`, `app/routes.ts`, `app/routes/layout.app.tsx`, `app/lib/session.ts`, `app/db/index.ts`, `app/components/youtube-player.tsx`
