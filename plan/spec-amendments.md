# Spec amendments

Tracked divergences from the canonical spec (`02-SPEC.md` as uploaded with the original handoff). Each amendment names the section being amended, gives the new wording, and the reasoning.

The original spec stays authoritative for everything not listed here.

---

## A1 — Persistent workspace state (amends spec §2.3)

**Original wording (paraphrased from §2.3):**
> IndexedDB holds FSA handles, session state, query result cache. sessionStorage holds BYOK keys.

The implicit reading was "no persistence beyond `.naklidata` files + ephemeral session state." That reading was wrong.

**Amended:**
> Workspace state — sources, column assignments, notebook cells, settings, FSA folder handles — **persists across tabs via IndexedDB**, plus the FSA permission the user has already granted. On tab open, the previous workspace is auto-restored. FSA-folder permission is re-verified silently when granted by user activation, and a "Reconnect" banner is shown otherwise. `.naklidata` files remain the explicit, portable export.

**Why:** Asking the user to restart from zero each session is a non-starter UX-wise. The privacy posture ("data never leaves the tab") is unchanged — persistence is local-only, same origin.

**Status:** Theme 3 in `pending.md`. The scaffolding (`src/core/idb.ts`, `src/core/settings.ts`, `src/core/handles.ts`) already exists; the boot-time auto-restore is the unwired piece.

---

## A2 — BYOK key persistence (amends spec §4 Hard NOT #2)

**Original wording (§4 item 2):**
> No persistent storage of BYOK keys.

This was the right *default* but the wrong *absolute*. Re-entering an API key every tab is friction users won't tolerate.

**Amended:**
> **No silent persistent storage of BYOK keys.** Keys live in `sessionStorage` by default (cleared on tab close). Persistent storage to IndexedDB requires explicit user opt-in per key, with the UI labelling the storage state honestly:
> - **v1.1 default (option A):** "Remember on this device" checkbox at entry time, defaults OFF. When checked, the key is stored plaintext in IndexedDB on the current origin. The UI tells the user clearly: "Stored on this device. Anyone with access to this browser profile can read it. [Forget]"
> - **v1.2 enhancement (option B):** opt-in passphrase-encrypted persistence. Key encrypted with a PBKDF2-derived AES-GCM key. Each new session: user enters the passphrase (not the long API key) to unlock.
> - A "Forget all stored keys" action lives in settings, available at any time.

**Why:** Same-origin JS can always read same-origin storage; "encrypted in IDB" with an on-origin key (PondPilot's posture) is largely theatre. The honest position is:
- Default to no-persistence (sessionStorage).
- Allow opt-in plaintext with clear labelling.
- Offer passphrase-encryption later as an opt-in for users on shared machines or with stronger threat models.

**Status:** v1.1 sidecar work in `pending.md`. Option B is parked for v1.2.

---

## A3 — Project name and file extension

**Original wording (vision):**
> Working codename. Final name deferred per standing rule. Leading candidates: Nazariya, Lens, Prism.

**Amended:**
> Product name is **NakliData**. File extension for saved notebooks is **`.naklidata`** (format ID `"format": "naklidata"`).

**Status:** Done. Sweep rename committed (DECISIONS.md 2026-05-16 03:30).

---

## Future amendments live here

Every spec deviation lands in this file with the same shape: original wording → amended wording → reasoning → status. Future-us reading the original spec doc should be able to cross-reference here to see what's still authoritative and what's been refined.
