/**
 * Build a stable, URL-safe slug for an item name.
 *
 * The slug is used as the canonical identifier across data sources, so it must
 * be deterministic and roundtripable for common Adopt Me item names.
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
