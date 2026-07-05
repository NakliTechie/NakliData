# Codex suggestions — input-format follow-up

Date: 2026-07-05

Host tested: `https://naklidata.naklitechie.com/`

Prior real-data pass covered public CSV:

- Titanic CSV: `891` rows; mounted and queried.
- NYC Airbnb CSV: `48,895` rows; mounted and queried.

This pass covered additional public URL input formats.

## Summary

The hosted public URL mount path handled JSONL and Parquet cleanly. Remote XLSX produced a clear unsupported-format message, which is the right boundary for the current URL modal because it advertises only CSV/TSV/JSONL/Parquet.

Main finding: file-format support is strong when the format is in the public URL path, but taxonomy/report coverage is uneven by domain. Logs worked best because current taxonomy already covers logs; research/scholarly Parquet mounted fine but had no semantic recognition.

## Test matrix

| Format | Source | Mount result | Query result | Semantic/report result |
| --- | --- | --- | --- | --- |
| JSONL | `public/examples/logs/access.jsonl` raw GitHub URL | Success: table `access`, `240` rows | Success: service/status aggregation, `47` rows in `40 ms` | Excellent: timestamp, level, service, endpoint, status, duration, request_id all classified at `100%`; suggested report appeared: "Error frequency by service" |
| Parquet | `eval/m0/data/papers.parquet` raw GitHub URL | Success: table `papers`, `2,600` rows | Success: year/citation aggregation, `9` rows in `30 ms` | Weak: physical schema inferred, but scholarly semantics unknown (`pid`, `ttl`, `abs`, `yr`, `venue`, `n_cite`, `typ`, `dt`, etc.) |
| XLSX over URL | `guide/sample-data/financial_sample.xlsx` raw GitHub URL | Expected refusal | Not run | Good boundary message: `Format "xlsx" can be mounted from disk but not yet via a public URL. Use Add file / Add folder for now.` |

## JSONL details

Source URL:

`https://raw.githubusercontent.com/NakliTechie/NakliData/main/public/examples/logs/access.jsonl`

Observed table:

- `access`
- `240 rows`

Schema recognition:

- `timestamp` -> Datetime, `100%`
- `level` -> Log level, `100%`
- `service` -> Service name, `100%`
- `endpoint` -> URL, `100%`
- `status` -> HTTP status code, `100%`
- `duration_ms` -> Duration (ms), `100%`
- `request_id` -> Request / trace ID, `100%`

Query run:

```sql
SELECT
  service,
  status,
  count(*) AS requests,
  round(avg(duration_ms), 1) AS avg_duration_ms,
  max(duration_ms) AS max_duration_ms
FROM access
GROUP BY service, status
ORDER BY service, status;
```

Result:

- `47 rows`
- `40 ms`
- No console warnings/errors observed.

Product implication:

This is the model case for NakliData's semantic promise: when taxonomy coverage matches the dataset, the app recognizes columns, offers quick charts, and surfaces a suggested report.

## Parquet details

Source URL:

`https://raw.githubusercontent.com/NakliTechie/NakliData/main/eval/m0/data/papers.parquet`

Observed table:

- `papers`
- `2,600 rows`

Query run:

```sql
SELECT
  yr,
  count(*) AS papers,
  round(avg(n_cite), 1) AS avg_citations,
  max(n_cite) AS max_citations
FROM papers
GROUP BY yr
ORDER BY yr;
```

Result:

- `9 rows`
- `30 ms`
- No console warnings/errors observed.

Product implication:

Parquet support is working on the hosted public URL path. The weakness is taxonomy: research/scholarly column names are not recognized. Add the research/scholarly taxonomy section from `real-data-reporting-improvements.md`.

Priority scholarly types:

- `paper_id`: `pid`, `paper_id`, `doi`, `work_id`
- `paper_title`: `ttl`, `title`, `paper_title`
- `abstract_text`: `abs`, `abstract`
- `publication_year`: `yr`, `year`, `publication_year`
- `venue_name`: `venue`, `journal`, `conference`
- `citation_count`: `n_cite`, `citations`, `citation_count`
- `publication_type`: `typ`, `type`, `publication_type`
- `retraction_flag`: `retracted`, `is_retracted`
- `publication_date`: `dt`, `date`, `publication_date`

Suggested report templates:

- Publications and citations by year.
- Venue impact summary.
- Retraction / quality watch.
- Topic and language coverage.

## Remote XLSX boundary

Source URL:

`https://raw.githubusercontent.com/NakliTechie/NakliData/main/guide/sample-data/financial_sample.xlsx`

Observed behavior:

- File was not mounted.
- Modal remained open.
- Clear inline message: `Format "xlsx" can be mounted from disk but not yet via a public URL. Use Add file / Add folder for now.`
- No console warnings/errors observed.

Product implication:

This is a good boundary. The improvement is discoverability: analysts need a simple matrix of "remote URL supports X; local file supports Y."

Recommended UI change:

- Add a "Supported formats" mini-link or tooltip inside the Add source modal.
- Show a two-column matrix:
  - Public URL: CSV, TSV, JSONL/NDJSON, Parquet.
  - Add file/folder: CSV, TSV, JSONL/NDJSON, Parquet, Arrow/Feather, Excel, SQLite, DuckDB, GeoJSON/KML, SPSS/Stata/SAS.
- If URL format is unsupported but local mount supports it, keep the current message and add a visible "Use Add file" button.

## Additional format tests to run next

These require local file-picker automation or a local fixture flow rather than the hosted public URL path:

- XLSX local file: use `guide/sample-data/financial_sample.xlsx`.
- SQLite local file: use `guide/sample-data/chinook.sqlite`.
- Stata local file: use `tests/e2e/fixtures/sample-data/stat_demo.dta`.
- GeoJSON local file: use `tests/e2e/fixtures/sample-data/places.geojson`.
- Arrow/Feather local file: use an uncompressed Arrow IPC fixture.
- TSV: use or publish a small public TSV fixture because the scratchpad TSV is not on the public branch.

Recommended automation:

- Add a non-product Playwright evaluation script that drives the hosted app's Add file flow with local fixtures.
- Keep the findings in `plan/codex-suggestions/`, not in committed tests, until the desired product changes are chosen.

## Taxonomy lesson from format testing

The file readers are not the bottleneck for analyst usefulness. The semantic layer is.

Observed contrast:

- JSONL logs: strong taxonomy coverage -> suggested report appears.
- Parquet papers: reader works, query works, but no semantic/report help because taxonomy lacks scholarly roles.
- CSV Airbnb/Titanic: reader works, query works, but report suggestions are sparse because taxonomy lacks marketplace/geography/outcome roles.

Therefore, the taxonomy expansion should be paired with report templates and generic fallback suggestions.
