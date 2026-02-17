from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
import requests
from supadata import Supadata


# SETUP
load_dotenv()
API_KEY = os.getenv("Openrouter_API_KEY")  # OpenRouter API key
SYSTEM_PROMPT = os.getenv("System_Prompt")
SUPADATA_API_KEY = os.getenv("Supadata_API_KEY")

app = FastAPI(
    title="Anti-Rot API",
    description="YouTube video classifier",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

# REQUEST & RESPONSE MODELS
class VideoRequest(BaseModel):
    url: str
class VideoResponse(BaseModel):
    category: int

# HELPER FUNCTIONS
def get_transcript(video_url: str) -> str:
    try:
        supadata = Supadata(api_key=SUPADATA_API_KEY)
        transcript = supadata.transcript(
            url=video_url,
            text=True,
            mode="auto"
        )
        return transcript.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcript extraction failed: {str(e)}")

def classify_video(transcript: str) -> int: #Send transcript to LLM, get back 0 or 1.
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "openai/gpt-oss-120b:free",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
    }

    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        result = response.json()
        raw = result["choices"][0]["message"]["content"].strip()
        return int(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM classification failed: {str(e)}")

# API ENDPOINTS
@app.post("/classify", response_model=VideoResponse)
def classify(req: VideoRequest):
    transcript = get_transcript(req.url)

    if not transcript:
        raise HTTPException(
            status_code=422,
            detail="No English transcript found for this video.",
        )

    category = classify_video(transcript)
    return VideoResponse(category=category)

@app.get("/health")
def health_check():
    return {"status": "alive"}