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
    /// Where the demo footage ends and the outro starts (set by `retime`).
    #[serde(skip)]
    pub demo_end: f32,
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

pub static VOICE: LazyLock<Voice> = LazyLock::new(|| {
    let mut v: Voice = serde_json::from_str(include_str!("../voice.json")).expect("voice.json");
    retime(&mut v);
    v
});

/// The product demo is real app footage (recorded from three teammates' browsers): one clip per
/// voice segment, with fixed lengths. `"split"` shows Ana's, Ben's and Maya's screens side by side;
/// `"mongo"` is the drawn scene about everything being saved.
pub const DEMO: [(&str, &str, f32); 6] = [
    ("plan", "plan_full.mp4", 9.48),
    ("sync", "split", 3.98),
    ("run", "run.mp4", 7.98),
    ("steer", "steer_full.mp4", 9.86),
    ("takeover", "takeover.mp4", 8.45),
    // not footage: everything flowing into MongoDB
    ("saved", "mongo", 5.6),
];

/// Lay the demo scenes out back to back from where the intro hands over, start each demo line
/// a beat into its clip, and move the outro after the footage. Lines voiced later re-time nothing
/// but their own clip, so footage and voice can't drift apart.
fn retime(v: &mut Voice) {
    let mut t = v.segments.iter().find(|s| s.id == DEMO[0].0).map(|s| s.start - LEAD).unwrap_or(19.6);
    for (id, _, secs) in DEMO {
        if let Some(s) = v.segments.iter_mut().find(|s| s.id == id) {
            let d = s.end - s.start;
            s.start = t + LEAD;
            s.end = s.start + d;
        }
        t += secs;
    }
    v.demo_end = t;
    if let Some(s) = v.segments.iter_mut().find(|s| s.id == "outro") {
        let d = s.end - s.start;
        s.start = t + 2.65;
        s.end = s.start + d;
        v.total_seconds = s.end + 2.5;
    }
}

pub fn demo_end() -> f32 {
    VOICE.demo_end
}

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
    /// Index into `DEMO`.
    Demo(usize),
    Outro,
}
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
        let mut shots = vec![
            Shot { kind: Kind::Hook, name: "Hook", start: 0.0, dur: 0.0 },
            Shot { kind: Kind::Problem, name: "Problem", start: seg_start("problem") - LEAD, dur: 0.0 },
            Shot { kind: Kind::Intro, name: "Intro", start: seg_start("intro") - LEAD, dur: 0.0 },
        ];
        const NAMES: [&str; 6] = ["Plan", "Sync", "Run", "Steer", "TakeOver", "Saved"];
        let mut t = seg_start(DEMO[0].0) - LEAD;
        for (i, (_, _, secs)) in DEMO.iter().enumerate() {
            shots.push(Shot { kind: Kind::Demo(i), name: NAMES[i], start: t, dur: 0.0 });
            t += secs;
        }
        shots.push(Shot { kind: Kind::Outro, name: "Outro", start: demo_end(), dur: 0.0 });
        for i in 0..shots.len() {
            let end = shots.get(i + 1).map(|s| s.start).unwrap_or(VOICE.total_seconds);
            shots[i].dur = end - shots[i].start;
        }
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
                // lines not voiced yet (no wav in audio/) are skipped
                .filter(|s| std::path::Path::new("audio").join(&s.file).exists())
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
