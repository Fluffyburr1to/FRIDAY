<!--
Every pull request answers these questions — from the owner, a contributor, or FRIDAY.
Delete nothing. If a section does not apply, say why.
See CONTRIBUTING.md
-->

## What changed

<!--
In plain language, for someone who does not read code.

❌ "Refactored the connector retry mechanism to use exponential backoff with jitter."
✅ "Gmail now waits longer between retry attempts and adds a small random delay, so
   several retries don't all fire at once. It was giving up too early on large
   attachments."
-->



## Why

<!-- The problem being solved, or the founding-document requirement being implemented.
     Reference the Article or Principle if one applies. -->



## Constitutional review

<!-- If an answer is uncomfortable, WRITE THAT. An honest "I'm not sure this is
     replaceable enough" is far more useful than a checked box. -->

- [ ] **Can the user see it?**
      *Does this appear in the audit trail and dashboard automatically, or did someone
      have to remember to log it?*

- [ ] **Can the user stop it?**
      *Does it block for approval where required? Does the plan survive waiting days?*

- [ ] **Can we replace it?**
      *Any new vendor dependency? Is it behind an interface?*

- [ ] **Can we explain it?**
      *Can the causal chain be reconstructed from recorded data — not from a model's
      account of its own past reasoning?*

- [ ] **Will this still be right in five years?**

**Notes on any of the above:**



## Risk

<!-- What could break. What you are uncertain about. What you did NOT test.
     A PR claiming no risk has not been thought about. -->

**What could break:**

**What I'm uncertain about:**

**What I did not test:**



## Testing

**Added:**

**Ran:**

**Deliberately untested, and why:**



## ADR

<!-- Link the ADR, or state "Not required, because ..." -->



---

## Checklist

- [ ] Matches the surrounding code
- [ ] Tests included; coverage did not decrease
- [ ] Documentation updated in this same PR
- [ ] No new dependency (or it was approved separately)
- [ ] No secrets in the diff
- [ ] No protected path touched (`docs/00-foundation/`, `packages/guardian/policies/`,
      `tests/constitutional/`, `.github/workflows/`)
- [ ] No test was weakened to make it pass
- [ ] Under 400 changed lines (**required** on `friday/*` branches)
- [ ] Commit messages follow Conventional Commits
