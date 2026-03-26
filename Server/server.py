from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import Optional
import os
import requests
from supadata import Supadata

# SETUP
load_dotenv()
API_KEY = os.getenv("Openrouter_API_KEY")
SYSTEM_PROMPT = os.getenv("System_Prompt")
SUPADATA_API_KEY = os.getenv("Supadata_API_KEY")

app = FastAPI(
    title="AntiRot API",
    description="YouTube video classifier",
    version="0.5.0",
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
    instructions: Optional[str] = None  # v2 field; v1 clients safe to ignore


class VideoResponse(BaseModel):
    category: int


# HELPER FUNCTIONS
def get_transcript(video_url: str) -> str:
    try:
        supadata = Supadata(api_key=SUPADATA_API_KEY)
        transcript = supadata.transcript(url=video_url, text=True, mode="auto")
        return transcript.content
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Transcript extraction failed: {str(e)}",
        )


def classify_video(transcript: str, instructions: Optional[str] = None) -> int:
    system_prompt = (
        f"{SYSTEM_PROMPT} USER INSTRUCTIONS: {instructions}" if instructions else SYSTEM_PROMPT
    )

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "openai/gpt-oss-120b:free",
        "messages": [
            {"role": "system", "content": system_prompt},
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

        if (
            "error" in result
            or "choices" not in result
            or len(result.get("choices", [])) == 0
        ):
            print("Falling back to mistralai/mistral-nemo")
            payload["model"] = "mistralai/mistral-nemo"
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            result = response.json()

        if "error" in result:
            error_msg = result["error"].get("message", str(result["error"]))
            if "metadata" in result["error"] and "raw" in result["error"]["metadata"]:
                error_msg += f" - {result['error']['metadata']['raw']}"
            raise Exception(f"OpenRouter API error: {error_msg}")

        raw = result["choices"][0]["message"]["content"].strip()
        return int(raw)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"LLM classification failed: {str(e)}",
        )


# API ENDPOINTS
@app.post("/classify", response_model=VideoResponse)
def classify(req: VideoRequest):
    print(f"Processing URL: {req.url}")
    transcript = get_transcript(req.url)

    if not transcript:
        raise HTTPException(
            status_code=422,
            detail="No English transcript found for this video.",
        )

    category = classify_video(transcript, req.instructions)
    return VideoResponse(category=category)


@app.get("/health")
def health_check():
    return {"status": "alive"}