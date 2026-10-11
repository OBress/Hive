// Demo voiceover with Inworld TTS. Reads video/script.txt and writes:
//   video/audio/vo_<id>.wav   one clip per [segment], for FFrames (MediaDirectory::read_folder("audio"))
//   video/voice.json          timeline: where each clip starts, its length and word timings
//   video/voice-preview.wav   every clip joined with the gaps, to listen to the whole read
// Unchanged segments are reused, so editing one line only re-synthesizes that line.
//
// Usage: node video/tts.mjs [--dry] [--force] [--only <id>]
//   --dry    parse the script and estimate the length; no API key, no API calls
//   --force  re-synthesize every segment
//   --only   re-synthesize just this segment (implies --force for it)
// Needs INWORLD_API_KEY (the Base64 key from the Inworld portal) in the environment or the repo's .env.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = join(DIR, 'audio');
const MANIFEST = join(DIR, 'voice.json');
const PREVIEW = join(DIR, 'voice-preview.wav');
const ENDPOINT = 'https://api.inworld.ai/tts/v1/voice';
const MAX_SECONDS = 90;
const SAMPLE_RATE = 48000;
const MAX_CHARS = 2000; // Inworld's limit per request
const WORDS_PER_SECOND = 2.6; // rough speaking pace for --dry estimates

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

function parseScript(source) {
  const settings = { voice: 'Ashley', model: 'inworld-tts-2', rate: 1, lead: 0.5, gap: 0.4, tail: 1.5 };
  const segments = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const where = `script.txt line ${i + 1}`;
    if (!line || line.startsWith('#')) return;
    let m;
    if ((m = line.match(/^@(\w+)\s+(.+)$/))) {
      const [, key, value] = m;
      if (!(key in settings)) throw new Error(`${where}: unknown setting @${key}`);
      settings[key] = typeof settings[key] === 'number' ? Number(value) : value.trim();
      if (Number.isNaN(settings[key])) throw new Error(`${where}: @${key} needs a number`);
    } else if ((m = line.match(/^\[([\w-]+)(?:\s+\+(\d+(?:\.\d+)?))?\]$/))) {
      if (segments.some((s) => s.id === m[1])) throw new Error(`${where}: duplicate segment [${m[1]}]`);
      segments.push({ id: m[1], text: '', pause: Number(m[2] ?? 0) });
    } else {
      const seg = segments.at(-1);
      if (!seg) throw new Error(`${where}: text before the first [segment] header`);
      seg.text = seg.text ? `${seg.text} ${line}` : line;
    }
  });
  if (!segments.length) throw new Error('script.txt has no [segments]');
  for (const s of segments) {
    if (!s.text) throw new Error(`segment [${s.id}] has no text`);
    if (s.text.length > MAX_CHARS) throw new Error(`segment [${s.id}] is over ${MAX_CHARS} characters; split it`);
  }
  if (settings.rate < 0.5 || settings.rate > 1.5) throw new Error('@rate must be between 0.5 and 1.5');
  return { settings, segments };
}

// Total length = lead + clips + gaps (plus any [id +pause]) between clips + tail.
function layout(settings, durations, pauses = []) {
  let t = settings.lead;
  const starts = durations.map((d, i) => {
    if (i > 0) t += pauses[i] ?? 0;
    const start = t;
    t += d + (i < durations.length - 1 ? settings.gap : 0);
    return start;
  });
  return { starts, total: t + settings.tail };
}

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt, data;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (id === 'data') data = buf.subarray(o + 8, Math.min(buf.length, o + 8 + size));
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV is missing its fmt or data chunk');
  return { ...fmt, data, seconds: data.length / (fmt.rate * fmt.channels * (fmt.bits / 8)) };
}

function writeWav(path, { channels, rate, bits }, pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * (bits / 8), 28);
  header.writeUInt16LE(channels * (bits / 8), 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
}

function apiKey() {
  const envFile = join(DIR, '..', '.env');
  if (!process.env.INWORLD_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
  const key = process.env.INWORLD_API_KEY?.trim();
  if (!key) throw new Error('INWORLD_API_KEY is not set. Add INWORLD_API_KEY=<key> to the repo .env (it is gitignored).');
  return key;
}

async function synthesize(seg, settings, key) {
  const body = {
    text: seg.text,
    voiceId: settings.voice,
    modelId: settings.model,
    timestampType: 'WORD',
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, speakingRate: settings.rate },
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Basic ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const w = json.timestampInfo?.wordAlignment;
      const words = (w?.words ?? []).map((word, i) => ({
        word,
        start: round(w.wordStartTimeSeconds[i]),
        end: round(w.wordEndTimeSeconds[i]),
      }));
      return { wav: Buffer.from(json.audioContent, 'base64'), words };
    }
    const detail = (await res.text()).slice(0, 300);
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    throw new Error(`Inworld TTS ${res.status} on [${seg.id}]: ${detail}`);
  }
}

// Inworld returns spaces and punctuation as their own "words": drop blanks, attach punctuation
// to the word before it ("Hive" + ": " -> "Hive:"). Safe to run again on cleaned words.
function cleanWords(words) {
  const out = [];
  for (const w of words) {
    const word = w.word.trim();
    if (!word) continue;
    const prev = out.at(-1);
    if (!/[\p{L}\p{N}]/u.test(word) && prev) Object.assign(prev, { word: prev.word + word, end: w.end });
    else out.push({ ...w, word });
  }
  return out;
}

const round = (n) => Math.round(n * 1000) / 1000;
const hashOf = (seg, s) => createHash('sha1').update(JSON.stringify([seg.text, s.voice, s.model, s.rate, SAMPLE_RATE])).digest('hex').slice(0, 12);
const fileOf = (seg) => `vo_${seg.id}.wav`;

async function main() {
  const { settings, segments } = parseScript(readFileSync(join(DIR, 'script.txt'), 'utf8'));

  if (dry) {
    const estimates = segments.map((s) => s.text.split(/\s+/).length / WORDS_PER_SECOND / settings.rate);
    const { total } = layout(settings, estimates, segments.map((s) => s.pause));
    for (const [i, s] of segments.entries()) console.log(`${s.id.padEnd(12)} ~${estimates[i].toFixed(1)}s  ${s.text.split(/\s+/).length} words`);
    console.log(`\nestimated total ~${total.toFixed(1)}s of ${MAX_SECONDS}s (real length comes from the audio)`);
    return total > MAX_SECONDS ? 1 : 0;
  }

  const key = apiKey();
  if (only && !segments.some((s) => s.id === only)) throw new Error(`--only: no segment [${only}] in script.txt`);
  const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { segments: [] };
  mkdirSync(AUDIO_DIR, { recursive: true });

  const clips = [];
  for (const seg of segments) {
    const hash = hashOf(seg, settings);
    const path = join(AUDIO_DIR, fileOf(seg));
    const old = previous.segments.find((p) => p.id === seg.id);
    const reuse = !force && only !== seg.id && old?.hash === hash && existsSync(path);
    let words = old?.words ?? [];
    if (!reuse) {
      process.stdout.write(`synthesizing [${seg.id}]... `);
      const out = await synthesize(seg, settings, key);
      writeFileSync(path, out.wav);
      words = out.words;
    }
    const wav = readWav(readFileSync(path));
    console.log(`${reuse ? 'cached ' : ''}[${seg.id}] ${wav.seconds.toFixed(2)}s`);
    clips.push({ seg, hash, words: cleanWords(words), wav });
  }

  // Clips of segments removed from the script would otherwise still be loaded by the video.
  const keep = new Set(segments.map(fileOf));
  for (const f of readdirSync(AUDIO_DIR)) if (/^vo_.*\.wav$/.test(f) && !keep.has(f)) rmSync(join(AUDIO_DIR, f));

  const { starts, total } = layout(settings, clips.map((c) => c.wav.seconds), segments.map((s) => s.pause));
  const manifest = {
    note: 'Generated by video/tts.mjs from script.txt. Times in seconds; word times are relative to the segment start.',
    ...settings,
    sampleRate: SAMPLE_RATE,
    totalSeconds: round(total),
    segments: clips.map(({ seg, hash, words, wav }, i) => ({
      id: seg.id,
      file: fileOf(seg),
      start: round(starts[i]),
      duration: round(wav.seconds),
      end: round(starts[i] + wav.seconds),
      text: seg.text,
      hash,
      words,
    })),
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  // Preview: silence for lead/gaps/tail, then each clip at its start time.
  const fmt = clips[0].wav;
  const bytesPerSecond = fmt.rate * fmt.channels * (fmt.bits / 8);
  const frame = fmt.channels * (fmt.bits / 8);
  const at = (sec) => Math.round((sec * bytesPerSecond) / frame) * frame;
  const pcm = Buffer.alloc(at(total));
  clips.forEach(({ wav }, i) => {
    if (wav.rate !== fmt.rate || wav.channels !== fmt.channels || wav.bits !== fmt.bits) throw new Error('clips have different WAV formats');
    wav.data.copy(pcm, at(starts[i]));
  });
  writeWav(PREVIEW, fmt, pcm);

  console.log(`\ntotal ${total.toFixed(2)}s of ${MAX_SECONDS}s -> video/voice.json, video/audio/, video/voice-preview.wav`);
  if (total > MAX_SECONDS) {
    console.error(`Too long by ${(total - MAX_SECONDS).toFixed(2)}s: shorten script.txt, lower @gap/@tail or raise @rate.`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  },
);
