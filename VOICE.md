# Talking with Claude

A spoken conversation loop for debriefing after a meeting, coaching yourself
through a problem, or thinking an idea out loud.

**The loop:** tap `Space`, talk, tap `Space` again. Your speech is transcribed
and sent, and Claude's reply is spoken back to you in a few sentences. Then you
talk again.

## Requirements

- Claude Code **v2.1.116 or later** (`claude --version`) — tap mode landed there
- Signed in with a **Claude.ai account**. Dictation is unavailable on API-key,
  Bedrock, Vertex, or Foundry auth, and on HIPAA-enabled organizations
- A **local microphone**. Dictation does not work in Claude Code on the web or
  over SSH, because the mic is on your machine and Claude Code is not
- **Linux only:** a speech engine — `sudo apt install speech-dispatcher` or
  `sudo apt install espeak-ng`. macOS and Windows work out of the box

## Start a conversation

```bash
cd helloworld
claude
```

Dictation and the spoken replies are already configured in
`.claude/settings.json`. If dictation isn't active, run `/voice tap` once.

Then just talk:

- *"I just got out of the quarterly planning meeting and I want to debrief."*
- *"I'm stuck on how to tell my report their work isn't landing."*
- *"Let me think out loud about this pricing idea."*

At the end of a session, "write that up for me" saves notes to a file — Claude
does the long-form work in writing and only says a short line out loud.

### Controls

| Action | How |
| :-- | :-- |
| Start / send | Tap `Space` (prompt must be empty to start) |
| Mute the voice | `/talk off`, or say "mute" |
| Unmute | `/talk on` |
| Cut off a reply mid-sentence | Just start your next turn; new speech kills the old |
| Type instead | Type normally — voice and keyboard mix freely |

Prefer holding a key over tapping? Use `"mode": "hold"` with
`"autoSubmit": true` in the `voice` block: hold `Space` while you talk, release
to send.

## Tuning the voice

The default is your OS voice, which is instant and free. Set these in your
shell profile:

| Variable | Effect |
| :-- | :-- |
| `VOICE_NAME` | macOS voice name — `say -v '?'` lists them. Try `Ava (Premium)` |
| `VOICE_RATE` | Speaking rate. macOS words-per-minute, e.g. `190` |
| `VOICE_MAX_CHARS` | Cap on spoken characters per turn (default `700`) |
| `ELEVENLABS_API_KEY` | Use ElevenLabs instead — much better quality, small latency cost |
| `ELEVENLABS_VOICE_ID` | Which ElevenLabs voice to use |

On macOS, download a Premium or Enhanced voice under System Settings → Accessibility
→ Spoken Content → System Voice. It's a large step up from the default.

If ElevenLabs fails for any reason, the hook falls back to the OS voice rather
than dropping the reply.

## How it works

Three pieces, all in `.claude/`:

- **`output-styles/thinking-partner.md`** — rewrites the system prompt so Claude
  is a conversation partner rather than a coding assistant. This is what keeps
  replies to two to four sentences, in prose, with one question at a time.
  Brevity is a prompt problem, not an audio problem
- **`hooks/speak.mjs`** — a `Stop` hook. Claude Code hands it the finished turn
  as JSON, it strips the markdown, and pipes the text to a speech engine. Runs
  async, so the session never waits on audio
- **`settings.json`** — turns on tap-mode dictation, selects the output style,
  and wires up the hook

Dictation itself is native (`/voice`) and costs no tokens.

### Using it everywhere

To talk to Claude in any directory, copy the pieces into `~/.claude/` — the
`output-styles/` and `hooks/` directories work the same at user level. Merge the
`hooks` and `voice` blocks into `~/.claude/settings.json` and change
`${CLAUDE_PROJECT_DIR}` in the hook path to an absolute path. Leave `outputStyle`
out of your user settings unless you want every session to be conversational,
including coding ones.

## What this doesn't do

Claude waits for you to finish before it starts. There's no full duplex — you
can't interrupt a reply the way you can in ChatGPT's GPT-Live, because the hook
only fires once the turn is complete. Keeping replies short is what makes the
rhythm work, and it's why the output style is the important half of this setup.
