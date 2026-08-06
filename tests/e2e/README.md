# End-to-End Tests

Playwright. Real browser, real core, real database, fixture connectors.

**Kept deliberately few** (~30). E2E tests are slow and brittle; their value is covering the handful
of journeys where a break would be unacceptable, not covering everything.

## The journeys that must never break

- Approve an action from the dashboard; verify it executes
- Decline one; verify the plan applies its failure policy
- **Restart core mid-plan; verify it resumes exactly where it stopped**
- Create a standing grant; verify it is applied and audited
- View an explanation; **verify every claim links to a recorded event**
- Enter and exit Safe Mode

## Rules

1. **Accessibility is tested here** via `axe-core`. WCAG 2.2 AA violations fail the build.
2. **A flaky test is fixed or deleted immediately.** A flaky gate is not a gate — it teaches you to
   re-run rather than investigate.
