# RFCs — Proposals Under Discussion

**Temporary documents.** An RFC either becomes an ADR or is closed.

| | RFC | ADR |
|---|---|---|
| Question | *Should we do this?* | *We decided this.* |
| Status | Exploratory, may go nowhere | A record |
| Lifecycle | Temporary | **Permanent, immutable** |

Use an RFC when the *shape* of the solution is not yet clear and the exploration itself is worth
recording. Most decisions skip this stage and go straight to an ADR.

## Format

Free-form, but state: the problem, why it matters now, what you have considered, what you do not
know, and what you are asking for.

Name them `NNNN-short-title.md`, numbered independently from ADRs.

## When an RFC resolves

- **Accepted** → write the ADR, link it, close the RFC
- **Rejected** → **write the ADR anyway**, with status `rejected`. Rejected decisions are kept, so
  the same idea is not re-proposed in eighteen months by someone who does not know it was already
  considered.

Reference: [Chapter 37](../01-bible/37-adr-process.md)
