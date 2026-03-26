<div align="center">

# Anti-Rot

**Stop doomscrolling. Start learning.**

[![Install](https://img.shields.io/badge/Install-antirot.in-FF6B6B?style=for-the-badge&logo=googlechrome&logoColor=white)](https://antirot.in)
[![Version](https://img.shields.io/badge/Version-0.5.0-FF6B6B?style=for-the-badge)](#version-log)
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
2. **Transcript Retrieval**: The URL is forwarded to the FastAPI server, which calls the Supadata API to extract the full video transcript.
3. **LLM Classification**: The transcript and any custom user instructions are passed to an OpenRouter LLM endpoint for binary evaluation (Value vs. Distraction).
4. **Client Enforcement**: The extension reads the API response. If flagged as non-valuable, the DOM is injected with a blocking overlay. Otherwise, navigation proceeds uninterrupted.

---

## Classification Logic

The core value proposition relies on strict, fast, and deterministic transcript classification.

### Prompt Design
The prompt utilizes a zero-shot, binary classification approach. The system prompt forces the LLM to act strictly as a binary router: it must output `1` if the content is educational, informational, skill-building, or productivity-related, and `0` for anything else. The prompt explicitly forbids explanations, punctuation, or preamble to ensure exact integer parsing on the backend.

### Custom Instructions
Users can write custom instructions directly in the browser extension popup. These instructions are appended to the system prompt at classification time, giving the LLM absolute overrides. For example: *"Allow rickrolls"* or *"Block all gaming content even if educational."* Custom instructions take priority over the default classification rules.

### Model Choice
The pipeline utilizes `openai/gpt-oss-120b:free` via OpenRouter, with an automatic fallback to `mistralai/mistral-nemo`. This optimizes for low-latency inference and zero API cost while retaining the necessary parameter depth to accurately classify complex context boundaries from unstructured transcript data.

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
| `POST` | `/classify` | JSON: `{"url": "...", "instructions": "..."}` | JSON: `{"category": 0/1}` | Executes the classification pipeline |

---

## Version Log

| Version | Milestone |
|:-------:|:----------|
| `v0.1` | Prototype stage and initial prompt engineering |
| `v0.2` | Backend deployment to cloud infrastructure |
| `v0.3` | Migrated extraction dependency from yt-dlp to Supadata API |
| `v0.4` | Completed client extension and stability patches for pre-beta release |
| `v0.5` | Custom instructions — users can now write per-session override rules directly in the extension popup |

---

## Upcoming Features

- Login & user accounts
- Lockdown mode
- Paid plans & API credits
- Feature blocking tools (e.g. unhook-style sidebar removal)

---

## Tech Stack

- **Backend:** Python 3.11, FastAPI, Uvicorn
- **AI / LLM:** OpenRouter (`gpt-oss-120b`, `mistral-nemo`)
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
