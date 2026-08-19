# Physical macOS evidence readiness — 2026-08-19

Status: preflight reached the host-permission boundary. Physical Safari,
VoiceOver, and native dialog workflows remain unverified.

## Host evidence

- macOS: 26.5.2 (`25F84`)
- Safari: 26.5.2 (`21624.2.5.11.8`)
- Safari WebDriver: present at `/System/Cryptexes/App/usr/bin/safaridriver`
- local application: served at `http://localhost:5173`
- checked build: `v1.7.0-233-g36f3196`

The physical Chrome session rendered NakliData's first-run surface from that
local build. This establishes neither native-picker behavior nor Safari or
screen-reader support.

## Attempt trail

1. `safaridriver -p 4444` started its local WebDriver service.
2. A W3C session request failed with `session not created` because Safari's
   **Allow remote automation** setting is disabled.
3. `safaridriver --enable` requested an administrator password and exited after
   the unattended authentication response was rejected.
4. `System Events` reported `UI elements enabled = false`, so Codex cannot
   operate Safari Settings, VoiceOver, or native open/save dialogs through the
   macOS accessibility layer.
5. `screencapture` returned a black frame, so the current host does not expose
   trustworthy system-window screenshots to this session.

No source, file, folder, or export destination was selected. No VoiceOver
session was started. No Safari support, native-picker support, or screen-reader
support claim follows from this preflight.

## Smallest unblock

The user must perform these host-level changes while present:

1. In Safari Settings, enable **Developer → Allow remote automation**.
2. In macOS System Settings, permit Codex under **Privacy & Security →
   Accessibility**.
3. Permit Codex under **Privacy & Security → Screen & System Audio Recording**
   if screenshot evidence is desired.
4. Confirm that VoiceOver audio and focus takeover may run during the test
   window.

Do not provide an administrator password to the repository or store it in a
script, shell history, environment variable, screenshot, or evidence file.

## Replay matrix after unblock

### Safari

Run first load, demo mount, schema override, notebook execution, report
creation, error recovery, and HTML/data export. Exercise the classic file-input
fallback and real open/save dialogs. Record the Safari and macOS versions,
visible result, dialog cancellation behavior, focus return, console errors,
and cleanup.

### VoiceOver

Run the same critical workflows using VoiceOver navigation. Record each
control's spoken name, role, state, value, error association, live-region
announcement, modal boundary, focus return, and export feedback. Do not infer
speech output from the DOM accessibility tree.

### Native Chromium dialogs

Exercise **Add folder**, **Add file**, workbook open/save, HTML export, and one
data export in the physical Chrome session. Cancel each dialog once, then use a
user-selected public fixture and destination. Confirm that cancellation is
silent, accepted paths remain browser-local, and no selected path or file bytes
enter logs or evidence.

NVDA remains a separate Windows-host requirement.
