import { useState } from "react";
import { generateQuiz } from "../../services/api.js";

export default function QuizModal({ sourceText, title, quiz, setQuiz }) {
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [status, setStatus] = useState("");

  async function handleGenerate() {
    if (!sourceText) {
      setStatus("Upload a document first to generate a quiz.");
      return;
    }

    setStatus("Generating quiz...");
    const result = await generateQuiz({
      sourceText,
      title,
      difficulty,
      count: Number(count),
    });
    setQuiz(result.quiz);
    setStatus("Quiz ready.");
  }

  return (
    <section className="panel-card">
      <h3>Quiz Generator</h3>
      <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
      </select>
      <input
        type="number"
        min="3"
        max="10"
        value={count}
        onChange={(event) => setCount(event.target.value)}
      />
      <button className="send-button" type="button" onClick={handleGenerate}>
        Create Quiz
      </button>
      <p className="status-row">{status}</p>
      {quiz?.questions?.map((item, index) => (
        <div className="quiz-question" key={`${item.question}-${index}`}>
          <strong>
            {index + 1}. {item.question}
          </strong>
          <div>{item.options?.join(" | ")}</div>
          <div className="status-row">Answer: {item.answer}</div>
        </div>
      ))}
    </section>
  );
}
