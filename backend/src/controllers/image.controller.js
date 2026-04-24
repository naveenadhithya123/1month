import { uploadBuffer } from "../services/cloudinary.service.js";
import {
  chatCompletion,
  generateImageFromPrompt,
  summarizeText,
  visionCompletion,
} from "../services/huggingface.service.js";
import { extractTextFromBuffer } from "../services/ocr.service.js";

export async function uploadImage(req, res) {
  try {
    const file = req.file;
    const { question } = req.body;

    if (!file) {
      return res.status(400).json({ error: "An image file is required." });
    }

    const uploaded = await uploadBuffer(file.buffer, {
      folder: "edu-ai/images",
      filename: file.originalname,
      mimeType: file.mimetype,
      resourceType: "image",
    });

    let extractedText = "";
    let summary = "";
    let answer = null;
    let fallbackNote = "";

    try {
      extractedText = await extractTextFromBuffer(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
    } catch (error) {
      extractedText = "";
      fallbackNote = error.message || "";
    }

    if (extractedText) {
      try {
        summary = await summarizeText(extractedText.slice(0, 12000));
      } catch (_error) {
        summary = extractedText.slice(0, 1200);
      }
    }

    if (question) {
      if (extractedText) {
        answer = await chatCompletion({
          messages: [
            {
              role: "system",
              content:
                "You are helping a student understand an uploaded study image. Answer using the extracted text first. Keep the answer clear and student-friendly.",
            },
            {
              role: "user",
              content: `Extracted text from the image:\n${extractedText}\n\nStudent request:\n${question}`,
            },
          ],
          maxTokens: 700,
        });
      } else {
        try {
          answer = await visionCompletion({
            question,
            imageUrl: uploaded.secureUrl,
          });
        } catch (_error) {
          answer =
            "I uploaded the image, but advanced visual analysis is limited right now. If the image contains text, notes, or formulas, try asking after uploading a clearer version or paste the text for me.";
        }
      }
    } else {
      answer =
        summary ||
        "I uploaded the image. If it contains notes, formulas, or visible text, I can explain, simplify, shorten, or summarize it for you.";
    }

    return res.json({
      imageUrl: uploaded.secureUrl,
      publicId: uploaded.publicId,
      answer,
      summary,
      extractedText,
      fallbackNote,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function generateImage(req, res) {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "prompt is required." });
    }

    const generatedAsset = await generateImageFromPrompt(prompt);
    const uploaded = await uploadBuffer(generatedAsset.buffer, {
      folder: "edu-ai/generated",
      filename: `generated-${Date.now()}.${generatedAsset.extension}`,
      mimeType: generatedAsset.mimeType,
      resourceType: "image",
    });

    return res.json({
      imageUrl: uploaded.secureUrl,
      prompt,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
