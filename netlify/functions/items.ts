import type { Handler } from "@netlify/functions";
import {
  buildMockSearchIndex,
  loadItemBySlug,
} from "../../src/server/repo";
import { hasSupabaseAdmin } from "../../src/server/supabase";
import { badRequest, json, notFound, serverError } from "./_response";

/**
 * GET /api/items/:slug
 *
 * Returns full item detail (canonical row + all aggregated variant values).
 */
export const handler: Handler = async (event) => {
  try {
    const slug = (
      event.queryStringParameters?.slug ??
      event.path.split("/").pop() ??
      ""
    ).trim();
    if (!slug) return badRequest("Missing slug");

    if (!hasSupabaseAdmin()) {
      const mock = buildMockSearchIndex().find((i) => i.slug === slug);
      if (!mock) return notFound();
      return json({
        item: {
          id: mock.id,
          slug: mock.slug,
          name: mock.name,
          category: mock.category,
          rarity: mock.rarity,
          aliases: mock.aliases,
          imagePath: null,
          isHighTier: false,
        },
        imageUrl: null,
        values: Object.values(mock.values),
      });
    }

    const result = await loadItemBySlug(slug);
    if (!result) return notFound();
    return json({
      item: result.item,
      imageUrl: result.item.imagePath ? `/${result.item.imagePath}` : null,
      values: result.values,
    });
  } catch (err) {
    return serverError(err);
  }
};
