-- Remove the CLIP visual-matching machinery.
--
-- Why: the pipeline was built on Cloudflare Workers AI's
-- @cf/openai/clip-vit-base-patch32, which is no longer available to the account
-- (Workers AI returns "5018: Account is not allowed to access"). No image
-- embedding model is offered any more — only text embeddings and image-to-text —
-- so there is nothing to swap in. No pet ever received an embedding: the webhook
-- had been returning 502 on every sighting since it was first wired up.
--
-- Candidate matching in the camera flow is proximity-only, which is what
-- nearby_pets already returned and what the app has always actually done.
--
-- Safe to re-run: all statements are idempotent.

drop function if exists public.match_pets(vector, double precision, double precision, integer, double precision, integer);

drop index if exists public.pets_embedding_ivf;

alter table public.pets drop column if exists embedding;

-- The `vector` extension is left installed. Dropping it is not free — it would
-- fail if anything else adopts a vector column later, and it costs nothing to
-- keep. Remove it by hand if you want a clean slate.
