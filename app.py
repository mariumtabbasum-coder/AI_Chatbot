import json
import os
import time

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from google import genai
from google.genai import types

load_dotenv()

app = Flask(__name__)

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")  # used if the main model is overloaded
RETRY_WORDS = ("503", "unavailable", "overloaded", "high demand")
client = genai.Client(api_key=API_KEY) if API_KEY else None

DEFAULT_SYSTEM = "You are a helpful, friendly AI assistant. Answer clearly and concisely."
MAX_MESSAGES = 20      # context window: only the latest N messages are sent
MAX_CHARS = 24000      # hard cap on total characters sent to the model


def trim_history(messages):
    """Keep the newest messages that fit in the context budget."""
    kept, total = [], 0
    for m in reversed(messages[-MAX_MESSAGES:]):
        total += len(m["content"])
        if total > MAX_CHARS:
            break
        kept.append(m)
    return list(reversed(kept))


def normalize(messages):
    """Merge consecutive same-role messages and make sure history starts with a user turn."""
    merged = []
    for m in messages:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append({"role": m["role"], "content": m["content"]})
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    return merged


def is_busy(exc):
    return any(w in str(exc).lower() for w in RETRY_WORDS)


def friendly_error(exc):
    text = str(exc).lower()
    if is_busy(exc):
        return "Gemini is busy right now (high demand). Wait a few seconds and press Enter again."
    if "api key" in text or "permission" in text or "401" in text or "403" in text:
        return "The API key is invalid or missing. Check GEMINI_API_KEY in your .env file."
    if "429" in text or "quota" in text or "resource_exhausted" in text:
        return "Rate limit reached. Wait a moment and try again."
    if any(k in text for k in ("timeout", "deadline", "connect", "getaddrinfo", "network", "errno", "resolve")):
        return "Could not reach Gemini. Check your internet connection and try again."
    if "not found" in text or "404" in text:
        return "Model not found. Check GEMINI_MODEL in your .env file."
    # Unknown error: show a short technical detail so it can be debugged.
    return f"Could not generate a reply ({type(exc).__name__}: {str(exc)[:160]})"


@app.route("/")
def index():
    return render_template("index.html", default_system=DEFAULT_SYSTEM, model=MODEL)


@app.route("/api/chat", methods=["POST"])
def chat():
    if client is None:
        return jsonify(error="GEMINI_API_KEY is not set. Add it to your .env file."), 500

    data = request.get_json(silent=True) or {}
    messages = [
        m for m in data.get("messages", [])
        if m.get("role") in ("user", "assistant") and str(m.get("content", "")).strip()
    ]
    if not messages or messages[-1]["role"] != "user":
        return jsonify(error="Send a question to get a reply."), 400

    system = (data.get("system") or DEFAULT_SYSTEM).strip()[:2000]
    history = normalize(trim_history(messages))
    contents = [
        types.Content(
            role="model" if m["role"] == "assistant" else "user",
            parts=[types.Part(text=m["content"])],
        )
        for m in history
    ]

    def generate():
        models = [MODEL] + ([FALLBACK_MODEL] if FALLBACK_MODEL and FALLBACK_MODEL != MODEL else [])
        last_exc = None
        for model in models:
            for attempt in range(3):
                started = False
                try:
                    stream = client.models.generate_content_stream(
                        model=model,
                        contents=contents,
                        config=types.GenerateContentConfig(system_instruction=system),
                    )
                    for chunk in stream:
                        if chunk.text:
                            started = True
                            yield json.dumps({"text": chunk.text}) + "\n"
                    return
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    app.logger.warning("Gemini error (%s, try %d): %s", model, attempt + 1, exc)
                    # Retry only if nothing was sent yet and the error is a temporary overload
                    if started or not is_busy(exc):
                        yield json.dumps({"error": friendly_error(exc)}) + "\n"
                        return
                    if attempt < 2:
                        time.sleep(1.5 * (attempt + 1))
        yield json.dumps({"error": friendly_error(last_exc)}) + "\n"

    return Response(stream_with_context(generate()), mimetype="application/x-ndjson")


if __name__ == "__main__":
    app.run(debug=True)
