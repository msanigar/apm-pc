import type { CandidateRow } from "../shared/types";
import { getSupabaseAdmin } from "./supabase";

/**
 * Image caching helpers.
 *
 * The pipeline downloads source images, uploads them into Supabase Storage at
 * a deterministic path (`items/<slug>.<ext>`), and writes the path back to
 * `items.image_path` so the UI can render it. Each step is idempotent and
 * safe to re-run.
 *
 * Callers:
 *   - Daily value sync passes a slug → URL map; only NEW items get pulled.
 *   - `scripts/backfillImages.ts` walks the whole catalog and seeds anything
 *     missing.
 *
 * The Storage bucket must be created and marked PUBLIC in Supabase — the
 * frontend reads images via `<bucket>/items/<slug>.<ext>` URLs and would
 * otherwise need a signed URL per request.
 */

const DEFAULT_BUCKET = "adopt-me";

export type ImageJob = {
  itemSlug: string;
  sourceUrl: string;
  /** Which adapter / source the URL came from (for audit). */
  sourceName?: string;
};

export type CacheImagesOptions = {
  /**
   * Skip items whose `image_path` is already populated. Default: true.
   * Set to false to force-refresh existing images (rarely needed).
   */
  skipIfPresent?: boolean;
  /** Optional sleep between fetches in milliseconds. */
  delayMs?: number;
  /** Optional progress callback (called once per processed job). */
  onProgress?: (info: {
    done: number;
    total: number;
    slug: string;
    status: "uploaded" | "skipped" | "error";
  }) => void;
};

export type CacheImagesResult = {
  uploaded: number;
  skippedAlreadyCached: number;
  skippedMissingItem: number;
  errors: number;
  /** Slugs that hit an error during fetch or upload. */
  errorSlugs: string[];
};

export function imagePathFor(slug: string, ext: string): string {
  // Force a small allowlist so a misbehaving source can't push us into
  // serving a `.svg` (or worse) under our domain.
  const safeExt = ["webp", "png", "jpg", "jpeg", "gif"].includes(ext)
    ? ext
    : "png";
  return `items/${slug}.${safeExt}`;
}

/**
 * Build the public CDN URL for a stored image. Returns null when no path is
 * provided or `SUPABASE_URL` is not configured.
 */
export function publicImageUrl(
  storagePath: string | null | undefined
): string | null {
  if (!storagePath) return null;
  const bucket = process.env.SUPABASE_IMAGE_BUCKET ?? DEFAULT_BUCKET;
  const url = process.env.SUPABASE_URL;
  if (!url) return null;
  const cleanPath = storagePath.replace(/^\/+/, "");
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${cleanPath}`;
}

/**
 * Determine a safe filename extension from a Content-Type header (or from a
 * URL as a fallback). Falls back to "png" because that's what most adapters
 * emit and what looks correct in the browser when the content-type is
 * missing or generic ("application/octet-stream").
 */
function extFromResponse(res: Response, url: string): string {
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("png")) return "png";
  // Fall back to URL extension.
  const m = url.match(/\.(webp|png|jpg|jpeg|gif)(?:\?|$)/i);
  if (m) return m[1].toLowerCase();
  return "png";
}

/**
 * Fetch each job's source URL, upload to Storage, and write the path back to
 * `items.image_path`. Also records an `item_images` audit row.
 *
 * Failures are logged and counted; they never throw.
 */
export async function cacheImagesForSlugs(
  jobs: ImageJob[],
  options: CacheImagesOptions = {}
): Promise<CacheImagesResult> {
  const result: CacheImagesResult = {
    uploaded: 0,
    skippedAlreadyCached: 0,
    skippedMissingItem: 0,
    errors: 0,
    errorSlugs: [],
  };
  if (jobs.length === 0) return result;

  const db = getSupabaseAdmin();
  if (!db) return result;

  const bucket = process.env.SUPABASE_IMAGE_BUCKET ?? DEFAULT_BUCKET;
  const skipIfPresent = options.skipIfPresent ?? true;

  // De-dupe by slug — first job wins.
  const dedup = new Map<string, ImageJob>();
  for (const job of jobs) {
    if (!dedup.has(job.itemSlug)) dedup.set(job.itemSlug, job);
  }
  const dedupedJobs = Array.from(dedup.values());

  // Pre-load (id, image_path) for every slug we're about to touch. PostgREST
  // `.in()` is fine up to ~300 values; chunk to stay safely under that.
  const slugInfo = new Map<string, { id: string; image_path: string | null }>();
  const slugs = dedupedJobs.map((j) => j.itemSlug);
  for (let i = 0; i < slugs.length; i += 300) {
    const chunk = slugs.slice(i, i + 300);
    const { data, error } = await db
      .from("items")
      .select("id, slug, image_path")
      .in("slug", chunk);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{
      id: string;
      slug: string;
      image_path: string | null;
    }>) {
      slugInfo.set(row.slug, { id: row.id, image_path: row.image_path });
    }
  }

  let done = 0;
  for (const job of dedupedJobs) {
    done += 1;
    const info = slugInfo.get(job.itemSlug);
    if (!info) {
      result.skippedMissingItem += 1;
      options.onProgress?.({ done, total: dedupedJobs.length, slug: job.itemSlug, status: "skipped" });
      continue;
    }
    if (skipIfPresent && info.image_path) {
      result.skippedAlreadyCached += 1;
      options.onProgress?.({ done, total: dedupedJobs.length, slug: job.itemSlug, status: "skipped" });
      continue;
    }

    if (options.delayMs && done > 1) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }

    try {
      const res = await fetch(job.sourceUrl);
      if (!res.ok) {
        result.errors += 1;
        result.errorSlugs.push(job.itemSlug);
        options.onProgress?.({ done, total: dedupedJobs.length, slug: job.itemSlug, status: "error" });
        continue;
      }
      const ext = extFromResponse(res, job.sourceUrl);
      const buffer = new Uint8Array(await res.arrayBuffer());
      const storagePath = imagePathFor(job.itemSlug, ext);

      const upload = await db.storage.from(bucket).upload(storagePath, buffer, {
        contentType: res.headers.get("content-type") ?? `image/${ext}`,
        upsert: true,
      });
      if (upload.error) {
        console.warn(`[images] upload failed for ${job.itemSlug}:`, upload.error);
        result.errors += 1;
        result.errorSlugs.push(job.itemSlug);
        options.onProgress?.({ done, total: dedupedJobs.length, slug: job.itemSlug, status: "error" });
        continue;
      }

      // Write the path back to the items row so the UI can find it.
      const { error: updateErr } = await db
        .from("items")
        .update({
          image_path: storagePath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", info.id);
      if (updateErr) {
        console.warn(`[images] items.image_path update failed for ${job.itemSlug}:`, updateErr);
        result.errors += 1;
        result.errorSlugs.push(job.itemSlug);
        options.onProgress?.({ done, total: dedupedJobs.length, slug: job.itemSlug, status: "error" });
        continue;
      }

      // Audit row. Best-effort: a failure here doesn't undo the upload.
      const { error: auditErr } = await db.from("item_images").insert({
        item_id: info.id,
        source_name: job.sourceName ?? null,
        source_image_url: job.sourceUrl,
        storage_path: storagePath,
      });
      if (auditErr) {
        console.warn(`[images] item_images insert failed for ${job.itemSlug}:`, auditErr);
      }

      result.uploaded += 1;
      options.onProgress?.({ done, total: dedupedJobs.length, slug: job.itemSlug, status: "uploaded" });
    } catch (err) {
      console.warn(`[images] fetch failed for ${job.itemSlug}:`, err);
      result.errors += 1;
      result.errorSlugs.push(job.itemSlug);
      options.onProgress?.({ done, total: dedupedJobs.length, slug: job.itemSlug, status: "error" });
    }
  }

  return result;
}

/**
 * Daily-sync entry point: convert candidate rows + a slug→url map into image
 * jobs and run `cacheImagesForSlugs`. Kept as a thin wrapper so the
 * `syncValues` call site stays unchanged.
 */
export async function cacheImagesForRows(
  rows: CandidateRow[],
  sourceImageUrlsBySlug: Map<string, string>,
  options?: Pick<CacheImagesOptions, "onProgress">
): Promise<CacheImagesResult> {
  const seen = new Set<string>();
  const jobs: ImageJob[] = [];
  for (const row of rows) {
    if (seen.has(row.itemSlug)) continue;
    seen.add(row.itemSlug);
    const url = sourceImageUrlsBySlug.get(row.itemSlug);
    if (!url) continue;
    jobs.push({ itemSlug: row.itemSlug, sourceUrl: url });
  }
  return cacheImagesForSlugs(jobs, options);
}
