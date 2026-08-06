# @friday/plugin-host

**Runs code written by people who are not you.**

Milestone: **M8** — designed now, implemented much later

## Charter

A plugin is the most dangerous feature FRIDAY can have: code you did not write, running on the
machine holding your correspondence, finances, and home controls.

The boundary is designed **now** because retrofitting a trust boundary into a system built without
one does not work. The feature ships at M8, when there is a stable API to promise.

## What lives here (eventually)

- Signature verification — unsigned packages are refused
- Manifest validation and permission legality checks
- **Process-level sandboxing** — not worker threads. For untrusted code, isolation is not enough.
- Per-plugin resource ceilings and rate limits
- The 7-day trial period with prominent activity logging

## What community plugins may NEVER do

Enforced in the kernel, not the plugin host — a host bug must not open these doors:

modify FRIDAY's code, configuration, or Guardian policies · read or write the event log directly ·
access credentials they did not provide · read `secret` memory · register or alter risk classes ·
grant themselves permissions · suppress notifications · access another plugin's data · reach
undeclared hosts · perform `critical` actions

## Rules

1. **Every permission requires a written justification**, approved individually at install.
2. **Installing a plugin is a `high` risk action** requiring approval, permanently audited.
3. **The Guardian evaluates both** the action's normal policy **and** the plugin's grant. Both must
   allow.

Reference: [Chapter 15](../../docs/01-bible/15-plugin-system.md)
