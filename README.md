# Evergreen Chat – AI Chat Assistant

A ChatGPT-style web app built with **Flask + Gemini API** and a responsive **Bootstrap 5** UI.

## Features
- Ask questions and get **streaming** AI replies (typing indicator + Stop button)
- **Multiple conversation sessions** with history saved in the browser (localStorage)
- Editable **system instructions** per conversation
- **Context window** handling: only the latest 20 messages / 24,000 characters are sent
- Loading and **API error handling** (invalid key, rate limit, network)
- Markdown rendering (code blocks, lists, tables), sanitized with DOMPurify
- Fixed navbar, same items on mobile and desktop; no horizontal or page scrollbar

## Concepts covered
LLM APIs · System prompts · Context windows · Streaming (NDJSON) · API errors

## Project structure
```
app.py
templates/index.html
static/css/style.css
static/js/app.js
requirements.txt
.env.example
.gitignore
README.md
```

## Setup
```bash
python -m venv venv
venv\Scripts\activate        # Windows  (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env       # macOS/Linux: cp .env.example .env
```
Get a free key at https://aistudio.google.com/apikey and paste it into `.env`.

```bash
python app.py
```
Open http://127.0.0.1:5000

## How it works
1. The browser sends `{system, messages}` to `POST /api/chat`.
2. Flask trims history to fit the context budget and calls `generate_content_stream`.
3. Each chunk is sent back as a JSON line (`{"text": "..."}` or `{"error": "..."}`).
4. `app.js` reads the stream and updates the reply bubble live.

## Screenshots & demo
Add your screenshots to a `screenshots/` folder and link them here, plus your demo video link.

## Deploy / GitHub
```bash
git init && git add . && git commit -m "AI chatbot"
git branch -M main
git remote add origin <your-repo-url> && git push -u origin main
```
Never commit your real `.env` file (it is in `.gitignore`).
