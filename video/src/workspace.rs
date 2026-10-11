//! The Hive workspace as one continuous UI: top bar, task graph, chat, task panel and conflict
//! card. Its state is a pure function of global time, driven by word cues of the voiceover, so
//! the plan, steer, stale, conflict and ship scenes are one unbroken take with camera moves.

use crate::ease::*;
use crate::ui::*;
use crate::{cue, cue_end, seg_end, seg_start};
use fframes::Svgr;
use std::sync::LazyLock;

/// The workspace is laid out in CSS pixels at this scale (1920 / 1.4 = 1371 px wide).
pub const K: f32 = 1.4;
pub const LW: f32 = 1920.0 / K;
pub const LH: f32 = 1080.0 / K;
pub const TOP_H: f32 = 62.0;
pub const CHAT_W: f32 = 400.0;
pub const STAGE_W: f32 = LW - CHAT_W;

pub const MAYA: (&str, &str, &str) = ("Maya", "M", PURPLE);
pub const SAM: (&str, &str, &str) = ("Sam", "S", BLUE);
pub const PRIYA: (&str, &str, &str) = ("Priya", "P", HOT);

/// Every moment of the take, in global seconds.
pub struct Cues {
    pub type_start: f32,
    pub type_end: f32,
    pub msg_maya: f32,
    pub planner_reply: f32,
    pub nodes_pop: f32,
    pub t1_run: f32,
    pub stream: f32,
    pub tests: f32,
    pub t1_done: f32,
    pub t23_run: f32,
    pub sam: f32,
    pub ack: f32,
    pub priya: f32,
    pub fix: f32,
    pub handback: f32,
    pub t2_done: f32,
    pub panel_in: f32,
    pub edit_start: f32,
    pub edit_end: f32,
    pub why: f32,
    pub stale: f32,
    pub stop: f32,
    pub rebuild: f32,
    pub kept: f32,
    pub panel_out: f32,
    pub conflict_in: f32,
    pub proposal: f32,
    pub checking: f32,
    pub pass: f32,
    pub otherwise: f32,
    pub conflict_out: f32,
    pub t3_done: f32,
    pub t4_run: f32,
    pub t4_done: f32,
    pub green: f32,
    pub click: f32,
    pub toast: f32,
}

pub static C: LazyLock<Cues> = LazyLock::new(|| {
    let type_start = cue("plan", "build");
    let type_end = cue_end("plan", "stats");
    let msg_maya = type_end + 0.15;
    let t1_done = cue("plan", "live");
    let pass = cue("conflict", "pass");
    let t3_done = pass + 0.35;
    let edit_end = cue_end("stale", "total");
    Cues {
        type_start,
        type_end,
        msg_maya,
        planner_reply: cue("plan", "splits") - 0.25,
        nodes_pop: cue("plan", "tasks") - 0.15,
        t1_run: cue("plan", "agents"),
        stream: cue("plan", "streaming"),
        tests: cue("plan", "test"),
        t1_done,
        t23_run: t1_done + 0.4,
        sam: cue("steer", "steers") - 0.15,
        ack: cue("steer", "midrun"),
        priya: cue("steer", "Priya"),
        fix: cue("steer", "fixes"),
        handback: cue("steer", "hands"),
        t2_done: seg_start("stale") - 0.35,
        panel_in: seg_start("stale") - 0.1,
        edit_start: cue("stale", "count"),
        edit_end,
        why: edit_end + 0.15,
        stale: cue("stale", "stale"),
        stop: cue("stale", "stops"),
        rebuild: cue("stale", "rebuilds"),
        kept: cue("stale", "Everything"),
        panel_out: cue("stale", "Everything") - 0.35,
        conflict_in: cue("conflict", "two") - 0.1,
        proposal: cue("conflict", "proposes"),
        checking: cue("conflict", "applies"),
        pass,
        otherwise: cue("conflict", "Otherwise"),
        conflict_out: seg_end("conflict") + 0.1,
        t3_done,
        t4_run: t3_done + 0.6,
        t4_done: seg_start("ship") - 0.2,
        green: cue("ship", "green"),
        click: cue("ship", "click"),
        toast: cue("ship", "pushes"),
    }
});

struct NodeDef {
    id: &'static str,
    title: &'static str,
    x: f32,
    y: f32,
    commit: &'static str,
}

const NODES: [NodeDef; 4] = [
    NodeDef { id: "#T1", title: "Create short link", x: 355.0, y: 46.0, commit: "a1f3c9e" },
    NodeDef { id: "#T2", title: "Redirect", x: 560.0, y: 262.0, commit: "4be71d0" },
    NodeDef { id: "#T3", title: "Click stats", x: 150.0, y: 262.0, commit: "9c02f7a" },
    NodeDef { id: "#T4", title: "README", x: 355.0, y: 478.0, commit: "e58d3b1" },
];
const EDGES: [(usize, usize); 4] = [(0, 1), (0, 2), (1, 3), (2, 3)];

/// Status of node `i` at `t`, and the second it entered that status.
fn status(i: usize, t: f32) -> (Status, f32) {
    let c = &*C;
    let pop = c.nodes_pop + i as f32 * 0.12;
    let steps: Vec<(f32, Status)> = match i {
        0 => vec![(pop, Status::Ready), (c.t1_run, Status::Running), (c.t1_done, Status::Done)],
        1 => vec![(pop, Status::Todo), (c.t23_run, Status::Running), (c.t2_done, Status::Done)],
        2 => vec![
            (pop, Status::Todo),
            (c.t23_run, Status::Running),
            (c.priya, Status::Human),
            (c.handback + 0.25, Status::Running),
            (c.stale, Status::Stale),
            (c.rebuild, Status::Running),
            (c.t3_done, Status::Done),
        ],
        _ => vec![(pop, Status::Todo), (c.t4_run, Status::Running), (c.t4_done, Status::Done)],
    };
    let mut cur = steps[0];
    for s in steps {
        if t >= s.0 {
            cur = s;
        }
    }
    (cur.1, cur.0)
}

fn node_pos(i: usize) -> (f32, f32) {
    (NODES[i].x, TOP_H + NODES[i].y)
}

/// Camera: (zoom, focus x, focus y) in workspace px. Each key starts moving at its time.
fn camera(t: f32) -> (f32, f32, f32) {
    let c = &*C;
    let center = (1.0, LW / 2.0, LH / 2.0);
    let keys: [(f32, f32, (f32, f32, f32)); 14] = [
        (seg_start("plan") - 1.0, 0.1, (1.15, 775.0, LH - 290.0)),
        (c.msg_maya + 0.2, 0.9, (1.08, LW - 400.0, LH / 2.0)),
        (c.nodes_pop - 0.3, 0.8, center),
        (c.t1_run + 0.1, 0.9, (1.3, 640.0, TOP_H + 150.0)),
        (c.t1_done + 0.2, 0.8, (1.12, 700.0, TOP_H + 330.0)),
        (c.priya - 0.3, 0.8, (1.3, 330.0, TOP_H + 380.0)),
        (c.panel_in, 0.8, (1.1, 560.0, LH / 2.0 + 10.0)),
        (c.kept, 0.9, (1.0, 620.0, LH / 2.0)),
        (c.conflict_in - 0.2, 0.7, (1.12, STAGE_W / 2.0 + 40.0, TOP_H + 250.0)),
        (c.conflict_out - 0.3, 0.6, center),
        (seg_start("ship") - 0.2, 0.1, center),
        (c.click - 1.0, 0.7, (1.5, LW - 170.0, 120.0)),
        (c.toast + 0.4, 0.8, (1.05, LW / 2.0, LH / 2.0 + 20.0)),
        (999.0, 0.1, center),
    ];
    let mut cam = keys[0].2;
    for w in keys.windows(2) {
        let (at, dur, to) = w[1];
        let from = cam;
        if t < at {
            break;
        }
        let p = in_out(prog(t, at, at + dur));
        cam = (mix(from.0, to.0, p), mix(from.1, to.1, p), mix(from.2, to.2, p));
        if t < at + dur {
            break;
        }
    }
    if t < keys[0].0 {
        return keys[0].2;
    }
    cam
}

/// SVG transform that places the workspace on screen for camera state `cam`.
pub fn camera_transform(cam: (f32, f32, f32)) -> String {
    let (z, fx, fy) = cam;
    let k = K * z;
    // never look past the edge of the UI
    let (hw, hh) = (960.0 / k, 540.0 / k);
    let fx = fx.clamp(hw.min(LW / 2.0), (LW - hw).max(LW / 2.0));
    let fy = fy.clamp(hh.min(LH / 2.0), (LH - hh).max(LH / 2.0));
    format!("translate(960 540) scale({k}) translate({} {})", -fx, -fy)
}

/// The whole workspace at `t`, already placed by the camera.
pub fn render(t: f32) -> Svgr<'static> {
    let c = &*C;
    let (z, fx, fy) = camera(t);
    // a little life: slow breathing, and a punch-in when something important lands
    let punch = |at: f32| {
        let p = prog(t, at, at + 0.5);
        if p <= 0.0 || p >= 1.0 { 0.0 } else { (p * std::f32::consts::PI).sin() * (1.0 - p) }
    };
    let z = z * 1.012 * (1.0 + 0.008 * (t * 0.7).sin() + 0.035 * (punch(c.nodes_pop) + punch(c.stale) + punch(c.pass) + punch(c.click)));
    let rot = 0.35 * (t * 0.45).sin();
    fframes::svgr!(<g transform={format!("rotate({rot} 960 540)")}><g transform={camera_transform((z, fx, fy))}>{layout(t)}</g></g>)
}

/// The workspace at `t` in workspace px (no camera).
pub fn layout(t: f32) -> Svgr<'static> {
    fframes::svgr!(
        <g>
            {stage(t)}
            {chat(t)}
            {top_bar(t)}
        </g>
    )
}

fn top_bar(t: f32) -> Svgr<'static> {
    let c = &*C;
    let (word_w, word) = {
        let label = "url-shortener";
        let w = mono_w(label, 13.0, 0.0) + 22.0;
        (w, fframes::svgr!(
            <g transform="rotate(-2 170 31)">
                {card(150.0, 17.0, w, 28.0, 8.0, PAPER, 3.0, INK, 3.0, false)}
                <text x="161" y="36" font-family={MONO} font-weight="700" font-size="13" fill={INK}>{label.to_owned()}</text>
            </g>
        ))
    };
    let _ = word_w;
    // right-aligned: LIVE · avatars · Run ready · Approve & push
    let btn_w = |l: &str| display_w(l, 13.0) * 1.08 + 13.0 * 4.3;
    let ship_x = LW - 26.0 - btn_w("Approve & push");
    let run_x = ship_x - 16.0 - btn_w("Run ready");
    let av_x = run_x - 104.0;
    let avatars: Vec<Svgr> = [MAYA, SAM, PRIYA]
        .iter()
        .enumerate()
        .map(|(i, (_, initial, color))| avatar(av_x + i as f32 * 26.0, 31.0, 16.0, initial, color, INK))
        .collect();
    let press = prog(t, c.click, c.click + 0.08) * (1.0 - prog(t, c.click + 0.2, c.click + 0.45));
    let pushing = t >= c.click && t < c.toast;
    let (run_btn, _) = button(run_x, 15.0, "Run ready", 13.0, BLUE, "#ffffff", 3.0, 0.0);
    let (ship_btn, ship_w) = button(ship_x, 15.0, "Approve & push", 13.0, HOT, INK, 3.0, press);
    let spin = if pushing {
        fframes::svgr!(<g><circle cx={ship_x + ship_w - 22.0} cy="33.5" r="12" fill={HOT} />{spinner(ship_x + ship_w - 22.0, 33.5, 7.0, t, INK)}</g>)
    } else {
        Svgr::empty()
    };
    let live_x = av_x - 90.0;
    let live_dot = 1.0 + 0.0 * t;
    fframes::svgr!(
        <g>
            <rect x="0" y="0" width={LW} height={TOP_H} fill={CREAM} />
            <rect x="0" y={TOP_H - 3.0} width={LW} height="3" fill={INK} />
            {logo(22.0, 14.0, 34.0)}
            <text x="64" y="41" font-family={DISPLAY} font-weight="800" font-size="26" letter-spacing="-1" fill={INK}>"Hive"</text>
            {word}
            <circle cx={live_x} cy="31" r={5.0 * live_dot} fill={GREEN} stroke={INK} stroke-width="2" />
            <text x={live_x + 12.0} y="35.5" font-family={MONO} font-weight="700" font-size="12" letter-spacing="1" fill={INK}>"LIVE"</text>
            {avatars}
            {run_btn}
            {ship_btn}
            {spin}
        </g>
    )
}

fn stage(t: f32) -> Svgr<'static> {
    let c = &*C;
    let edges: Vec<Svgr> = EDGES.iter().map(|&(a, b)| edge(a, b, t)).collect();
    let nodes: Vec<Svgr> = (0..4).map(|i| node_at(i, t)).collect();
    fframes::svgr!(
        <g>
            <rect x="0" y={TOP_H} width={STAGE_W} height={LH - TOP_H} fill={PAPER} />
            {dots(0.0, TOP_H, STAGE_W, LH - TOP_H, 28.0, INK, 0.16)}
            {edges}
            {nodes}
            {stream_card(t)}
            {priya_card(t)}
            {kept_flash(t)}
            {panel(t)}
            {conflict(t)}
            {toast(t)}
            {if t < c.nodes_pop + 0.2 { empty_card(t) } else { Svgr::empty() }}
        </g>
    )
}

/// `.hv-empty__card`: the blue tilted card an empty graph shows.
fn empty_card(t: f32) -> Svgr<'static> {
    let c = &*C;
    let out = expo_in(prog(t, c.nodes_pop - 0.35, c.nodes_pop));
    let (w, h) = (580.0, 268.0);
    let (x, y) = ((STAGE_W - w) / 2.0, TOP_H + 190.0);
    let (cx, cy) = (x + w / 2.0, y + h / 2.0);
    let k = 1.0 - 0.15 * out;
    fframes::svgr!(
        <g opacity={1.0 - out} transform={format!("translate({cx} {cy}) rotate(-1.2) scale({k}) translate({} {})", -cx, -cy)}>
            {card(x, y, w, h, 28.0, BLUE, 10.0, INK, 3.0, false)}
            <defs><clipPath id="empty-card"><rect x={x + 3.0} y={y + 3.0} width={w - 6.0} height={h - 6.0} rx="25" /></clipPath></defs>
            <g clip-path="url(#empty-card)">{dots(x, y, w, h, 24.0, "#ffffff", 0.18)}</g>
            <text x={x + 44.0} y={y + 96.0} font-family={DISPLAY} font-weight="800" font-size="54" letter-spacing="-2.4" fill="#ffffff">"Describe it in chat."</text>
            <text x={x + 44.0} y={y + 146.0} font-family={DISPLAY} font-weight="500" font-size="18" fill="#ffffffeb">"The Planner turns one message into a task"</text>
            <text x={x + 44.0} y={y + 172.0} font-family={DISPLAY} font-weight="500" font-size="18" fill="#ffffffeb">"graph everyone edits live."</text>
            {sticker(x + 44.0, y + 200.0, "WAITING FOR A MESSAGE", 12.0, PAPER, INK, Some(HOT), 3.0, 2.0).0}
        </g>
    )
}

fn node_at(i: usize, t: f32) -> Svgr<'static> {
    let c = &*C;
    let pop_at = c.nodes_pop + i as f32 * 0.12;
    if t < pop_at {
        return Svgr::empty();
    }
    let (st, since) = status(i, t);
    let (op, sc, dy) = pop_in(t, pop_at);
    let mut scale = sc;
    let mut rot = 0.0;
    match st {
        Status::Done => scale *= settle(t, since),
        Status::Stale => rot = wiggle(t, since),
        _ => {}
    }
    // everything green pulses once more when the ship scene says so
    if t > c.green {
        scale *= settle(t, c.green + i as f32 * 0.08);
    }
    let def = &NODES[i];
    let (x, y) = node_pos(i);
    let human = if st == Status::Human { Some((PRIYA.1, PRIYA.2)) } else { None };
    let view = NodeView {
        id: def.id,
        title: def.title,
        status: st,
        human,
        commit: if st == Status::Done { Some(def.commit) } else { None },
        t,
        frozen: st == Status::Stale && t >= c.stop,
    };
    let (cx, cy) = (x + NODE_W / 2.0, y + NODE_H / 2.0);
    let tr = format!("translate({cx} {}) rotate({rot}) scale({scale}) translate({} {})", cy + dy, -cx, -cy);
    fframes::svgr!(<g opacity={op} transform={tr}>{node(x, y, &view)}</g>)
}

fn edge(a: usize, b: usize, t: f32) -> Svgr<'static> {
    let c = &*C;
    let start = c.nodes_pop + 0.45 + (a + b) as f32 * 0.05;
    let p = ease(prog(t, start, start + 0.5));
    if p <= 0.0 {
        return Svgr::empty();
    }
    let (ax, ay) = node_pos(a);
    let (bx, by) = node_pos(b);
    let (x1, y1) = (ax + NODE_W / 2.0, ay + NODE_H);
    let (x2, y2) = (bx + NODE_W / 2.0, by);
    let my = (y1 + y2) / 2.0;
    let d = format!("M{x1} {y1} C{x1} {my} {x2} {my} {x2} {y2}");
    let (st, _) = status(b, t);
    let (stroke, dash, w) = match st {
        Status::Running => (BLUE, "9 7", 3.0),
        Status::Stale => (HOT, "4 6", 3.0),
        _ => (INK, "none", 3.0),
    };
    let flow = -(t * 30.0) % 16.0;
    // draw-on with a long dash, then the status dash pattern
    let len = 260.0;
    let (dash, offset) = if p < 1.0 { (format!("{} {}", len * p, len), 0.0) } else { (dash.to_owned(), flow) };
    fframes::svgr!(<path d={d} fill="none" stroke={s(stroke)} stroke-width={w} stroke-dasharray={dash} stroke-dashoffset={offset} stroke-linecap="round" />)
}

/// Live output of the T1 builder: code lines typing in, then the test result.
fn stream_card(t: f32) -> Svgr<'static> {
    let c = &*C;
    let start = c.stream - 0.35;
    let end = c.t23_run + 0.6;
    if t < start || t > end + 0.4 {
        return Svgr::empty();
    }
    let (op, sc, dy) = pop_in(t, start);
    let out = 1.0 - prog(t, end, end + 0.3);
    let (x, y, w) = (640.0, TOP_H + 40.0, 300.0);
    let lines = [
        "+ export function shorten(url) {",
        "+   const code = base62(6)",
        "+   store.set(code, url)",
        "+   return code",
        "+ }",
    ];
    let typed = ((t - c.stream) / 0.32).max(0.0);
    let rows: Vec<Svgr> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| typed > *i as f32)
        .map(|(i, l)| {
            let shown: String = l.chars().take(((typed - i as f32) * 40.0) as usize).collect();
            fframes::svgr!(<text x={x + 14.0} y={y + 52.0 + i as f32 * 19.0} font-family={MONO} font-size="12.5" fill="#b6f5c9">{shown}</text>)
        })
        .collect();
    let pass = prog(t, c.tests, c.tests + 0.3);
    let (pass_el, _) = sticker(x + 14.0, y + 158.0, "TESTS 6/6 ✓", 11.0, GREEN, INK, None, 2.0, 2.0);
    let tr = format!("translate(0 {dy}) translate({} {}) scale({sc}) translate({} {})", x, y, -x, -y);
    fframes::svgr!(
        <g opacity={op * out} transform={tr}>
            {card(x, y, w, 196.0, 18.0, INK, 6.0, HOT, 3.0, false)}
            <text x={x + 14.0} y={y + 26.0} font-family={MONO} font-weight="700" font-size="12" letter-spacing="1.2" fill={CREAM}>"> LIVE · #T1 BUILDER"</text>
            <rect x={x} y={y + 36.0} width={w} height="1.5" fill="#f5efe440" />
            {rows}
            <g opacity={pass}>{pass_el}</g>
        </g>
    )
}

/// Priya's hand edit on T3 and the hand-back button.
fn priya_card(t: f32) -> Svgr<'static> {
    let c = &*C;
    let start = c.priya + 0.1;
    let end = c.handback + 0.7;
    if t < start || t > end + 0.35 {
        return Svgr::empty();
    }
    let (op, sc, dy) = pop_in(t, start);
    let out = 1.0 - prog(t, end, end + 0.3);
    let (x, y, w) = (40.0, TOP_H + 405.0, 290.0);
    let added = prog(t, c.fix + 0.2, c.fix + 0.5);
    let typed: String = "+   return res.status(400)".chars().take((prog(t, c.fix + 0.2, c.fix + 0.9) * 26.0) as usize).collect();
    let press = prog(t, c.handback, c.handback + 0.08) * (1.0 - prog(t, c.handback + 0.2, c.handback + 0.4));
    let (btn, _) = button(x + 14.0, y + 128.0, "Hand back", 12.0, PAPER, INK, 3.0, press);
    let tr = format!("translate(0 {dy}) translate({x} {y}) scale({sc}) translate({} {})", -x, -y);
    fframes::svgr!(
        <g opacity={op * out} transform={tr}>
            {card(x, y, w, 180.0, 18.0, PAPER, 6.0, INK, 3.0, false)}
            {avatar(x + 24.0, y + 22.0, 11.0, PRIYA.1, PRIYA.2, INK)}
            <text x={x + 42.0} y={y + 27.0} font-family={MONO} font-weight="700" font-size="12" letter-spacing="1" fill={INK}>"PRIYA · src/shorten.js"</text>
            <rect x={x} y={y + 40.0} width={w} height="2" fill={INK} />
            <text x={x + 14.0} y={y + 64.0} font-family={MONO} font-size="12.5" fill={INK}>"  if (!isUrl(url)) {"</text>
            <rect x={x + 3.0} y={y + 71.0} width={((w - 6.0) * added).max(0.5)} height="19" fill="#22c55e33" opacity={if added > 0.0 { 1.0 } else { 0.0 }} />
            <text x={x + 14.0} y={y + 85.0} font-family={MONO} font-size="12.5" fill={INK}>{typed}</text>
            <text x={x + 14.0} y={y + 106.0} font-family={MONO} font-size="12.5" fill={INK}>"  }"</text>
            {btn}
        </g>
    )
}

/// T1 and T2 are untouched by the spec change: a green ring says so.
fn kept_flash(t: f32) -> Svgr<'static> {
    let c = &*C;
    let p = prog(t, c.kept, c.kept + 1.1);
    if p <= 0.0 || p >= 1.0 {
        return Svgr::empty();
    }
    let a = if p < 0.2 { p / 0.2 } else if p < 0.45 { 1.0 - (p - 0.2) * 3.2 } else if p < 0.65 { 0.2 + (p - 0.45) * 4.0 } else { 1.0 - (p - 0.65) / 0.35 };
    let rings: Vec<Svgr> = [0usize, 1]
        .iter()
        .map(|&i| {
            let (x, y) = node_pos(i);
            let (lbl, w) = sticker(x + NODE_W - 92.0, y - 16.0, "KEPT ✓", 11.0, GREEN, INK, None, 2.0, 2.0);
            let _ = w;
            fframes::svgr!(
                <g>
                    <rect x={x - 10.0} y={y - 10.0} width={NODE_W + 20.0} height={NODE_H + 20.0} rx="26" fill="none" stroke={GREEN} stroke-width="4" />
                    {lbl}
                </g>
            )
        })
        .collect();
    fframes::svgr!(<g opacity={a.clamp(0.0, 1.0)}>{rings}</g>)
}

/// TaskPanel for #T3 during the spec change.
fn panel(t: f32) -> Svgr<'static> {
    let c = &*C;
    if t < c.panel_in || t > c.panel_out + 0.6 {
        return Svgr::empty();
    }
    let inp = ease(prog(t, c.panel_in, c.panel_in + 0.6));
    let outp = expo_in(prog(t, c.panel_out, c.panel_out + 0.5));
    let dx = 28.0 * (1.0 - inp) + 520.0 * outp;
    let op = inp * (1.0 - outp);
    let (x, y, w, h) = (STAGE_W - 14.0 - 440.0, TOP_H + 14.0, 440.0, LH - TOP_H - 28.0);
    let (st, since) = status(2, t);

    // spec text: "total" gets struck, then "per day" is typed
    let strike = prog(t, c.edit_start, c.edit_start + 0.35);
    let typed_n = (prog(t, c.edit_start + 0.3, c.edit_end) * 7.0) as usize;
    let typed: String = "per day".chars().take(typed_n).collect();
    let committed = t >= c.why;
    let spec_x = x + 30.0;
    let spec_y = y + 236.0;
    let spec = if committed {
        fframes::svgr!(<text x={spec_x} y={spec_y} font-family={DISPLAY} font-weight="500" font-size="16" fill={INK}>"Count clicks per day for each code."</text>)
    } else {
        let pre_w = display_w("Count ", 16.0) * 0.93;
        let total_w = display_w("total", 16.0) * 0.93;
        let cursor_on = t >= c.edit_start && (t < c.edit_end || (t * 2.0).fract() < 0.5);
        fframes::svgr!(
            <g>
                <text x={spec_x} y={spec_y} font-family={DISPLAY} font-weight="500" font-size="16" fill={INK}>"Count "
                    <tspan fill={RED}>"total"</tspan>
                    " clicks for each code."</text>
                <rect x={spec_x + pre_w - 1.0} y={spec_y - 6.0} width={((total_w + 2.0) * strike).max(0.5)} height="2.5" opacity={if strike > 0.0 { 1.0 } else { 0.0 }} fill={RED} />
                // the caret is a glyph right after the typed text, so it always follows the last letter
                <text x={spec_x + pre_w} y={spec_y + 24.0} font-family={DISPLAY} font-weight="700" font-size="16" fill={BLUE}>{typed}<tspan font-weight="500" fill={if cursor_on { BLUE } else { "#00000000" }}>"|"</tspan></text>
            </g>
        )
    };

    let (pill, _) = status_pill(x + 30.0, y + 108.0, st, 14.0, false);
    let note = match st {
        Status::Stale if t >= c.stop => "Run stopped · spec changed",
        Status::Stale => "Spec changed mid-build",
        Status::Running if t >= c.rebuild => "Rebuilding #T3 only",
        Status::Done => "Tests pass",
        _ => "Building on task/T3",
    };
    let (run_fill, run_text, _, _) = st.look();
    let box_rot = if st == Status::Stale { wiggle(t, since) } else { 0.0 };
    let stopped = if t >= c.stop && st == Status::Stale {
        let (op2, sc2, _) = pop_in(t, c.stop);
        let (el, _) = sticker(x + 250.0, y + 108.0, "STOPPED", 12.0, INK, CREAM, Some(RED), 3.0, 2.0);
        fframes::svgr!(<g opacity={op2} transform={format!("translate({} {}) scale({sc2}) translate({} {}) rotate(3 {} {})", x + 300.0, y + 120.0, -x - 300.0, -y - 120.0, x + 300.0, y + 120.0)}>{el}</g>)
    } else {
        Svgr::empty()
    };

    let why = if t >= c.why {
        let (op3, sc3, dy3) = pop_in(t, c.why);
        let (wx, wy) = (x + 18.0, y + 300.0);
        fframes::svgr!(
            <g opacity={op3} transform={format!("translate({} {}) rotate(-1.2) scale({sc3}) translate({} {})", wx + 200.0, wy + 30.0 + dy3, -wx - 200.0, -wy - 30.0)}>
                {card(wx, wy, 404.0, 62.0, 14.0, PAPER, 3.0, INK, 2.0, false)}
                <rect x={wx} y={wy} width="7" height="62" rx="3" fill={HOT} />
                <text x={wx + 20.0} y={wy + 37.0} font-family={DISPLAY} font-weight="700" font-size="15" fill={INK}>"“Stats should count clicks per day, not total.”"</text>
                {avatar(wx + 18.0, wy + 92.0, 11.0, MAYA.1, MAYA.2, INK)}
                <text x={wx + 36.0} y={wy + 97.0} font-family={DISPLAY} font-weight="700" font-size="14" fill={INK}>"Maya changed #T3 Click stats"</text>
            </g>
        )
    } else {
        Svgr::empty()
    };

    fframes::svgr!(
        <g opacity={op} transform={format!("translate({dx} 0)")}>
            {card(x, y, w, h, 22.0, CREAM, 10.0, INK, 3.0, false)}
            <text x={x + 22.0} y={y + 38.0} font-family={MONO} font-weight="700" font-size="13" fill={INK} opacity="0.7">"#T3"</text>
            <text x={x + 20.0} y={y + 76.0} font-family={DISPLAY} font-weight="800" font-size="32" letter-spacing="-1.3" fill={INK}>"Click stats"</text>
            <g transform={format!("rotate({box_rot} {} {})", x + 220.0, y + 140.0)}>
                {card(x + 18.0, y + 96.0, w - 36.0, 96.0, 18.0, run_fill, 6.0, INK, 3.0, false)}
                {pill}
                <text x={x + 32.0} y={y + 176.0} font-family={DISPLAY} font-weight="700" font-size="16" fill={s(run_text)}>{note.to_owned()}</text>
            </g>
            {stopped}
            <text x={x + 22.0} y={y + 214.0} font-family={MONO} font-weight="700" font-size="11.5" letter-spacing="1.2" fill={MUTED}>"SPEC"</text>
            {card(x + 18.0, y + 220.0, w - 36.0, 64.0, 10.0, PAPER, if t >= c.edit_start && !committed { 3.0 } else { 0.0 }, INK, 2.0, false)}
            {spec}
            {why}
        </g>
    )
}

/// Conflict card: two builders touched src/store.js; an AI merge applies because tests pass.
fn conflict(t: f32) -> Svgr<'static> {
    let c = &*C;
    if t < c.conflict_in || t > c.conflict_out + 1.2 {
        return Svgr::empty();
    }
    let (op, sc, dy) = pop_in(t, c.conflict_in);
    let (x, y, w) = (STAGE_W / 2.0 - 330.0, TOP_H + 26.0, 660.0);
    let settled = t >= c.pass;
    let collapse = in_out(prog(t, c.conflict_out, c.conflict_out + 0.45));

    if collapse >= 1.0 {
        // collapsed pill
        let (pop_op, pop_sc, _) = pop_in(t, c.conflict_out + 0.4);
        let label = "Merged · tests pass";
        let pw = display_w(label, 15.0) + 56.0;
        let px = STAGE_W / 2.0 - pw / 2.0;
        let fade = 1.0 - prog(t, c.conflict_out + 0.9, c.conflict_out + 1.2);
        return fframes::svgr!(
            <g opacity={pop_op * fade} transform={format!("translate({} {}) scale({pop_sc}) translate({} {})", STAGE_W / 2.0, y + 20.0, -STAGE_W / 2.0, -y - 20.0)}>
                {card(px, y, pw, 40.0, 20.0, GREEN, 3.0, INK, 3.0, false)}
                <text x={px + 18.0} y={y + 26.0} font-family={DISPLAY} font-weight="700" font-size="15" fill={INK}>{label.to_owned()}</text>
                {check(px + pw - 30.0, y + 20.0, 13.0, INK)}
            </g>
        );
    }

    let code = |cx: f32, cy: f32, cw: f32, label: &str, lines: &[&str], fill: &str, reveal: f32| -> Svgr<'static> {
        let rows: Vec<Svgr> = lines
            .iter()
            .enumerate()
            .map(|(i, l)| fframes::svgr!(<text x={cx + 12.0} y={cy + 44.0 + i as f32 * 19.0} font-family={MONO} font-size="12" fill={INK}>{(*l).to_owned()}</text>))
            .collect();
        let h = 30.0 + lines.len() as f32 * 19.0;
        fframes::svgr!(
            <g opacity={reveal}>
                <text x={cx} y={cy + 4.0} font-family={MONO} font-weight="700" font-size="11" letter-spacing="1" fill={MUTED}>{label.to_owned()}</text>
                {card(cx, cy + 14.0, cw, h, 12.0, fill, 0.0, INK, 2.0, false)}
                {rows}
            </g>
        )
    };
    let side_w = (w - 40.0 - 12.0) / 2.0;
    let ours = code(x + 20.0, y + 70.0, side_w, "#T2 REDIRECT", &["get(code) {", "  hits.inc(code)", "  return urls[code]", "}"], CREAM, 1.0);
    let theirs = code(x + 32.0 + side_w, y + 70.0, side_w, "#T3 CLICK STATS", &["get(code) {", "  clicks.add(code, today())", "  return urls[code]", "}"], CREAM, 1.0);
    let prop_p = prog(t, c.proposal, c.proposal + 0.35);
    let proposal = code(x + 20.0, y + 202.0, w - 40.0, "AI MERGE PROPOSAL", &["get(code) {  hits.inc(code); clicks.add(code, today())", "  return urls[code] }"], "#e6f9ec", prop_p);

    let foot_y = y + 296.0;
    let foot = if settled {
        let (op2, sc2, _) = pop_in(t, c.pass);
        let (el, _) = sticker(x + 20.0, foot_y, "MERGED · TESTS PASS ✓", 13.0, GREEN, INK, None, 3.0, 2.0);
        fframes::svgr!(<g opacity={op2} transform={format!("translate({} {}) scale({sc2}) translate({} {})", x + 120.0, foot_y + 15.0, -x - 120.0, -foot_y - 15.0)}>{el}</g>)
    } else if t >= c.checking {
        let n = ((t - c.checking) / 0.12) as usize % 9;
        fframes::svgr!(
            <g>
                {spinner(x + 32.0, foot_y + 15.0, 8.0, t, BLUE)}
                <text x={x + 50.0} y={foot_y + 20.0} font-family={DISPLAY} font-weight="700" font-size="15" fill={BLUE}>{format!("Running tests… {n}/8")}</text>
            </g>
        )
    } else {
        Svgr::empty()
    };
    let rule = fframes::svgr!(<text x={x + 300.0} y={foot_y + 20.0} font-family={MONO} font-weight="700" font-size="11" fill={INK} opacity={prog(t, c.checking, c.checking + 0.3)}>"APPLIED ONLY IF TESTS PASS"</text>);
    let picks = if t >= c.otherwise {
        let a = prog(t, c.otherwise, c.otherwise + 0.3);
        let bx = x + 20.0;
        let by = foot_y + 46.0;
        let (b1, w1) = button(bx + 210.0, by, "Ours", 12.0, PAPER, INK, 3.0, 0.0);
        let (b2, w2) = button(bx + 222.0 + w1, by, "Theirs", 12.0, PAPER, INK, 3.0, 0.0);
        let (b3, _) = button(bx + 234.0 + w1 + w2, by, "Proposal", 12.0, PAPER, INK, 3.0, 0.0);
        fframes::svgr!(
            <g opacity={a}>
                <text x={bx} y={by + 23.0} font-family={DISPLAY} font-weight="700" font-size="14" fill={INK}>"If tests fail, a person picks:"</text>
                <g opacity="0.85">{b1}{b2}{b3}</g>
            </g>
        )
    } else {
        Svgr::empty()
    };
    let h = if t >= c.otherwise { 300.0 + 46.0 * prog(t, c.otherwise, c.otherwise + 0.3) + 40.0 } else { 340.0 };
    let shadow = if settled { GREEN } else { HOT };
    let (badge, bw) = sticker(x + 20.0, y + 18.0, "CONFLICT", 12.0, RED, "#ffffff", None, 3.0, 2.0);
    let bscale = 1.0 - collapse * 0.9;
    let tr = format!(
        "translate({} {}) rotate(-0.6) scale({}) translate({} {})",
        x + w / 2.0,
        y + 160.0 + dy,
        sc * bscale,
        -x - w / 2.0,
        -y - 160.0
    );
    fframes::svgr!(
        <g opacity={op * (1.0 - collapse)} transform={tr}>
            {card(x, y, w, h, 24.0, PAPER, 8.0, shadow, 3.0, false)}
            <g transform={format!("rotate({} {} {})", wiggle(t, c.conflict_in + 0.3), x + 60.0, y + 30.0)}>{badge}</g>
            <text x={x + 34.0 + bw} y={y + 40.0} font-family={DISPLAY} font-weight="800" font-size="21" letter-spacing="-0.6" fill={INK}>"Two builders changed "<tspan fill={HOT}>"src/store.js"</tspan></text>
            {ours}
            {theirs}
            {proposal}
            {foot}
            {rule}
            {picks}
        </g>
    )
}

fn toast(t: f32) -> Svgr<'static> {
    let c = &*C;
    if t < c.toast {
        return Svgr::empty();
    }
    let (op, sc, dy) = pop_in(t, c.toast);
    let label = "Pushed 7c2e9f1 to GitHub";
    let w = display_w(label, 16.0) + 64.0;
    let (x, y) = (STAGE_W / 2.0 - w / 2.0, LH - 90.0);
    fframes::svgr!(
        <g opacity={op} transform={format!("translate({} {}) scale({sc}) translate({} {})", STAGE_W / 2.0, y + 22.0 + dy, -STAGE_W / 2.0, -y - 22.0)}>
            {card(x, y, w, 46.0, 14.0, INK, 5.0, HOT, 3.0, false)}
            <text x={x + 20.0} y={y + 29.0} font-family={DISPLAY} font-weight="700" font-size="16" fill={CREAM}>{label.to_owned()}</text>
            {check(x + w - 36.0, y + 23.0, 15.0, GREEN)}
        </g>
    )
}

type Msg = (f32, Who, &'static [&'static str], &'static [(&'static str, &'static str, &'static str)]);

fn messages() -> Vec<Msg> {
    let c = &*C;
    let maya = Who::Person(MAYA.0, MAYA.1, MAYA.2);
    let sam = Who::Person(SAM.0, SAM.1, SAM.2);
    let priya = Who::Person(PRIYA.0, PRIYA.1, PRIYA.2);
    vec![
        (c.msg_maya, maya, &["Build a URL shortener with click stats"], &[]),
        (
            c.planner_reply,
            Who::Planner,
            &["Split it into 4 tasks. Builders start", "as soon as dependencies are done."],
            &[("+ SHORT LINK", PAPER, INK), ("+ REDIRECT", PAPER, INK), ("+ CLICK STATS", PAPER, INK), ("+ README", PAPER, INK)],
        ),
        (c.sam, sam, &["@T2 return 404 for unknown codes"], &[]),
        (c.ack, Who::Builder, &["Got it: 404 for unknown codes."], &[]),
        (c.priya + 0.15, priya, &["Taking #T3, fixing the bad-URL case."], &[]),
        (c.stale + 0.35, Who::Builder, &["#T3 spec changed. Stopped and", "rebuilding #T3 only."], &[]),
        (c.pass + 0.3, Who::Builder, &["Merged #T2 + #T3 in src/store.js.", "8/8 tests pass."], &[]),
        (c.toast + 0.2, Who::Builder, &["Pushed 7c2e9f1 to GitHub."], &[]),
    ]
}

fn chat(t: f32) -> Svgr<'static> {
    let c = &*C;
    let x0 = STAGE_W;
    let (list_top, list_bottom) = (TOP_H + 64.0, LH - 96.0);
    let bw = CHAT_W - 32.0;
    let mut y = list_top + 16.0;
    let mut els = Vec::new();
    let mut content_h = 0.0;
    for (at, who, lines, ops) in messages() {
        if t < at {
            continue;
        }
        let appear: Vec<f32> = (0..ops.len()).map(|i| prog(t, c.nodes_pop + i as f32 * 0.12, c.nodes_pop + i as f32 * 0.12 + 0.3)).collect();
        let extra = if ops.is_empty() { None } else { Some(chips(ops, 11.0, bw - 30.0, &appear)) };
        let extra = extra.map(|(e, h)| (e, h + 4.0));
        let (el, h) = message(x0 + 16.0, y, bw, who, lines, extra);
        let (op, sc, dy) = pop_in(t, at);
        let grow = ease(prog(t, at, at + 0.35));
        els.push(fframes::svgr!(<g opacity={op} transform={format!("translate({} {}) scale({sc}) translate({} {})", x0 + 16.0, y + h + dy, -x0 - 16.0, -y - h)}>{el}</g>));
        y += h;
        content_h += h * grow;
    }
    // planner "thinking" dots
    let thinking = if t >= c.msg_maya + 0.4 && t < c.planner_reply {
        let dots_el: Vec<Svgr> = (0..3)
            .map(|i| {
                let b = ((t - i as f32 * 0.15) / 1.0).fract();
                let lift = if b < 0.4 { (b / 0.4 * std::f32::consts::PI).sin() * 6.0 } else { 0.0 };
                fframes::svgr!(<circle cx={x0 + 40.0 + i as f32 * 16.0} cy={y + 52.0 - lift} r="4.5" fill="#ffffff" />)
            })
            .collect();
        fframes::svgr!(
            <g>
                <rect x={x0 + 16.0} y={y + 32.0} width="76" height="40" rx="14" fill={BLUE} stroke={INK} stroke-width="2.5" />
                {dots_el}
            </g>
        )
    } else {
        Svgr::empty()
    };
    let scroll = (content_h + list_top + 16.0 + 80.0 - list_bottom).max(0.0);
    let typed_n = (prog(t, c.type_start, c.type_end) * 38.0) as usize;
    let composing = t >= c.type_start - 0.3 && t < c.msg_maya;
    let draft: String = if composing { "Build a URL shortener with click stats".chars().take(typed_n).collect() } else { String::new() };
    let typing = t >= c.type_start && t < c.type_end;
    let caret = composing && (typing || (t * 2.0).fract() < 0.55);
    let focus = if composing { HOT } else { "#f5efe44d" };
    let send_press = prog(t, c.msg_maya - 0.12, c.msg_maya - 0.04) * (1.0 - prog(t, c.msg_maya + 0.05, c.msg_maya + 0.25));
    let cy = LH - 82.0;
    let placeholder = if draft.is_empty() { "Describe what to build…" } else { "" };
    fframes::svgr!(
        <g>
            <rect x={x0} y={TOP_H} width={CHAT_W} height={LH - TOP_H} fill={INK} />
            <defs><clipPath id="chat-list"><rect x={x0} y={list_top} width={CHAT_W} height={list_bottom - list_top} /></clipPath></defs>
            <g clip-path="url(#chat-list)">
                <g transform={format!("translate(0 {})", -scroll)}>{els}{thinking}</g>
            </g>
            // head: Chat / Log toggle
            <rect x={x0} y={TOP_H} width={CHAT_W} height="64" fill={INK} />
            <rect x={x0 + 16.0 + 4.0} y={TOP_H + 14.0 + 4.0} width={CHAT_W - 32.0} height="38" rx="19" fill="#f5efe44d" />
            {card(x0 + 16.0, TOP_H + 14.0, CHAT_W - 32.0, 38.0, 19.0, PAPER, 0.0, INK, 3.0, false)}
            <rect x={x0 + 20.0} y={TOP_H + 18.0} width={(CHAT_W - 40.0) / 2.0} height="30" rx="15" fill={INK} />
            <text x={x0 + 20.0 + (CHAT_W - 40.0) / 4.0} y={TOP_H + 38.5} text-anchor="middle" font-family={DISPLAY} font-weight="800" font-size="15" fill={CREAM}>"Chat"</text>
            <text x={x0 + 20.0 + 3.0 * (CHAT_W - 40.0) / 4.0} y={TOP_H + 38.5} text-anchor="middle" font-family={DISPLAY} font-weight="800" font-size="15" fill={INK}>"Log"</text>
            <rect x={x0} y={TOP_H + 63.0} width={CHAT_W} height="2" fill="#f5efe424" />
            // composer
            <rect x={x0} y={LH - 98.0} width={CHAT_W} height="98" fill={INK} />
            <rect x={x0} y={LH - 98.0} width={CHAT_W} height="2" fill="#f5efe424" />
            <rect x={x0 + 20.0} y={cy + 4.0} width={CHAT_W - 32.0} height="58" rx="20" fill={s(focus)} />
            {card(x0 + 16.0, cy, CHAT_W - 32.0, 58.0, 20.0, PAPER, 0.0, INK, 3.0, false)}
            <text x={x0 + 32.0} y={cy + 34.0} font-family={DISPLAY} font-weight="500" font-size="15" fill={INK}>{draft}<tspan fill={if caret { INK } else { "#00000000" }}>"|"</tspan></text>
            <text x={x0 + 32.0} y={cy + 34.0} font-family={DISPLAY} font-weight="500" font-size="15" fill={MUTED}>{placeholder.to_owned()}</text>
            <g transform={format!("translate({} {})", send_press * 1.5, send_press * 1.5)}>
                <circle cx={x0 + CHAT_W - 46.0} cy={cy + 29.0} r="20" fill={HOT} stroke={INK} stroke-width="3" />
                <path d={format!("M{} {} h12 m-5 -5 l5 5 l-5 5", x0 + CHAT_W - 52.0, cy + 29.0)} fill="none" stroke={INK} stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
            </g>
        </g>
    )
}
