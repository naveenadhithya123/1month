import { generateQuiz } from "../services/huggingface.service.js";

export async function createQuiz(req, res) {
  try {
    const { sourceText, title, difficulty = "medium", count = 5 } = req.body;

    if (!sourceText) {
      return res.status(400).json({ error: "sourceText is required." });
    }

    const quiz = await generateQuiz({
      sourceText,
      title: title ?? "Study Quiz",
      difficulty,
      count,
    });

    return res.json({ quiz });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
