# Issue Templates

To be written at Milestone 0.

| Template | For |
|---|---|
| `bug.yml` | Something is broken — symptoms, expected, actual, correlation ID |
| `improvement.yml` | Something could be better — with evidence |
| `decision.yml` | Something needs deciding — becomes an RFC or ADR |

**Every bug report asks for a correlation ID.** It is what connects a symptom to the complete causal
chain in the audit trail ([Chapter 22](../../docs/01-bible/22-logging-standards.md)) — the
difference between "it broke" and knowing exactly what happened.

**Security issues do not go here.** See [SECURITY.md](../../SECURITY.md).
