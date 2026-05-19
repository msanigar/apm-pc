/**
 * Edge function that rewrites the OpenGraph / Twitter meta block in the
 * SPA's `index.html` so social-media link previews show route-specific
 * content (Discord, Twitter/X, iMessage, Slack, Facebook, etc.).
 *
 * Strategy:
 *   - Always serve the same SPA shell to users and crawlers — no UA sniffing.
 *   - Only HTML responses are touched; assets, JSON, etc. pass through.
 *   - The dynamic block lives between `<!-- META:DYNAMIC:START -->` and
 *     `<!-- META:DYNAMIC:END -->` markers in `index.html`; we replace
 *     everything between them.
 *   - Failures fall back to the defaults already in the static HTML so a
 *     Supabase blip can't break the homepage.
 *
 * Registered in `netlify.toml` against:
 *   - `/`
 *   - `/about`
 *   - `/trade`
 *   - `/items/*`
 *
 * Other routes pass straight through Netlify's normal SPA fallback.
 */
import type { Context } from "https://edge.netlify.com";

const FALLBACK_OG_IMAGE = "/og/default.png";
const SITE_NAME = "Adopt Me Values";

type ItemRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  rarity: string | null;
  image_path: string | null;
  is_high_tier: boolean | null;
};

type AggregatedRow = {
  variant: string;
  value_rp: number;
};

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);

  // Only rewrite HTML responses. Let the rest (CSS, JS, images, JSON, etc.)
  // pass through untouched.
  const response = await context.next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  let html: string;
  try {
    html = await response.text();
  } catch {
    return response;
  }

  if (!html.includes("META:DYNAMIC:START")) {
    // Marker missing — assume we're looking at something unusual; pass through.
    return new Response(html, response);
  }

  let block: string;
  try {
    block = await buildMetaBlock(url);
  } catch (err) {
    console.warn("[og-meta] meta build failed:", err);
    return new Response(html, response);
  }

  const rewritten = html.replace(
    /<!-- META:DYNAMIC:START -->[\s\S]*?<!-- META:DYNAMIC:END -->/,
    `<!-- META:DYNAMIC:START -->\n${block}\n    <!-- META:DYNAMIC:END -->`
  );

  // Strip headers that no longer apply after rewriting.
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  // Edge cache for 5 minutes; CDN cache for 1 hour. Item/trade meta only
  // changes when the underlying record changes, which is at most daily.
  headers.set(
    "Cache-Control",
    "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
  );

  return new Response(rewritten, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

async function buildMetaBlock(url: URL): Promise<string> {
  const pathname = url.pathname;

  if (pathname === "/") {
    return renderMeta({
      url: url.origin + "/",
      title: "Adopt Me Values — Free, ad-free pet & item value checker",
      description:
        "Search pets and items, see aggregated RP values from multiple community sources, refreshed daily.",
      imageUrl: url.origin + FALLBACK_OG_IMAGE,
      imageAlt: "Adopt Me Values — Free, ad-free pet and item value checker",
      type: "website",
    });
  }

  if (pathname === "/about") {
    return renderMeta({
      url: url.origin + "/about",
      title: "About — Adopt Me Values",
      description:
        "How the value aggregator works, what data sources we use, and how often values are refreshed.",
      imageUrl: url.origin + FALLBACK_OG_IMAGE,
      imageAlt: "Adopt Me Values",
      type: "website",
    });
  }

  if (pathname === "/trade") {
    // Trade pages can carry l= / r= query params with item lists. We don't
    // currently render them into the preview text — that's a v2 nicety
    // (composite image generator). For now keep the meta generic so the
    // share preview always looks the same.
    return renderMeta({
      url: url.origin + url.pathname + url.search,
      title: "Adopt Me trade comparison",
      description:
        "Compare two Adopt Me offers side-by-side with aggregated RP values. Add up to 18 items per side and see which is heavier.",
      imageUrl: url.origin + FALLBACK_OG_IMAGE,
      imageAlt: "Adopt Me trade comparison",
      type: "website",
    });
  }

  if (pathname.startsWith("/items/")) {
    const slug = pathname.slice("/items/".length).split("/")[0];
    if (!slug) {
      return renderDefault(url);
    }
    const item = await fetchItemMeta(slug);
    if (!item) return renderDefault(url);

    const valueText = item.valueRp != null ? formatRp(item.valueRp) : null;
    const sourcesText = item.sourceLabel ? ` ${item.sourceLabel}` : "";
    const titleParts = [item.name];
    if (item.rarity) titleParts.push(humanise(item.rarity));
    const title = `${titleParts.join(" · ")} — Adopt Me value`;

    const description = valueText
      ? `${item.name} is worth around ${valueText}.${sourcesText} Free, ad-free pet & item value checker.`
      : `Adopt Me value reference for ${item.name}.${sourcesText} Free, ad-free pet & item value checker.`;

    return renderMeta({
      url: url.origin + "/items/" + item.slug,
      title,
      description,
      imageUrl: item.imageUrl ?? url.origin + FALLBACK_OG_IMAGE,
      imageAlt: `${item.name} — Adopt Me Values`,
      type: "article",
    });
  }

  return renderDefault(url);
}

function renderDefault(url: URL): string {
  return renderMeta({
    url: url.origin + url.pathname,
    title: "Adopt Me Values — Free, ad-free pet & item value checker",
    description:
      "Search pets and items, see aggregated RP values from multiple community sources, refreshed daily.",
    imageUrl: url.origin + FALLBACK_OG_IMAGE,
    imageAlt: "Adopt Me Values",
    type: "website",
  });
}

type MetaInput = {
  url: string;
  title: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  type: "website" | "article";
};

function renderMeta(m: MetaInput): string {
  const t = escapeHtml(m.title);
  const d = escapeHtml(m.description);
  const u = escapeHtml(m.url);
  const i = escapeHtml(m.imageUrl);
  const a = escapeHtml(m.imageAlt);
  return [
    `    <meta property="og:type" content="${m.type}" />`,
    `    <meta property="og:site_name" content="${SITE_NAME}" />`,
    `    <meta property="og:title" content="${t}" />`,
    `    <meta property="og:description" content="${d}" />`,
    `    <meta property="og:image" content="${i}" />`,
    `    <meta property="og:image:width" content="1200" />`,
    `    <meta property="og:image:height" content="630" />`,
    `    <meta property="og:image:alt" content="${a}" />`,
    `    <meta property="og:url" content="${u}" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${t}" />`,
    `    <meta name="twitter:description" content="${d}" />`,
    `    <meta name="twitter:image" content="${i}" />`,
    `    <meta name="twitter:image:alt" content="${a}" />`,
    `    <link rel="canonical" href="${u}" />`,
  ].join("\n");
}

async function fetchItemMeta(slug: string): Promise<
  | null
  | {
      slug: string;
      name: string;
      rarity: string | null;
      imageUrl: string | null;
      valueRp: number | null;
      sourceLabel: string | null;
    }
> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return null;

  const safeSlug = encodeURIComponent(slug);
  const itemRes = await fetch(
    `${supabaseUrl}/rest/v1/items?slug=eq.${safeSlug}&select=id,slug,name,category,rarity,image_path,is_high_tier&limit=1`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    }
  );
  if (!itemRes.ok) return null;
  const itemRows = (await itemRes.json()) as ItemRow[];
  const item = itemRows[0];
  if (!item) return null;

  // Pull the regular variant's value to put in the description. We don't
  // want to over-fetch — one row per variant is fine, we'll pick the
  // headline number from that.
  let valueRp: number | null = null;
  let sourceLabel: string | null = null;
  try {
    const aggRes = await fetch(
      `${supabaseUrl}/rest/v1/aggregated_values?item_id=eq.${item.id}&select=variant,value_rp&order=value_rp.desc&limit=8`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      }
    );
    if (aggRes.ok) {
      const aggs = (await aggRes.json()) as AggregatedRow[];
      // Prefer the "regular" variant if present (the base/headline value
      // for the item); fall back to the cheapest variant we have, which
      // matches what the detail page emphasises.
      const regular = aggs.find((a) => a.variant === "regular");
      const headline = regular ?? aggs[aggs.length - 1];
      if (headline) {
        valueRp = Number(headline.value_rp);
        if (aggs.length > 1) sourceLabel = `Aggregated from community sources.`;
      }
    }
  } catch {
    // Ignore — meta will just omit the value.
  }

  return {
    slug: item.slug,
    name: item.name,
    rarity: item.rarity,
    imageUrl: item.image_path
      ? buildPublicImageUrl(supabaseUrl, item.image_path)
      : null,
    valueRp,
    sourceLabel,
  };
}

function buildPublicImageUrl(supabaseUrl: string, path: string): string {
  const bucket = Deno.env.get("SUPABASE_IMAGE_BUCKET") ?? "adopt-me";
  const clean = path.replace(/^\/+/, "");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${clean}`;
}

function formatRp(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M RP`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k RP`;
  }
  return `${Math.round(n)} RP`;
}

function humanise(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
