# Guardian Policies

**These files are yours. FRIDAY may never change them.**

Enforced in [CODEOWNERS](../../../CODEOWNERS) and in
[`.github/workflows/ai-pr-rules.yml`](../../../.github/WORKFLOWS.md) — a pull request from FRIDAY
that touches this directory is rejected outright, not flagged for review. A system that can change
the rules governing it is not governed.

## What a rule says

```json
{
  "id": "connector-write-requires-approval",
  "description": "Writing to a connected service needs your approval, because it changes something outside FRIDAY.",
  "effect": "require_approval",
  "riskClass": "medium",
  "when": { "action": "connector.*.write", "actorType": "agent" },
  "unless": { "standingGrant": true }
}
```

| Field | Meaning |
|---|---|
| `id` | Kebab-case, stable, and **quoted whenever FRIDAY explains a decision**. Renaming one makes older explanations untrue. |
| `description` | One line, in your language. Shown to you when this rule decides something. |
| `effect` | `allow`, `deny`, or `require_approval`. |
| `riskClass` | `low`, `medium`, `high`, `critical`, `self_modification`. This is where risk comes from — never from a model. |
| `when` | What the rule matches. Must name an action or a resource. Any condition you omit is not a constraint. |
| `unless` | `{ "standingGrant": true }` means the rule steps aside when a live standing permission covers the request. |

Wildcards: `*` stands for one whole segment (`connector.*.write`), and in a resource `**` at the end
covers a whole subtree (`memory:contacts/**`). A rule that allows or asks about **everything** —
`*` for both action and resource — is rejected at load. A `deny` may be that broad.

## How the rules combine

**Every rule is evaluated. The strictest outcome wins. If nothing matches, the answer is no.**

- `deny` beats `require_approval` beats `allow`.
- The risk class is the **highest** among the rules that matched.
- **File order does not matter, and neither does file layout.** Organise these files however reads
  best. Adding a file can never disarm a rule in another file.
- An action no rule mentions is refused, and the refusal names the action so you can see what needs
  a rule.

The full reasoning, and the alternatives that were rejected, is in
[ADR-0025](../../../docs/adr/0025-policy-evaluation-is-order-independent-and-fails-closed.md).

## Changing a rule

Editing anything in this directory is a `critical` action: it requires your explicit approval and a
passkey. That is deliberate — the rules governing authorization are the most consequential data in
the system, and the loosest one is the one that matters.

Reference: [Chapter 17](../../../docs/01-bible/17-authentication-authorization.md) ·
[Chapter 19](../../../docs/01-bible/19-approval-system.md)
