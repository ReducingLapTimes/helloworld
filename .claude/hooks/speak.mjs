#!/usr/bin/env node
// Stop hook: speaks Claude's reply aloud.
//
// Claude Code passes the finished turn on stdin as JSON, including
// `last_assistant_message`. We strip the markdown, then hand the text to a
// text-to-speech engine. Runs async so the session never waits on audio.
//
// Engine order: ElevenLabs (if ELEVENLABS_API_KEY is set) -> OS built-in.
// Disable at any time by creating .claude/.voice-off in the project.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_SPOKEN_CHARS = Number(process.env.VOICE_MAX_CHARS || 700);

const read = (stream) =>
  new Promise((resolve) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => (data += chunk));
    stream.on('end', () => resolve(data));
  });

// Markdown is written for eyes. Everything here exists to stop the engine from
// reading punctuation, or worse, an entire code block, out loud.
function toSpeech(markdown) {
  let text = markdown;
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/https?:\/\/\S+/g, 'a link');
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/^\s*#{1,6}\s*/gm, '');
  text = text.replace(/^\s*>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+[.)]\s+/gm, '');
  text = text.replace(/^\s*([-*_)]\s*){3,}\s*$/gm, ' ');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// A runaway reply should not become a two-minute monologue you have to sit
// through. Cut at the last sentence boundary that fits.
function trimToLimit(text, limit) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  return lastStop > limit * 0.4 ? head.slice(0, lastStop + 1) : head.trimEnd();
}

// Barging in with a new answer should cut off the previous one.
function stopPreviousSpeech(pidFile) {
  if (!existsSync(pidFile)) return;
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    if (pid > 0) process.kill(-pid, 'SIGTERM');
  } catch {
    // Already gone, or never started. Either way there is nothing to stop.
  }
  try {
    unlinkSync(pidFile);
  } catch {}
}

function launch(command, args, pidFile) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  try {
    writeFileSync(pidFile, String(child.pid));
  } catch {}
}

function speakWithOsVoice(text, pidFile) {
  if (process.platform === 'darwin') {
    const args = [];
    if (process.env.VOICE_NAME) args.push('-v', process.env.VOICE_NAME);
    if (process.env.VOICE_RATE) args.push('-r', process.env.VOICE_RATE);
    launch('say', [...args, text], pidFile);
    return;
  }

  if (process.platform === 'win32') {
    const escaped = text.replace(/'/g, "''");
    const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('${escaped}')`;
    launch('powershell', ['-NoProfile', '-Command', script], pidFile);
    return;
  }

  // Linux: prefer the speech-dispatcher front end, fall back to espeak-ng.
  const rate = process.env.VOICE_RATE || '0';
  launch('sh', ['-c', `spd-say -w -r ${rate} "$1" 2>/dev/null || espeak-ng "$1"`, 'sh', text], pidFile);
}

async function speakWithElevenLabs(text, pidFile) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5';
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: modelId }),
    },
  );
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);

  const file = join(tmpdir(), `claude-speak-${process.pid}.mp3`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));

  const player =
    process.platform === 'darwin'
      ? `afplay "$1"`
      : process.platform === 'win32'
        ? `powershell -NoProfile -c "(New-Object Media.SoundPlayer '$1').PlaySync()"`
        : `mpv --no-video --really-quiet "$1" 2>/dev/null || ffplay -nodisp -autoexit -loglevel quiet "$1"`;
  launch('sh', ['-c', `${player}; rm -f "$1"`, 'sh', file], pidFile);
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await read(process.stdin));
  } catch {
    return;
  }

  const projectDir = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (existsSync(join(projectDir, '.claude', '.voice-off'))) return;

  const message = payload.last_assistant_message;
  if (typeof message !== 'string' || !message.trim()) return;

  const spoken = trimToLimit(toSpeech(message), MAX_SPOKEN_CHARS);
  if (!spoken) return;

  const pidFile = join(tmpdir(), `claude-speak-${payload.session_id || 'default'}.pid`);
  stopPreviousSpeech(pidFile);

  if (process.env.ELEVENLABS_API_KEY) {
    try {
      await speakWithElevenLabs(spoken, pidFile);
      return;
    } catch {
      // Network down, bad key, quota spent — fall through to the OS voice
      // rather than dropping the reply silently.
    }
  }
  speakWithOsVoice(spoken, pidFile);
}

// A broken hook must never break the conversation.
main().catch(() => {});
