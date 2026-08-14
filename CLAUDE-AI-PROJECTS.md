# The chat-only setup

Everything here runs in the Claude app or on claude.ai. No terminal, no repo, no
Claude Code. If this is the way you want to work, you need two projects and
nothing else in this repository.

The rest of the repo is the Claude Code version of the same idea, and you can
ignore it.

## Project 1: Thinking partner

The conversation itself.

1. **Projects → Create project**, named `Thinking partner`
2. Open it, find **Instructions**, and paste the whole of
   [INSTRUCTIONS.md](INSTRUCTIONS.md)
3. Start a new chat **inside the project**, then tap the sound-wave button

Starting a chat from the home screen instead of inside the project is the one
mistake that matters — the instructions won't apply, you'll get long replies, and
it looks like the setup failed.

Voice mode gives you hands-free (Claude listens continuously and answers at your
pauses) and push-to-talk (hold while speaking). Hands-free is right walking out
of a meeting; push-to-talk anywhere noisy.

## Project 2: Prompt tuning

The feedback loop. Without this the instructions never improve, because you'll
notice a conversation felt flat and have no idea which line caused it.

1. **Create project**, named `Prompt tuning`
2. Paste [evals/transcript-scorer.md](evals/transcript-scorer.md) as its
   instructions
3. After a conversation that felt off, copy the transcript out of the chat and
   paste it here

It computes real metrics with code execution rather than eyeballing them, applies
a judge rubric, quotes the worst turn, and recommends exactly one edit to
Project 1's instructions. One edit at a time is the point — change five things
and you can't tell which one worked.

Keep the two projects separate. Asking the thinking partner to critique its own
instructions mid-conversation breaks the thing you're there for.

## Keeping your notes

In Claude Code, "write that up" saves a file in the repo. In chat you get an
artifact instead. To make notes accumulate rather than scatter across
conversations, save the artifact into the project's knowledge — later
conversations can then refer back to what you worked through last week.

## What you give up

Honestly, not much for this use case:

| Claude Code version | Chat project version |
| :-- | :-- |
| `/voice` dictation, free of tokens | Voice mode, counts toward your usage |
| Speak hook with a choice of TTS engine | Native voice, no setup, no engine to install |
| Output style | Project instructions |
| Notes written to files in a repo | Artifacts, savable to project knowledge |
| Offline eval harness over 240 conversations | Scoring real transcripts, one at a time |
| Works only at a desk, on Windows or WSL | Works anywhere, including walking |

The one real loss is the harness. It can rank four candidate prompts against
each other overnight, which the chat loop can't. But it ranks them against a
simulated user, and the chat loop scores conversations you actually had — so for
tuning the prompt you live with day to day, the chat loop is arguably the better
instrument.

## Requirements

Projects need a paid plan. On Free, put the thinking-partner text in
**Settings → Instructions** instead; it applies account-wide, so every Claude
conversation gets terser, and you skip Project 2 entirely.
