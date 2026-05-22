import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable


SERVER_DIR = Path(__file__).resolve().parents[1]
DEFAULT_LOG_PATH = SERVER_DIR / "data" / "api_call_events.jsonl"
DEFAULT_DB_PATH = SERVER_DIR / "data" / "api_request_events.sqlite3"


def iter_events(log_path: Path) -> Iterable[Dict[str, Any]]:
    with log_path.open("r", encoding="utf-8") as log_file:
        for line in log_file:
            line = line.strip()
            if not line:
                continue

            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS request_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            request_id TEXT UNIQUE,
            timestamp_utc TEXT,
            path TEXT,
            client_ip TEXT,
            install_id TEXT,
            install_token_sha256 TEXT,
            install_verified INTEGER,
            video_url TEXT,
            video_id TEXT,
            cache_key TEXT,
            instructions TEXT,
            instructions_length INTEGER,
            category INTEGER,
            success INTEGER,
            status_code INTEGER,
            error TEXT,
            supadata_called INTEGER,
            supadata_transcript_chars INTEGER,
            usable_for_future_cache INTEGER,
            timings_ms TEXT,
            raw_event TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_request_events_timestamp
            ON request_events(timestamp_utc);
        CREATE INDEX IF NOT EXISTS idx_request_events_event
            ON request_events(event);
        CREATE INDEX IF NOT EXISTS idx_request_events_install
            ON request_events(install_id);
        CREATE INDEX IF NOT EXISTS idx_request_events_video
            ON request_events(video_id);
        CREATE INDEX IF NOT EXISTS idx_request_events_cache_key
            ON request_events(cache_key);
        CREATE INDEX IF NOT EXISTS idx_request_events_category
            ON request_events(category);
        """
    )


def event_to_row(event: Dict[str, Any]) -> Dict[str, Any]:
    request = event.get("request", {})
    install = event.get("install", {})
    video = event.get("video", {})
    input_data = event.get("input", {})
    outcome = event.get("outcome", {})
    supadata = event.get("supadata", {})
    cache = event.get("cache", {})

    return {
        "event": event.get("event"),
        "request_id": event.get("request_id"),
        "timestamp_utc": event.get("timestamp_utc"),
        "path": request.get("path"),
        "client_ip": request.get("client_ip"),
        "install_id": install.get("install_id") or input_data.get("install_id"),
        "install_token_sha256": (
            install.get("token_sha256") or input_data.get("install_token_sha256")
        ),
        "install_verified": int(bool(install.get("verified"))),
        "video_url": video.get("url") or input_data.get("url"),
        "video_id": video.get("video_id"),
        "cache_key": cache.get("candidate_key") or video.get("cache_key"),
        "instructions": input_data.get("instructions"),
        "instructions_length": input_data.get("instructions_length"),
        "category": outcome.get("category"),
        "success": int(bool(outcome.get("success"))),
        "status_code": outcome.get("status_code"),
        "error": json.dumps(outcome.get("error")) if outcome.get("error") else None,
        "supadata_called": int(bool(supadata.get("called"))),
        "supadata_transcript_chars": supadata.get("transcript_chars"),
        "usable_for_future_cache": int(bool(cache.get("usable_for_future_cache"))),
        "timings_ms": json.dumps(event.get("timings_ms", {}), sort_keys=True),
        "raw_event": json.dumps(event, sort_keys=True),
    }


def import_log(log_path: Path, db_path: Path) -> int:
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as connection:
        create_schema(connection)
        imported = 0

        for event in iter_events(log_path):
            row = event_to_row(event)
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO request_events (
                    event,
                    request_id,
                    timestamp_utc,
                    path,
                    client_ip,
                    install_id,
                    install_token_sha256,
                    install_verified,
                    video_url,
                    video_id,
                    cache_key,
                    instructions,
                    instructions_length,
                    category,
                    success,
                    status_code,
                    error,
                    supadata_called,
                    supadata_transcript_chars,
                    usable_for_future_cache,
                    timings_ms,
                    raw_event
                ) VALUES (
                    :event,
                    :request_id,
                    :timestamp_utc,
                    :path,
                    :client_ip,
                    :install_id,
                    :install_token_sha256,
                    :install_verified,
                    :video_url,
                    :video_id,
                    :cache_key,
                    :instructions,
                    :instructions_length,
                    :category,
                    :success,
                    :status_code,
                    :error,
                    :supadata_called,
                    :supadata_transcript_chars,
                    :usable_for_future_cache,
                    :timings_ms,
                    :raw_event
                )
                """,
                row,
            )
            imported += cursor.rowcount

        return imported


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import AntiRot JSONL request logs into SQLite."
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=DEFAULT_LOG_PATH,
        help=f"Path to api_call_events.jsonl. Default: {DEFAULT_LOG_PATH}",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to SQLite DB. Default: {DEFAULT_DB_PATH}",
    )
    args = parser.parse_args()

    if not args.log.exists():
        raise SystemExit(f"Log file not found: {args.log}")

    imported = import_log(args.log, args.db)
    print(f"Imported {imported} new events into {args.db}")


if __name__ == "__main__":
    main()
