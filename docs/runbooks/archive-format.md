# Re-verifying that archives stay readable without FRIDAY

**Run this when the Parquet library is upgraded, or when
`packages/storage/test/integration/archive-format.test.ts` starts failing.**

[Chapter 10](../01-bible/10-event-bus.md) promises that cold events stay queryable — "slower, not
gone" — and names DuckDB. That promise is about a file being readable by software this project does
not control, so it cannot be proved by reading the file back with the same library that wrote it.
It has to be checked against a real outside reader.

## What was verified, and when

| | |
|---|---|
| Date | 2026-08-07 |
| DuckDB engine | v1.5.5 (via `@duckdb/node-api` 1.5.5-r.3) |
| Writer | `hyparquet-writer` 0.16.5 |
| Archive | Four events written by `writeArchive`, including unicode, nulls, a 200-byte payload, and causation links |

Everything checked out:

- DuckDB inferred `BIGINT` for the integer columns and `VARCHAR` for the text ones.
- All four rows read back, with the exact millisecond timestamps — `1786159671566` and neighbours,
  which is well past what a 32-bit column could hold.
- Integrity hashes came back byte for byte.
- `sécond — with unicode ✓` survived exactly.
- Nulls read as nulls; `causation_id` was null on the first event and set on the rest.
- `SELECT type, COUNT(*), MIN(occurred_at) ... GROUP BY type` worked — which is the actual reason
  Chapter 10 chose Parquet rather than a private format.

## Why there is no DuckDB test in CI

`@duckdb/node-api` is **114 MB** — a whole embedded analytical database. Paying that on every CI run
to re-prove a stable file-format claim is the trade [Chapter 18](../01-bible/18-security-model.md)
says not to make, and Rule 4 in [`CLAUDE.md`](../../CLAUDE.md) says to prefer fifty lines over a
package.

Instead, `archive-format.test.ts` asserts the **physical** shape of the file — the Parquet types,
the `UTF8` annotations, the encodings, and the compression codec — because that is what an outside
reader actually depends on and what a library upgrade could silently change. The other archive tests
read files back with the library that wrote them, so they would not notice.

**If those assertions change, run the check below before accepting the new shape.**

## How to repeat it

Nothing here is installed permanently. Work in a scratch directory.

```bash
mkdir -p /tmp/friday-duckdb && cd /tmp/friday-duckdb && echo '{"name":"probe","type":"module","private":true}' > package.json && pnpm add @duckdb/node-api
```

Produce a real archive from the current code. From `packages/storage`, with the package built:

```bash
node --input-type=module -e "import Database from 'better-sqlite3'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { createInMemoryKeyProvider, openStorage, writeArchive } from './dist/index.js'; const d = mkdtempSync(join(tmpdir(),'arc-')); const keys = createInMemoryKeyProvider({ 'field-encryption-key': Buffer.alloc(32,4).toString('base64') }); const s = openStorage({ mainDbPath: d+'/friday.db', eventsDbPath: d+'/events.db', keys, fieldKeyReference: 'field-encryption-key' }); for (const n of ['first','sécond — ✓','third']) s.value.events.append({ event: { type:'test.event.emitted', actor:{type:'user',id:'usr_tyler'}, principalId:'usr_tyler', payload:{note:n}, sensitivity:'internal' } }); s.value.close(); const db = new Database(d+'/events.db'); const w = await writeArchive({ db, fromSeq:1, toSeq:3, archiveDirectory:'/tmp/friday-duckdb' }); console.log(w.ok ? w.value.path : w.error.message); db.close();"
```

Then read it with DuckDB, from the scratch directory:

```bash
node --input-type=module -e "import { DuckDBInstance } from '@duckdb/node-api'; const f = process.env.ARCHIVE; const c = await (await DuckDBInstance.create(':memory:')).connect(); const q = async (s) => (await (await c.run(s)).getRowObjectsJson()); console.log(await q(\`DESCRIBE SELECT * FROM read_parquet('\${f}')\`)); console.log(await q(\`SELECT seq, occurred_at, integrity_hash, payload FROM read_parquet('\${f}') ORDER BY seq\`)); console.log(await q(\`SELECT type, COUNT(*) AS n FROM read_parquet('\${f}') GROUP BY type\`));"
```

Set `ARCHIVE` to the path the previous command printed.

**What to look for:** integer columns as `BIGINT`, text as `VARCHAR`, timestamps identical to the
source, unicode intact, nulls as nulls, and the `GROUP BY` returning a row. Anything else means the
archive format has drifted and Chapter 10's promise is at risk — update this runbook with what you
found before changing the test to match.

## If it fails

The archive format is a promise to the owner about their own data, not an implementation detail.
Treat a failure as a blocker on archiving, not on the test:

1. **Do not adjust `archive-format.test.ts` to match the new output.** That is the assertion doing
   its job.
2. Check whether the writer changed its types, encodings, or codec — those are the three things
   that break outside readers.
3. If the current writer can no longer produce a widely readable file,
   [ADR-0028](../adr/0028-the-chain-covers-a-payload-digest-and-is-segmented.md) names
   `parquet-wasm` as the fallback and explains what the trade costs.

Archives already written are unaffected by any of this — they are finished files.
