# Agent surface v3 contract

Status: **Browser API v3 available; workplan A0–A5 complete**. The scoped v3
namespace is published at `window.naklidata.v3`; Browser API v2 remains the
root compatibility contract. WebMCP is experimental and the external MCP
package remains planned—neither is an availability claim.

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
explicitly through `window.naklidata.v3.version === "3"`,
`window.naklidata.v3.listTools()`, and
`window.naklidata.v3.invoke(tool, input)`. It never changes a v2 result in
place.

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

- `proposeSqlCell` adds the same editable, idle SQL cell as the v2
  `proposeCell` compatibility alias.
- `proposeChart` validates exact ownership and result columns, resolves missing
  bindings through the chart cell's canonical inference path, and writes the
  existing chart-cell state.
- `proposeQualityCheck` parses the portable quality-check core, validates exact
  mounted table/column ownership, and writes the same tagged assertion used by
  the data-quality surface.
- `proposeCleaningStep` accepts only a current cached table-context suggestion,
  validates exact source/table ownership, and adds its previewable SQL as an
  editable cell.

Each proposal reports a deterministic preview, created/affected objects,
warnings, `editable: true`, an explicit `un-run` state, and the exact human
review action. Proposal code is capped at 64 KiB. No proposal calls
`Notebook.runCell`, sends a remote write, or starts background work.

## Adapter and MCP boundary

- Browser API v2 is available.
- Browser API v3 is available on the nested namespace and calls the same lazy
  registry as v2.
- WebMCP remains feature-detected and flag-gated while the browser API is
  experimental. When `?webmcp=1` and `document.modelContext` exists, it
  registers the same twelve v3 tools asynchronously, exposes them only to the
  page origin, returns structured v3 envelopes, and uses one abort-scoped
  lifetime that ends on failure or page teardown. It is an adapter, not a
  dependency.
- The first external MCP boundary is **artifact-first**: validate, inspect, and
  author `.naklidata` documents without controlling a browser tab. A live-tab
  server is deferred until a secure, supportable browser/native bridge exists.
- A page-to-`http://localhost` server is not viable under the current CSP.
  Adding a runtime dependency, companion binary, or remote service requires a
  separate repository/runtime decision.

The external boundary spike is recorded in
[`external-mcp-boundary.md`](external-mcp-boundary.md): artifact-only stdio is
GO for future implementation planning; an extension/native live-tab bridge is
DEFER; localhost-from-page, remote-first, and Compute-Bridge reuse are NO-GO.
No MCP package ships today.

## Release evidence

The 2026-07-30 A5 gate covers deterministic tool/scope/error selection,
malformed and unavailable calls, prompt-like headers and values, aliases,
expressions, joins, ambiguous ownership, missing sensitivity, workspace
replacement, cancellation, proposal bounds, and current-shape WebMCP lifecycle
behavior. Production browser smoke verifies v2 compatibility, all twelve v3
tools, permission grant/revoke, metadata-only activity, an editable un-run SQL
proposal, ARIA/canvas discovery, graceful native WebMCP absence, and an
abort-scoped same-origin mock registration.

The catalogue contains no execution scope or verb. Registry, transport, and
browser tests prove proposals do not execute cells, write remote data, retain
credentials, or start background polling. Cleaning proposals reuse only the
current table-context suggestion cache and remain editable and un-run.
