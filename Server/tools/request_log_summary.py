import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


DEFAULT_LOG_PATH = Path(__file__).resolve().parents[1] / "data" / "api_call_events.jsonl"


def iter_events(log_path: Path) -> Iterable[Dict[str, Any]]:
    with log_path.open("r", encoding="utf-8") as log_file:
        for line_number, line in enumerate(log_file, start=1):
            line = line.strip()
            if not line:
                continue

            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                yield {
                    "event": "invalid_jsonl_line",
                    "line_number": line_number,
                }
                continue

            yield event


def first_present(*values: Optional[str]) -> Optional[str]:
    for value in values:
        if value:
            return value
    return None


def summarize(log_path: Path, top: int) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "log_path": str(log_path),
        "total_events": 0,
        "invalid_lines": 0,
        "classify_events": 0,
        "install_register_events": 0,
        "successful_classifications": 0,
        "failed_classifications": 0,
        "unique_installs": 0,
        "first_timestamp_utc": None,
        "last_timestamp_utc": None,
    }

    installs = set()
    category_counts: Counter[str] = Counter()
    status_counts: Counter[str] = Counter()
    video_counts: Counter[str] = Counter()
    cache_key_counts: Counter[str] = Counter()
    error_counts: Counter[str] = Counter()

    for event in iter_events(log_path):
        summary["total_events"] += 1

        if event.get("event") == "invalid_jsonl_line":
            summary["invalid_lines"] += 1
            continue

        timestamp = event.get("timestamp_utc")
        if timestamp:
            summary["first_timestamp_utc"] = summary["first_timestamp_utc"] or timestamp
            summary["last_timestamp_utc"] = timestamp

        event_name = event.get("event")
        if event_name == "install_register_api_call":
            summary["install_register_events"] += 1
        elif event_name == "classify_api_call":
            summary["classify_events"] += 1

        install_id = event.get("install", {}).get("install_id")
        if install_id:
            installs.add(install_id)

        outcome = event.get("outcome", {})
        status_code = outcome.get("status_code")
        if status_code is not None:
            status_counts[str(status_code)] += 1

        if event_name != "classify_api_call":
            continue

        if outcome.get("success"):
            summary["successful_classifications"] += 1
        else:
            summary["failed_classifications"] += 1

        category = outcome.get("category")
        if category is not None:
            category_counts[str(category)] += 1

        error = outcome.get("error")
        if error:
            error_counts[str(error)] += 1

        video = event.get("video", {})
        video_key = first_present(video.get("video_id"), video.get("url"))
        if video_key:
            video_counts[video_key] += 1

        cache_key = event.get("cache", {}).get("candidate_key") or video.get("cache_key")
        if cache_key:
            cache_key_counts[cache_key] += 1

    summary["unique_installs"] = len(installs)
    summary["categories"] = dict(category_counts)
    summary["status_codes"] = dict(status_counts)
    summary["top_videos"] = video_counts.most_common(top)
    summary["top_cache_candidates"] = cache_key_counts.most_common(top)
    summary["top_errors"] = error_counts.most_common(top)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize AntiRot JSONL request logs.")
    parser.add_argument(
        "--log",
        type=Path,
        default=DEFAULT_LOG_PATH,
        help=f"Path to api_call_events.jsonl. Default: {DEFAULT_LOG_PATH}",
    )
    parser.add_argument("--top", type=int, default=10, help="Number of top rows to show.")
    args = parser.parse_args()

    if not args.log.exists():
        raise SystemExit(f"Log file not found: {args.log}")

    print(json.dumps(summarize(args.log, args.top), indent=2))


if __name__ == "__main__":
    main()
