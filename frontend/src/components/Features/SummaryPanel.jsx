export default function SummaryPanel({ document }) {
  return (
    <section className="panel-card">
      <h3>Document Summary</h3>
      {document ? (
        <>
          <p>
            <strong>{document.title}</strong>
          </p>
          <p>{document.summary || "Summary will appear here after upload."}</p>
        </>
      ) : (
        <p>Upload a PDF, notes file, or image to extract text and create a summary.</p>
      )}
    </section>
  );
}
