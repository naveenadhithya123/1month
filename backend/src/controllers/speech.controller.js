import {
  speakText,
  transcribeAudio,
} from "../services/huggingface.service.js";

export async function transcribe(req, res) {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "An audio file is required." });
    }

    const text = await transcribeAudio(file.buffer, file.mimetype);
    return res.json({ text });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function textToSpeech(req, res) {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "text is required." });
    }

    const audioBuffer = await speakText(text);

    return res.json({
      audioBase64: audioBuffer.toString("base64"),
      mimeType: "audio/wav",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
