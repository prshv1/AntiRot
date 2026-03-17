<div align="center">

# 🧠 Anti-Rot

**Stop doomscrolling. Start learning.**

A Chrome extension + Python backend that automatically blocks non-valuable YouTube videos — so you only watch what actually matters.

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/anti-rot/peicgeopikaehdnnaloamfhhikikegan)
[![Version](https://img.shields.io/badge/Version-v0.4.1-FF6B6B?style=for-the-badge)](#version-log)
[![Made with Love](https://img.shields.io/badge/Made_with-Love-E91E63?style=for-the-badge)](#)

</div>

---

## ⚡ How It Works

> Browse YouTube like you normally do — Anti-Rot works silently in the background.

| Step | What Happens |
|:----:|:-------------|
| 🎬 | You open a YouTube video |
| 🔗 | The extension detects the video and extracts the URL |
| 📝 | Backend fetches the transcript via **Supadata API** |
| 🤖 | An LLM classifies the video as *educational* or *distraction* |
| ✅ | **Valuable?** Keep watching — nothing changes |
| 🚫 | **Not valuable?** Page gets replaced with a *"Time is valuable"* screen |

---

## 🏗️ Architecture

```mermaid
flowchart TD
    A["🎬 User opens YouTube video"] --> B["🧩 Chrome Extension extracts URL"]
    B --> C["📡 Sends URL to Backend Server"]
    C --> D["📝 Supadata API fetches transcript"]
    D --> E["🤖 Transcript sent to LLM via OpenRouter"]
    E --> F{"🧠 LLM Classification"}
    F -->|"✅ Valuable"| G["Allow video to play"]
    F -->|"🚫 Time Waste"| H["Block video & show warning"]

    style A fill:#1a1a2e,stroke:#e94560,color:#fff
    style B fill:#1a1a2e,stroke:#0f3460,color:#fff
    style C fill:#1a1a2e,stroke:#0f3460,color:#fff
    style D fill:#1a1a2e,stroke:#0f3460,color:#fff
    style E fill:#1a1a2e,stroke:#0f3460,color:#fff
    style F fill:#16213e,stroke:#e94560,color:#fff
    style G fill:#0a3d2a,stroke:#00d97e,color:#fff
    style H fill:#3d0a0a,stroke:#e94560,color:#fff
```

---

## 📦 Installation

1. Visit the **[Chrome Web Store](https://chromewebstore.google.com/detail/anti-rot/peicgeopikaehdnnaloamfhhikikegan)**
2. Click **"Add to Chrome"**
3. Done — that's it! 🎉

> **Prerequisite:** Any Chromium-based browser (Chrome, Brave, Edge, Arc, etc.)

---

## 📂 Project Structure

```
Anti-Rot/
├── 🧩 Browser Client/        # Chrome extension source
│   ├── manifest.json          # Extension manifest (v3)
│   ├── background.js          # Service worker
│   ├── content.js             # Content script for YT pages
│   ├── content.css            # Injection styles
│   ├── popup.html / .js / .css # Extension popup UI
│   └── icons/                 # Extension icons
├── ⚙️ Server/                  # Python backend
│   ├── server.py              # Flask/FastAPI server
│   ├── Dockerfile             # Container config
│   └── requirements.txt       # Python dependencies
├── 🎨 Promotions/             # Marketing & promo assets
├── 🧪 Testing/                # Test suite
└── 📄 README.md
```

---

## 📋 Version Log

| Version | Milestone |
|:-------:|:----------|
| `v0.1` | 🏗️ Prototype stage |
| `v0.2` | ☁️ Deployed backend on cloud servers |
| `v0.3` | 🔄 Switched from yt-dlp to Supadata for transcripts |
| `v0.4` | 🚀 Completed client-side software — ready for beta shipping |
| `v0.4.1` | 🚀 Making the browser extension public |

---

## 🔮 Upcoming Features

- [ ] **Custom Preferences** — let users define what "valuable" means to them
- [ ] **Multi-language Support** — extend beyond English-language videos
- [ ] **Distraction-free UI** — hide distracting YouTube elements (like Unhook)
- [ ] **Cross-platform** — expand support to sites beyond YouTube

---

## 🧰 Skills & Tech Stack

<div align="center">

| Category | Technologies |
|:---------|:-------------|
| **Frontend** | Chrome Extensions API (Manifest V3), JavaScript, HTML/CSS |
| **Backend** | Python, Flask, Docker |
| **Cloud** | Google Cloud Platform (GCP) |
| **AI/ML** | OpenRouter, LLM APIs |
| **Data** | Supadata Transcript API |

</div>

---

<div align="center">

### 💡 What I Learned Building This

`Creating APIs` · `Deploying Docker on GCP` · `Managing User Accounts` · `Working with LLMs` · `Building Simple & Useful Software`

---

**Version:** v0.4.1 · **Stage:** Prototype

Made with ❤️ by [@prshv1](https://linktr.ee/prshv1)

</div>
