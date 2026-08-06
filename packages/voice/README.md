# @friday/voice

**Speaking and listening — entirely on your machine.**

Milestone: **M7**

## Charter

> **Audio never leaves your machine. Ever. Under any configuration.**

Wake word, transcription, and synthesis all run locally as sealed child processes. What may leave —
subject to the same rules as any other request — is *text*, after the audio has been converted on
your Mac and discarded.

## What lives here

- openWakeWord (rolling 2s buffer, continuously overwritten, never written to disk)
- whisper.cpp transcription — **raw audio destroyed immediately after**
- Piper local synthesis; optional cloud voice for non-sensitive content only
- Streaming synthesis, so speech begins before the full answer exists
- Push-to-talk and tap-to-talk activation

## What does NOT

- Any intent handling — a transcript becomes an ordinary request to the Chief of Staff
- Any authentication. **Voice is not authentication** — speaker recognition is defeatable by
  recordings and synthesis. Voice identifies an utterance, never a person.

## Rules

1. **Push-to-talk is the default.** Wake word is opt-in, added once trust is earned, with the macOS
   microphone indicator always visible — an OS-level guarantee FRIDAY cannot suppress.
2. **`high` and `critical` approvals cannot be granted by voice.** Approval requires *seeing* the
   artifact. FRIDAY says "that needs your approval — I've sent it to your Mac."
3. **Hardware mute is respected absolutely.**
4. Perceived response under 2 seconds, or the interaction reads as broken.

Reference: [Chapter 25](../../docs/01-bible/25-voice-architecture.md)
