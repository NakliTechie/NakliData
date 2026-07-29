# NakliData Compute Bridge protocol

Status: browser client implemented; no bridge server, vendor adapter, image, or
installer ships in this repository.

Protocol identity: `naklidata-compute-bridge`, version `2`.

The `/v1/*` route namespace is retained for transport compatibility. The
`protocol_version` field is the wire-contract version and must equal `2`.
NakliData rejects older or foreign services before sending a query.

## Purpose and trust boundary

The Compute Bridge is an optional, customer-deployed service that keeps
warehouse credentials and heavy query execution inside the customer's network.
NakliData sends a bounded read request over HTTPS and registers the returned
Arrow IPC stream in browser-local DuckDB.

Protocol conformance is not a security boundary by itself. A conformant
deployment must also use a warehouse identity that cannot write and must expose
only allowlisted objects. NakliData's client-side SQL guard is defense in depth;
the bridge must independently enforce every server requirement below.

## Discovery

`GET /v1/health` returns JSON:

```json
{
  "protocol": "naklidata-compute-bridge",
  "protocol_version": 2,
  "name": "customer-bridge",
  "version": "1.0.0",
  "auth": "bearer",
  "single_tenant": true,
  "capabilities": ["query", "table-query", "tables", "arrow-ipc"]
}
```

Supported authentication declarations are `none`, `bearer`, and `oauth2`.
Authentication material is carried only to the bridge. Vendor access tokens,
private keys, and refresh tokens stay bridge-side.

Flows fail closed unless health advertises all required capabilities:

- Direct SQL: `query`, `arrow-ipc`.
- Catalog browsing: `tables`, `table-query`, `arrow-ipc`.

## Mandatory version 2 server behavior

A conformant bridge must:

1. accept exactly one read-only query and reject writes, DDL, session changes,
   extension installation/loading, file scans, and multi-statement input;
2. enforce the requested `row_limit` before serializing a result, with an
   implementation maximum no greater than 1,000,000 rows;
3. apply an independent byte and execution-time ceiling;
4. cancel the downstream warehouse statement when the HTTP request is
   cancelled or disconnected, then poll until the vendor reports a terminal
   state;
5. return bounded, redacted errors that contain no credentials or signed URLs;
6. send no telemetry and perform no remote write operation; and
7. return successful data only as
   `Content-Type: application/vnd.apache.arrow.stream`.

NakliData sends 100,000 rows when the caller does not choose a lower cap and
rejects any client value outside `1..1,000,000`. A server may impose a lower
documented limit, but it must never silently exceed the request.

## Catalog inventory

`GET /v1/tables` returns JSON:

```json
{
  "tables": [
    {
      "catalog": "ANALYTICS",
      "namespace": ["PUBLIC"],
      "name": "ORDERS",
      "qualified_name": "\"ANALYTICS\".\"PUBLIC\".\"ORDERS\"",
      "kind": "table",
      "source": "snowflake",
      "schema": [{ "name": "ORDER_ID", "type": "NUMBER" }]
    }
  ]
}
```

`qualified_name` is an opaque bridge-owned identifier. The browser displays the
portable catalog/namespace/name fields but must not parse, quote, concatenate,
or translate `qualified_name`.

## Bounded object query

`POST /v1/table-query` accepts:

```json
{
  "qualified_name": "\"ANALYTICS\".\"PUBLIC\".\"ORDERS\"",
  "row_limit": 25000
}
```

The bridge must resolve `qualified_name` against the authenticated inventory
or an equivalent server-side allowlist. It owns vendor-dialect quoting and must
not treat the value as arbitrary SQL. The response is Arrow IPC.

## Bounded direct query

`POST /v1/query` accepts:

```json
{
  "sql": "SELECT order_id FROM main.analytics.orders",
  "row_limit": 100000
}
```

The browser rejects non-read SQL before transport. The bridge must parse and
enforce the same restriction independently, apply the row cap even when the SQL
has no `LIMIT`, and return Arrow IPC.

Errors use JSON when possible:

```json
{
  "error": {
    "code": "query_rejected",
    "message": "Read-only query required."
  }
}
```

## Databricks SQL Warehouse adapter profile

A Databricks adapter should translate bridge requests to the Statement
Execution API:

- submit with `POST /api/2.0/sql/statements`, a configured `warehouse_id`, and
  optional catalog/schema context;
- apply Databricks row and byte limits as additional ceilings;
- use asynchronous execution, poll the statement handle, and call the cancel
  endpoint on browser cancellation;
- after a cancel receipt, continue polling until a terminal state;
- use `ARROW_STREAM` results where supported; and
- when Databricks returns signed external result links, fetch them without the
  Databricks `Authorization` header and convert/stream the result as bounded
  Arrow IPC.

References:

- [Statement Execution API](https://docs.databricks.com/api/workspace/statementexecution)
- [Execute statement](https://docs.databricks.com/api/gcp/workspace/statementexecution/executestatement)
- [Cancel execution](https://docs.databricks.com/api/workspace/statementexecution/cancelexecution)
- [Statement Execution tutorial](https://docs.databricks.com/aws/en/dev-tools/sql-execution-tutorial)

## Snowflake Virtual Warehouse adapter profile

A Snowflake adapter should translate bridge requests to the SQL API:

- submit with `POST /api/v2/statements` and configured database, schema,
  warehouse, and role context;
- keep OAuth, key-pair, or programmatic access-token handling bridge-side;
- use asynchronous statement handles, status polling, and the cancel endpoint;
- fetch every bounded JSONv2 result partition; and
- convert the complete bounded result to Arrow IPC before returning it to the
  browser.

References:

- [SQL API reference](https://docs.snowflake.com/en/developer-guide/sql-api/reference)
- [Submitting requests](https://docs.snowflake.com/en/developer-guide/sql-api/submitting-requests)
- [Handling responses](https://docs.snowflake.com/en/en/developer-guide/sql-api/handling-responses)
- [Cancelling requests](https://docs.snowflake.com/en/en/developer-guide/sql-api/cancelling-requests)
- [SQL API authentication](https://docs.snowflake.com/en/en/developer-guide/snowflake-rest-api/authentication)

## Verification and claim scope

`npm run warehouse:conformance` exercises Databricks- and Snowflake-shaped
synthetic bridge profiles against the production browser client. It proves
request shape, opaque identifier preservation, row caps, secret-free results,
and branded-card absence. Production-browser coverage separately proves that
closing a bridge dialog aborts the HTTP request. Neither gate can prove vendor
authentication, authorization, SQL-dialect coverage, downstream cancellation,
rate limits, or live result conversion.

Do not enable or advertise a Databricks SQL Warehouse or Snowflake Virtual
Warehouse entry point until a separately packaged bridge adapter passes those
live tests with safe user-supplied credentials.
