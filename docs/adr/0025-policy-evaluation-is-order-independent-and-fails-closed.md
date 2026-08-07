# ADR-0025 — Policy evaluation is order-independent and fails closed

- **Status:** accepted
- **Date:** 2026-08-07
- **Deciders:** Tyler Hutson (owner)
- **Supersedes:** none
- **Related:** [Chapter 17 — Authentication & Authorization](../01-bible/17-authentication-authorization.md),
  [Chapter 19 — Approval System](../01-bible/19-approval-system.md),
  [ADR-0005 — The Guardian as the sole authorization point](0005-guardian-sole-authorization.md),
  [ADR-0006 — Capability tokens rather than RBAC](0006-capability-based-authorization.md)

---

## Context

[Chapter 17](../01-bible/17-authentication-authorization.md) settles that policies are declarative
data rather than code, and gives one example rule with `effect`, `when`, `unless`, and `riskClass`.
It does not say what happens when two rules match the same request, or when none does. Those two
questions decide every answer the Guardian ever gives, so they cannot be left to whichever
implementation lands first.

Three specific gaps:

1. **Conflict.** A rule saying `connector.*.write` requires approval and a rule saying
   `connector.calendar.write` is allowed both match a calendar write. Which wins?
2. **No match.** An action nobody wrote a rule about arrives. Allowed or denied?
3. **Risk.** Chapter 19 says risk class is "assigned by the Guardian from a static policy table".
   Chapter 17 puts `riskClass` on an individual rule. If two matching rules name different classes,
   the action has two risk classes, and the one that gets used decides whether the owner is asked.

The obvious implementation — walk the rules in file order, first match wins — answers all three
cheaply and is what most policy engines do. It is also the reason this needed a decision rather than
a default: under first-match-wins, the security posture of the system depends on the order files
happen to be read off a disk. Adding a rule to a new file could silently disarm an existing one, and
nothing in the diff would show it.

## Decision

**Every rule is evaluated. The strictest outcome among the matching rules wins. No match denies.**

Concretely:

| Question | Answer |
|---|---|
| Which effect wins? | `deny` > `require_approval` > `allow`. A single `deny` ends it. |
| Which risk class wins? | The **highest** among matching rules: `low` < `medium` < `high` < `critical`, and `self_modification` is treated as at least `critical` for this purpose. |
| No rule matches? | **`DENY`**, with reason `no_policy_matched`. |
| Does file order matter? | **No.** The result is identical for any load order. |
| What does the decision carry? | The IDs of *every* rule that matched, not just the deciding one. |

`unless` is evaluated per rule: a rule whose `unless` clause is satisfied does not contribute its
effect. It is a rule-local exemption, not a global override, which keeps the order-independence
property intact.

## Constitutional review

- **Article III (Approval):** fail-closed is the only reading that survives an incomplete policy
  set. An action nobody classified is, by definition, one the owner has never considered, and
  Article III's default for an unconsidered action cannot be "go ahead."
- **Article I (The User):** strictest-wins means the owner's most restrictive statement about a
  class of action is the one that holds. Under first-match-wins, a narrow permissive rule added
  later could quietly override a broad restriction the owner wrote deliberately.
- **Article II (Transparency):** returning every matched rule rather than the deciding one is what
  lets an explanation say *"three rules applied; this one is why you are being asked"*. A single
  rule ID would be true and misleading.
- **Principle 7 (Explainability):** order-independence is what makes an explanation reproducible.
  A decision that depends on directory listing order cannot be re-derived from the recorded facts.

**The five questions:**

- [x] **Can the user see it?** Every decision records its matched rules and its risk class in the
      event log, and the dashboard shows them.
- [x] **Can the user stop it?** Fail-closed is the mechanism by which they stop things they have
      not yet thought about.
- [x] **Can we replace it?** Yes — deliberately. Chapter 17 flags Cedar as the migration target past
      ~50 rules. Cedar's semantics are also deny-overrides with no implicit permit, so this decision
      moves us *toward* that target rather than away from it.
- [x] **Can we explain it?** "Everything that matched was considered, and the strictest answer won"
      is a sentence the owner can hold in their head. "The first file alphabetically decided" is not.
- [x] **Will this still be right in five years?** Deny-overrides is the settled answer in every
      serious authorization system. It will still be right.

## Alternatives considered

### First match wins, in declared order

**What it is.** Rules form an ordered list; evaluation stops at the first match. Firewall rules,
`.gitignore`, and most ACL systems work this way.

**Advantages.** Fast. Familiar. Lets the owner express "allow this one specific thing, deny the rest"
compactly by putting the exception first.

**Why rejected.** It makes ordering a security control, and ordering is invisible in review. The
failure mode is specific and bad: someone adds `policies/calendar.json` with a permissive rule, it
sorts before `policies/connectors.json`, and a restriction that was in force for a year stops
applying — with no line in either file changed to say so. The owner does not read code and would
have no way to see it. The compactness benefit is real but small; `unless` covers most of what
ordering-for-exceptions is used for, and it does so locally and visibly.

### Highest-priority rule wins, with an explicit `priority` integer

**What it is.** Each rule carries a number; the highest matching priority decides.

**Advantages.** Order-independent, and more expressive than deny-overrides — it can express
"this narrow allow beats that broad deny."

**Why rejected.** Priority numbers are a well-known maintenance trap: they drift, they collide, and
they get chosen by copying a nearby rule and adding ten. More importantly, the expressiveness it
buys is exactly the dangerous kind — an allow that beats a deny. For a policy set that governs
whether FRIDAY may spend money or send mail, "nothing can override a deny" is worth more than
expressiveness. Reconsider if the rule count grows past the point where deny-overrides forces
awkward duplication; the migration is mechanical.

### Allow by default when no rule matches

**What it is.** An unmatched action proceeds, on the reasoning that the policy set only needs to
enumerate what is dangerous.

**Advantages.** Far less policy authoring. FRIDAY works out of the box; new capabilities do not need
a policy written before they function.

**Why rejected without qualification.** It inverts Article III. It also fails in the specific way
that matters most: a new connector, a new department, or a manipulated agent inventing an action
name it made up would all be permitted precisely because nobody had considered them. The cost —
that every new action needs a policy line before it works — is a feature. It forces the owner to
classify each new capability once, at the moment it is introduced, rather than discovering it acted
unclassified.

## Consequences

**Positive**

- The Guardian's answer is a pure function of (request, policy set). It does not depend on
  filesystem order, load order, or insertion order, which makes it trivially testable and makes an
  explanation reproducible years later.
- A `deny` rule cannot be neutralised by any addition elsewhere. The owner's restrictions are
  monotonic.
- An unclassified action is a visible, debuggable denial rather than a silent permission.

**Negative**

- **Every action needs a policy line before it works.** The first time a department or connector is
  added, the failure will be `no_policy_matched`, and it will look like a bug rather than a
  configuration gap. Mitigated by making the denial reason say exactly which action string had no
  rule, and by the dashboard surfacing it.
- **"Allow this one exception to a broad deny" cannot be expressed by adding a rule.** It requires
  narrowing the deny or using `unless`. This is a deliberate loss of expressiveness and it will
  occasionally be annoying.
- Evaluating every rule is O(rules) rather than short-circuiting. At the scale Chapter 17 anticipates
  (~50 rules) this is irrelevant; it is recorded so the trade is not rediscovered.

**Neutral**

- Rules may live in any number of files under `policies/`, organised however the owner finds
  readable, because the file layout carries no meaning.

## Reversibility

- **Cost to reverse:** medium. The evaluation function is small and replaceable, but every existing
  rule was authored under deny-overrides semantics, and re-reading them under first-match-wins would
  require reviewing the whole set for order dependence.
- **Point of no return:** none technically. In practice, once the owner has authored a policy set
  they trust, changing the semantics under it is a security review, not a refactor.

## Review triggers

- Rule count exceeds ~50 — the Cedar evaluation Chapter 17 already flags. Deny-overrides is
  compatible with Cedar, so this decision does not have to be revisited at the same time.
- The policy set starts containing near-duplicate rules written only to narrow a deny — that is the
  symptom of missing priority, and the second alternative above should be reconsidered.
- Any `no_policy_matched` denial reaches the owner as a surprise more than occasionally — the
  authoring workflow, not the semantics, is what needs fixing.

## Notes

The decision that took the longest was risk class, not effect. It is tempting to let the most
*specific* matching rule assign the class, since a rule naming `connector.gmail.send` obviously
knows more than one naming `connector.*.*`. That was rejected for the same reason as first-match:
"most specific" needs a specificity metric, the metric is arbitrary at the margins, and the thing it
would decide is whether the owner gets asked before an email goes out. Taking the maximum is cruder
and cannot fail in the direction that matters.
