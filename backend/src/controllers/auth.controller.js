import { upsertProfile } from "../services/supabase.service.js";

export async function bootstrapProfile(req, res) {
  try {
    const { id, email, fullName } = req.body;

    if (!id || !email) {
      return res.status(400).json({ error: "id and email are required." });
    }

    const profile = await upsertProfile({
      id,
      email,
      full_name: fullName ?? email.split("@")[0],
    });

    return res.json({ profile });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
