# Halturaz — Static Bloom rehearsal manager

A band's rehearsals, setlists and chord charts in one place.

`Calendar → Rehearsal → Song`. Two nav destinations only: rehearsals live inside
the calendar, setlists live inside a rehearsal.

## Run it

```bash
cd app
npm install
cp .env.example .env   # project URL + publishable key
npm run db:apply       # create the schema
npm run db:seed        # load members and rooms (the library starts empty)
npm run dev            # http://127.0.0.1:5174
npm run build
npm test               # renders every route + 49 logic checks
npm run db:test        # 60 checks driven through the running app, against the real database
```

React 18 + Vite + React Router over Supabase — the schedule, the library and
every chart live in Postgres. With no credentials the app still runs, with an
empty library and calendar, so it still tests. Songs are added in the library
or imported; they are not shipped in the bundle.

See `app/README.md` for the schema, and for which credential is allowed where —
the publishable key ships in the browser bundle, the secret key never does.

## Deploy

Every push to `yaliby` builds `app/` and publishes it to GitHub Pages —
https://yaliby.github.io/Haltorot/ — via `.github/workflows/pages.yml`.
One switch turns it on, once: **Settings → Pages → Source: GitHub Actions.**

Nothing else is configured. The build's Supabase settings sit in
`app/.env.production`, in the repo, because Vite bakes them into the JS every
visitor downloads either way — see that file's header for the line between
those and the credentials in `.env.admin`.

The site is served from a sub-path, so the workflow builds with
`BASE_PATH=/Haltorot/` and the router reads that prefix off `BASE_URL`. A plain
local `npm run build` stays at `/`. Pages has no server for a deep link like
`/Haltorot/songs`, so the build leaves a copy of `index.html` as `404.html` and
the router picks the route up from there.

### Or Vercel, which runs the code too

`app/vercel.json` and `app/api/songs/import.js` are the whole of it. Import the
repo at https://vercel.com/new, set **Root Directory** to `app`, and that is
the configuration — the site is served from `/`, so no `BASE_PATH`; the SPA
rewrite replaces the `404.html` trick; and `api/songs/import.js` re-exports the
same `handleRequest`, on the same origin, so the chart importer works from a
phone with no Edge Function and no access token in sight.

Both hosts can run at once — they publish from the same branch and do not know
about each other. What tells the app which server to ask is `VITE_CHART_API`,
set by `vercel.json` at build time and absent everywhere else; see
`chartEndpoint()` in `app/src/lib/songImport.js` for all three cases.

### The chart importer (optional)

Adding a song works on the published site — the library's "new song" form needs
no server. Pulling a chart down off Tab4U does: the site sends no
`Access-Control-Allow-Origin`, and the scrape sets request headers page code is
not allowed to set. In dev that server is Vite middleware
(`app/server/handlers.js`), which is enough on its own — importing is an
authoring move, and a song imported from a laptop is in Postgres and on
everyone's screen a second later.

If you would rather import from a phone too, the same `importChords` deploys as
a Supabase Edge Function:

```bash
cd app
npm run fn:build    # flattens server/ + src/lib into supabase/functions/import
npm run fn:test     # runs that bundle against the live Tab4U and Ultimate Guitar
npm run fn:deploy   # builds, then pushes it to the project
```

`fn:deploy` needs `SUPABASE_ACCESS_TOKEN` in `.env.admin` — a personal access
token from https://supabase.com/dashboard/account/tokens. The secret key does
not authorise deploys. The project ref is read off the URL the app already uses.
Until it is deployed the built site's import button simply reports a failure;
nothing else waits on it.

The bundle is generated and gitignored; the scrapers stay in `app/server/`,
sharing one chord parser and one Hebrew text matcher with the app. Song *search*
never needed any of this — iTunes answers the browser directly.

## What's here

```
app/        the application (see app/README.md for the full tour)
app/db/     schema.sql plus the scripts that apply and seed it
design/     the design canvas sources — one .dc.html per artboard, laid out by canvas.json
```

The design canvas came first: seven artboards (four desktop, three phone) used
to settle layout, colour and typography before any of it was built for real.
The generated canvas bundle itself is not committed — reseed it from `design/`.

## Screens

| Route | |
| --- | --- |
| `/` | Month calendar; pick a day, then book, open or read it in the day panel |
| `/rehearsal/:date` | The setlist — drag to reorder, tick off what you've run, edit or delete the booking |
| `/song/:id` | Chords over lyrics, with transpose, text sizing and stage mode |
| `/songs` | The library, filtered by collection and key; new songs are added here |
