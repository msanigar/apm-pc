import type { Handler } from "@netlify/functions";
import { hasSupabaseAdmin } from "../../src/server/supabase";
import { json, serverError } from "./_response";

export const handler: Handler = async () => {
  try {
    return json({
      ok: true,
      timestamp: new Date().toISOString(),
      supabaseConfigured: hasSupabaseAdmin(),
      runtime: "netlify-functions",
    });
  } catch (err) {
    return serverError(err);
  }
};
