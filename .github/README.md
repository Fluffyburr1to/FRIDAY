# .github/ — The Enforcement Layer

**Owner-only. FRIDAY may never propose changes to this folder** — she cannot weaken the pipeline
that checks her. Enforced by CI and CODEOWNERS.

| Path | Purpose |
|---|---|
| `workflows/` | CI/CD pipelines — the verification layer of the approval system |
| `pull_request_template.md` | The five constitutional questions, asked in the moment |
| `ISSUE_TEMPLATE/` | Issue forms |
| `dependabot.yml` | Dependency security updates |

## The pipeline is a safety mechanism, not a convenience

You approve every merge. That decision needs independent verification — otherwise you are trusting
FRIDAY's own report that her tests pass.

| Workflow | Runs | Status |
|---|---|---|
| `pr.yml` | Every PR — lint, typecheck, tests, **constitutional tests**, security scan, build, E2E | ✅ |
| `ai-pr-rules.yml` | `friday/*` branches — 400-line cap, forbidden paths, required PR sections | ✅ |
| `main.yml` | After merge — full suite, benchmarks, coverage | ✅ |
| `nightly.yml` | Live connector smoke tests, soak test, dependency audit | M1 — needs a running kernel to soak |
| `release.yml` | Build and SBOM. **Signing stays manual.** | M4 — needs something installable |

The stages that have nothing to run yet — constitutional tests, migrations, E2E, agent evals — say so
in their output and pass. They are wired now rather than added later so that the milestone which
introduces each one finds the gate already in place, rather than retrofitting enforcement onto code
that already exists.

Reference: [Chapter 27](../docs/01-bible/27-cicd-pipeline.md)
