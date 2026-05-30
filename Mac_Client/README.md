# Antirot

This folder is the Mac app.

It is not the full productivity suite yet. Right now it has one job: help lockdown mode stop the browser extension from being turned off inside Chrome-like browsers.

## What It Does

- Finds common Chromium browsers like Chrome, Brave, Edge, Helium, Arc, Vivaldi, and Opera.
- Tries to detect other Chromium browsers already installed on the Mac.
- Lets the user choose which browsers to protect.
- Asks macOS for admin permission.
- Tells those browsers to keep the Antirot extension installed.
- Lets the user remove that protection.

## What It Does Not Do Yet

- It does not talk to the browser extension yet.
- It does not decide when lockdown starts or ends. The extension owns that.
- It does not run secretly in the background.
- It does not create an unbreakable lock. A Mac admin can still undo it manually.

Later, the browser extension should tell this Mac app when lockdown turns on or off. This app should stay focused on the Mac-side browser blocking work.

## Build The App

Open Terminal in this folder and run:

```bash
make app
```

Then open:

```bash
open "dist/Antirot.app"
```

## Make A File To Share

```bash
make dmg
```

This creates:

```text
dist/Antirot.dmg
```

You can upload that `.dmg` file to the website for early users.

## Important Mac Warning

Without an Apple Developer account, macOS will warn users that the app is from an unidentified developer.

That is annoying, but it does not stop alpha testing. Users can still open it by right-clicking the app and choosing Open.

## Agent Notes

Keep the Mac app as one app named Antirot. Do not split this into a separate guard app. The browser extension owns lockdown state; the Mac app owns Mac/browser policy actions.

Build outputs live in `dist/`. They are useful locally, but source changes should stay in the package files unless a release artifact is intentionally needed.
