//! Hive's UI kit redrawn in SVG from web/app/globals.css: tokens, stickers, status pills,
//! task nodes, chat bubbles, buttons. Sizes are the CSS pixel values; the workspace is drawn
//! at CSS size and scaled up as a whole.

use fframes::Svgr;

pub const INK: &str = "#14121a";
pub const INK2: &str = "#24212d";
pub const PAPER: &str = "#fffdf8";
pub const CREAM: &str = "#f5efe4";
pub const BLUE: &str = "#2563eb";
pub const HOT: &str = "#ff5c1a";
pub const GREEN: &str = "#22c55e";
pub const RED: &str = "#ef4444";
pub const PURPLE: &str = "#a855f7";
pub const MUTED: &str = "#14121a9e";

pub const DISPLAY: &str = "Rubik";
pub const MONO: &str = "Space Mono";

/// Space Mono advance width per em.
pub const MONO_ADV: f32 = 0.612;

/// Width of mono text with CSS letter-spacing (em).
pub fn mono_w(text: &str, size: f32, spacing_em: f32) -> f32 {
    text.chars().count() as f32 * size * (MONO_ADV + spacing_em)
}

/// Rough Rubik width (bold), good enough for boxes around short labels.
pub fn display_w(text: &str, size: f32) -> f32 {
    text.chars()
        .map(|c| match c {
            'i' | 'l' | 'j' | '.' | ',' | ':' | '\'' | '!' | '|' => 0.27,
            ' ' => 0.25,
            'f' | 't' | 'r' => 0.38,
            'm' | 'w' => 0.82,
            'M' | 'W' => 0.9,
            c if c.is_uppercase() => 0.66,
            c if c.is_ascii_digit() => 0.58,
            _ => 0.55,
        })
        .sum::<f32>()
        * size
}

pub fn s(v: &str) -> String {
    v.to_owned()
}

/// Rounded rect with an ink border and a hard offset shadow (`box-shadow: dx dy 0 color`).
#[allow(clippy::too_many_arguments)]
pub fn card(x: f32, y: f32, w: f32, h: f32, r: f32, fill: &str, shadow: f32, shadow_color: &str, border: f32, dashed: bool) -> Svgr<'static> {
    let dash = if dashed { "10 7" } else { "none" };
    let shadow_el = if shadow > 0.0 {
        fframes::svgr!(<rect x={x + shadow} y={y + shadow} width={w} height={h} rx={r} fill={s(shadow_color)} />)
    } else {
        Svgr::empty()
    };
    let border_el = if border > 0.0 {
        fframes::svgr!(<rect x={x + border / 2.0} y={y + border / 2.0} width={w - border} height={h - border} rx={(r - border / 2.0).max(0.5)}
            fill="none" stroke={INK} stroke-width={border} stroke-dasharray={dash} />)
    } else {
        Svgr::empty()
    };
    fframes::svgr!(
        <g>
            {shadow_el}
            <rect x={x} y={y} width={w} height={h} rx={r} fill={s(fill)} />
            {border_el}
        </g>
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Todo,
    Ready,
    Running,
    Stale,
    Done,
    Human,
}

impl Status {
    /// (fill, text, dot, label) from the `.hv-s-*` classes and web/AGENTS.md.
    pub fn look(self) -> (&'static str, &'static str, &'static str, &'static str) {
        match self {
            Status::Todo => (PAPER, INK, "#b9b4a8", "TO DO"),
            Status::Ready => (CREAM, INK, INK, "READY"),
            Status::Running => (BLUE, "#ffffff", "#ffffff", "BUILDING…"),
            Status::Stale => (HOT, INK, INK, "STALE · REBUILDING"),
            Status::Done => (GREEN, INK, INK, "DONE ✓"),
            Status::Human => (PAPER, INK, PURPLE, "HUMAN"),
        }
    }
}

/// `.hv-sticker`: mono uppercase pill. Returns the pill and its width.
#[allow(clippy::too_many_arguments)]
pub fn sticker(x: f32, y: f32, text: &str, size: f32, fill: &str, color: &str, dot: Option<&str>, shadow: f32, border: f32) -> (Svgr<'static>, f32) {
    let (text, checked) = match text.strip_suffix(" ✓") { Some(t) => (t, true), None => (text, false) };
    let check_w = if checked { 1.25 * size } else { 0.0 };
    let pad_x = 0.85 * size;
    let pad_y = 0.38 * size;
    let dot_w = if dot.is_some() { 0.62 * size + 0.45 * size } else { 0.0 };
    let tw = mono_w(text, size, 0.06);
    let w = tw + dot_w + check_w + pad_x * 2.0;
    let h = size * 1.1 + pad_y * 2.0 + border * 2.0;
    let dot_el = match dot {
        Some(c) => fframes::svgr!(<circle cx={x + pad_x + 0.31 * size} cy={y + h / 2.0} r={0.31 * size} fill={s(c)} />),
        None => Svgr::empty(),
    };
    let el = fframes::svgr!(
        <g>
            {card(x, y, w, h, h / 2.0, fill, shadow, INK, border, false)}
            {dot_el}
            <text x={x + pad_x + dot_w} y={y + h / 2.0 + size * 0.36} font-family={MONO} font-weight="700"
                font-size={size} letter-spacing={size * 0.06} fill={s(color)}>{text.to_owned()}</text>
            {if checked { check(x + pad_x + dot_w + tw + 0.3 * size, y + h / 2.0, size * 0.85, color) } else { Svgr::empty() }}
        </g>
    );
    (el, w)
}

/// A drawn check mark, left edge at x, vertically centered on y.
pub fn check(x: f32, y: f32, size: f32, color: &str) -> Svgr<'static> {
    let d = format!("M{} {} l{} {} l{} {}", x, y, size * 0.32, size * 0.32, size * 0.58, -size * 0.62);
    fframes::svgr!(<path d={d} fill="none" stroke={s(color)} stroke-width={size * 0.2} stroke-linecap="round" stroke-linejoin="round" />)
}

/// Status pill (`.hv-status`), as on nodes (paper fill) or standalone (status fill).
pub fn status_pill(x: f32, y: f32, st: Status, size: f32, on_node: bool) -> (Svgr<'static>, f32) {
    let (fill, text, dot, label) = st.look();
    let (fill, text, dot) = if on_node {
        let f = if matches!(st, Status::Todo | Status::Human) { CREAM } else { PAPER };
        (f, INK, if matches!(st, Status::Running) { BLUE } else { dot })
    } else {
        (fill, text, dot)
    };
    sticker(x, y, label, size, fill, text, Some(dot), size * 0.18, 2.0)
}

/// Round avatar with initials (`.hv-avatar`).
pub fn avatar(cx: f32, cy: f32, r: f32, initial: &str, color: &str, ring: &str) -> Svgr<'static> {
    fframes::svgr!(
        <g>
            <circle cx={cx} cy={cy} r={r - 1.5} fill={s(color)} stroke={s(ring)} stroke-width="3" />
            <text x={cx} y={cy + r * 0.36} text-anchor="middle" font-family={DISPLAY} font-weight="800"
                font-size={r * 1.0} fill={PAPER}>{initial.to_owned()}</text>
        </g>
    )
}

/// The little robot used for agents.
pub fn robot(x: f32, y: f32, size: f32, color: &str) -> Svgr<'static> {
    let u = size / 16.0;
    fframes::svgr!(
        <g fill="none" stroke={s(color)} stroke-width={1.8 * u} stroke-linecap="round" stroke-linejoin="round">
            <rect x={x + 2.0 * u} y={y + 5.0 * u} width={12.0 * u} height={9.0 * u} rx={2.5 * u} />
            <path d={format!("M{} {} V{}", x + 8.0 * u, y + 5.0 * u, y + 2.0 * u)} />
            <circle cx={x + 8.0 * u} cy={y + 1.6 * u} r={0.9 * u} fill={s(color)} />
            <circle cx={x + 5.6 * u} cy={y + 9.2 * u} r={0.6 * u} fill={s(color)} />
            <circle cx={x + 10.4 * u} cy={y + 9.2 * u} r={0.6 * u} fill={s(color)} />
        </g>
    )
}

/// Hive's hexagon mark from the top bar, `size` px tall, top-left at (x, y).
pub fn logo(x: f32, y: f32, size: f32) -> Svgr<'static> {
    let k = size / 34.0;
    let t = format!("translate({x} {y}) scale({k})");
    fframes::svgr!(
        <g transform={t}>
            <path d="M17 2.5l12.5 7.2v14.6L17 31.5 4.5 24.3V9.7z" fill={HOT} stroke={INK} stroke-width="3" stroke-linejoin="round" />
            <path d="M17 11l6 3.5v7L17 25l-6-3.5v-7z" fill={PAPER} stroke={INK} stroke-width="2.5" stroke-linejoin="round" />
        </g>
    )
}

/// `.hv-btn` pill. `press` 0..1 sinks it into its shadow.
#[allow(clippy::too_many_arguments)]
pub fn button(x: f32, y: f32, label: &str, size: f32, fill: &str, color: &str, shadow: f32, press: f32) -> (Svgr<'static>, f32) {
    let w = display_w(label, size) * 1.08 + size * 4.3;
    let h = size * 2.9;
    let sh = shadow * (1.0 - press) + 1.0 * press;
    let off = (shadow - sh).max(0.0);
    let el = fframes::svgr!(
        <g>
            <rect x={x + shadow} y={y + shadow} width={w} height={h} rx={h / 2.0} fill={INK} />
            <g transform={format!("translate({off} {off})")}>
                {card(x, y, w, h, h / 2.0, fill, 0.0, INK, 3.0, false)}
                <text x={x + size * 1.25} y={y + h / 2.0 + size * 0.36} font-family={DISPLAY} font-weight="700"
                    font-size={size} letter-spacing={-0.02 * size} fill={s(color)}>{label.to_owned()}</text>
                <path d={format!("M{} {} h{} m{} {} l{} {} l{} {}", x + w - size * 1.9, y + h / 2.0, size * 0.75, -size * 0.32, -size * 0.32, size * 0.32, size * 0.32, -size * 0.32, size * 0.32)}
                    fill="none" stroke={s(color)} stroke-width={size * 0.14} stroke-linecap="round" stroke-linejoin="round" />
            </g>
        </g>
    );
    (el, w)
}

pub struct NodeView<'n> {
    pub id: &'n str,
    pub title: &'n str,
    pub status: Status,
    /// Person who took over (initial, color); agent otherwise.
    pub human: Option<(&'n str, &'n str)>,
    pub commit: Option<&'n str>,
    /// Seconds, drives the stripes and the pulse ring of running nodes.
    pub t: f32,
    /// Run stopped: the stripes freeze.
    pub frozen: bool,
}

pub const NODE_W: f32 = 260.0;
pub const NODE_H: f32 = 116.0;

/// `.hv-node` card, top-left at (x, y).
pub fn node(x: f32, y: f32, n: &NodeView) -> Svgr<'static> {
    let (fill, text, _, _) = n.status.look();
    let (w, h) = (NODE_W, NODE_H);
    let running = matches!(n.status, Status::Running | Status::Stale);

    // pulse ring of a running node
    let ring = if n.status == Status::Running && !n.frozen {
        let p = (n.t / 1.4).fract();
        let grow = 18.0 * crate::ease::ease(p);
        fframes::svgr!(<rect x={x - grow} y={y - grow} width={w + 2.0 * grow} height={h + 2.0 * grow} rx={18.0 + grow}
            fill="none" stroke={BLUE} stroke-width={3.0 + grow * 0.6} opacity={0.55 * (1.0 - p)} />)
    } else {
        Svgr::empty()
    };

    // striped progress bar under running / stale nodes
    let bar = if running {
        let (bx, by, bw, bh) = (x + 14.0, y + h - 5.0, w - 28.0, 12.0);
        let shift = if n.frozen { 0.0 } else { (n.t / 0.6).fract() * 22.6 };
        let stripes: Vec<Svgr> = (0..16)
            .map(|i| {
                let sx = bx - 30.0 + i as f32 * 22.6 + shift;
                fframes::svgr!(<path d={format!("M{} {} l11.3 0 l-12 {} l-11.3 0 z", sx, by, bh)} fill={s(fill)} />)
            })
            .collect();
        let clip = format!("bar-{}", n.id);
        fframes::svgr!(
            <g>
                <defs><clipPath id={clip.clone()}><rect x={bx} y={by} width={bw} height={bh} rx="6" /></clipPath></defs>
                <rect x={bx} y={by} width={bw} height={bh} rx="6" fill={PAPER} />
                <g clip-path={format!("url(#{clip})")}>{stripes}</g>
                <rect x={bx} y={by} width={bw} height={bh} rx="6" fill="none" stroke={INK} stroke-width="2.5" />
            </g>
        )
    } else {
        Svgr::empty()
    };

    // who: agent robot pill or the person's avatar
    let who = match n.human {
        None => {
            let pw = mono_w("AGENT", 11.0, 0.0) + 36.0;
            let px = x + w - 16.0 - pw;
            fframes::svgr!(
                <g>
                    {card(px, y + 12.0, pw, 22.0, 11.0, PAPER, 0.0, INK, 2.0, false)}
                    {robot(px + 7.0, y + 15.0, 15.0, INK)}
                    <text x={px + 26.0} y={y + 27.5} font-family={MONO} font-weight="700" font-size="11" fill={INK}>"AGENT"</text>
                </g>
            )
        }
        Some((initial, color)) => {
            let pw = mono_w("HUMAN", 11.0, 0.0) + 34.0;
            let px = x + w - 16.0 - pw;
            fframes::svgr!(
                <g>
                    {card(px, y + 12.0, pw, 22.0, 11.0, PAPER, 0.0, INK, 2.0, false)}
                    {avatar(px + 11.0, y + 23.0, 9.0, initial, color, INK)}
                    <text x={px + 24.0} y={y + 27.5} font-family={MONO} font-weight="700" font-size="11" fill={INK}>"HUMAN"</text>
                </g>
            )
        }
    };

    let commit = match n.commit {
        Some(c) => {
            let cw = mono_w(c, 12.0, 0.0) + 16.0;
            fframes::svgr!(
                <g>
                    <rect x={x + w - 16.0 - cw} y={y + h - 38.0} width={cw} height="21" rx="6" fill={INK} />
                    <text x={x + w - 8.0 - cw} y={y + h - 23.5} font-family={MONO} font-weight="700" font-size="12" fill={GREEN}>{c.to_owned()}</text>
                </g>
            )
        }
        None => Svgr::empty(),
    };

    let (pill, _) = status_pill(x + 16.0, y + h - 42.0, n.status, 11.0, true);
    fframes::svgr!(
        <g>
            {ring}
            {card(x, y, w, h, 18.0, fill, 6.0, INK, 3.0, n.status == Status::Human)}
            <text x={x + 16.0} y={y + 28.0} font-family={MONO} font-weight="700" font-size="12" fill={s(text)} opacity="0.7">{n.id.to_owned()}</text>
            {who}
            <text x={x + 16.0} y={y + 62.0} font-family={DISPLAY} font-weight="800" font-size="20" letter-spacing="-0.6" fill={s(text)}>{n.title.to_owned()}</text>
            {pill}
            {commit}
            {bar}
        </g>
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Who {
    /// Person: name, initial, color.
    Person(&'static str, &'static str, &'static str),
    Planner,
    Builder,
}

/// One chat message (`.hv-msg`): meta row + bubble. Lines are pre-broken. Returns (svg, height).
pub fn message(x: f32, y: f32, w: f32, who: Who, lines: &[&str], extra: Option<(Svgr<'static>, f32)>) -> (Svgr<'static>, f32) {
    let (name, fill, color, border_left, badge) = match who {
        Who::Person(name, initial, c) => (name, PAPER, INK, Some(c), avatar(x + 12.0, y + 11.0, 12.0, initial, c, CREAM)),
        Who::Planner => ("Planner", BLUE, "#ffffff", None, agent_badge(x + 12.0, y + 11.0, BLUE)),
        Who::Builder => ("Builder", INK2, CREAM, None, agent_badge(x + 12.0, y + 11.0, INK2)),
    };
    let line_h = 21.0;
    let (extra_el, extra_h) = extra.unwrap_or((Svgr::empty(), 0.0));
    let bh = lines.len() as f32 * line_h + 22.0 + extra_h;
    let by = y + 30.0;
    let text_x = x + if border_left.is_some() { 20.0 } else { 15.0 };
    let texts: Vec<Svgr> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            fframes::svgr!(<text x={text_x} y={by + 26.0 + i as f32 * line_h} font-family={DISPLAY} font-weight="500" font-size="15" fill={s(color)}>{(*l).to_owned()}</text>)
        })
        .collect();
    let left = match border_left {
        Some(c) => fframes::svgr!(<path d={format!("M{} {} h7 v{} h-7 a4 4 0 0 1 -0 0 z", x, by + 4.0, bh - 8.0)} fill={s(c)} />),
        None => Svgr::empty(),
    };
    let stroke = if who == Who::Builder { "#f5efe480" } else { INK };
    let shadow = if who == Who::Builder { 0.0 } else { 4.0 };
    let el = fframes::svgr!(
        <g>
            {badge}
            <text x={x + 32.0} y={y + 16.0} font-family={DISPLAY} font-weight="700" font-size="14" fill={CREAM}>{name.to_owned()}</text>
            <rect x={x + shadow} y={by + shadow} width={w} height={bh} rx="14" fill="#f5efe447" />
            <rect x={x} y={by} width={w} height={bh} rx="14" fill={s(fill)} stroke={s(stroke)} stroke-width="2.5" />
            {left}
            {texts}
            <g transform={format!("translate({} {})", text_x, by + 14.0 + lines.len() as f32 * line_h)}>{extra_el}</g>
        </g>
    );
    (el, 30.0 + bh + 16.0)
}

fn agent_badge(cx: f32, cy: f32, fill: &str) -> Svgr<'static> {
    fframes::svgr!(
        <g>
            <circle cx={cx} cy={cy} r="10.5" fill={s(fill)} stroke={CREAM} stroke-width="2" />
            {robot(cx - 7.0, cy - 7.5, 14.0, CREAM)}
        </g>
    )
}

/// A row of small stickers (`.hv-sticker--op`, `.hv-cite`), wrapped at `max_w`. Returns (svg, height).
pub fn chips(items: &[(&str, &str, &str)], size: f32, max_w: f32, appear: &[f32]) -> (Svgr<'static>, f32) {
    let (mut cx, mut cy) = (0.0, 0.0);
    let mut out = Vec::new();
    let h = size * 1.1 + size * 0.76 + 4.0;
    for (i, (label, fill, color)) in items.iter().enumerate() {
        let w = mono_w(label, size, 0.06) + size * 1.4;
        if cx + w > max_w && cx > 0.0 {
            cx = 0.0;
            cy += h + 6.0;
        }
        let a = appear.get(i).copied().unwrap_or(1.0);
        if a > 0.0 {
            let (el, _) = sticker(cx, cy, label, size, fill, color, None, 2.0, 2.0);
            let k = 0.85 + 0.15 * a;
            out.push(fframes::svgr!(<g opacity={a.min(1.0)} transform={format!("translate({} {}) scale({k}) translate({} {})", cx + w / 2.0, cy + h / 2.0, -cx - w / 2.0, -cy - h / 2.0)}>{el}</g>));
        }
        cx += w + 6.0;
    }
    (fframes::svgr!(<g>{out}</g>), cy + h)
}

/// Dot field background (`radial-gradient(var(--ink) 1.2px ...)` at 28px, ~.12 opacity).
pub fn dots(x: f32, y: f32, w: f32, h: f32, gap: f32, color: &str, opacity: f32) -> Svgr<'static> {
    let id = format!("dots-{}-{}", gap as i32, (opacity * 100.0) as i32);
    fframes::svgr!(
        <g>
            <defs>
                <pattern id={id.clone()} x={x} y={y} width={gap} height={gap} patternUnits="userSpaceOnUse">
                    <circle cx={gap / 2.0} cy={gap / 2.0} r="1.3" fill={s(color)} />
                </pattern>
            </defs>
            <rect x={x} y={y} width={w} height={h} fill={format!("url(#{id})")} opacity={opacity} />
        </g>
    )
}

/// Mouse pointer, tip at (x, y).
pub fn cursor(x: f32, y: f32, scale: f32) -> Svgr<'static> {
    fframes::svgr!(
        <g transform={format!("translate({x} {y}) scale({scale})")}>
            <path d="M0 0 L0 22 L6 16.5 L10 25 L14 23 L10 15 L18 15 Z" fill={PAPER} stroke={INK} stroke-width="2.4" stroke-linejoin="round" />
        </g>
    )
}

/// `.hv-spinner`.
pub fn spinner(cx: f32, cy: f32, r: f32, t: f32, color: &str) -> Svgr<'static> {
    let a = (t / 0.7).fract() * 360.0;
    fframes::svgr!(
        <g transform={format!("rotate({a} {cx} {cy})")}>
            <path d={format!("M{} {} A{r} {r} 0 1 1 {} {}", cx + r, cy, cx, cy - r)} fill="none" stroke={s(color)} stroke-width="3" stroke-linecap="round" />
        </g>
    )
}
