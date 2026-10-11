//! Hive demo video. One scene per voiceover segment in `voice.json` (made by `tts.mjs` from
//! `script.txt`), so re-voicing the script re-times the video. Every scene works in global
//! seconds and syncs its motion to words of the voiceover with `cue()`.

pub mod ascii;
pub mod ease;
pub mod scenes;
pub mod ui;
pub mod workspace;

use fframes::{
    AudioMap, AudioTimestamp::*, AudioTrack, Color, Duration, FFramesContext, Frame, Scene, Scenes,
    Svgr, Video, include_media_dir,
};
use serde::Deserialize;
use std::sync::LazyLock;

include_media_dir!(pub struct HiveMedia, "media");

pub const WIDTH: usize = 1920;
pub const HEIGHT: usize = 1080;
pub const FPS: usize = 30;

#[derive(Debug, Deserialize)]
pub struct Voice {
    #[serde(rename = "totalSeconds")]
    pub total_seconds: f32,
    pub segments: Vec<Segment>,
}

#[derive(Debug, Deserialize)]
pub struct Segment {
    pub id: String,
    pub file: String,
    pub start: f32,
    pub end: f32,
    pub words: Vec<Word>,
}

#[derive(Debug, Deserialize)]
pub struct Word {
    pub word: String,
    pub start: f32,
    pub end: f32,
}

pub static VOICE: LazyLock<Voice> =
    LazyLock::new(|| serde_json::from_str(include_str!("../voice.json")).expect("voice.json"));

fn segment(id: &str) -> &'static Segment {
    VOICE.segments.iter().find(|s| s.id == id).unwrap_or_else(|| panic!("no [{id}] in voice.json"))
}

fn norm(w: &str) -> String {
    w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

/// Global second at which `word` is spoken in segment `id` (first match, punctuation ignored).
/// Falls back to the segment start, so an edited script never breaks the render.
pub fn cue(id: &str, word: &str) -> f32 {
    let seg = segment(id);
    let want = norm(word);
    seg.words.iter().find(|w| norm(&w.word) == want).map(|w| seg.start + w.start).unwrap_or(seg.start)
}

/// Like `cue` for the `n`th (0-based) time `word` is spoken in the segment.
pub fn cue_n(id: &str, word: &str, n: usize) -> f32 {
    let seg = segment(id);
    let want = norm(word);
    seg.words.iter().filter(|w| norm(&w.word) == want).nth(n).map(|w| seg.start + w.start).unwrap_or(seg.start)
}

/// Global second at which `word` has been said.
pub fn cue_end(id: &str, word: &str) -> f32 {
    let seg = segment(id);
    let want = norm(word);
    seg.words.iter().find(|w| norm(&w.word) == want).map(|w| seg.start + w.end).unwrap_or(seg.end)
}

pub fn seg_start(id: &str) -> f32 {
    segment(id).start
}

pub fn seg_end(id: &str) -> f32 {
    segment(id).end
}

/// Scene boundaries: visuals lead the voice by a beat.
const LEAD: f32 = 0.2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Hook,
    Problem,
    Intro,
    Plan,
    Steer,
    Stale,
    Conflict,
    Memory,
    Ship,
    Outro,
}

const KINDS: [(Kind, &str, &str); 10] = [
    (Kind::Hook, "hook", "Hook"),
    (Kind::Problem, "problem", "Problem"),
    (Kind::Intro, "intro", "Intro"),
    (Kind::Plan, "plan", "Plan"),
    (Kind::Steer, "steer", "Steer"),
    (Kind::Stale, "stale", "Stale"),
    (Kind::Conflict, "conflict", "Conflict"),
    (Kind::Memory, "memory", "Memory"),
    (Kind::Ship, "ship", "Ship"),
    (Kind::Outro, "outro", "Outro"),
];

/// One scene per voice segment; `start` is its global start second.
#[derive(Debug)]
pub struct Shot {
    pub kind: Kind,
    pub name: &'static str,
    pub start: f32,
    pub dur: f32,
}

impl Scene for Shot {
    fn duration(&self) -> Duration<'_> {
        Duration::Seconds(self.dur)
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn render_frame<'a>(&'a self, frame: Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        let t = self.start + frame.seconds();
        scenes::render(self.kind, t, frame, ctx)
    }
}

pub struct HiveVideo {
    shots: Vec<Shot>,
}

impl HiveVideo {
    pub fn new() -> Self {
        let starts: Vec<f32> = KINDS
            .iter()
            .enumerate()
            .map(|(i, (kind, id, _))| match kind {
                _ if i == 0 => 0.0,
                // the closing zoom-out starts as soon as the ship line is said
                Kind::Outro => seg_end("ship") + 0.35,
                _ => seg_start(id) - LEAD,
            })
            .collect();
        let shots = KINDS
            .iter()
            .enumerate()
            .map(|(i, (kind, _, name))| {
                let end = starts.get(i + 1).copied().unwrap_or(VOICE.total_seconds);
                Shot { kind: *kind, name, start: starts[i], dur: end - starts[i] }
            })
            .collect();
        Self { shots }
    }
}

impl Default for HiveVideo {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for HiveVideo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HiveVideo").finish()
    }
}

impl Video for HiveVideo {
    const FPS: usize = FPS;
    const WIDTH: usize = WIDTH;
    const HEIGHT: usize = HEIGHT;
    const BACKGROUND_COLOR: Color = Color::BLACK;

    fn duration(&self) -> Duration<'_> {
        Duration::Auto
    }

    fn audio(&self) -> AudioMap<'_> {
        AudioMap::from(
            VOICE
                .segments
                .iter()
                .map(|s| AudioTrack::new(s.file.as_str(), Second(s.start)..Eof).voice())
                .collect::<Vec<_>>(),
        )
    }

    fn define_scenes(&self) -> Scenes<'_> {
        Scenes::from(self.shots.iter().map(|s| s as &dyn Scene).collect::<Vec<_>>())
    }

    fn render_frame<'a>(&'a self, frame: Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" width={WIDTH} height={HEIGHT} viewBox="0 0 1920 1080">
                <rect width="1920" height="1080" fill={ui::INK} />
                {ctx.render_scenes(&frame)}
            </svg>
        )
    }
}
