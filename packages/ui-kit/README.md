# @friday/ui-kit

**Shared React components for web, desktop, and mobile.**

Milestone: **M4**

## Charter

One component library used by every surface. This is what makes the approval screen identical on
your Mac and your phone — which is a safety property, not a cosmetic one. Three implementations
would drift, and a drifting approval screen misdescribes what you are authorizing.

## What lives here

- Radix primitives styled with Tailwind: dialogs, menus, tooltips, popovers
- FRIDAY-specific components: `ApprovalCard`, `PlanGraph`, `EventStream`, `HealthIndicator`,
  `ExplanationPanel`, `MemoryEntry`
- Design tokens, typography, spacing
- Adaptive layout primitives (same components, different composition per surface)

## What does NOT

- Any data fetching or business logic — components receive props
- Any decision. **The UI never decides whether an action is permitted.** It renders the Guardian's
  decision.

## Rules

1. **Accessibility is a requirement, not a phase.** WCAG 2.2 AA, keyboard operable, visible focus,
   4.5:1 contrast, `prefers-reduced-motion` respected. Violations fail CI.
2. **Maximum one animated element on screen.** The Manifesto asks for calm.
3. **No modal dialogs except approvals.**
4. **Every consequential action renders its risk and reasoning beside the confirm button.**
   Principle 7: recommendations without explanations are commands.

Reference: [Chapter 06](../../docs/01-bible/06-frontend-architecture.md)
