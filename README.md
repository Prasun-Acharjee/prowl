<div align="center">

# 🐾 Prowl

**Spot a stray. Log it. Help it get home.**

A community app for tracking stray and community pets on a shared map — snap a photo,
and Prowl matches it to a pet already logged nearby or adds it as a new one, so repeat
sightings build a living history for each animal. Shelters can flag pets as adoptable.

Built with Expo / React Native · Supabase (Postgres + PostGIS)

</div>

---

## Why Prowl?

Neighborhood strays get spotted by dozens of people who have no way to compare notes. One
cat gets reported as five different animals; a pet that's ready for adoption stays invisible.
Prowl turns scattered sightings into one shared, map-based record:

- 📸 **Snap & match** — take a photo of a stray and Prowl surfaces pets already logged nearby, so you can confirm a repeat sighting instead of creating a duplicate.
- 🗺️ **Live map** — every community pet on a clustered map, newest sightings first.
- 🕑 **Sighting history** — each pet accumulates a timeline of who saw it, where, and when.
- ❤️ **Adoption** — shelters/owners can mark a pet adoptable and add a contact, shown right in the app (tap to reach them on WhatsApp or email).
- 🧭 **Go and look** — every pet shows how far away it is, sorts nearest-first, and opens directions in your own maps app.
- 👀 **Check-ins** — pets nobody has logged in a while are flagged, so the map stays a record of what is actually out there rather than what once was.

## How it works

Prowl is three small pieces that work together:

```
        ┌─────────────────┐   photo + GPS   ┌──────────────────────────┐
        │  Mobile app     │ ───────────────▶│  Supabase                │
        │  (Expo / RN)    │◀─────────────── │  Postgres + PostGIS      │
        └─────────────────┘   pets nearby   │  Storage, RLS            │
                                            └────────────┬─────────────┘
        ┌─────────────────┐                              │
        │  Admin dashboard│──── adoption status ─────────┘
        │  (web, Leaflet) │     report queue
        └─────────────────┘
```

Matching is **geographic**: a photo's GPS (from EXIF where available, otherwise the device)
is run against a 300 m PostGIS radius query, and you confirm which pet it is.

| Piece | Path | Stack | Role |
|-------|------|-------|------|
| **Mobile app** | `App.tsx`, `src/` | Expo / React Native + TypeScript | The product: map, camera, sighting flow |
| **Backend** | `supabase/` | Postgres + PostGIS | Data, auth, storage, geospatial RPCs, RLS |
| **Admin dashboard** | `dashboard/` | Vanilla JS + Leaflet | Shelter/owner tool for adoption status and reports |

The camera flow uploads a photo, then calls a PostGIS `nearby_pets` query (300 m radius) to
show candidate matches. Confirm one and the sighting is logged against that pet; otherwise a
new one is created — a cat or a dog, your choice.

## Tech stack

- **Mobile:** Expo `~54`, React Native `0.81`, React `19`, TypeScript (strict)
- **Navigation / data:** React Navigation (stack), TanStack Query
- **Maps:** `react-native-maps` (Google provider) + `supercluster` clustering
- **Backend:** Supabase — Postgres, PostGIS (geography), Storage, RLS
- **Tooling:** Yarn 3 (Berry, `node-modules` linker), EAS Build

## Getting started

### Prerequisites

- Node 20+ and [Yarn](https://yarnpkg.com) (the repo pins Yarn 3.6.4 via `.yarnrc.yml`)
- A [Supabase](https://supabase.com) project (with the `postgis` and `vector` extensions)
- For device builds: the [Expo](https://docs.expo.dev) toolchain / EAS CLI

### 1. Install

```bash
git clone https://github.com/Prasun-Acharjee/prowl.git
cd prowl
yarn install
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in your Supabase project values (the `EXPO_PUBLIC_` prefix exposes them to the app):

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

> The anon key is **public by design** — it ships inside the mobile bundle. Privileged
> actions (like changing adoption status) are enforced server-side, not by hiding the key.

### 3. Set up the database

Apply the SQL migrations in `supabase/migrations/` **in order** (via the Supabase SQL editor
or the Supabase CLI). They're idempotent and safe to re-run — they create the tables,
PostGIS indexes, the `pet-photos` storage bucket, RLS policies, and the geospatial RPCs the
app depends on.

### 4. Run

```bash
yarn start        # Expo dev server (Metro)
yarn android      # build + run on Android
yarn ios          # build + run on iOS
```

Android map rendering needs a Google Maps API key — set `GOOGLE_MAPS_API_KEY` (see
`app.config.js`).

## Repository layout

```
prowl/
├── App.tsx                  App entry: fonts, anon auth, providers, navigator
├── app.config.js            Expo native config (permissions, package id, maps key)
├── eas.json                 EAS build profiles (preview → APK, production → bundle)
├── src/
│   ├── navigation/          Stack navigator + route param types
│   ├── screens/             Map, Camera, AddSighting, PetDetail, Legal
│   ├── components/           Map pins
│   ├── hooks/usePets.ts     All React Query data access (keys, fetchers, mappers)
│   ├── lib/                 supabase client, photo upload, EXIF GPS, distance, filters
│   ├── context/             Light/dark theme provider
│   ├── constants/           colors, typography, map style, legal text
│   └── types/               Domain types (Pet, Sighting, …)
├── supabase/migrations/     Numbered, idempotent SQL migrations
├── dashboard/               Static admin web app
└── docs/                    Privacy policy & terms (HTML)
```

## Sub-projects

**Admin dashboard** — static files in `dashboard/`; serve them with any static host
(e.g. `python3 -m http.server` from that directory). Shelters/owners sign in with a real
Supabase email+password account to manage adoption status. No build step.

## Development notes

- There is no automated test/lint suite yet. Sanity-check types with `yarn tsc --noEmit`.
- Data access flows through `src/hooks/usePets.ts`; the DB is snake_case and the app is
  camelCase, converted by mappers there.
- Read [`CLAUDE.md`](./CLAUDE.md) for the deeper architecture guide and the schema/theming
  conventions to follow when contributing.

## License

No license file is currently included in this repository.
