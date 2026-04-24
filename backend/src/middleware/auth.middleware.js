import { createClient } from "@supabase/supabase-js";

const canVerifyAuth =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY;

const supabase = canVerifyAuth
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

export async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ") || !supabase) {
      req.user = null;
      return next();
    }

    const token = header.replace("Bearer ", "");
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      req.user = null;
      return next();
    }

    req.user = data.user ?? null;
    return next();
  } catch {
    req.user = null;
    return next();
  }
}
