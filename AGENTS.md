# Agent Instructions

## Repository Role

`AntiRot` is the public repository for the AntiRot project. Treat it as public-facing code.

## Secrets And Environments

- Do not commit real `.env` files, API keys, credentials, or production secrets here.
- Keep only safe examples such as `Server/.env.example`.
- Keep `Server/data/`, generated SQLite files, and local logs out of git.

## Mirroring

- `Antirot_Dev` is the private development mirror. It may contain real `.env` files by owner preference.
- Use `Antirot_Dev` as the default working repository for extension and backend changes.
- Do not mirror changes into this public repo unless the owner explicitly asks for mirroring.
- When syncing changes from `Antirot_Dev` to this public repo, remove private secrets and verify `.gitignore` still protects env files.

## Branches

- Work on `main` for the extension/backend application.
- The website branch lives in the private `Antirot_Dev` repo as `antirot_website`; do not mix website-only work into this public app repo unless explicitly asked.

## Runtime Notes

- The API is FastAPI under `Server/server.py`.
- The Chrome extension is under `Browser_Client/`.
- Install credentials are stored in `data/install_registry.json` at runtime.
- Request tracking is append-only JSONL in `data/api_call_events.jsonl`.
- Use `Server/tools/request_log_summary.py` and `Server/tools/request_log_to_sqlite.py` for local log analysis.
