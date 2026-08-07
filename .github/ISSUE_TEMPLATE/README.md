# Issue Templates

| Template | For |
|---|---|
| `bug.yml` | Something is broken — symptoms, expected, actual, correlation ID |
| `improvement.yml` | Something could be better — with evidence |
| `decision.yml` | Something needs deciding — becomes an RFC or ADR |
| `config.yml` | Disables blank issues; routes security reports away from public issues |

**Every bug report asks for a correlation ID.** It is what connects a symptom to the complete causal
chain in the audit trail ([Chapter 22](../../docs/01-bible/22-logging-standards.md)) — the
difference between "it broke" and knowing exactly what happened.

**Blank issues are disabled.** Each template asks for the one field that makes an issue actionable
six months later — a correlation ID, evidence, or the alternatives considered — and a blank issue
reliably omits it.

**Security issues do not go here.** See [SECURITY.md](../../SECURITY.md).
