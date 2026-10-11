# Hive demo video

A ~75 s demo video rendered from code with [fframes](https://github.com/dmtrKovalenko/fframes) (Rust + SVG), voiced with Inworld TTS. Must stay under 90 s.

## Pipeline

1. **Script**: edit `script.txt` (one `[id]` block per scene, voice settings at the top; `[id +2.5]` adds 2.5 s of silence before a line to give a visual moment room).
2. **Voice**: `node video/tts.mjs` (from the repo root). Needs `INWORLD_API_KEY` in the root `.env`. Writes `audio/vo_<id>.wav`, `voice.json` (timings + word timestamps) and `voice-preview.wav`. Only changed lines are re-synthesized. `--dry` estimates length for free.
3. **Video**: from `video/`, `cargo run --release -- render` writes `hive-demo.mp4`. Scene lengths and every animation beat come from `voice.json`, so re-voicing re-times the video automatically.

Useful commands (all `cargo run --release -- <cmd>` from `video/`):

| command | does |
|---|---|
| `preview 20s` | real-time window with sound from 20 s |
| `timeline` | scenes and voice clips with their times |
| `inspect` | missing fonts/glyphs, invalid SVG (camera crops are expected warnings) |
| `strip Stale -n 12` | contact sheet of a scene → `strip.png` |
| `frame Plan@3s` | full-size PNG → `frames/` |
| `render` | final `hive-demo.mp4` |

**Windows**: first `. .\fframes-env.ps1` (PowerShell). It points at the FFmpeg 9 shared build in `%USERPROFILE%\.fframes\ffmpeg-9.0` and LLVM. Visual Studio 2022 must be 17.11+ (the prebuilt Skia needs the newer C++ runtime). **macOS**: `brew install pkg-config ffmpeg x264 x265 opus nasm ninja`, nothing else.

## When the app UI changes

The UI is **redrawn in SVG from `web/app/globals.css`**, not screenshotted, so update these by hand:

| app change | edit |
|---|---|
| colors, fonts, radii, shadows, easing curves | `src/ui.rs` (tokens at the top), `src/ease.rs` (`ease`/`bounce`/`pop`) |
| task node, status pills, buttons, chat bubbles, avatars, logo | `src/ui.rs` (`node`, `status_pill`, `button`, `message`, `logo`, ...) |
| top bar, graph layout, chat, task panel, conflict card, toast | `src/workspace.rs` |
| what happens when (states, chat messages, camera) | `src/workspace.rs` (`Cues`, `status()`, `messages()`, `camera()`) |
| opening (hook, problem), intro, decision log, transitions, chapter stickers, closing mosaic | `src/scenes.rs` |
| ASCII rendering, 3D logo, glyph zoom, particles | `src/ascii.rs` (glyph bitmaps in `data/glyphs_288x60.gray`) |
| landing page shown in the intro | re-capture `media/hero.jpg` (1920x1080 of `localhost:5173/`) and regenerate `data/hero_160x54.gray`: `ffmpeg -i media/hero.jpg -vf scale=160:54:flags=area,format=gray -f rawvideo data/hero_160x54.gray` |

Animations are tied to spoken words with `cue("scene", "word")`; if you reword a line, check that the cue words still exist (a missing word falls back to the scene start).

Fonts: Rubik (500/700/800 static files, the variable font renders at one weight) and Space Mono, both OFL (`licenses/`).
