# Tuning the instructions

An eval harness for the thinking-partner prompt. It runs each candidate
instruction set through multi-turn conversations with a simulated user, scores
every reply, and ranks the candidates.

```bash
node evals/harness.mjs --dry-run                    # plan and call count, no spend
node evals/harness.mjs                              # full sweep
node evals/harness.mjs --candidates v1,v4 --turns 6 # narrower
node evals/harness.mjs --judge                      # add the LLM judge
```

Reports and full transcripts land in `evals/results/`.

## What it measures

Everything here is deterministic and computed from the reply text:

| Metric | Why it matters |
| :-- | :-- |
| mean words, p90, % over target | The core constraint. p90 catches the occasional monologue that the mean hides |
| % turns with 2+ questions | Two questions makes you pick one, and the other is lost |
| % markdown | Bullets and headings are unspeakable, and a sign the model reverted to assistant mode |
| % preamble | "That's a great question" — burns the opening of a spoken turn |
| % playback | Trigram overlap with your previous turn: repeating you back instead of responding |
| drift | Mean words in the last third of a conversation over the first third. **The most useful number here** |

Drift is the one that changes decisions. Prompts almost always comply on turn
one and bloat by turn eight, and a single-turn eval would call that a pass. It
needs at least six turns to compute; below that it reports `—` and contributes
nothing to the ranking.

`--judge` adds a separate Claude call scoring each transcript 1-5 on question
quality, pushback against weak assumptions, patience before advising, and
register. It's noisier than the mechanical metrics — treat it as a tiebreaker
between candidates that already comply, not as a verdict.

## What it can't measure

The simulated user is a caricature, not you. It can tell you which prompt keeps
replies short under pressure, which is genuinely most of the problem. It cannot
tell you whether the question Claude asked was the one *you* needed, because
that depends on your situation and your taste.

The intended split: let the harness rank candidates on compliance and drift,
then take the top two into real conversations for a day and pick by feel.

## Tuning from the Claude app instead

The harness needs to make hundreds of calls, so it can't run inside a claude.ai
chat project — that sandbox has no outbound network. Two routes that don't need
a terminal:

**Run this harness from the Code tab.** A cloud session in the Claude app has an
authenticated `claude` CLI, so you can open the repo there, say "run the eval
sweep," and read the report on your phone. Same app as your conversations, just
the Code tab rather than Chat.

**Score real transcripts in a chat project.** `transcript-scorer.md` is an
instruction set for a second project. Paste a transcript from a real voice
conversation and it computes the same metrics using code execution — which needs
no network — then applies the judge rubric and recommends one edit.

The second is the better feedback loop, because it scores conversations you
actually had rather than ones a simulated user invented. Use the harness to rank
candidates before you commit to one, and the scorer to keep tuning the one you're
living with.

## Fidelity caveat

The harness drives `claude -p --system-prompt <candidate>`, which is Claude Code
headless with the built-in system prompt replaced. That approximates a bare chat
model but is not identical to claude.ai Projects, and voice mode may differ
again. Results transfer directionally — a prompt that drifts badly here will
drift there. Exact word counts won't match.

## Cost

Every call goes through your existing `claude` login, so this runs on your
**subscription** — there is no API key involved and nothing is billed. What a
sweep actually consumes is your rate limits: the rolling usage window and the
weekly cap.

The `total_cost_usd` figure the run prints is an API-equivalent valuation of the
tokens, not a charge. Read it as a relative measure — useful for comparing a
Haiku subject run against a Sonnet one, not as money.

A full sweep is 4 candidates x 4 scenarios x 8 turns, which is 240 calls, most
on Sonnet, with context growing as each conversation resumes. That is enough to
eat a noticeable share of a usage window, so start it when you don't need Claude
for something else. If you do hit a limit mid-run, calls fail, the harness counts
the errors and keeps going, and you get a partial report rather than a crash.

`--dry-run` prints the call count before you commit anything. To spend less: fewer
scenarios, fewer turns (but keep at least six, or drift can't be measured), or
`--model claude-haiku-4-5-20251001` for a cheaper subject.

## Adding candidates

Drop a `.md` file in `candidates/`. The filename is the label in the report, and
the file body is used verbatim as the system prompt.

The four shipped candidates are a real experiment, not filler:

- `v1-baseline` — the instructions currently in `VOICE.md`
- `v2-terser` — same rules, tighter limits (one to two sentences, thirty words)
- `v3-minimal` — four lines of role, no rules. Tests whether the long ruleset earns its length
- `v4-examples` — baseline rules plus worked examples of good turns

The interesting question is whether v4 beats v1. Rules tell the model what not
to do; examples show it the register to hit. For tone, examples usually win.

## Adding scenarios

`scenarios.json` entries have an `opening`, a `persona` for the simulated user,
and a `pressure` field describing a moment designed to break a bad prompt — a
weak assumption stated as fact, or a turn that rewards patience. The pressure
field is what makes the eval discriminating; without it every candidate looks
fine.
