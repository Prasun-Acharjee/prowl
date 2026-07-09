// Cloudflare Worker — triggered by a Supabase database webhook on sightings INSERT.
// Fetches the sighting photo, runs CLIP via Workers AI, writes the 512-dim
// embedding back to the parent pet row in Supabase.
//
// Setup:
//   wrangler secret put SUPABASE_URL
//   wrangler secret put SUPABASE_SERVICE_KEY
//   wrangler deploy

interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

interface SupabaseWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: {
    id: string;
    pet_id: string;
    photo_url: string | null;
    [key: string]: unknown;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload: SupabaseWebhookPayload;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const { pet_id, photo_url } = payload.record;

    // Skip if no photo was attached to this sighting
    if (!photo_url) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    // Fetch the photo from Supabase Storage (public bucket, so no auth needed)
    const imageRes = await fetch(photo_url);
    if (!imageRes.ok) {
      return new Response('Failed to fetch photo', { status: 502 });
    }
    const imageBytes = new Uint8Array(await imageRes.arrayBuffer());

    // Run CLIP ViT-B/32 via Workers AI — returns a 512-dim image embedding
    const aiResult = await (env.AI as any).run('@cf/openai/clip-vit-base-patch32', {
      image: [...imageBytes],
    });

    const embedding: number[] = aiResult.data?.[0] ?? aiResult;

    // Write the embedding to the pet row so future match_pets() queries use it
    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/pets?id=eq.${pet_id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ embedding }),
      },
    );

    if (!patchRes.ok) {
      const err = await patchRes.text();
      return new Response(`Supabase patch failed: ${err}`, { status: 502 });
    }

    return new Response(JSON.stringify({ pet_id, embeddingDims: embedding.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
} satisfies ExportedHandler<Env>;
