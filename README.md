# AI Interview Assistant

Web-based interview form with:
- guided question flow
- voice input for answers
- optional spoken AI prompts that you turn on manually
- local Ollama-powered clarification and answer cleaning
- PDF export for print-ready records

## Setup

1. Install dependencies:
   npm install
2. Copy environment template:
   copy .env.example .env
3. Edit `.env` if needed:
   - set `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`
   - set `OLLAMA_MODEL=llama3.2:3b` (or any model you already pulled)
4. Pull/start your model locally (one-time):
   ollama pull llama3.2:3b
5. Start server:
   npm start
6. Open:
   http://localhost:3000

## Notes

- The backend is Ollama-only and expects a local OpenAI-compatible Ollama endpoint.
- Spoken turns are interpreted by `/api/interpret-turn` to clean data values.
- AI voice output uses the browser speech engine and starts off disabled until you turn it on.
- The app prefers more natural English browser voices when available, but the exact voice still depends on the browser and OS voice packs installed.
