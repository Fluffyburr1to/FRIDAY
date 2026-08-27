# docs/reviews/ — What we checked before letting something out

**Charter.** A disclosure review is the record of what a connector sends, to whom, under what
conditions, and what it does not send — written down before that connector is allowed to make a real
call, and kept afterwards so the answer does not have to be reconstructed from code.

**Every connector gets one before its first real request.** Chapter 14 makes connectors the only
components with network access; this folder is where that access is examined rather than assumed.

## What belongs here

- One review per connector, numbered, recording the outbound disclosure in full
- What was **verified**, what was **assumed**, and what remains **unverified** — kept apart
- Any real-call proposal, what it would disclose, and the owner's decision

## What does NOT

- Design decisions. Those are ADRs. A review records what a thing *does*, not what it *should* do.
- Provider documentation. Summarise and link; do not mirror.
- Anything a connector's README already says better. Link to it.

## The rule that makes a review worth writing

★ **An unverified claim is recorded as unverified.** A review that reads as confirmation, but rests
on someone's reading of a documentation page, is worse than no review — it converts a guess into
evidence and puts a name against it.

Reference: [Chapter 14](../01-bible/14-connector-framework.md) · Constitution Article IV
