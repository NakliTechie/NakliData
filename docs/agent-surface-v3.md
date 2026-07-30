# Agent surface v3 contract

Status: **ratified product contract; A1 permissions and the internal A2 v3 read
registry are implemented; proposal/adapters/release tracked in workplan A3–A5**.
The v3 registry is not yet published on the page global.
The shipping live-tab API remains v2 until the runtime, permission UX, tests,
and release gate all pass. This document is not a WebMCP or external-MCP
availability claim.

## Product boundary

The agent surface lets a caller inspect the semantic workspace and add
reviewable, un-run artifacts. It is not an autonomous agent, a chat surface, a
sidecar model, or warehouse compute.

| Surface | Responsibility | Explicitly excluded |
| --- | --- | --- |
| Agent surface | Deterministic tools over the live tab or a portable artifact | Agent loop, credentials, background polling |
| AI sidecar | Ten bounded BYOK model jobs with payload disclosure | Generic chat, automatic SQL execution |
| Compute Bridge | User-owned, read-only remote query execution | Agent orchestration, browser-side secrets, remote writes |

All adapters call one internal registry. `window.naklidata`, WebMCP, artifact
validation, and a future external MCP server do not get independent business
logic or safety policy.

## Permission model

The tab owns three scopes:

| Scope | Default | What it permits |
| --- | --- | --- |
| `metadata:read` | granted | Schema, semantics, cells, lineage, capabilities, and artifact validation without result values |
| `values:read` | denied | Bounded read-only queries through validation, provenance proof, and sensitivity redaction |
| `workspace:propose` | denied | Add editable, un-run SQL/chart/quality artifacts |

The latter two grants are explicit, per-tab, memory-only, and revocable. They
are cleared on workspace replacement, teardown, and fatal engine reset.
Revocation cancels affected in-flight requests. The legacy persisted
`agentWritesEnabled` preference is not migrated into authority.

There is deliberately no execution scope and no tool that runs a proposed
notebook cell.

## Versions and result envelope

`window.naklidata` v2 remains callable during v3 adoption. V3 is negotiated
explicitly and never changes a v2 result in place.

Every v3 invocation resolves to a structured envelope:

```ts
type AgentV3Result<T> =
  | {
      version: "3";
      ok: true;
      tool: string;
      scope: "metadata:read" | "values:read" | "workspace:propose";
      data: T;
      meta: {
        provenance: {
          workspaceRevision: number | null;
          sourceIds: string[];
          tableIds: string[];
        };
        bounds: {
          rowLimit: number | null;
          rowsReturned: number | null;
          truncated: boolean;
        };
        redaction: {
          applied: boolean;
          columns: string[];
          policy: "semantic-sensitivity-v1" | "none";
        };
        untrustedContent: boolean;
      };
    }
  | {
      version: "3";
      ok: false;
      tool: string;
      scope: "metadata:read" | "values:read" | "workspace:propose";
      error: {
        code:
          | "invalid_input"
          | "unknown_tool"
          | "permission_denied"
          | "validation_failed"
          | "safety_refusal"
          | "unavailable"
          | "cancelled"
          | "workspace_changed"
          | "internal_error";
        message: string;
        retryable: boolean;
      };
      meta: AgentResultMeta;
    };
```

Messages are bounded and safe to display. Error codes are stable; messages may
improve. User-controlled values or artifact text set `untrustedContent: true`.
Query results report their source ownership, enforced row bound, and semantic
redaction. The initial value cap is 1,000 rows and each call has a 30-second
deadline. Activity is kept in a 50-entry
in-memory ring buffer and records metadata only—never SQL, result values, file
contents, or credentials.

## Initial tool set

Metadata tools:

- `describe`, `listTables`, and `listCells` (v2-compatible behavior)
- `getCapabilities`
- `getLineage`
- `exportDataDictionary`
- `validateArtifact`

Value tool:

- `query`, limited to a single mounted table and direct traceable projections;
  validators run before DuckDB and non-public/unclassified values are redacted

Proposal tools:

- `proposeSqlCell`
- `proposeChart`
- `proposeQualityCheck`

`proposeCleaningStep` remains unavailable until the table-context cleaning
boundary in batch N5 exists. No transport may bypass that dependency.

## Adapter and MCP boundary

- Browser API v2 is available.
- Browser API v3 ships only after A1–A5 pass.
- WebMCP remains feature-detected and flag-gated while the browser API is
  experimental. It is an adapter, not a dependency.
- The first external MCP boundary is **artifact-first**: validate, inspect, and
  author `.naklidata` documents without controlling a browser tab. A live-tab
  server is deferred until a secure, supportable browser/native bridge exists.
- A page-to-`http://localhost` server is not viable under the current CSP.
  Adding a runtime dependency, companion binary, or remote service requires a
  separate repository/runtime decision.

## Release gate

The v3 release requires deterministic unit tests, browser smoke for permission
grant/revoke and workspace resets, adversarial prompt-injection fixtures,
sensitivity failures, oversized outputs, cancellation races, malformed
artifacts, and proof that neither the registry nor an adapter exposes execution,
credentials, remote writes, or background polling.
