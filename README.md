<div align="center">

# Anti-Rot

**Stop doomscrolling. Start learning.**

[![Install](https://img.shields.io/badge/Install-antirot.in-FF6B6B?style=for-the-badge&logo=googlechrome&logoColor=white)](https://antirot.in)
![Version](https://img.shields.io/badge/Version-0.6.2-FF6B6B?style=for-the-badge)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)

---

*A Chrome extension and Python backend that acts as an LLM-powered firewall for YouTube. It classifies video transcripts in real-time, blocking superficial content and only permitting educational or valuable videos.*

</div>

---

## Architecture

```
Anti-Rot/
├── Browser_Client/             ← Chrome Extension (Manifest V3)
├── Server/                     ← FastAPI REST Server + Docker
└── test_client.py              ← Local API test script
```

The system operates as a real-time proxy intercepting YouTube navigation events:

1. **Client Intercept**: The Chrome extension detects a YouTube video URL via background service workers.
2. **Server Cache Check**: The FastAPI server checks the local classification cache by YouTube video ID, falling back to the raw URL for non-YouTube links.
3. **Transcript Retrieval**: On a cache miss, the server calls the Supadata API to extract the full video transcript. If custom instructions are present and the video is cached, the cached transcript is reused but the cached category is ignored.
4. **LLM Classification**: The transcript and any custom user instructions are passed to an OpenRouter LLM endpoint for binary evaluation (Value vs. Distraction).
5. **Cache Write & Client Enforcement**: Successful classifications are stored with the video URL, transcript, and category. The extension reads the API response and either injects a blocking overlay or allows navigation.

---

## Classification Logic

The core value proposition relies on strict, fast, and deterministic transcript classification.

### Prompt Design
The prompt utilizes a zero-shot, binary classification approach. The system prompt forces the LLM to act strictly as a binary router: it must output `1` if the content is educational, informational, skill-building, or productivity-related, and `0` for anything else. The prompt explicitly forbids explanations, punctuation, or preamble to ensure exact integer parsing on the backend.

### Custom Instructions
Users can write custom instructions directly in the browser extension popup. These instructions are appended to the system prompt at classification time, giving the LLM absolute overrides. For example: *"Allow rickrolls"* or *"Block all gaming content even if educational."* Custom instructions take priority over the default classification rules.

### Model Choice
The pipeline utilizes `openai/gpt-oss-120b:free` via OpenRouter, with an automatic fallback to the paid `openai/gpt-oss-120b` model. This keeps the free model as the primary path while retaining a same-family fallback when OpenRouter cannot return a usable response from the free endpoint.

### Edge Case Handling
The system implements a **fail-open** design pattern to maintain a frictionless user experience:
- **No Transcript Available:** If Supadata cannot extract a transcript (e.g., no captions or non-English video), the API returns a `422 Unprocessable Entity` error.
- **Upstream Failures:** If the OpenRouter LLM times out or rate-limits the request, the API returns a `500 Internal Server Error`.
- **Client Fallback:** The Chrome extension intercepts non-200 HTTP responses and defaults to an `allowed` state. It ensures that network or API degradation never prevents the user from accessing a video.

---

## Quick Start

### Install the Extension

Visit **[antirot.in](https://antirot.in)** to install the browser extension.

### Backend Server (FastAPI)

```bash
cd Server
pip install -r requirements.txt

# Create .env based on .env.example
cp .env.example .env

# Run the local server
uvicorn server:app --reload --port 8000
```

### Load Extension Locally (Developer Mode)

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `Browser_Client/` directory

---

## API Endpoints

| Method | Path | Input | Output | Description |
|--------|------|-------|--------|-------------|
| `GET` | `/health` | — | `{"status": "alive"}` | Health check |
| `POST` | `/installs/register` | JSON: `{"requested_install_id": "...", "client": {...}}` | JSON: `{"install_id": "...", "install_token": "..."}` | Creates a server-issued install credential pair; can attach a token to an older local install ID during migration |
| `POST` | `/classify` | JSON: `{"url": "...", "instructions": "...", "install_id": "...", "install_token": "..."}` | JSON: `{"category": 0/1}` | Verifies install credentials, executes classification, and writes a tracking event |

Install records are stored at `INSTALL_REGISTRY_PATH`. The server stores only a SHA-256 hash of each `install_token`, then verifies that the submitted `install_id` and `install_token` match before checking the classification cache or running Supadata/OpenRouter. Existing installs keep their stored ID/token across extension autoupdates; older installs that have an ID but no token request a token for that same ID once. If credentials do not match, `/classify` returns `{"detail": "User not found."}`. Request tracking is logged as JSONL to `API_CALL_LOG_PATH` and, by default, stdout for AWS logs. Each classify event includes request metadata, client IP/proxy headers, URL, instructions, install ID, install token hash, YouTube video ID, cache status, Supadata/OpenRouter timings, result category, and failure details. Raw install tokens and account identifiers are not logged.

Successful default-rule classifications are cached in SQLite at `CLASSIFICATION_CACHE_DB_PATH` (`data/video_classification_cache.sqlite3` by default). The cache stores the video URL, transcript, and category. If a matching video is already cached and the request has no custom instructions, `/classify` returns the cached category and does not call Supadata or OpenRouter. If custom instructions are present, the server reuses a cached transcript when available, but still calls OpenRouter and does not write the custom-instruction result back into the shared cache.

For cache hits, request logs mark live-pipeline-only fields such as Supadata, OpenRouter, and cache-write timings as `na`.

The request log is append-only: every event is added as one JSON object line to the same `api_call_events.jsonl` file. For larger logs, use `python Server/tools/request_log_summary.py` for a streaming summary or `python Server/tools/request_log_to_sqlite.py` to import the log into `data/api_request_events.sqlite3` for SQL queries and cache analysis.

## Upcoming Features

- Lockdown mode

---

## Tech Stack

- **Backend:** Python 3.11, FastAPI, Uvicorn
- **AI / LLM:** OpenRouter (`gpt-oss-120b:free`, `gpt-oss-120b`)
- **Transcript Extraction:** Supadata API
- **Browser Extension:** Chrome Manifest V3 (Vanilla JS)
- **Deployment:** Docker, Google Cloud Run

---

## Project Structure

```
Anti-Rot/
├── Browser_Client/
│   ├── manifest.json          # Extension manifest (v3)
│   ├── background.js          # Service worker and caching layer
│   ├── content.js             # Content script for DOM manipulation
│   ├── content.css            # Overlay injection styles
│   ├── popup.html / .js / .css  # Extension UI (toggle, whitelist, custom instructions)
│   └── icons/                 # Extension icons
├── Server/
│   ├── server.py              # FastAPI application and LLM pipeline
│   ├── Dockerfile             # Production container definition
│   ├── requirements.txt       # Python dependencies
│   ├── .env.example           # Environment template
│   └── .env                   # Local secrets (gitignored)
├── test_client.py             # Local API test script
└── README.md
```
