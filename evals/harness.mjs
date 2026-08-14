#!/usr/bin/env node
// Eval harness for the thinking-partner instructions.
//
// Runs each candidate instruction set through multi-turn conversations with a
// simulated user, then scores the replies. The simulated user is another Claude
// call driven by a persona from scenarios.json.
//
//   node evals/harness.mjs                          # all candidates, all scenarios
//   node evals/harness.mjs --candidates v1,v4       # substring match on filename
//   node evals/harness.mjs --turns 6 --judge        # shorter runs, add the LLM judge
//   node evals/harness.mjs --dry-run                # show the plan and cost estimate
//
// Everything runs through the `claude` CLI, so it uses your existing login. Each
// conversation gets its own session id, because CLAUDE_CODE_SESSION_ID is
// inherited from the parent and would otherwise make every run share a session.

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');

const args = parseArgs(process.argv.slice(2));
const TURNS = Number(args.turns || 8);
const CONCURRENCY = Number(args.concurrency || 3);
const SUBJECT_MODEL = args.model || 'claude-sonnet-5';
const SIM_MODEL = args['sim-model'] || 'claude-haiku-4-5-20251001';
const WORD_TARGET = Number(args['word-target'] || 60);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------- claude calls

// The parent session's id leaks in through the environment. Left alone, every
// conversation below would resume the same session and contaminate the results.
const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.CLAUDE_CODE_SESSION_ID;

function claude(cliArgs) {
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      cliArgs,
      { env: CLEAN_ENV, maxBuffer: 32 * 1024 * 1024, timeout: 300_000 },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Unparseable CLI output: ${String(stdout).slice(0, 300)}`));
        }
      },
    );
  });
}

const stats = { calls: 0, costUsd: 0, errors: 0 };

async function ask({ prompt, systemPrompt, sessionId, resume, model }) {
  const cliArgs = ['-p', prompt, '--output-format', 'json', '--model', model];
  if (resume) cliArgs.push('--resume', sessionId);
  else cliArgs.push('--session-id', sessionId);
  if (systemPrompt) cliArgs.push('--system-prompt', systemPrompt);

  const res = await claude(cliArgs);
  stats.calls++;
  stats.costUsd += res.total_cost_usd || 0;
  if (res.is_error) throw new Error(res.result || 'CLI reported an error');
  return String(res.result || '').trim();
}

// --------------------------------------------------------------------- scoring

const PREAMBLES = [
  /^(that'?s|what) a (great|good|really good|fair|interesting) (question|point)/i,
  /^it sounds like/i,
  /^what i'?m hearing/i,
  /^i hear you/i,
  /^that makes (a lot of )?sense/i,
  /^i can (hear|see|tell) (that|how)/i,
  /^so,? (you'?re|what you'?re)/i,
  /^thank you for sharing/i,
];

const MARKDOWN = /(^|\n)\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>\s)|\*\*[^*]+\*\*|```|\n\s*\|/;

function words(text) {
  return text.split(/\s+/).filter(Boolean);
}

function trigrams(text) {
  const w = words(text.toLowerCase().replace(/[^\w\s]/g, ''));
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(' '));
  return out;
}

// Echoing the user's own words back at them is the most common way these
// prompts fail: it reads as empathetic and wastes the whole turn.
function playbackScore(userText, replyText) {
  const opener = words(replyText).slice(0, 25).join(' ');
  const a = trigrams(userText);
  const b = trigrams(opener);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const g of b) if (a.has(g)) hits++;
  return hits / b.size;
}

function scoreTurn(reply, userText) {
  const wordCount = words(reply).length;
  return {
    words: wordCount,
    overTarget: wordCount > WORD_TARGET,
    questions: (reply.match(/\?/g) || []).length,
    multiQuestion: (reply.match(/\?/g) || []).length > 1,
    markdown: MARKDOWN.test(reply),
    preamble: PREAMBLES.some((re) => re.test(reply.trim())),
    playback: playbackScore(userText, reply) > 0.25,
  };
}

function pct(list, key) {
  return list.length ? (100 * list.filter((t) => t[key]).length) / list.length : 0;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Drift needs enough turns to mean anything, and it has to be measured within a
// single conversation — pooling turns across conversations first would compare
// one conversation's opening to another's ending.
const MIN_TURNS_FOR_DRIFT = 6;

function conversationDrift(turns) {
  if (turns.length < MIN_TURNS_FOR_DRIFT) return null;
  const third = Math.floor(turns.length / 3);
  const early = mean(turns.slice(0, third).map((t) => t.words));
  const late = mean(turns.slice(-third).map((t) => t.words));
  if (!early) return null;
  // The absolute figures travel with the ratio because the ratio alone lies
  // when turns are short: an opener of six words followed by a perfectly good
  // twenty-word reply reads as 3.3x drift and nothing is wrong.
  return { ratio: late / early, early, late };
}

function summarize(turns, drifts) {
  const counts = turns.map((t) => t.words).sort((a, b) => a - b);
  const measured = drifts.filter((d) => d != null);

  return {
    turns: turns.length,
    meanWords: mean(counts),
    p90Words: counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.9))] : 0,
    overTargetPct: pct(turns, 'overTarget'),
    multiQuestionPct: pct(turns, 'multiQuestion'),
    markdownPct: pct(turns, 'markdown'),
    preamblePct: pct(turns, 'preamble'),
    playbackPct: pct(turns, 'playback'),
    // Prompts routinely pass on turn one and bloat by turn eight. This is the
    // ratio that catches it. Null when the runs were too short to tell.
    drift: measured.length ? mean(measured.map((d) => d.ratio)) : null,
    earlyWords: measured.length ? mean(measured.map((d) => d.early)) : null,
    lateWords: measured.length ? mean(measured.map((d) => d.late)) : null,
  };
}

// Lower is better. Length compliance and the one-question rule carry the most
// weight because they are what make a spoken conversation feel alive.
function penalty(s) {
  return (
    s.overTargetPct * 1.0 +
    s.multiQuestionPct * 0.8 +
    s.playbackPct * 0.6 +
    s.preamblePct * 0.6 +
    s.markdownPct * 1.2 +
    // Only penalise growth that ends somewhere long. Below half the word
    // target the replies are still short in absolute terms, whatever the
    // ratio says, and penalising that would push prompts toward openers so
    // terse they can never grow.
    ((s.lateWords ?? 0) > WORD_TARGET * 0.5
      ? Math.min(1.5, Math.max(0, (s.drift ?? 1) - 1)) * 40
      : 0)
  );
}

// ------------------------------------------------------------------ simulation

const SIM_SYSTEM = `You are role-playing a human in a spoken conversation with an AI thinking partner. You are the HUMAN, never the assistant.

Rules:
- Reply with only what the person says out loud. No narration, no quotation marks, no stage directions.
- Keep it to one to three sentences, the way real speech goes.
- Stay in character even if the assistant is unhelpful. Do not become agreeable or wrap the conversation up early.
- Never break character to comment on the assistant's performance.`;

async function nextUserTurn(scenario, transcript, turnIndex) {
  const history = transcript
    .map((t) => `${t.role === 'user' ? 'ME' : 'PARTNER'}: ${t.text}`)
    .join('\n');

  const prompt = `${scenario.persona}

${scenario.pressure}

This is turn ${turnIndex + 1} of the conversation so far:

${history}

What do you say next? Reply with only your spoken words.`;

  return ask({ prompt, systemPrompt: SIM_SYSTEM, sessionId: randomUUID(), model: SIM_MODEL });
}

async function runConversation(candidate, scenario) {
  const sessionId = randomUUID();
  const transcript = [];
  const scored = [];

  let userText = scenario.opening;
  for (let i = 0; i < TURNS; i++) {
    transcript.push({ role: 'user', text: userText });

    const reply = await ask({
      prompt: userText,
      systemPrompt: candidate.text,
      sessionId,
      resume: i > 0,
      model: SUBJECT_MODEL,
    });

    transcript.push({ role: 'assistant', text: reply });
    scored.push(scoreTurn(reply, userText));

    if (i < TURNS - 1) userText = await nextUserTurn(scenario, transcript, i);
  }

  return { candidate: candidate.name, scenario: scenario.id, transcript, scored };
}

// ----------------------------------------------------------------- LLM judging

const JUDGE_SYSTEM = `You evaluate transcripts of an AI acting as a spoken thinking partner. You are strict. Most transcripts are mediocre and should score 3 or below. Reply with JSON only, no prose around it.`;

async function judge(conversation) {
  const text = conversation.transcript
    .map((t) => `${t.role === 'user' ? 'PERSON' : 'PARTNER'}: ${t.text}`)
    .join('\n\n');

  const prompt = `Score this transcript on four dimensions, 1 to 5.

question_quality: Did the partner's questions open something the person had skated past, or were they generic prompts that any transcript could have received?
pushback: The person states at least one weak or unexamined assumption. Did the partner test it, or accept it to keep things pleasant?
patience: Did the partner let the person think, or rush to advice and solutions before they had finished?
register: Did this read like a perceptive friend talking, or like an assistant producing output?

Transcript:

${text}

Reply with only this JSON shape:
{"question_quality":N,"pushback":N,"patience":N,"register":N,"note":"one sentence on the single biggest weakness"}`;

  const raw = await ask({ prompt, systemPrompt: JUDGE_SYSTEM, sessionId: randomUUID(), model: SUBJECT_MODEL });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Judge did not return JSON');
  return JSON.parse(match[0]);
}

// --------------------------------------------------------------------- running

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        stats.errors++;
        results[index] = { error: String(err.message || err), ...items[index] };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function loadCandidates(filter) {
  return readdirSync(join(HERE, 'candidates'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f.replace(/\.md$/, ''), text: readFileSync(join(HERE, 'candidates', f), 'utf8').trim() }))
    .filter((c) => !filter || filter.split(',').some((needle) => c.name.includes(needle.trim())));
}

function table(rows, columns) {
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const rule = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => c.get(r)).join(' | ')} |`).join('\n');
  return [header, rule, body].join('\n');
}

async function main() {
  const scenarios = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8')).filter(
    (s) => !args.scenarios || args.scenarios === 'all' || args.scenarios.split(',').some((n) => s.id.includes(n.trim())),
  );
  const candidates = loadCandidates(args.candidates);

  if (!candidates.length) throw new Error('No candidates matched');
  if (!scenarios.length) throw new Error('No scenarios matched');

  const jobs = candidates.flatMap((c) => scenarios.map((s) => ({ candidate: c, scenario: s })));
  const subjectCalls = jobs.length * TURNS;
  const simCalls = jobs.length * (TURNS - 1);
  const judgeCalls = args.judge ? jobs.length : 0;

  console.log(`Candidates: ${candidates.map((c) => c.name).join(', ')}`);
  console.log(`Scenarios:  ${scenarios.map((s) => s.id).join(', ')}`);
  console.log(`Plan:       ${jobs.length} conversations x ${TURNS} turns`);
  console.log(`Calls:      ${subjectCalls} subject (${SUBJECT_MODEL}) + ${simCalls} simulated user (${SIM_MODEL})${judgeCalls ? ` + ${judgeCalls} judge` : ''} = ${subjectCalls + simCalls + judgeCalls}\n`);

  if (args['dry-run']) return;

  const started = Date.now();
  const conversations = await pool(jobs, CONCURRENCY, async (job) => {
    const convo = await runConversation(job.candidate, job.scenario);
    process.stdout.write(`  done: ${job.candidate.name} / ${job.scenario.id}\n`);
    return convo;
  });

  const ok = conversations.filter((c) => !c.error);
  if (args.judge) {
    await pool(ok, CONCURRENCY, async (convo) => {
      convo.judgement = await judge(convo);
    });
  }

  // ----- report
  const byCandidate = candidates
    .map((c) => {
      const mine = ok.filter((r) => r.candidate === c.name);
      const turns = mine.flatMap((r) => r.scored);
      if (!turns.length) return null;
      const summary = summarize(turns, mine.map((r) => conversationDrift(r.scored)));
      const judgements = mine.map((r) => r.judgement).filter(Boolean);
      const avg = (key) =>
        judgements.length ? judgements.reduce((a, j) => a + (j[key] || 0), 0) / judgements.length : null;
      return {
        name: c.name,
        ...summary,
        penalty: penalty(summary),
        judge: judgements.length
          ? {
              question_quality: avg('question_quality'),
              pushback: avg('pushback'),
              patience: avg('patience'),
              register: avg('register'),
              notes: judgements.map((j) => j.note),
            }
          : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.penalty - b.penalty);

  const n = (x, d = 1) => (x == null ? '—' : x.toFixed(d));
  let report = `# Thinking-partner eval\n\n`;
  report += `${jobs.length} conversations, ${TURNS} turns each, subject model \`${SUBJECT_MODEL}\`.\n`;
  report += `Word target: ${WORD_TARGET}. Ranked by penalty, lower is better.\n\n`;
  report += `## Mechanical compliance\n\n`;
  report += table(byCandidate, [
    { label: 'candidate', get: (r) => r.name },
    { label: 'penalty', get: (r) => n(r.penalty, 0) },
    { label: 'mean words', get: (r) => n(r.meanWords) },
    { label: 'p90', get: (r) => n(r.p90Words, 0) },
    { label: `% over ${WORD_TARGET}w`, get: (r) => n(r.overTargetPct, 0) },
    { label: '% 2+ questions', get: (r) => n(r.multiQuestionPct, 0) },
    { label: '% markdown', get: (r) => n(r.markdownPct, 0) },
    { label: '% preamble', get: (r) => n(r.preamblePct, 0) },
    { label: '% playback', get: (r) => n(r.playbackPct, 0) },
    { label: 'words early→late', get: (r) => (r.earlyWords == null ? '—' : `${n(r.earlyWords, 0)}→${n(r.lateWords, 0)}`) },
    { label: 'drift', get: (r) => n(r.drift, 2) },
  ]);

  if (args.judge) {
    report += `\n\n## Judged quality (1-5, higher is better)\n\n`;
    report += table(byCandidate, [
      { label: 'candidate', get: (r) => r.name },
      { label: 'questions', get: (r) => n(r.judge?.question_quality) },
      { label: 'pushback', get: (r) => n(r.judge?.pushback) },
      { label: 'patience', get: (r) => n(r.judge?.patience) },
      { label: 'register', get: (r) => n(r.judge?.register) },
    ]);
    report += `\n\n### Judge notes\n\n`;
    for (const r of byCandidate) {
      for (const note of r.judge?.notes || []) report += `- **${r.name}**: ${note}\n`;
    }
  }

  report += `\n\n## Worst turns\n\n`;
  const offenders = [];
  for (const convo of ok) {
    convo.scored.forEach((s, i) => {
      if (s.overTarget || s.multiQuestion || s.markdown || s.preamble || s.playback) {
        const flags = Object.entries(s)
          .filter(([k, v]) => v === true)
          .map(([k]) => k);
        offenders.push({ ...convo, turn: i, flags, words: s.words, text: convo.transcript[i * 2 + 1].text });
      }
    });
  }
  offenders.sort((a, b) => b.words - a.words);
  for (const o of offenders.slice(0, 12)) {
    report += `**${o.candidate}** / ${o.scenario} / turn ${o.turn + 1} — ${o.words} words, ${o.flags.join(', ')}\n\n> ${o.text.replace(/\n/g, '\n> ')}\n\n`;
  }
  if (!offenders.length) report += `None. Every turn passed every mechanical check.\n`;

  mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date(started).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(join(RESULTS, `${stamp}-report.md`), report);
  writeFileSync(join(RESULTS, `${stamp}-transcripts.json`), JSON.stringify(conversations, null, 2));

  console.log(`\n${report}`);
  console.log(
    `\n${stats.calls} calls, ${stats.errors} errors, ${Math.round((Date.now() - started) / 1000)}s` +
      (stats.costUsd ? `, $${stats.costUsd.toFixed(2)}` : ''),
  );
  console.log(`Written to evals/results/${stamp}-report.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
