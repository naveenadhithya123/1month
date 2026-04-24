import { useState } from "react";
import { generateImage } from "../../services/api.js";

export default function ImageGen() {
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState("");

  async function handleGenerate() {
    if (!prompt.trim()) {
      return;
    }

    setStatus("Generating image...");
    const result = await generateImage(prompt);
    setImageUrl(result.imageUrl);
    setStatus("Image generated.");
  }

  return (
    <section className="panel-card">
      <h3>Image Generator</h3>
      <textarea
        placeholder="Create an educational illustration, diagram, or concept visual..."
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <button className="send-button" type="button" onClick={handleGenerate}>
        Generate
      </button>
      <p className="status-row">{status}</p>
      {imageUrl ? <img src={imageUrl} alt="Generated" /> : null}
    </section>
  );
}
