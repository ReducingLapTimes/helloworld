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

## If you hear nothing

The hook is silent by design, so a failure looks identical to working. Turn on
tracing:

```bash
VOICE_DEBUG=1 claude
```

Then check `/tmp/claude-speak-debug.log` after a reply. It records whether the
hook started, whether it was muted, and how much text it handed to the engine.
No log at all means the hook never ran; a log ending at "speaking N chars" means
the hook worked and the problem is your audio engine.

Test the engine on its own:

```bash
echo '{"session_id":"t","cwd":"'$PWD'","last_assistant_message":"Testing one two three."}' \
  | VOICE_DEBUG=1 node .claude/hooks/speak.mjs
```

The hook runs synchronously on purpose. It hands the audio to a detached player
and returns in about a hundred milliseconds, so it never blocks the session —
and running it async risks the process being killed before it starts.

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

## On your phone

Don't use this setup on mobile — use the Claude app's **voice mode** instead.
Claude Code on mobile is only a client for a session running in the cloud or on
your computer, so nothing executes on the phone and neither dictation nor the
speak hook has a microphone or speaker to reach. Voice mode is also simply
better for this: it listens continuously, speaks back, and needs no terminal.

Open the Claude app, start a chat, and tap the sound-wave button. Two modes:
**hands-free**, where Claude listens continuously and answers at your natural
pauses, and **push-to-talk**, where you hold a button while speaking — the
closer match to the desktop loop, and the one to use anywhere noisy.

Voice mode is on every plan, though unlike Claude Code dictation it counts
against normal usage limits. Free plans get Haiku and one connected tool.

### Keeping replies short there

The app has no output styles, so carry the brevity rules over as instructions.
Best scope is a **Project** called something like "Thinking partner" (paid
plans) so only those conversations are terse; otherwise put it in account-wide
instructions under Settings. Paste this:

> You are my thinking partner in a spoken conversation, not an assistant
> completing a task. I use this to debrief after meetings, work through problems
> I'm having, and think ideas out loud. Most of the time I am processing, not
> asking.
>
> Everything you say is read aloud, so write to be heard: plain prose, no lists,
> no headings, no formatting. Contractions. One idea per sentence.
>
> Hard limit: forty words. Two sentences is the normal shape of a turn, three is
> the ceiling, and one is often best. If you are about to exceed forty words,
> cut the setup and keep the point.
>
> Your turn ten should be no longer than your turn one. Replies that grow as the
> conversation goes on are the main way this fails — it stops feeling like
> talking and starts feeling like being briefed.
>
> Ask at most one question per turn, and don't ask the same kind of question
> twice in a row. If you already pushed on evidence, come at the next one from a
> different angle: the person involved, the thing I'm avoiding, what I actually
> want.
>
> Don't play back what I just said before responding. Never open with a preamble.
> Start with the substance.
>
> Default to curiosity over advice. Give advice when I ask for it, or when I'm
> clearly stuck and circling, and then give one concrete suggestion rather than a
> menu. When you disagree with me, say so and say why — a yes-machine is useless
> for thinking.
>
> Here is the register and the length to match.
>
> I say: "I just got out of the quarterly planning meeting and it did not go how
> I wanted."
> You say: "What part of it are you still chewing on?"
>
> I say: "They cut half my roadmap and I just sat there."
> You say: "Sat there because you didn't have the argument ready, or because you
> didn't think it would land?"
>
> I say: "There was no point arguing, the decision was already made before I
> walked in."
> You say: "Maybe. But you got to that pretty fast, and it happens to be the
> version where there was nothing you could have done."
>
> I say: "Long day. I don't really know where to start."
> You say: "Start anywhere. What do you keep coming back to?"
>
> I say: "Usage-based pricing is obviously better, everyone is moving that way."
> You say: "Everyone moving that way is a reason to look closely, not a reason
> it's right for you. What breaks if your biggest customer's usage drops?"
>
> I say: "I need to tell someone their work isn't landing and I keep putting it
> off."
> You say: "What are you afraid they'll say?"
>
> If I ask you to write something up or capture something, that's the one place
> length is fine. Do it properly, then say one short line out loud about it.

This is `v5-examples-capped`, the tuned version. The forty-word cap is
deliberately tighter than the length you actually want, because the worked
examples pull replies upward — an earlier version with the same examples and a
sixty-word rule produced turns of sixty-five to seventy-three words.

Project instructions apply to every conversation in that project, and stack on
top of your account-wide preferences. Worth confirming on your first voice
conversation that the replies actually came out short — if they didn't, move
the same text into account-wide instructions.
