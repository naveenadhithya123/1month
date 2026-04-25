import OpenAI from "openai";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const groq = GROQ_API_KEY
  ? new OpenAI({
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: GROQ_API_KEY,
    })
  : null;

export const MODEL_PRESETS = {
  groqChat: process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
};

function ensureGroq() {
  if (!groq) {
    throw new Error("GROQ_API_KEY is missing in backend/.env");
  }
}

export async function chatCompletion({
  messages,
  temperature = 0.2,
  maxTokens = 1800,
  model = MODEL_PRESETS.groqChat,
}) {
  ensureGroq();

  try {
    const completion = await groq.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    return completion.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    const message = String(error?.message || "");

    if (/401|403|incorrect api key|invalid api key|unauthorized|forbidden/i.test(message)) {
      throw new Error("Groq is not configured correctly. Please update GROQ_API_KEY.");
    }

    if (/429|rate limit|quota|resource exhausted/i.test(message)) {
      throw new Error("Groq is busy or out of quota. Please wait and try again.");
    }

    throw error;
  }
}

export async function summarizeText(text = "") {
  return chatCompletion({
    messages: [
      {
        role: "system",
        content: "Summarize finance or document text clearly and concisely.",
      },
      {
        role: "user",
        content: String(text).slice(0, 16000),
      },
    ],
    maxTokens: 700,
  });
}

export async function embedTexts() {
  return [];
}

export async function generateQuiz() {
  throw new Error("Quiz generation is not enabled in this invoice reconciliation project.");
}

export async function transcribeAudio() {
  throw new Error("Speech transcription is not enabled in this invoice reconciliation project.");
}

export async function speakText() {
  throw new Error("Text-to-speech is not enabled in this invoice reconciliation project.");
}

export async function visionCompletion() {
  throw new Error("Vision analysis is not enabled in this invoice reconciliation project.");
}

export async function extractImageText() {
  return "";
}

export async function generateImageFromPrompt() {
  throw new Error("Image generation is not enabled in this invoice reconciliation project.");
}

export function isImageGenerationPrompt() {
  return false;
}
