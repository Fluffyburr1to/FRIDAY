# _template — Copy this to create a department

**Do not modify this folder to build something.** Copy it.

```bash
cp -r departments/_template departments/<name>
```

Then, in order:

1. **Write the README first** — what this department owns, and explicitly what it does *not*. The
   boundary is more useful than the charter.
2. **Fill in `department.json`:**
   - `capabilities` — the public API. Each with input/output schema names and a risk class.
   - Mark irreversible operations `irreversible: true` — it becomes the "cannot be undone" line on
     the approval screen.
   - `requiredConnectors` / `optionalConnectors`
   - `subscribes` / `publishes` — **declared, not discovered.** Undeclared use fails at load.
   - `permissions` — namespaced, minimal
   - **`degradedMode`** — required. What can this department still do when its dependencies are
     down? Article VII, answered at design time rather than during an incident.
3. **Write the evaluation suite before the agents.** `tools/evals/suites/<agent>/`.
4. **Write the agents**, each with a manifest capping its capabilities and risk classes.
5. **Prompts go in `src/prompts/`** and are version-controlled source code.

## Reminders

- **No department imports another department.** Events only.
- **No direct database access.** Use `packages/storage` repositories.
- **No authorization logic.** The Guardian decides.
- Only `src/index.ts` is importable from outside.

**This template will be written at Milestone 3**, alongside the first real department, so it
reflects working code rather than speculation.

Reference: [Chapter 13](../../docs/01-bible/13-department-architecture.md)
