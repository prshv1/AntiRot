# Agent Instructions

This folder is the Mac app for Antirot.

## Build After Changes

After every change in `Mac_Client`, recreate the app package:

```bash
make app
```

Use `make app` instead of only `swift build` because it deletes the old `dist/Antirot.app` and creates a fresh one.

Do not commit `.build/` or `dist/` unless the user explicitly asks for a release artifact.

## App Scope

Keep this as one app named `Antirot`. Do not split it into a separate guard app.

The browser extension owns lockdown state. The Mac app owns Mac/browser policy actions and local app settings.
