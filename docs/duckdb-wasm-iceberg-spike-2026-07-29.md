# DuckDB-WASM / Iceberg migration spike

Date: 29 July 2026  
Status: candidate and browser compatibility proven; checked-in runtime migration
not yet authorized

## Outcome

Use `@duckdb/duckdb-wasm` **1.32.0**, embedding DuckDB **v1.4.3**, as the
reviewed migration candidate. Do not follow the npm `latest` tag: on the day of
the spike it pointed to a development build (`1.33.1-dev57.0`), while 1.32.0
was the newest stable package version.

A no-install, temporary probe proved that the candidate can load a
same-origin, dependency-complete Iceberg extension mirror and read bounded rows
from DuckDB's official Iceberg fixture in real headless Chromium. Both shipped
compatibility variants passed:

| Variant | Engine | Extensions loaded | Bounded result | Console errors |
| --- | --- | --- | --- | --- |
| `wasm_eh` | v1.4.3 | httpfs, iceberg, parquet, avro | 5 ordered rows | 0 |
| `wasm_mvp` | v1.4.3 | httpfs, iceberg, parquet, avro | 5 ordered rows | 0 |

This resolves package/extension feasibility. It does **not** change the
project dependency, vendor runtime assets, enable Iceberg source cards, test a
live vendor endpoint, or establish Databricks/Snowflake compatibility.

## Candidate review

The stable packages were downloaded directly from the npm registry, their
registry SHA-1 values were verified, and their blocking builds were
instantiated to obtain the embedded core revision:

| Package | Published | Embedded DuckDB | Registry SHA-1 |
| --- | --- | --- | --- |
| 1.30.0 | 2025-09-09 | v1.3.2 | `b6dcc228af441a38de2c54208f6f653d8342b38d` |
| 1.31.0 | 2025-09-26 | v1.4.0 | `bf48e84ed561048edf8c205741d1b00838f123f6` |
| **1.32.0** | 2025-12-16 | **v1.4.3** | `199ebbca6c302eba7bb0a458aacd34ccf8518335` |

The candidate npm integrity is:

`sha512-IewXTNYEjsZCPE9weUWgtjGxUlMRo7qhX0GF6tq/KjK8bnY+RAl4cyUdYUfcdzbyb4b9ZxPC+FOsCcxgaKFWMg==`

The compromised package named in GHSA-w62p-hx95-gf2c was 1.29.2; patched
versions begin at 1.30.0. NakliData's current 1.29.0 pin is not that compromised
release, and the 1.32.0 candidate is above the patched floor. This only resolves
that named incident; normal lockfile/advisory gates still apply during the real
migration.

## Artifact evidence

The official registry returned signed Iceberg artifacts at the root layout
already used by NakliData:

`https://extensions.duckdb.org/v1.4.3/<platform>/<extension>.duckdb_extension.wasm`

The alternative `/duckdb-wasm/v1.4.3/...` layout returned 404 and must not be
used.

Candidate core assets staged from the verified 1.32.0 package:

| Asset | Bytes | SHA-384 |
| --- | ---: | --- |
| browser JS | 435,666 | `cd7cd71a5eaaf50c3375f19e621a36097a6da9fbbed2686d9c6d9a297ab17826dc818929e354527f17fb1692f9b660d4` |
| EH worker | 772,759 | `6b6439c0f7cc247ae2c3de83df186d9329bcdd24f5d715089ba7b6eeaf5ddefe3290fa92cde63b5825cae824e5245c1b` |
| MVP worker | 844,644 | `001078405814a10a9f88c46fe0499edb4442a3eacefff38110e25f8946e26450511ffe13e31cbc55cbb884b5e03f1434` |
| EH core WASM | 34,242,586 | `870dc68de25963941aa50f26c2a3075c13d59932cefa32a6e5d943c241ac11f8f2bbf1dc5f1d5dd11c25aff6404a18ea` |
| MVP core WASM | 39,362,651 | `68fc439ada2f350c8c4f2f12ef3a25354887a1036fb642c639625d3ed4295b54f9d8342ea9e1aeb6611d6f4c9c06836c` |

Required extension closure:

| Platform | Extension | Bytes | SHA-384 |
| --- | --- | ---: | --- |
| EH | httpfs | 389,034 | `82cf73b3c093f2cda14c843dd4561d07479f6169f14fa95d2adc47dc0cdd46116fd6e92dd2be00b8e2539510f7d261ad` |
| EH | iceberg | 1,645,338 | `e1fee67dd6bbce713fb30cc60be0e2784b794dc50d1415ceadb082ad18394abdb8c940a65c0120228ee7165bd4284db6` |
| EH | parquet | 3,045,039 | `04e43345195622506c82e462338947dcdbc0f869756827d82752233a3c9a503d39eba483ecde89a384e74f42e6295bec` |
| EH | avro | 442,681 | `9c22895b0aac67d7eaebbcb1c0b22bc3b145c053ab3f1c950eaedb8f92e5a0902a2b09c5043f9c2cab097e075829d016` |
| MVP | httpfs | 312,242 | `90285ab5ee27cc9e2581af5ae70c2617dddb3eaa63f6c51960aa72446e7ca3ca75776fd5d4e4882c66afa8202a56babf` |
| MVP | iceberg | 1,429,213 | `558d3624b6f5240c63ff857f44488077130229b3d213997c4d9279695ada500a85de9ae7ebfd73608b4e525095b3d771` |
| MVP | parquet | 2,867,304 | `62fe0eb44ff51278846bd4dfc0abb86f309e8dddf7c5fa05d542329e1e52dc82bb75641f3758c7866141d7655187d5fd` |
| MVP | avro | 407,691 | `8ced489ba9f0e60a8ece59d2952066857edaa46caef7843b91abaa3100bfbd24c722341b76953800c209dbb0c46ec95c` |

An Iceberg artifact also exists for `wasm_threads` (SHA-384
`8f04e2a12a670b9133b424566240a8b8b235c890991832bc9380eecc17c39b77bd46c92a1f1a95c5bc061389c8058bf8`).
NakliData does not currently select a threads/COI bundle, so adding it would be
a separate capability and is not part of this migration.

## Browser scan evidence

The official `iceberg_data.zip` fixture was downloaded from duckdb.org,
validated for absolute/traversal paths before extraction, and served from the
same loopback origin as the staged runtime. Its SHA-384 was
`a845422c72559d1023fb564ffca1a9b3fd40c6045ef698d94a75ff6825678184dcc765c5dbba27961973b82cd5d32404`.
The server implemented byte ranges because DuckDB's HTTP reader correctly
rejects a server that returns more bytes than requested.

For each variant the probe:

1. instantiated the candidate worker and WASM;
2. set the same-origin custom and auto-install extension repository;
3. installed and loaded `httpfs`, then `iceberg`;
4. observed `parquet` and `avro` dependency requests;
5. ran:

```sql
SELECT l_orderkey, l_partkey, l_quantity, l_extendedprice
FROM iceberg_scan(
  '<loopback>/fixture/data/iceberg/lineitem_iceberg',
  allow_moved_paths = true
)
ORDER BY l_orderkey, l_partkey
LIMIT 5;
```

Both variants returned the same first key pairs:
`(1,22)`, `(1,157)`, `(1,241)`, `(1,637)`, and `(1,674)`. Requests included
the version hint, v2 metadata JSON, snapshot and manifest Avro files, and a
Parquet data file. No browser console errors occurred.

## Issues found

1. **The extension mirror must include dependency closure.** Mirroring only
   `iceberg` fails first on `parquet`, then on `avro`; an HTTP table scan also
   needs `httpfs`.
2. **The current local fallback is variant-asymmetric.** NakliData ships EH and
   MVP core/worker assets, but its current extension mirror contains only
   `v1.1.1/wasm_eh`. The migration must vendor and hash required extensions for
   both selectable variants.
3. **Range semantics matter.** A remote fixture server that ignores byte-range
   requests produces DuckDB's “server sent back more data than expected”
   failure. Live matrices need explicit range/CORS failure coverage.
4. **npm `latest` is not a stable-selection policy.** It currently resolves to
   a development build. The migration must keep an exact reviewed pin.
5. **Artifact existence is not product compatibility.** The probe used a
   public fixture and no credentials. It did not exercise Unity Catalog,
   Open Catalog/Polaris, cloud credential application, refresh, or vendor
   authorization/error behavior.
6. **The shared engine substrate changes.** Moving from DuckDB v1.1.1 to v1.4.3
   can affect every reader, SQL plan, type conversion, worker bootstrap, CSP
   hash, and persisted relation path; the complete regression gate remains
   mandatory.

## Authorized migration plan

When the runtime change is explicitly approved:

1. pin package and lockfile to exactly 1.32.0;
2. update the CDN/fallback bundle URLs and core-revision mapping together;
3. vendor and SHA-384-pin EH and MVP core/worker assets;
4. vendor and SHA-384-pin the four-extension closure for both variants;
5. make extension lookup variant-aware and fail closed on an incomplete mirror;
6. implement the real DuckDB `VendedCredentialTarget` with atomic replace and
   clear for S3, GCS, and ADLS;
7. add the public Iceberg Chromium probe to the production smoke surface,
   including range/CORS/404/metadata/data failure cases;
8. rerun all local and remote-source regressions, manual schema override,
   complete tests, smoke, CSP, integrity, static, and 768 KiB shell gates;
9. keep generic and branded Iceberg cards disabled until their separate live
   matrices pass.

## Sources

- [npm package metadata for 1.32.0](https://registry.npmjs.org/@duckdb/duckdb-wasm/1.32.0)
- [DuckDB-WASM extension loading](https://duckdb.org/docs/current/clients/wasm/extensions)
- [DuckDB Iceberg extension](https://duckdb.org/docs/current/core_extensions/iceberg/overview)
- [DuckDB official Iceberg fixture](https://duckdb.org/data/iceberg_data.zip)
- [DuckDB-WASM repository](https://github.com/duckdb/duckdb-wasm)
- [GHSA-w62p-hx95-gf2c](https://github.com/advisories/GHSA-w62p-hx95-gf2c)
