import type { CandidateRow } from "../shared/types";
import { getSupabaseAdmin } from "./supabase";

/**
 * Image caching helpers.
 *
 * The spec calls for downloading source images into Supabase Storage, but we
 * don't want to hammer external sources on day one. The functions in this
 * file are intentionally cheap and idempotent:
 *
 *   - `imagePathFor(slug)` returns the canonical storage path we'd use.
 *   - `cacheImagesForRows` is a stub that, when given real source image URLs
 *     and a configured bucket, downloads each image, compresses it (caller
 *     can swap in `sharp` later), and uploads it to the bucket.
 *
 * The MVP wires the stubs in but no-ops when no image URLs are present, so
 * tests and the daily sync work without depending on any external image host.
 */

export type CachedImageRecord = {
  itemSlug: string;
  storagePath: string;
  sourceUrl?: string;
};

const DEFAULT_BUCKET = "adopt-me";

export function imagePathFor(slug: string, ext: "webp" | "png" = "webp"): string {
  return `items/${slug}.${ext}`;
}

export function publicImageUrl(storagePath: string): string | null {
  const bucket = process.env.SUPABASE_IMAGE_BUCKET ?? DEFAULT_BUCKET;
  const url = process.env.SUPABASE_URL;
  if (!url) return null;
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${storagePath}`;
}

/**
 * Cache any source-provided images for `rows`. Returns the list of records
 * that ended up in storage. Safe to call repeatedly; uploads use `upsert`.
 */
export async function cacheImagesForRows(
  rows: CandidateRow[],
  sourceImageUrlsBySlug: Map<string, string>
): Promise<CachedImageRecord[]> {
  const db = getSupabaseAdmin();
  const bucket = process.env.SUPABASE_IMAGE_BUCKET ?? DEFAULT_BUCKET;
  if (!db) return [];

  const seen = new Set<string>();
  const cached: CachedImageRecord[] = [];

  for (const row of rows) {
    if (seen.has(row.itemSlug)) continue;
    seen.add(row.itemSlug);
    const url = sourceImageUrlsBySlug.get(row.itemSlug);
    if (!url) continue;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "image/png";
      const ext = contentType.includes("webp") ? "webp" : "png";
      const buffer = new Uint8Array(await res.arrayBuffer());
      const storagePath = imagePathFor(row.itemSlug, ext);
      const upload = await db.storage.from(bucket).upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });
      if (upload.error) {
        console.warn(`[images] upload failed for ${row.itemSlug}:`, upload.error);
        continue;
      }
      cached.push({ itemSlug: row.itemSlug, storagePath, sourceUrl: url });
    } catch (err) {
      console.warn(`[images] fetch failed for ${row.itemSlug}:`, err);
    }
  }
  return cached;
}
