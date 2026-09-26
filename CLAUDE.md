# CLAUDE.md

Guidance for AI assistants working in this repository.

## What Prowl is

Prowl is a community app for logging and tracking stray/community pet sightings on a map.
Anyone can snap a photo of a stray, and the app tries to match it to a pet already logged
nearby (so repeat sightings accumulate on one animal) or create a new pet. Owners/shelters
can flag pets as adoptable from a separate admin dashboard.

The repo contains **three cooperating pieces**:

| Piece | Path | Stack | Role |
|-------|------|-------|------|
| Mobile app | `App.tsx`, `src/` | Expo / React Native (TypeScript) | The product — map, camera, sighting flow |
| Backend | `supabase/` | Supabase (Postgres + PostGIS) | Data, auth, storage, RPCs, RLS |
| Admin dashboard | `dashboard/` | Vanilla JS + supabase-js UMD + Leaflet | Owner/shelter tool to manage adoption + reports |

Everything is written in TypeScript except the dashboard (plain JS) and SQL migrations.

> There used to be a fourth piece, a Cloudflare Worker generating CLIP embeddings for visual
> photo matching. It is gone — the model it depended on is no longer available to the
> account, and no image-embedding replacement is offered. Migration `00007` dropped the
> column, index and RPC. **Candidate matching is proximity-only**, which is all it ever
> actually did in production: no pet ever received an embedding.

## Commands

Mobile app (Yarn 3 / Berry, `node-modules` linker — **use `yarn`, not `npm`**):

```bash
yarn install          # install deps
yarn start            # Expo dev server (Metro)
yarn android          # build + run on Android
yarn ios              # build + run on iOS
```

There is **no test runner or linter** wired up. Types are checked with `yarn typecheck`.

The pure helpers in `src/lib` carry framework-free self-checks — plain `node:assert`
scripts, run one at a time:

```bash
npx tsx src/lib/geo.test.ts
npx tsx src/lib/petFilters.test.ts
npx tsx src/lib/freshness.test.ts
```

Keep those files importable by node: no `react-native` imports in the module under test
(that's why `directionsUrl` takes the platform as an argument instead of reading
`Platform.OS`).

Admin dashboard: static files in `dashboard/` — serve them with any static host
(e.g. `python3 -m http.server` from that dir). No build step.

EAS build profiles live in `eas.json` (`preview` → APK, `production` → app bundle).

## Environment / configuration

- Mobile app reads Supabase config from `EXPO_PUBLIC_*` env vars (see `.env.example`).
  Copy it to `.env` and fill in real values; `.env*` is gitignored except `.env.example`.
  The `EXPO_PUBLIC_` prefix is what makes a var visible inside the Expo bundle.
- `app.config.js` holds native config (Android package `com.prowl.app`, permissions,
  Google Maps API key via `GOOGLE_MAPS_API_KEY`, iOS `LSApplicationQueriesSchemes` for
  WhatsApp deep links).
- The **Supabase anon key is public by design** — it ships inside the mobile bundle and is
  hard-coded in `dashboard/app.js`. Never treat it as a secret. Privileged writes are
  guarded server-side (see the adoption-guard trigger below).
- There is **no service-role key anywhere in this repo**, and none should ever be added: both
  clients are public surfaces. Privileged operations run as the admin user or in the SQL
  editor.

## Mobile app architecture (`src/`)

```
src/
  navigation/RootNavigator.tsx   Stack navigator; RootStackParamList is the source of truth for routes
  screens/                       One file per screen (see below)
  components/PetPin.tsx          Map pin visual
  components/motion.tsx          Shared animation kit (springs, PressableScale, ToggleChip, Skeleton, SuccessStamp)
  hooks/usePets.ts               All React Query data access for pets/sightings
  lib/
    supabase.ts                  Supabase client + anonymous auth (ensureAuth)
    storage.ts                   Photo compress + dual upload (full + thumb)
    exif.ts                      GPS extraction from photo EXIF (iOS + Android shapes)
    petFilters.ts                Map/list filter chips (pure; petFilters.test.ts)
    geo.ts                       Haversine distance, distance labels, maps URLs (pure; geo.test.ts)
    freshness.ts                 How stale a pet's last sighting is (pure; freshness.test.ts)
    sightings.ts                 One-tap "I see this cat" — position + log_sighting
  context/ThemeContext.tsx       Light/dark theme provider (follows OS scheme)
  constants/                     colors (Coral Dusk), typography, mapStyle (dark + light), legal text
  types/index.ts                 Domain types (Pet, Sighting, Species, PetStatus, PetMatch)
  data/mockData.ts               Mock fixtures (dev/reference only)
```

**Screens & the core flow** (all in `src/screens/`):

- `MapScreen` — home. Clustered map (uses `supercluster`), queries pets by viewport bounds,
  debounced on region change. Tapping the camera FAB opens `Camera`.
- `CameraScreen` — the heart of the app. Take/pick a photo → upload → call `nearby_pets`
  RPC (300 m radius) to show candidate matches → user either **confirms a match**
  (`log_sighting` RPC) or **creates a new pet** (insert into `pets` then `log_sighting`).
- `AddSightingScreen` — log another sighting for an existing pet, with map pin + reverse
  geocoding.
- `PetDetailScreen` — pet profile, sighting history, adoption contact (opens WhatsApp/email).
- `LegalScreen` — renders terms/privacy from `src/constants/legal.ts`.

### Conventions to follow

- **Data access goes through `src/hooks/usePets.ts`.** It owns React Query keys
  (`petKeys` factory), the row→domain mappers (`toPet`), and the fetchers. Add new queries
  there rather than calling `supabase` from screens ad hoc. (The Camera/AddSighting *write*
  paths call `supabase.rpc(...)` directly, which is the established pattern for mutations.)
- **The DB is snake_case; the app is camelCase.** Views/RPCs return snake_case rows and the
  mappers in `usePets.ts` convert to the camelCase `Pet`/`Sighting` types. Keep this
  boundary — don't leak snake_case shapes past the mappers.
- **Never read/write the PostGIS `location` column directly from the client.** Read through
  the `pets_geo` / `sightings_geo` views or the RPCs, which decode geography to flat
  `latitude`/`longitude`. To write a point, pass lat/lng to `log_sighting`, or on insert use
  the WKT literal form `` `SRID=4326;POINT(${lng} ${lat})` `` (note: **lng first**).
- **Theming:** never hard-code colors in components. Pull from `useTheme()`/`useColors()`
  and the palettes in `src/constants/colors.ts` (the "Coral Dusk" palette, full dark + light).
  Tokens: `accent` (coral — primary actions, pins seen in the last 24 h), `violet` (pins seen
  this week, adoptable, "needs a check-in"), `mint` (success), `onAccent` (text on a coral
  fill — dark ink in both themes, since white on coral fails AA), plus `glass` (chrome over
  the map), `scrim` and `shimmer`. Placeholder avatar colours come from `avatarColor(id)`;
  `dashboard/app.js` mirrors the same list and the pin colours, so change them together.
  Typography comes from `src/constants/typography.ts` (`type` presets, DM Serif Display for
  display text, Inter for body). Compute `StyleSheet` objects with `useMemo` off `colors`,
  as the screens do.
- **Auth is anonymous.** `ensureAuth()` (called once in `App.tsx`) signs the device in
  anonymously via Supabase so RLS `authenticated` policies pass. There is no login in the
  mobile app.
- **Photos are always uploaded as a pair** via `uploadPhoto()`: a 1080 px full image
  (`<id>.jpg`) and a 300 px thumbnail (`<id>_thumb.jpg`), in parallel. The thumb URL is
  derivable from the full URL by the `_thumb.jpg` suffix. Map pins/list rows use the small
  thumbnail; detail/hero uses the full one.
- New routes must be added to `RootStackParamList` in `RootNavigator.tsx` with their params.
- **Motion** goes through `src/components/motion.tsx` and **react-native-reanimated**, so it
  runs on the UI thread. Use its `springs` rather than inventing new configs, `PressableScale`
  for anything that reads as a button (`haptic` only on primary actions), `ToggleChip` for
  filter/choice chips, `staggerIn(i)` + `reflow` for list rows, `Skeleton`/`SkeletonRow` for
  loading states, and `SuccessOverlay` + `SUCCESS_HOLD_MS` before navigating away from a save.
  Reanimated's springs and layout animations respect the OS reduce-motion setting by default;
  infinite loops must check `useReducedMotion()` themselves.
- **Reanimated is pinned to 3.x on purpose.** The app runs the old architecture
  (`newArchEnabled: false` in `app.config.js` and `android/gradle.properties`), and Reanimated 4
  requires the New Architecture. Don't bump it without switching architecture first. The Babel
  plugin is added automatically by `babel-preset-expo`.
- **Map markers don't animate on Android.** Google Maps rasterizes each marker to a bitmap
  (see `useMarkerSettle` in `MapScreen`), so `PetPin`'s drop-in and sonar ring are iOS-only.
  Don't add animation inside a marker without that gate.
- The map list sheet is dragged with a Gesture Handler `Gesture.Pan`, which needs the
  `GestureHandlerRootView` in `App.tsx`.

## Backend (`supabase/migrations/`)

Plain SQL migrations, numbered `0000N_name.sql`, applied in order. **Every migration is
written to be idempotent and safe to re-run** (`if not exists`, `drop ... if exists` before
`create`, `on conflict do update`). Preserve this when adding migrations.

Migration history (read these before touching schema):

- `00001_init.sql` — core schema. `pets` and `sightings` tables with `geography(Point,4326)`
  columns + GiST indexes, RLS policies (public read; `authenticated` insert/update/delete),
  the `pet-photos` public storage bucket, the `pets_geo`/`sightings_geo` decode views, and
  the key RPCs: `nearby_pets`, `log_sighting`. (It also created the `vector(512)` embedding
  column and `match_pets`; both were dropped in 00007.)
- `00002_thumbnails.sql` — adds `thumbnail_small_url`, storage delete policy, and extends
  `log_sighting` with `p_photo_thumb_url`.
- `00003_sightings_update.sql` — adds the missing `sightings` UPDATE RLS policy.
- `00004_adoption.sql` — adds `status` (`stray`|`adoptable`|`adopted`, checked) and
  `adoption_contact`, exposed through `pets_geo` and `nearby_pets`.
- `00005_admin_guard.sql` — `guard_adoption_columns` BEFORE-UPDATE trigger: anonymous mobile
  users can still update pets (sighting logging, thumbnail sync), but **only the admin
  email / service-role / dashboard SQL editor may change `status` or `adoption_contact`**.
  Adoption is admin-only by design — there is no in-app write path for it.
- `00006_ownership.sql` — adds `pets.created_by` / `sightings.user_id` and rewrites the RLS
  policies so **a row can only be updated or deleted by whoever created it**. `log_sighting`
  takes its identity from `auth.uid()` from here on, so it no longer accepts `p_user_id` —
  passing it matches no function and fails the whole call. Also adds `clear_sighting_photo`,
  which nulls a photo and repairs the parent pet's thumbnails in one authorized step.
  Rows predating this have a null creator and are admin-only to delete.
- `00007_drop_embeddings.sql` — drops the `embedding` column, its ivfflat index and
  `match_pets`. See the note at the top of this file.
- `00008_moderation.sql` — `reports` table (reason CHECK: `inappropriate` | `not_a_cat` |
  `spam` | `other`) and per-user hide lists behind the in-app report/block flow, required by
  Google Play's UGC policy. Reports deliberately carry **no foreign key to their target**:
  deleting an offending pet must not erase the record that it was reported. Hiding is applied
  client-side (`useModeration`) because pets are world-readable by design — it is
  presentation, not a security boundary.
- `00009_species.sql` — CHECK constraint pinning `species` to `cat`/`dog`. 00001 left it an
  unconstrained `text` because only cats could be added; the camera now offers a choice, so
  the column is real input. Adding a species means the migration, `Species` in
  `types/index.ts`, `SPECIES` in `CameraScreen`, and `SPECIES_CHIPS` in `MapScreen` — all
  four, or the insert is rejected.

**Gotchas when changing the schema:**

- Changing an RPC's return columns requires `drop function ... ` before `create` (Postgres
  can't change a return type in place). `create or replace view` can only *append* columns —
  to reorder, `drop view` first (see 00004).
- If you add a column that clients read, expose it through `pets_geo`/`sightings_geo` **and**
  the relevant RPC, then add it to the row interface + mapper in `usePets.ts`. The mapper
  uses `?? default` fallbacks so older clients tolerate pre-migration schemas — keep that.

## Logo & icons

The logo is the "Ear pin": a cat's head that tapers into a map-pin point. Sources are
`assets/logo-mark.svg` (transparent mark, also copied to `dashboard/logo-mark.svg`),
`assets/icon.svg` (full-bleed app icon) and `assets/adaptive-icon.svg` (Android foreground,
inside the 66/108 safe zone). The PNGs in `assets/` and the committed Android launcher
(`mipmap-*`) and splash (`drawable-*/splashscreen_logo.png`) images are rasterized from the
same drawing — regenerate all of them together if the mark changes, since `android/` is
committed and a prebuild won't do it for you. Splash and icon backgrounds are `#160F1F`.

## Admin dashboard (`dashboard/`)

Single-page vanilla-JS app (`index.html` + `app.js` + `styles.css`) using the supabase-js
UMD build and Leaflet. Owner/shelters sign in with email+password (a real Supabase user, not
anonymous) to list pets, view them on a map, and set adoption `status` / `adoption_contact`.
Those writes are the ones the 00005 trigger gates to the admin email. No build step; keep it
dependency-free (CDN scripts only).

## Working style in this repo

- Match the existing house style: aligned assignment blocks, `─── section ───` comment
  banners, and comments that explain *why* (constraints, gotchas) rather than *what*.
- Keep the four pieces in sync when a change spans them: a new client-visible field usually
  touches a migration, a view/RPC, `types/index.ts`, and the `usePets.ts` mapper together.
- Prefer `expo-*` and the already-chosen libraries (React Navigation stack, TanStack Query,
  react-native-maps, supercluster) over introducing new dependencies.

## Git / workflow

- Develop on the assigned feature branch; commit with clear messages; push with
  `git push -u origin <branch>`. Do not open a PR unless explicitly asked.
- Do not commit real secrets or `.env` (only `.env.example` is tracked). The Android native
  project is committed; iOS is generated by `expo prebuild` and gitignored.
