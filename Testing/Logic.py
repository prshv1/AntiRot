import os
import time
import requests
from dotenv import load_dotenv
from supadata import Supadata

# SETUP
t_total_start = time.time()

print("\n[INIT] Loading environment variables...")
t0 = time.time()
load_dotenv()
API_KEY          = os.getenv("Openrouter_API_KEY")
SYSTEM_PROMPT    = os.getenv("System_Prompt")
SUPADATA_API_KEY = os.getenv("Supadata_API_KEY")
print(f"[INIT] Done — {time.time() - t0:.3f}s")

# STEP 1 — Get URL from user
video_url = input("\nPaste YouTube URL: ").strip()

# STEP 2 — Fetch transcript via Supadata
print(f"\n[TRANSCRIPT] Fetching transcript for: {video_url}")
t0 = time.time()

try:
    supadata  = Supadata(api_key=SUPADATA_API_KEY)
    transcript_obj = supadata.transcript(url=video_url, text=True, mode="auto")
    transcript = transcript_obj.content
    elapsed = time.time() - t0
    print(f"[TRANSCRIPT] Success — {elapsed:.3f}s")
    print(f"[TRANSCRIPT] Length: {len(transcript)} characters")
except Exception as e:
    print(f"[TRANSCRIPT] FAILED after {time.time() - t0:.3f}s — {e}")
    raise SystemExit(1)

if not transcript:
    print("[TRANSCRIPT] ERROR — No English transcript found for this video.")
    raise SystemExit(1)

# STEP 3 — Classify via LLM (OpenRouter)
PRIMARY_MODEL  = "openai/gpt-oss-120b:free"
FALLBACK_MODEL = "mistralai/mistral-nemo"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

payload = {
    "model": PRIMARY_MODEL,
    "messages": [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": transcript},
    ],
}

print(f"\n[LLM] Sending transcript to model: {PRIMARY_MODEL}")
t0 = time.time()

try:
    response = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers=headers,
        json=payload,
    )
    result = response.json()
    elapsed = time.time() - t0
    print(f"[LLM] Primary model response received — {elapsed:.3f}s")

    # ── Fallback if primary fails ──────────────────────────────────────────
    if "error" in result or "choices" not in result or len(result.get("choices", [])) == 0:
        print(f"[LLM] Primary model failed. Reason: {result.get('error', 'no choices returned')}")
        print(f"[LLM] Falling back to: {FALLBACK_MODEL}")
        payload["model"] = FALLBACK_MODEL

        t0 = time.time()
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        result = response.json()
        elapsed = time.time() - t0
        print(f"[LLM] Fallback model response received — {elapsed:.3f}s")

    # ── Hard error check ───────────────────────────────────────────────────
    if "error" in result:
        error_msg = result["error"].get("message", str(result["error"]))
        if "metadata" in result["error"] and "raw" in result["error"]["metadata"]:
            error_msg += f" | raw: {result['error']['metadata']['raw']}"
        print(f"[LLM] FAILED — {error_msg}")
        raise SystemExit(1)

    # ── Parse result ───────────────────────────────────────────────────────
    t0 = time.time()
    raw = result["choices"][0]["message"]["content"].strip()
    category = int(raw)
    print(f"[LLM] Parsed category: {category} — {time.time() - t0:.3f}s")

except Exception as e:
    print(f"[LLM] Exception — {e}")
    raise SystemExit(1)

# ─────────────────────────────────────────────
# FINAL OUTPUT
# ─────────────────────────────────────────────
total_elapsed = time.time() - t_total_start

print("\n" + "─" * 40)
print(f"  RESULT  →  category: {category}")
print("─" * 40)
print(f"  Total time: {total_elapsed:.3f}s")
print("─" * 40 + "\n")