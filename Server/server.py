from collections import defaultdict, deque
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from threading import Lock
from typing import Any, Deque, Dict, Optional
from urllib.parse import parse_qs, urlparse
import hashlib
import hmac
import json
import os
import re
import requests
import secrets
import time
import uuid
from supadata import Supadata

# SETUP
load_dotenv()
API_KEY = os.getenv("Openrouter_API_KEY")
SYSTEM_PROMPT = os.getenv("System_Prompt")
SUPADATA_API_KEY = os.getenv("Supadata_API_KEY")
API_CALL_LOG_PATH = os.getenv("API_CALL_LOG_PATH", "data/api_call_events.jsonl")
INSTALL_REGISTRY_PATH = os.getenv("INSTALL_REGISTRY_PATH", "data/install_registry.json")
API_CALL_LOG_STDOUT = os.getenv("API_CALL_LOG_STDOUT", "true").lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


RATE_LIMIT_WINDOW_SECONDS = _positive_int_env("RATE_LIMIT_WINDOW_SECONDS", 60)
RATE_LIMIT_MAX_REQUESTS = _positive_int_env("RATE_LIMIT_MAX_REQUESTS", 30)
RATE_LIMIT_CLEANUP_SECONDS = max(RATE_LIMIT_WINDOW_SECONDS * 10, 300)
_rate_limit_lock = Lock()
_rate_limit_hits: Dict[str, Deque[float]] = defaultdict(deque)
_last_rate_limit_cleanup = 0.0
_tracking_lock = Lock()
_install_registry_lock = Lock()

app = FastAPI(
    title="AntiRot API",
    description="YouTube video classifier",
    version="0.6",
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
    install_id: Optional[str] = None
    installId: Optional[str] = None
    install_token: Optional[str] = None
    installToken: Optional[str] = None
    client: Optional[Dict[str, Any]] = None

    class Config:
        extra = "ignore"


class VideoResponse(BaseModel):
    category: int


class InstallRegisterRequest(BaseModel):
    requested_install_id: Optional[str] = None
    requestedInstallId: Optional[str] = None
    client: Optional[Dict[str, Any]] = None

    class Config:
        extra = "ignore"


class InstallRegisterResponse(BaseModel):
    install_id: str
    install_token: str


# HELPER FUNCTIONS
def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()

    real_ip = request.headers.get("x-real-ip") or request.headers.get("cf-connecting-ip")
    if real_ip:
        return real_ip.strip()

    return request.client.host if request.client else "unknown"


def extract_youtube_video_id(video_url: str) -> Optional[str]:
    try:
        parsed = urlparse(video_url)
    except Exception:
        return None

    host = (parsed.hostname or "").lower()
    path = parsed.path.strip("/")

    if host.endswith("youtu.be") and path:
        return path.split("/", 1)[0]

    if "youtube.com" not in host and "youtube-nocookie.com" not in host:
        return None

    query_video_id = parse_qs(parsed.query).get("v", [None])[0]
    if query_video_id:
        return query_video_id

    for prefix in ("shorts/", "embed/", "live/"):
        if path.startswith(prefix):
            return path.removeprefix(prefix).split("/", 1)[0]

    return None


def compact_header(value: Optional[str], limit: int = 500) -> Optional[str]:
    if value is None:
        return None
    return value if len(value) <= limit else f"{value[:limit]}..."


def selected_headers(request: Request) -> Dict[str, Optional[str]]:
    header_names = (
        "host",
        "origin",
        "referer",
        "user-agent",
        "accept-language",
        "content-type",
        "content-length",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-port",
        "x-forwarded-proto",
        "x-real-ip",
        "cf-connecting-ip",
        "x-amzn-trace-id",
        "x-request-id",
    )
    return {
        name: compact_header(request.headers.get(name))
        for name in header_names
        if request.headers.get(name) is not None
    }


def get_install_id(req: VideoRequest) -> Optional[str]:
    return req.install_id or req.installId


def get_install_token(req: VideoRequest) -> Optional[str]:
    return req.install_token or req.installToken


def get_requested_install_id(req: InstallRegisterRequest) -> Optional[str]:
    return req.requested_install_id or req.requestedInstallId


def is_valid_install_id(install_id: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{8,128}", install_id))


def hash_install_token(install_token: str) -> str:
    return hashlib.sha256(install_token.encode("utf-8")).hexdigest()


def hash_optional_install_token(install_token: Optional[str]) -> Optional[str]:
    if not install_token:
        return None
    return hash_install_token(install_token)


def get_install_registry_path() -> str:
    return os.path.abspath(INSTALL_REGISTRY_PATH)


def load_install_registry_unlocked() -> Dict[str, Any]:
    registry_path = get_install_registry_path()
    if not os.path.exists(registry_path):
        return {"version": 1, "installs": {}}

    with open(registry_path, "r", encoding="utf-8") as registry_file:
        registry = json.load(registry_file)

    if "installs" not in registry or not isinstance(registry["installs"], dict):
        registry["installs"] = {}

    return registry


def save_install_registry_unlocked(registry: Dict[str, Any]) -> None:
    registry_path = get_install_registry_path()
    os.makedirs(os.path.dirname(registry_path), exist_ok=True)
    temp_path = f"{registry_path}.{uuid.uuid4().hex}.tmp"

    with open(temp_path, "w", encoding="utf-8") as registry_file:
        json.dump(registry, registry_file, ensure_ascii=False, indent=2)

    os.replace(temp_path, registry_path)


def create_install_registration(
    request: Request,
    client: Optional[Dict[str, Any]] = None,
    requested_install_id: Optional[str] = None,
) -> InstallRegisterResponse:
    install_token = secrets.token_urlsafe(32)
    token_sha256 = hash_install_token(install_token)
    timestamp = utc_now_iso()

    with _install_registry_lock:
        registry = load_install_registry_unlocked()
        installs = registry["installs"]

        if (
            requested_install_id
            and is_valid_install_id(requested_install_id)
            and requested_install_id not in installs
        ):
            install_id = requested_install_id
        else:
            install_id = f"inst_{uuid.uuid4().hex}"
            while install_id in installs:
                install_id = f"inst_{uuid.uuid4().hex}"

        installs[install_id] = {
            "token_sha256": token_sha256,
            "migrated_from_local_install_id": install_id == requested_install_id,
            "created_at_utc": timestamp,
            "last_seen_at_utc": timestamp,
            "registration_ip": get_client_ip(request),
            "last_ip": get_client_ip(request),
            "user_agent": compact_header(request.headers.get("user-agent")),
            "client": client or {},
            "classify_count": 0,
        }
        save_install_registry_unlocked(registry)

    return InstallRegisterResponse(
        install_id=install_id,
        install_token=install_token,
    )


def verify_install_credentials(req: VideoRequest, request: Request) -> str:
    install_id = get_install_id(req)
    install_token = get_install_token(req)

    if not install_id or not install_token:
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )

    token_sha256 = hash_install_token(install_token)
    timestamp = utc_now_iso()

    with _install_registry_lock:
        registry = load_install_registry_unlocked()
        install_record = registry["installs"].get(install_id)

        if not install_record or not hmac.compare_digest(
            install_record.get("token_sha256", ""),
            token_sha256,
        ):
            raise HTTPException(
                status_code=404,
                detail="User not found.",
            )

        install_record["last_seen_at_utc"] = timestamp
        install_record["last_ip"] = get_client_ip(request)
        install_record["classify_count"] = int(install_record.get("classify_count", 0)) + 1
        save_install_registry_unlocked(registry)

    return install_id


def build_classify_tracking_event(
    request_id: str,
    req: VideoRequest,
    request: Request,
) -> Dict[str, Any]:
    video_id = extract_youtube_video_id(req.url)
    install_id = get_install_id(req)
    install_token = get_install_token(req)
    forwarded_for = request.headers.get("x-forwarded-for", "")
    forwarded_chain = [
        ip.strip()
        for ip in forwarded_for.split(",")
        if ip.strip()
    ]

    return {
        "event": "classify_api_call",
        "request_id": request_id,
        "timestamp_utc": utc_now_iso(),
        "request": {
            "method": request.method,
            "path": request.url.path,
            "query": str(request.url.query) or None,
            "client_ip": get_client_ip(request),
            "client_host": request.client.host if request.client else None,
            "forwarded_chain": forwarded_chain,
            "headers": selected_headers(request),
        },
        "install": {
            "install_id": install_id,
            "present": bool(install_id),
            "token_present": bool(install_token),
            "token_sha256": hash_optional_install_token(install_token),
            "verified": False,
        },
        "video": {
            "url": req.url,
            "video_id": video_id,
            "cache_key": video_id or req.url,
        },
        "input": {
            "url": req.url,
            "instructions": req.instructions,
            "instructions_present": bool(req.instructions),
            "instructions_length": len(req.instructions or ""),
            "install_id": install_id,
            "install_token_sha256": hash_optional_install_token(install_token),
            "client": req.client or {},
        },
        "supadata": {
            "called": False,
            "transcript_chars": None,
        },
        "cache": {
            "candidate_key": video_id or req.url,
            "source": "live_pipeline",
            "usable_for_future_cache": False,
        },
    }


def record_api_call(event: Dict[str, Any]) -> None:
    try:
        line = json.dumps(event, default=str, ensure_ascii=False)

        if API_CALL_LOG_PATH:
            log_path = os.path.abspath(API_CALL_LOG_PATH)
            os.makedirs(os.path.dirname(log_path), exist_ok=True)

            with _tracking_lock:
                with open(log_path, "a", encoding="utf-8") as log_file:
                    log_file.write(f"{line}\n")

        if API_CALL_LOG_STDOUT:
            print(f"[api_tracking] {line}")
    except Exception as exc:
        print(f"[api_tracking_error] {exc}")


def build_rate_limit_keys(
    request: Request,
    install_id: Optional[str],
    include_ip: bool = True,
) -> list:
    keys = [f"ip:{get_client_ip(request)}"] if include_ip else []
    if install_id:
        keys.append(f"install:{install_id}")
    return keys


def enforce_rate_limit(
    request: Request,
    install_id: Optional[str] = None,
    include_ip: bool = True,
) -> None:
    global _last_rate_limit_cleanup

    now = time.monotonic()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    rate_limit_keys = build_rate_limit_keys(request, install_id, include_ip)

    with _rate_limit_lock:
        current_hits = []

        for rate_limit_key in rate_limit_keys:
            hits = _rate_limit_hits[rate_limit_key]
            while hits and hits[0] <= cutoff:
                hits.popleft()

            if len(hits) >= RATE_LIMIT_MAX_REQUESTS:
                retry_after = max(1, int(RATE_LIMIT_WINDOW_SECONDS - (now - hits[0])))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please slow down and try again.",
                    headers={"Retry-After": str(retry_after)},
                )

            current_hits.append(hits)

        for hits in current_hits:
            hits.append(now)

        if now - _last_rate_limit_cleanup >= RATE_LIMIT_CLEANUP_SECONDS:
            for rate_limit_key, hits in list(_rate_limit_hits.items()):
                while hits and hits[0] <= cutoff:
                    hits.popleft()
                if not hits:
                    del _rate_limit_hits[rate_limit_key]
            _last_rate_limit_cleanup = now


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
@app.post("/installs/register", response_model=InstallRegisterResponse)
def register_install(req: InstallRegisterRequest, request: Request):
    request_id = str(uuid.uuid4())
    started = time.monotonic()
    status_code = 200
    error_detail: Optional[Any] = None
    install_id: Optional[str] = None

    try:
        enforce_rate_limit(request)
        registration = create_install_registration(
            request,
            req.client,
            get_requested_install_id(req),
        )
        install_id = registration.install_id
        return registration
    except HTTPException as exc:
        status_code = exc.status_code
        error_detail = exc.detail
        raise
    except Exception as exc:
        status_code = 500
        error_detail = str(exc)
        raise
    finally:
        record_api_call(
            {
                "event": "install_register_api_call",
                "request_id": request_id,
                "timestamp_utc": utc_now_iso(),
                "request": {
                    "method": request.method,
                    "path": request.url.path,
                    "client_ip": get_client_ip(request),
                    "client_host": request.client.host if request.client else None,
                    "headers": selected_headers(request),
                },
                "install": {
                    "install_id": install_id,
                    "created": bool(install_id),
                },
                "input": {
                    "client": req.client or {},
                },
                "outcome": {
                    "success": status_code < 400,
                    "status_code": status_code,
                    "error": error_detail,
                },
                "timings_ms": {
                    "total": int((time.monotonic() - started) * 1000),
                },
            }
        )


@app.post("/classify", response_model=VideoResponse)
def classify(req: VideoRequest, request: Request):
    request_id = str(uuid.uuid4())
    started = time.monotonic()
    tracking_event = build_classify_tracking_event(request_id, req, request)
    timings_ms: Dict[str, int] = {}
    category: Optional[int] = None
    status_code = 200
    error_detail: Optional[Any] = None
    pipeline_stage = "rate_limit"

    try:
        enforce_rate_limit(request)
        pipeline_stage = "install_validation"
        install_id = verify_install_credentials(req, request)
        tracking_event["install"]["verified"] = True
        enforce_rate_limit(request, install_id, include_ip=False)
        print(f"Processing URL: {req.url}")

        pipeline_stage = "supadata_transcript"
        transcript_started = time.monotonic()
        try:
            tracking_event["supadata"]["called"] = True
            transcript = get_transcript(req.url)
        finally:
            timings_ms["supadata"] = int((time.monotonic() - transcript_started) * 1000)

        tracking_event["supadata"]["transcript_chars"] = len(transcript or "")

        if not transcript:
            raise HTTPException(
                status_code=422,
                detail="No English transcript found for this video.",
            )

        pipeline_stage = "openrouter_classification"
        classification_started = time.monotonic()
        try:
            category = classify_video(transcript, req.instructions)
        finally:
            timings_ms["openrouter"] = int(
                (time.monotonic() - classification_started) * 1000
            )

        return VideoResponse(category=category)
    except HTTPException as exc:
        status_code = exc.status_code
        error_detail = exc.detail
        raise
    except Exception as exc:
        status_code = 500
        error_detail = str(exc)
        raise
    finally:
        total_ms = int((time.monotonic() - started) * 1000)
        timings_ms["total"] = total_ms
        tracking_event["pipeline_stage"] = pipeline_stage
        tracking_event["cache"]["usable_for_future_cache"] = category is not None
        tracking_event["outcome"] = {
            "success": status_code < 400,
            "status_code": status_code,
            "category": category,
            "error": error_detail,
        }
        tracking_event["timings_ms"] = timings_ms
        record_api_call(tracking_event)


@app.get("/health")
def health_check():
    return {"status": "alive"}
