# tests/ — Cross-Cutting Tests

Tests that span packages. Tests belonging to a single package live in that package's `test/` folder.

| Folder | Contains | Runs |
|---|---|---|
| **constitutional/** | ★ Assertions that the founding guarantees hold | Every PR |
| **e2e/** | Playwright — full user journeys through a real browser | Every PR |
| **contract/** | The conformance suite every connector must pass | Every PR |
| **fixtures/** | Shared test data, scrubbed of real content | — |

---

## tests/constitutional — the protected tier

**These tests assert that the Constitution is enforced by the code**, not that features work.

| Test | Asserts |
|---|---|
| No unaudited action | Every action above `low` produces an audit event |
| No unapproved consequence | No `high`+ action executes without an approval record |
| No `critical` by standing grant | `critical` always requires live confirmation |
| No perpetual grants | Every standing grant has an expiry |
| No agent self-classification | Risk class comes only from Guardian policy |
| No ambient authority | Agents have no network, filesystem, or credential access |
| No undeclared egress | Requests to non-allowlisted hosts are blocked |
| No secrets on disk | No credential value in the database, logs, or build artifacts |
| No memory without provenance | Every memory has a `source_event_id` |
| Audit immutability | `UPDATE`/`DELETE` on `events` fails at the database level |
| Fail-closed budgets | An exhausted budget stops work; it never proceeds |
| Timeout means denied | An expired approval never auto-grants |
| Self-modification is desktop-only | Mobile approval of `self_modification` is rejected |

### Rules

**Protected by CODEOWNERS. FRIDAY may never propose changes to them.** A system that can weaken its
own constitutional tests is not constrained by them.

**When one fails, the answer is never to adjust the test.** Either the code has violated a founding
guarantee — fix the code — or the guarantee itself needs amending, which requires an ADR and the
owner's deliberate decision, not a quiet edit to an assertion.

---

## The shape of the suite

```
        ▲   Constitutional     ~40 tests    the founding guarantees
       ╱ ╲                                   ★ cannot be weakened
      ╱   ╲  End-to-end        ~30 tests    real journeys, real browser
     ╱     ╲
    ╱       ╲ Agent evals      ~15 suites   scored, not asserted (tools/evals)
   ╱         ╲
  ╱           ╲ Integration    ~200 tests   real DB, real bus, fixture connectors
 ╱             ╲
╱               ╲ Unit         ~1500 tests  pure logic, fast (in each package)
──────────────────
```

Deliberately not a standard pyramid. The constitutional tier sits above end-to-end because those
properties matter more than any feature — and because they are the ones a future contributor is most
likely to be tempted to weaken when they become inconvenient.

---

## Fixtures

**Scrubbed of real data automatically before commit.** A fixture containing a real email body would
put personal data in git history permanently.

Reference: [Chapter 28](../docs/01-bible/28-testing-strategy.md).
