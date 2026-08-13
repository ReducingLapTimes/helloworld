---
name: talk
description: Mute or unmute Claude's spoken replies during a voice conversation. Use when the user says "mute", "stop talking", "quiet", "voice off", or wants speech turned back on.
---

Toggle spoken replies by creating or removing the `.claude/.voice-off` marker
file that the Stop hook checks.

- Mute (`/talk off`, "mute", "be quiet"): `touch .claude/.voice-off`
- Unmute (`/talk on`, "speak again"): `rm -f .claude/.voice-off`
- No argument: check whether `.claude/.voice-off` exists and flip it.

Then confirm in one short sentence — "Muted." or "Talking again." — and nothing
else. Do not explain the mechanism unless asked.

Muting only stops the audio. Dictation and the conversation itself keep working,
and replies still appear as text.
