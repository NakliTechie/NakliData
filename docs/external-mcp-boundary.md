# External MCP boundary

Status: **architecture spike complete; artifact-only package is GO for a future
separate implementation, live-tab control is DEFER, browser-to-localhost and
Compute-Bridge reuse are NO-GO. No external MCP server ships today.**

Decision date: 2026-07-30. Protocol target:
[`2026-07-28`](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/).
The stable TypeScript SDK v2 implements that revision, but adding it remains a
separate package/dependency decision; it is not a browser runtime dependency.

## Compared boundaries

| Boundary | Verdict | Why |
| --- | --- | --- |
| `naklidata-agent` artifact-only stdio package | **GO for implementation planning** | The MCP host launches the process, so the browser CSP and tab state are out of scope. It can validate, inspect, and author portable artifacts without credentials, network access, or live workspace mutation. |
| Browser extension plus reviewed native messaging/live-tab bridge | **DEFER** | Technically plausible, but it adds extension distribution, native-host installation, origin binding, tab ownership, consent, upgrade, and incident-response obligations. |
| Page calls `http://localhost` MCP server | **NO-GO** | It would require CSP/network relaxation, localhost discovery/authentication, and a browser-to-native trust channel the product does not own. |
| Warehouse Compute Bridge doubles as MCP server | **NO-GO** | Warehouse query transport and agent/artifact authoring have different credentials, permissions, audit, deployment, and failure boundaries. |
| Remote multi-tenant MCP service | **NO-GO for the first release** | It would move local workbook artifacts into a service and introduce accounts, telemetry, retention, and authorization outside NakliData's privacy posture. |

## GO package contract

The future package is named `naklidata-agent` and lives outside the browser
bundle, preferably in its own repository/release stream.

- Transport: stdio only for the first release. Standard output carries protocol
  messages only; bounded operational diagnostics may use standard error.
- Protocol: pin `2026-07-28`; advertise the exact version and reject an
  unsupported version instead of silently downgrading.
- Surface: artifact capabilities, validation, inspection, and authoring only.
  There is no live tab, agent loop, generic chat, query execution, result
  narration, warehouse connection, credential tool, background task, or remote
  write.
- Inputs: callers pass each input/output path explicitly. No implicit home,
  repository, or broad root traversal; canonicalize paths, reject symlink
  escapes, cap artifacts at 2 MiB, and do not overwrite without an explicit
  per-call flag.
- Outputs: a new or validated `.naklidata`, portable semantic model, or data
  contract. Authored work remains proposal-only: SQL/assertion cells are
  editable and un-run.
- Network and secrets: no network permission, browser key access, warehouse
  credentials, BYOK lookup, or environment-variable secret discovery.
- Reuse: consume versioned portable schemas/validators and the v3 envelope/error
  vocabulary. Do not import the browser engine, DOM stores, IndexedDB, or
  Compute Bridge.

The first candidate tools should stay narrow:

- `getCapabilities`
- `validateArtifact`
- `inspectArtifact`
- `authorWorkbook`

`authorWorkbook` writes only the caller-selected output artifact and returns a
preview/manifest. It never opens or runs the workbook.

## Ownership and release gate

The package owns MCP transport, path confinement, protocol negotiation, and
artifact-only orchestration. NakliData owns the artifact schemas, semantic
contract, and compatibility fixtures. Releases are independent; the browser
must not download the package or assume it is installed.

Before changing the capability label from planned:

1. choose the repository and maintainer;
2. approve the SDK/runtime dependency and lockfile;
3. pass the MCP conformance suite for the pinned revision;
4. pass malicious-path, symlink, oversized, malformed, overwrite, cancellation,
   and stdout-purity tests;
5. prove authored work is un-run and contains no source row data or secrets;
6. publish install, permission, upgrade, rollback, and support documentation.

The current browser API and experimental WebMCP adapter do not depend on this
package.
