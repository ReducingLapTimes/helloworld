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

## Fidelity caveat

The harness drives `claude -p --system-prompt <candidate>`, which is Claude Code
headless with the built-in system prompt replaced. That approximates a bare chat
model but is not identical to claude.ai Projects, and voice mode may differ
again. Results transfer directionally — a prompt that drifts badly here will
drift there. Exact word counts won't match.

## Cost

Every call goes through your `claude` login and counts against your usage. A
full sweep is 4 candidates x 4 scenarios x 8 turns, which is 240 calls and ran
around $10 in testing. `--dry-run` prints the call count before you commit, and
the run reports actual spend at the end.

To cut cost: fewer scenarios, fewer turns (but keep at least six for drift), or
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
