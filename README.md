# Invoice Reconciliation AI

A focused finance workflow for comparing an invoice PDF against a bank details PDF. The app extracts text from both files, asks the AI to reconcile invoices against payments, shows matched and exception counts, and emails a PDF report through Brevo.

## Project Structure

```txt
backend/
  src/controllers/reconciliation.controller.js
  src/routes/reconciliation.routes.js
  src/utils/reconciliationReport.js
  src/services/
frontend/
  src/App.jsx
  src/services/api.js
supabase/
  schema.sql
render.yaml
```

## Backend Setup

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Required `backend/.env` values:

```txt
PORT=4000
CLIENT_URL=http://localhost:5173

HF_TOKEN=
HF_CHAT_MODEL=openai/gpt-oss-120b:fastest

OCR_SPACE_API_KEY=helloworld

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=Invoice Reconciliation AI
```

You can also set `OPENAI_API_KEY`, `GROQ_API_KEY`, or `GEMINI_API_KEY` as fallback chat providers.

## Frontend Setup

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Required `frontend/.env` values:

```txt
VITE_APP_NAME=Invoice Reconciliation AI
VITE_API_URL=http://localhost:4000/api
```

## Supabase

Create a new Supabase project, open SQL Editor, and run `supabase/schema.sql`.

For this project the important table is `reconciliation_runs`, which stores the uploaded file names, extracted text, AI result JSON, and email audit status.

## Render Deployment

This repo includes a `render.yaml` blueprint for:

- `invoice-reconciliation-backend`: Node web service
- `invoice-reconciliation-frontend`: static React/Vite site

Deploy steps:

1. Push the repo to GitHub.
2. In Render, choose `New +` -> `Blueprint`.
3. Connect this repository.
4. Add backend secret environment variables.
5. Set frontend `VITE_API_URL` to `https://your-backend.onrender.com/api`.
6. Set backend `CLIENT_URL` to `https://your-frontend.onrender.com`.
7. Redeploy both services.

Do not commit `.env` files. Put real keys only in local `.env` or Render environment variables.
