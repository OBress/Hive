//! Scene renderers. Motion borrowed from the reference: glyph fields that build 3D shapes, a
//! loading line, a particle burst, a zoom that dives into the glyphs, glyphs resolving into the
//! real page, glyph-block wipes between light and dark, a ticking counter, and a closing zoom
//! out to a mosaic of real Hive screens that fly into giant letters.
//! The product demo in the middle is real app footage (`demo`); the animated workspace scenes
//! (plan, stale, conflict, memory, ship) are kept for reference but no longer in the cut.
#![allow(dead_code)]

use crate::ascii::{self, Canvas, Grid};
use crate::ease::*;
use crate::ui::*;
use crate::workspace;
use crate::{DEMO, Kind, cue, cue_n, demo_end, seg_start};
use fframes::{FFramesContext, FFramesSyncedVideoFrame, Frame, Svgr, SyncVideoFrameInput};

pub fn render<'a>(kind: Kind, t: f32, frame: Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
    match kind {
        Kind::Hook => hook(t),
        Kind::Problem => problem(t),
        Kind::Intro => intro(t, ctx),
        Kind::Demo(i) => demo(i, t, &frame, ctx),
        Kind::Outro => outro(t, ctx),
    }
}

fn smooth(e0: f32, e1: f32, x: f32) -> f32 {
    let p = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    p * p * (3.0 - 2.0 * p)
}

fn noise(c: usize, r: usize) -> f32 {
    hash2(c as u32 * 31 + 7, r as u32 * 17 + 3)
}

fn rbox(px: f32, py: f32, cx: f32, cy: f32, hw: f32, hh: f32, r: f32) -> f32 {
    let qx = (px - cx).abs() - hw + r;
    let qy = (py - cy).abs() - hh + r;
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    outside + qx.max(qy).min(0.0) - r
}

fn seg_dist(px: f32, py: f32, a: (f32, f32), b: (f32, f32)) -> f32 {
    let (vx, vy) = (b.0 - a.0, b.1 - a.1);
    let l2 = (vx * vx + vy * vy).max(1e-3);
    let h = (((px - a.0) * vx + (py - a.1) * vy) / l2).clamp(0.0, 1.0);
    ((px - a.0 - vx * h).powi(2) + (py - a.1 - vy * h).powi(2)).sqrt()
}

// ---------------------------------------------------------------- futuristic overlays

/// Scanlines and a vignette over dark scenes.
fn crt(strength: f32) -> Svgr<'static> {
    fframes::svgr!(
        <g opacity={strength}>
            <defs>
                <pattern id="scan" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
                    <rect x="0" y="0" width="4" height="1.4" fill="#000000" />
                </pattern>
                <radialGradient id="vig" cx="50%" cy="50%" r="75%">
                    <stop offset="55%" stop-color="#000000" stop-opacity="0" />
                    <stop offset="100%" stop-color="#000000" stop-opacity="0.7" />
                </radialGradient>
            </defs>
            <rect width="1920" height="1080" fill="url(#scan)" opacity="0.35" />
            <rect width="1920" height="1080" fill="url(#vig)" />
        </g>
    )
}

/// Corner brackets, labels and a timecode, like a system HUD.
fn hud(t: f32, label: &str, alpha: f32) -> Svgr<'static> {
    if alpha <= 0.0 {
        return Svgr::empty();
    }
    let bracket = |x: f32, y: f32, dx: f32, dy: f32| fframes::svgr!(<path d={format!("M{} {} V{} H{}", x, y + dy * 34.0, y, x + dx * 34.0)} fill="none" stroke={CREAM} stroke-width="2" />);
    let frames = (t * 30.0) as u32;
    let tc = format!("T+{:02}:{:02}:{:02}", (t as u32) / 60, (t as u32) % 60, frames % 30);
    let blink = if (t * 2.0).fract() < 0.5 { 1.0 } else { 0.3 };
    fframes::svgr!(
        <g opacity={alpha * 0.55}>
            {bracket(48.0, 48.0, 1.0, 1.0)}
            {bracket(1872.0, 48.0, -1.0, 1.0)}
            {bracket(48.0, 1032.0, 1.0, -1.0)}
            {bracket(1872.0, 1032.0, -1.0, -1.0)}
            <circle cx="98" cy="74" r="5" fill={HOT} opacity={blink} />
            <text x="112" y="80" font-family={MONO} font-weight="700" font-size="16" letter-spacing="3" fill={CREAM}>{label.to_owned()}</text>
            <text x="1822" y="80" text-anchor="end" font-family={MONO} font-weight="700" font-size="16" letter-spacing="3" fill={CREAM}>{tc}</text>
        </g>
    )
}

/// Thin loading line with a mono label and percent, centered at y.
fn loading(y: f32, w: f32, p: f32, label: &str, alpha: f32) -> Svgr<'static> {
    if alpha <= 0.0 {
        return Svgr::empty();
    }
    let x = 960.0 - w / 2.0;
    fframes::svgr!(
        <g opacity={alpha}>
            <rect x={x} y={y} width={w} height="3" fill={CREAM} opacity="0.18" />
            <rect x={x} y={y} width={(w * p).max(0.5)} height="3" fill={CREAM} />
            <text x={x} y={y - 14.0} font-family={MONO} font-weight="700" font-size="15" letter-spacing="3" fill={CREAM} opacity="0.8">{label.to_owned()}</text>
            <text x={x + w} y={y - 14.0} text-anchor="end" font-family={MONO} font-weight="700" font-size="15" letter-spacing="2" fill={CREAM} opacity="0.8">{format!("{:>3}%", (p * 100.0) as u32)}</text>
        </g>
    )
}

/// Small mono callout with a leader line, for floating annotations.
fn tag(x: f32, y: f32, tx: f32, ty: f32, text: &str, color: &str, a: f32) -> Svgr<'static> {
    if a <= 0.0 {
        return Svgr::empty();
    }
    let w = mono_w(text, 14.0, 0.12) + 18.0;
    fframes::svgr!(
        <g opacity={a}>
            <path d={format!("M{x} {y} L{tx} {ty}")} stroke={s(color)} stroke-width="1.5" opacity="0.7" />
            <circle cx={x} cy={y} r="3.5" fill={s(color)} />
            <rect x={tx} y={ty - 13.0} width={w} height="26" fill={INK} stroke={s(color)} stroke-width="1.5" />
            <text x={tx + 9.0} y={ty + 5.0} font-family={MONO} font-weight="700" font-size="14" letter-spacing="1.7" fill={s(color)}>{text.to_owned()}</text>
        </g>
    )
}

// ---------------------------------------------------------------- hook

const NET_N: usize = 18;

/// Positions of the people/agent network at t: (x, y, depth scale, is_agent).
fn network(t: f32, radius: f32) -> Vec<(f32, f32, f32, bool)> {
    let yaw = t * 0.45;
    let pitch: f32 = 0.38;
    (0..NET_N)
        .map(|i| {
            let k = i as f32 + 0.5;
            let phi = (1.0 - 2.0 * k / NET_N as f32).acos();
            let theta = std::f32::consts::PI * (1.0 + 5f32.sqrt()) * k;
            let (x, y, z) = (phi.sin() * theta.cos(), phi.cos(), phi.sin() * theta.sin());
            let (sy, cy) = yaw.sin_cos();
            let (x, z) = (x * cy + z * sy, -x * sy + z * cy);
            let (sp, cp) = pitch.sin_cos();
            let (y, z) = (y * cp - z * sp, y * sp + z * cp);
            let persp = 1.0 / (1.0 + z * 0.35);
            (960.0 + x * radius * persp, 520.0 + y * radius * persp, persp, i % 2 == 1)
        })
        .collect()
}

/// Lit glyph agent: a rounded box with two eye holes.
fn agent_glyph(px: f32, py: f32, x: f32, y: f32, size: f32) -> f32 {
    let d = rbox(px, py, x, y, size, size * 0.8, size * 0.35);
    if d >= 0.0 {
        return 0.0;
    }
    let eye = ascii::sphere(px, py, x - size * 0.38, y - size * 0.05, size * 0.2).max(ascii::sphere(px, py, x + size * 0.38, y - size * 0.05, size * 0.2));
    if eye > 0.0 { 0.0 } else { 0.5 + 0.5 * ((y - py) / size + 0.6).clamp(0.0, 1.0) }
}

/// "Software is now built by people and AI agents, side by side."
fn hook(t: f32) -> Svgr<'static> {
    let g = Grid::screen(16.0);
    let tick = (t * 12.0) as u32;
    let software = cue("hook", "Software");
    let people = cue("hook", "people");
    let agents = cue("hook", "agents");
    let side = cue("hook", "side");
    let into_problem = seg_start("problem") - 0.2;

    let sphere_r = 210.0 * pop(prog(t, software - 0.1, software + 0.45)) * (1.0 - in_out(prog(t, people - 0.1, people + 0.35)));
    let spread = bounce(prog(t, people - 0.1, people + 0.7));
    let nodes = network(t, 380.0 * spread);
    let agents_in = pop(prog(t, agents - 0.1, agents + 0.35));
    let links = smooth(side - 0.1, side + 0.4, t);
    let lat = t * 2.2;

    let field = ascii::render(&g, &[CREAM, HOT, "#f5efe480"], tick, 0.07, |c, r| {
        let (px, py) = g.center(c, r);
        let mut best = (0.0f32, 0usize);
        // the glyph sphere, banded so it reads as spinning
        if sphere_r > 1.0 {
            let v = ascii::sphere(px, py, 960.0, 520.0, sphere_r);
            if v > 0.0 {
                let nx = (px - 960.0) / sphere_r;
                let band = ((nx * 6.0 + lat).sin() * 0.5 + 0.5) * 0.35 + 0.65;
                best = (v * band, 0);
            }
        }
        // links between people and agents
        if links > 0.0 {
            for i in 0..NET_N {
                for &b in &[(i + 1) % NET_N, (i + 5) % NET_N] {
                    let (ax, ay, ap, _) = nodes[i];
                    let (bx, by, bp, _) = nodes[b];
                    if seg_dist(px, py, (ax, ay), (bx, by)) < 3.5 {
                        let flicker = if hash2((i * 31 + b) as u32, tick / 2) < 0.1 { 0.5 } else { 1.0 };
                        let v = 0.33 * links * (ap + bp) * 0.5 * flicker;
                        if v > best.0 {
                            best = (v, 2);
                        }
                    }
                }
            }
        }
        // nodes: people are lit spheres, agents are lit boxes with eyes
        if spread > 0.0 {
            for &(x, y, persp, agent) in &nodes {
                let size = 46.0 * persp * spread;
                let depth = (persp - 0.55).clamp(0.35, 1.0) * 1.15;
                let (v, tone) = if agent {
                    if agents_in <= 0.0 {
                        continue;
                    }
                    (agent_glyph(px, py, x, y, size * agents_in) * depth, 1)
                } else {
                    (ascii::sphere(px, py, x, y, size) * depth, 0)
                };
                if v > best.0 {
                    best = (v, tone);
                }
            }
        }
        best
    });

    let tags = {
        let a = smooth(side, side + 0.3, t) * (1.0 - smooth(into_problem - 0.2, into_problem, t));
        let pick = |i: usize| nodes.get(i).copied().unwrap_or((960.0, 540.0, 1.0, false));
        let (x0, y0, _, _) = pick(4);
        let (x1, y1, _, _) = pick(9);
        let (x2, y2, _, _) = pick(13);
        fframes::svgr!(
            <g>
                {tag(x0, y0, x0 - 260.0, y0 - 70.0, "MAYA · HUMAN", CREAM, a)}
                {tag(x1, y1, x1 + 90.0, y1 - 90.0, "BUILDER-2 · AGENT", HOT, a)}
                {tag(x2, y2, x2 + 100.0, y2 + 80.0, "PLANNER · AGENT", HOT, a)}
            </g>
        )
    };
    let boot = in_out(prog(t, 0.0, software + 0.2));
    fframes::svgr!(
        <g>
            <rect width="1920" height="1080" fill={INK} />
            {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, CREAM, 0.06)}
            {field}
            {tags}
            {loading(980.0, 420.0, boot, "BOOTING HIVE//SIGNAL", 1.0 - smooth(software + 0.3, software + 0.7, t))}
            {hud(t, "HIVE // 2026", smooth(0.1, 0.5, t))}
            {crt(1.0)}
        </g>
    )
}

// ---------------------------------------------------------------- problem

const WIN: [(f32, &str, &str); 3] = [(400.0, "TAB", "AGENT 01"), (960.0, "CHAT", "AGENT 02"), (1520.0, "BRANCH", "AGENT 03")];

/// "But every agent works alone: its own tab, its own chat, its own branch. Nobody sees what
/// the others are doing. Decisions get lost, and work collides." Ends diving into the glyphs.
fn problem(t: f32) -> Svgr<'static> {
    let g = Grid::screen(16.0);
    let tick = (t * 12.0) as u32;
    let s0 = seg_start("problem") - 0.2;
    let alone = cue("problem", "alone");
    let opens = [cue_n("problem", "own", 0), cue_n("problem", "own", 1), cue_n("problem", "own", 2)];
    let nobody = cue("problem", "Nobody");
    let lost = cue("problem", "Decisions");
    let collide_at = cue("problem", "collides") + 0.18;
    let end = seg_start("intro") - 0.2;
    let dive_start = collide_at + 0.75;

    let net = network(t, 380.0);
    let gather = in_out(prog(t, alone - 0.6, opens[0] + 0.2));
    let break_links = smooth(s0 + 0.2, alone, t);
    // the outer windows slam into the middle one
    let slam = expo_in(prog(t, collide_at - 0.38, collide_at));
    let win_x = |i: usize| -> f32 {
        let x = WIN[i].0;
        mix(x, 960.0 + (x - 960.0) * 0.12, slam)
    };
    let shake = if t > collide_at { 26.0 * (1.0 - prog(t, collide_at, collide_at + 0.6)) } else { 0.0 };
    let (shx, shy) = ((hash2(tick, 1) - 0.5) * shake, (hash2(tick, 2) - 0.5) * shake);
    let glitch = smooth(nobody - 0.05, nobody + 0.15, t) * (1.0 - smooth(lost + 0.6, lost + 1.0, t));
    let fall = prog(t, lost, lost + 1.6);

    // burst particles after the collision
    let mut canvas = Canvas::new(g);
    if t > collide_at {
        let dt = t - collide_at;
        for i in 0..1600u32 {
            let ang = -std::f32::consts::FRAC_PI_2 + (hash(i * 3 + 1) - 0.5) * 3.4;
            let speed = 350.0 + 1500.0 * hash(i * 3 + 2).powf(1.6);
            for trail in 0..3 {
                let tt = (dt - trail as f32 * 0.025).max(0.0);
                let x = 960.0 + ang.cos() * speed * tt;
                let y = 560.0 + ang.sin() * speed * tt + 0.5 * 1100.0 * tt * tt;
                canvas.splat(x + shx, y + shy, 0.55 - trail as f32 * 0.15, if hash(i) < 0.35 { 1 } else { 0 });
            }
        }
    }
    let dense = smooth(collide_at + 0.25, dive_start + 0.2, t);

    let field_fn = |c: usize, r: usize| -> (f32, usize) {
        let (px0, py0) = g.center(c, r);
        let (px, py) = (px0 - shx, py0 - shy);
        let mut best = (0.0f32, 0usize);
        let (pv, pt) = canvas.get(c, r);
        if pv > 0.0 {
            best = (pv, pt);
        }
        if dense > 0.0 {
            let n = noise(c, r);
            let wave = ((c as f32 * 0.21 + t * 3.0).sin() * (r as f32 * 0.17 - t * 2.0).cos()) * 0.25 + 0.6;
            if n < dense {
                let v = wave * (0.55 + 0.45 * hash2((c * 7 + r) as u32, tick / 3));
                if v > best.0 {
                    best = (v, if n < 0.12 * dense { 1 } else { 0 });
                }
            }
        }
        if t >= collide_at + 0.05 {
            return best;
        }
        // nodes drifting into their windows; one agent and its people per window
        for (i, &(nx, ny, persp, agent)) in net.iter().enumerate() {
            let home = i % 3;
            let hx = win_x(home) + if agent { 0.0 } else { (i as f32 % 2.0 - 0.5) * 120.0 };
            let hy = 600.0 + if agent { -40.0 } else { 70.0 };
            let x = mix(nx, hx, gather);
            let y = mix(ny, hy, gather);
            let keep = !agent || i % 6 == 1 || i % 6 == 3 || i % 6 == 5;
            let fade = if keep { 1.0 } else { 1.0 - gather };
            let size = mix(46.0 * persp, if agent { 58.0 } else { 34.0 }, gather) * fade;
            if size < 1.0 {
                continue;
            }
            let (v, tone) = if agent { (agent_glyph(px, py, x, y, size), 1) } else { (ascii::sphere(px, py, x, y, size), 0) };
            if v > best.0 {
                best = (v, tone);
            }
        }
        // the old links snapping
        if break_links < 1.0 {
            for i in 0..NET_N {
                if hash2(i as u32, 9) < break_links {
                    continue;
                }
                let (ax, ay, _, _) = net[i];
                let (bx, by, _, _) = net[(i + 1) % NET_N];
                if seg_dist(px, py, (ax, ay), (bx, by)) < 3.5 && best.0 < 0.3 {
                    best = (0.3 * (1.0 - break_links), 2);
                }
            }
        }
        // windows: frame, header strip, context lines that fall out when decisions get lost
        for (i, &open_at) in opens.iter().enumerate() {
            let open = pop(prog(t, open_at - 0.15, open_at + 0.3));
            if open <= 0.0 {
                continue;
            }
            let jitter = if glitch > 0.0 && hash2(r as u32, tick / 2 + i as u32 * 7) < 0.3 * glitch { (hash2(r as u32, tick) - 0.5) * 60.0 } else { 0.0 };
            let (cx, cy) = (win_x(i), 560.0);
            let (hw, hh) = (230.0 * open, 250.0 * open);
            let d = rbox(px + jitter, py, cx, cy, hw, hh, 22.0);
            if d.abs() < 6.0 {
                best = (0.85, 2);
            } else if d < 0.0 && py < cy - hh + 54.0 {
                if best.0 < 0.3 {
                    best = (0.3, 2);
                }
            } else if d < 0.0 {
                let line = ((py - (cy + 120.0)) / 22.0).floor();
                if (0.0..5.0).contains(&line) {
                    let li = line as usize;
                    let lw = 120.0 + 200.0 * hash2(i as u32, li as u32);
                    let drop = fall * fall * (500.0 + 300.0 * hash2(li as u32, i as u32 + 3)) * (0.6 + 0.4 * hash2(c as u32, li as u32));
                    let ly = cy + 120.0 + li as f32 * 22.0 + drop;
                    let in_line = (py - ly).abs() < 6.0 && (px - (cx - hw + 40.0)) > 0.0 && (px - (cx - hw + 40.0)) < lw;
                    let gone = fall > 0.0 && noise(c, r) < fall;
                    if in_line && !gone && best.0 < 0.55 {
                        best = (0.55, 0);
                    }
                }
            }
        }
        best
    };

    // the dive: zoom into the dense glyph field until single glyphs fill the screen
    let z = 1.0 + 30.0 * expo_in(prog(t, dive_start, end));
    let field = ascii::zoom_field(&g, z, (961.0, 541.0), &[CREAM, HOT, "#f5efe4b3"], tick, 0.07, &field_fn);

    let labels: Vec<Svgr> = (0..3)
        .map(|i| {
            let open = pop(prog(t, opens[i] - 0.15, opens[i] + 0.3));
            let gone = 1.0 - smooth(collide_at - 0.1, collide_at + 0.05, t);
            let a = open.min(1.0) * gone;
            if a <= 0.0 {
                return Svgr::empty();
            }
            let (x, y) = (win_x(i) - 200.0 + shx, 560.0 - 250.0 + 14.0 + shy);
            let (st, w) = sticker(x, y, WIN[i].1, 15.0, if i == 1 { HOT } else { INK }, if i == 1 { INK } else { CREAM }, Some(if i == 1 { INK } else { HOT }), 0.0, 2.0);
            fframes::svgr!(
                <g opacity={a}>
                    {st}
                    <text x={x + w + 14.0} y={y + 20.0} font-family={MONO} font-weight="700" font-size="14" letter-spacing="2" fill={CREAM} opacity="0.7">{WIN[i].2.to_owned()}</text>
                </g>
            )
        })
        .collect();
    let blocked = {
        let a = smooth(nobody, nobody + 0.25, t) * (1.0 - smooth(lost + 0.3, lost + 0.7, t));
        let xs: Vec<Svgr> = [680.0f32, 1240.0]
            .iter()
            .enumerate()
            .map(|(i, &x)| {
                let p = prog(t, nobody + i as f32 * 0.25, nobody + 0.35 + i as f32 * 0.25);
                let (x1, x2) = (x - 40.0, x + 40.0);
                fframes::svgr!(
                    <g>
                        <path d={format!("M{} 560 L{} 560", x - 50.0, x - 50.0 + 100.0 * p)} stroke={CREAM} stroke-width="3" stroke-dasharray="6 8" opacity="0.6" />
                        <g opacity={smooth(0.6, 1.0, p)}>
                            <path d={format!("M{} 540 L{} 580 M{} 540 L{} 580", x1 + 20.0, x2 - 20.0, x2 - 20.0, x1 + 20.0)} stroke={RED} stroke-width="7" stroke-linecap="round" />
                        </g>
                    </g>
                )
            })
            .collect();
        fframes::svgr!(<g opacity={a}>{xs}</g>)
    };
    let flash = if t > collide_at { 0.75 * (1.0 - prog(t, collide_at, collide_at + 0.35)) } else { 0.0 };
    let hud_a = 1.0 - smooth(dive_start, dive_start + 0.4, t);
    fframes::svgr!(
        <g>
            <rect width="1920" height="1080" fill={INK} />
            {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, CREAM, 0.06)}
            {field}
            {labels}
            {blocked}
            <rect width="1920" height="1080" fill={CREAM} opacity={flash} />
            {hud(t, "SIGNAL // FRAGMENTED", hud_a)}
            {crt(1.0)}
        </g>
    )
}

// ---------------------------------------------------------------- intro

/// "Hive fixes that: one live task graph where your whole team and its agents build together."
/// A 3D Hive mark spins in the glyph field while a loading line fills, the camera dives into its
/// center and the real landing page opens out of it, then Ana types her name and joins: the
/// orange of the button floods the screen and the demo starts on her laptop.
fn intro<'a>(t: f32, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
    let s0 = seg_start("intro") - 0.2;
    let end = seg_start("plan") - 0.2;
    let r = t - s0;
    let tick = (t * 12.0) as u32;

    // 1. the glyph logo spins, then the camera dives into its middle
    let dive = expo_in(prog(r, 1.35, 2.3));
    let open = in_out(prog(r, 1.9, 2.6));
    let mark = if open < 1.0 {
        let g = Grid::screen(16.0);
        let condense = smooth(0.0, 0.45, r);
        // two full turns that slow down and land face-on just before the dive
        let yaw = std::f32::consts::PI * 4.0 * expo_out(prog(r, 0.0, 1.65));
        let pitch = 0.32 * (r * 1.4).sin() * (1.0 - in_out(prog(r, 0.9, 1.6)));
        let scale = 300.0 * (1.0 + 0.12 * r) * (1.0 + 16.0 * dive);
        let el = ascii::render(&g, &[HOT, CREAM], tick, 0.06, |c, rr| {
            let (px, py) = g.center(c, rr);
            let hit = ascii::logo3d((px - 960.0) / scale, (py - 500.0) / scale, yaw, pitch);
            let n = noise(c, rr);
            match hit {
                Some((v, m)) if n < condense.max(0.05) || condense >= 1.0 => (v, m),
                Some(_) => (0.5 * (1.0 - condense), 1),
                None => {
                    if n > condense && hash2((c * 3 + rr) as u32, 5) < 0.55 { (0.55 * (1.0 - condense), 1) } else { (0.0, 0) }
                }
            }
        });
        fframes::svgr!(<g opacity={1.0 - open}>{el}</g>)
    } else {
        Svgr::empty()
    };
    let load = loading(860.0, 520.0, ease(prog(r, 0.05, 1.5)), "INITIALIZING HIVE", 1.0 - smooth(1.45, 1.75, r));

    // 2. the landing page opens out of the mark's center as a growing hexagon
    let page = if open > 0.0 {
        let radius = 30.0 + 2300.0 * open;
        let hex_pts: String = (0..6)
            .map(|i| {
                let a = std::f32::consts::FRAC_PI_3 * i as f32 - std::f32::consts::FRAC_PI_2;
                format!("{},{} ", 960.0 + radius * a.cos(), 500.0 + radius * a.sin())
            })
            .collect();
        let settle = 1.0 + 0.08 * (1.0 - ease(prog(r, 1.9, 3.0)));
        // a gentle push toward the name field so the typing reads (1.2x at most)
        let push = in_out(prog(r, 2.6, 3.25));
        let (fx, fy) = (mix(960.0, 800.0, push), mix(500.0, 580.0, push));
        let z = settle * (1.0 + 0.2 * push);
        let image = match ctx.get_image("hero.jpg").map(|i| i.href()) {
            Some(href) => fframes::svgr!(<image href={href} x="0" y="0" width="1920" height="1080" />),
            None => Svgr::empty(),
        };

        // 3. Ana clicks "Your name", types it, and joins
        let (field_x, field_y) = (490.0, 616.0);
        let (btn_x, btn_y) = (756.0, 616.0);
        let click_field = 3.2;
        let click_btn = 4.35;
        let to_field = in_out(prog(r, 2.55, 3.1));
        let to_btn = in_out(prog(r, 3.85, 4.25));
        let (cx, cy) = (mix(mix(1380.0, field_x, to_field), btn_x, to_btn), mix(mix(930.0, field_y, to_field), btn_y + 6.0, to_btn));
        let typed: String = "Ana".chars().take(((r - 3.35) / 0.15).clamp(0.0, 3.0) as usize).collect();
        let focused = r >= click_field && r < click_btn + 0.1;
        let field = if r >= click_field {
            let caret = if focused && (r * 2.2).fract() < 0.6 { 1.0 } else { 0.0 };
            let cw = display_w(&typed, 19.0);
            fframes::svgr!(
                <g>
                    <rect x="384" y="586" width="214" height="61" rx="30.5" fill={PAPER} stroke={if focused { BLUE } else { INK }} stroke-width="3" />
                    <text x="404" y="623" font-family={DISPLAY} font-weight="500" font-size="19" fill={INK}>{typed.clone()}</text>
                    <rect x={405.0 + cw} y="603" width="2" height="26" fill={INK} opacity={caret} />
                </g>
            )
        } else {
            Svgr::empty()
        };
        let press = |at: f32| -> f32 { if r >= at && r < at + 0.14 { 0.86 } else { 1.0 } };
        let cursor = if r >= 2.5 {
            let k = press(click_field).min(press(click_btn));
            fframes::svgr!(
                <g opacity={smooth(2.5, 2.7, r)} transform={format!("translate({cx} {cy}) scale({k})")}>
                    <path d="M0 0 L0 34 L9 26.5 L15.5 40 L21.5 37.5 L15.5 24.5 L27 24.5 Z" fill={INK} stroke={PAPER} stroke-width="2.4" stroke-linejoin="round" />
                </g>
            )
        } else {
            Svgr::empty()
        };
        // the button's orange floods out and becomes the demo's first frame
        let flood = in_out(prog(r, click_btn + 0.08, end - s0));
        let flood_el = if flood > 0.0 {
            { let (sx, sy) = (960.0 + (btn_x - fx) * z, 500.0 + (btn_y - fy) * z); fframes::svgr!(<circle cx={sx} cy={sy} r={20.0 + 2300.0 * flood} fill={HOT} />) }
        } else {
            Svgr::empty()
        };
        fframes::svgr!(
            <g>
                <defs><clipPath id="wipe"><polygon points={hex_pts} /></clipPath></defs>
                <g clip-path="url(#wipe)">
                    <g transform={format!("translate(960 500) scale({z}) translate({} {})", -fx, -fy)}>
                        <rect width="1920" height="1080" fill={CREAM} />
                        {image}
                        {field}
                        {cursor}
                    </g>
                    {flood_el}
                </g>
            </g>
        )
    } else {
        Svgr::empty()
    };
    fframes::svgr!(
        <g>
            <rect width="1920" height="1080" fill={INK} />
            {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, CREAM, 0.06)}
            {mark}
            {load}
            <g opacity={1.0 - open}>{crt(1.0)}{hud(t, "HIVE // ONLINE", 1.0 - smooth(1.4, 1.8, r))}</g>
            {page}
        </g>
    )
}

// ---------------------------------------------------------------- chapters + transitions

/// Chapter stickers over the product scenes: number, title, colors, show from/until.
fn chapters() -> Vec<(&'static str, &'static str, &'static str, &'static str, f32, f32)> {
    vec![
        ("01", "ONE MESSAGE → A TASK GRAPH", BLUE, "#ffffff", seg_start("plan") + 0.1, seg_start("plan") + 3.4),
        ("02", "LIVE ON EVERY SCREEN", PAPER, INK, seg_start("sync") - 0.1, seg_start("sync") + 2.8),
        ("03", "AGENTS BUILD IN THE OPEN", GREEN, INK, seg_start("run") - 0.1, seg_start("run") + 2.8),
        ("04", "REDIRECT AN AGENT MID-RUN", HOT, INK, seg_start("steer") - 0.1, seg_start("steer") + 2.8),
        ("05", "TAKE OVER · HAND BACK", PAPER, INK, seg_start("takeover") - 0.1, seg_start("takeover") + 2.8),
    ]
}

fn chapter_sticker(t: f32) -> Svgr<'static> {
    let mut out = Vec::new();
    for (num, title, fill, color, at, until) in chapters() {
        if t < at || t > until + 0.5 {
            continue;
        }
        let inp = bounce(prog(t, at, at + 0.55));
        let outp = expo_in(prog(t, until, until + 0.4));
        let x = mix(-760.0, 64.0, inp) - 900.0 * outp;
        let y = 948.0;
        let num_w = 64.0;
        let (st, _) = sticker(x + num_w + 10.0, y, title, 24.0, fill, color, None, 5.0, 3.0);
        let rot = -2.5 * (1.0 - outp) + 3.0 * (1.0 - inp);
        out.push(fframes::svgr!(
            <g transform={format!("rotate({rot} {} {})", x + 200.0, y + 30.0)}>
                {card(x, y - 2.0, num_w, 60.0, 14.0, INK, 5.0, HOT, 3.0, false)}
                <text x={x + num_w / 2.0} y={y + 39.0} text-anchor="middle" font-family={MONO} font-weight="700" font-size="28" fill={CREAM}>{num.to_owned()}</text>
                {st}
            </g>
        ));
    }
    fframes::svgr!(<g>{out}</g>)
}

fn with_chapter(t: f32, body: Svgr<'static>) -> Svgr<'static> {
    fframes::svgr!(<g>{body}{chapter_sticker(t)}</g>)
}

/// Glyph-block wipe: blocks flip from `over` to `under` in a sweeping random order as p goes
/// 0 -> 1, flashing a big glyph on each block while it flips.
fn block_wipe(p: f32, id: &str, over: Svgr<'static>, under: Svgr<'static>, glyph_color: &str, t: f32) -> Svgr<'static> {
    if p <= 0.0 {
        return over;
    }
    if p >= 1.0 {
        return under;
    }
    let size = 120.0;
    let mut rects = Vec::new();
    let mut sparks = Vec::new();
    let tick = (t * 20.0) as u32;
    for by in 0..9u32 {
        for bx in 0..16u32 {
            let th = (bx as f32 / 16.0) * 0.55 + hash2(bx, by + 40) * 0.45;
            if th < p {
                rects.push(fframes::svgr!(<rect x={bx as f32 * size} y={by as f32 * size} width={size} height={size} />));
                if p - th < 0.12 {
                    let ch = ['0', '#', '8', '@', '+'][(hash2(bx * 7 + by, tick) * 5.0) as usize % 5];
                    sparks.push(fframes::svgr!(
                        <g>
                            <rect x={bx as f32 * size} y={by as f32 * size} width={size} height={size} fill={INK} />
                            <text x={bx as f32 * size + size / 2.0} y={by as f32 * size + size * 0.72} text-anchor="middle" font-family={MONO} font-weight="700" font-size={size * 0.8} fill={s(glyph_color)}>{ch.to_string()}</text>
                        </g>
                    ));
                }
            }
        }
    }
    let clip = format!("wipe-{id}");
    fframes::svgr!(
        <g>
            {over}
            <defs><clipPath id={clip.clone()}>{rects}</clipPath></defs>
            <g clip-path={format!("url(#{clip})")}>{under}</g>
            {sparks}
        </g>
    )
}

/// Plan: out of the orange button into the live workspace.
fn plan(t: f32) -> Svgr<'static> {
    let s0 = seg_start("plan") - 0.2;
    let a = 1.0 - ease(prog(t, s0, s0 + 0.45));
    let k = 1.0 + 0.06 * a;
    with_chapter(
        t,
        fframes::svgr!(
            <g>
                <g transform={format!("translate(960 540) scale({k}) translate(-960 -540)")}>{workspace::render(t)}</g>
                <rect width="1920" height="1080" fill={HOT} opacity={a} />
            </g>
        ),
    )
}

/// Conflict, ending in a glyph-block wipe into the dark decision log.
fn conflict_out(t: f32) -> Svgr<'static> {
    let start = seg_start("memory") - 0.2 - 0.55;
    let p = prog(t, start, start + 0.55);
    let body = if p > 0.0 { block_wipe(p, "to-dark", workspace::render(t), memory_body(t), HOT, t) } else { workspace::render(t) };
    with_chapter(t, body)
}

/// Ship: glyph-block wipe from the dark log back to the workspace.
fn ship(t: f32) -> Svgr<'static> {
    let s0 = seg_start("ship") - 0.2;
    let p = prog(t, s0, s0 + 0.6);
    let body = block_wipe(p, "to-light", memory_body(t), workspace::render(t), CREAM, t);
    with_chapter(t, body)
}

// ---------------------------------------------------------------- memory

struct LogRow {
    id: &'static str,
    kind: &'static str,
    fill: &'static str,
    text_fill: &'static str,
    summary: &'static str,
}

const LOG: [LogRow; 10] = [
    LogRow { id: "st_3", kind: "PLAN", fill: PAPER, text_fill: INK, summary: "Planner split 1 message into 4 tasks" },
    LogRow { id: "st_12", kind: "DECISION", fill: HOT, text_fill: INK, summary: "Sam: base62 short codes, 6 chars" },
    LogRow { id: "st_15", kind: "SPEC-CHANGE", fill: HOT, text_fill: INK, summary: "6 chars = 56B links, still short" },
    LogRow { id: "st_21", kind: "AGENT-RESULT", fill: GREEN, text_fill: INK, summary: "#T1 Create short link · tests pass" },
    LogRow { id: "st_27", kind: "STEER", fill: PAPER, text_fill: INK, summary: "Sam steered #T2: 404 for unknown codes" },
    LogRow { id: "st_31", kind: "TAKEOVER", fill: PAPER, text_fill: INK, summary: "Priya took #T3, fixed bad URLs" },
    LogRow { id: "st_38", kind: "SPEC-CHANGE", fill: HOT, text_fill: INK, summary: "Maya: count clicks per day" },
    LogRow { id: "st_40", kind: "CONFLICT", fill: RED, text_fill: "#ffffff", summary: "src/store.js · #T2 vs #T3" },
    LogRow { id: "st_41", kind: "MERGE", fill: GREEN, text_fill: INK, summary: "AI merge applied · 8/8 tests" },
    LogRow { id: "st_44", kind: "AGENT-RESULT", fill: GREEN, text_fill: INK, summary: "#T2 Redirect · tests pass" },
];

/// `.hv-log__btn` row, 560 px wide at 1x.
fn log_row(x: f32, y: f32, row: &LogRow, lit: f32) -> Svgr<'static> {
    let kw = mono_w(row.kind, 13.0, 0.08) + 20.0;
    let border = if lit > 0.0 { HOT } else { "#f5efe433" };
    let shadow = if lit > 0.0 { 6.0 * lit } else { 0.0 };
    fframes::svgr!(
        <g>
            <rect x={x + shadow} y={y + shadow} width="560" height="78" rx="16" fill={HOT} opacity={lit} />
            <rect x={x} y={y} width="560" height="78" rx="16" fill={INK2} stroke={border} stroke-width="2.5" />
            {card(x + 16.0, y + 12.0, kw, 24.0, 12.0, row.fill, 0.0, INK, 2.0, false)}
            <text x={x + 26.0} y={y + 29.0} font-family={MONO} font-weight="700" font-size="13" letter-spacing="1" fill={s(row.text_fill)}>{row.kind.to_owned()}</text>
            <text x={x + 544.0} y={y + 29.0} text-anchor="end" font-family={MONO} font-size="13" fill={CREAM} opacity="0.6">{row.id.to_owned()}</text>
            <text x={x + 16.0} y={y + 62.0} font-family={DISPLAY} font-weight="700" font-size="19" fill={CREAM}>{row.summary.to_owned()}</text>
        </g>
    )
}

fn memory(t: f32) -> Svgr<'static> {
    with_chapter(t, memory_body(t))
}

fn memory_body(t: f32) -> Svgr<'static> {
    let every = cue("memory", "Every");
    let ask = cue("memory", "Ask");
    let answers = cue("memory", "answers");
    let citing = cue("memory", "citing");
    let decisions = cue("memory", "decisions");

    // columns of log rows drifting up behind everything, slightly tilted
    let dim = 0.32 - 0.14 * smooth(ask, ask + 0.6, t);
    let mut cols = Vec::new();
    for col in 0..4 {
        let x = -150.0 + col as f32 * 610.0;
        let speed = 46.0 + col as f32 * 9.0;
        let off = (t * speed + col as f32 * 140.0) % 94.0;
        for i in 0..15 {
            let row = &LOG[(i + col * 3 + (t * speed / 94.0) as usize) % LOG.len()];
            let y = -140.0 + i as f32 * 94.0 - off;
            cols.push(log_row(x, y, row, 0.0));
        }
    }
    let log_bg = fframes::svgr!(<g opacity={dim} transform="rotate(-6 960 540)">{cols}</g>);

    let count_p = expo_out(prog(t, every, every + 1.8));
    let n = (count_p * 312.0).round() as u32;
    let up = in_out(prog(t, ask - 0.1, ask + 0.6));
    let (cy, ck) = (mix(560.0, 205.0, up), mix(1.0, 0.42, up));
    let counter_in = smooth(every - 0.3, every + 0.1, t);
    let counter = fframes::svgr!(
        <g opacity={counter_in} transform={format!("translate(960 {cy}) scale({ck})")}>
            <text x="0" y="-150" text-anchor="middle" font-family={MONO} font-weight="700" font-size="28" letter-spacing="6" fill={CREAM} opacity="0.8">"EVERY CHANGE, RECORDED"</text>
            <text x="12" y="92" text-anchor="middle" font-family={DISPLAY} font-weight="800" font-size="300" letter-spacing="-12" fill={HOT}>{format!("{n}")}</text>
            <text x="0" y="80" text-anchor="middle" font-family={DISPLAY} font-weight="800" font-size="300" letter-spacing="-12" fill={CREAM}>{format!("{n}")}</text>
            <text x="0" y="160" text-anchor="middle" font-family={MONO} font-weight="700" font-size="28" letter-spacing="4" fill={CREAM} opacity="0.8">"STEPS IN THE DECISION LOG"</text>
        </g>
    );

    let qa = if t >= ask {
        let k = 1.9;
        let q_at = ask + 0.1;
        let (q, qh) = message(0.0, 0.0, 520.0, Who::Person("Priya", "P", HOT), &["Why are short codes 6 characters?"], None);
        let appear: Vec<f32> = (0..3).map(|i| prog(t, citing + i as f32 * 0.12, citing + i as f32 * 0.12 + 0.3)).collect();
        let cites = chips(&[("CITES", "#ffffff33", "#ffffff"), ("ST_12", HOT, INK), ("ST_15", HOT, INK)], 11.0, 480.0, &appear);
        let (a, _) = message(0.0, 0.0, 520.0, Who::Planner, &["Sam picked base62 with 6 characters:", "56 billion links, and still short."], Some((cites.0, cites.1 + 4.0)));
        let (qo, qs, qdy) = pop_in(t, q_at);
        let (ao, as_, ady) = pop_in(t, answers);
        let (x, y) = (960.0 - 260.0 * k, 360.0);
        let a_el = if t >= answers {
            fframes::svgr!(<g opacity={ao} transform={format!("translate({x} {}) scale({}) ", y + qh * k + ady, k * as_)}>{a}</g>)
        } else {
            Svgr::empty()
        };
        fframes::svgr!(
            <g>
                <g opacity={qo} transform={format!("translate({x} {}) scale({})", y + qdy, k * qs)}>{q}</g>
                {a_el}
            </g>
        )
    } else {
        Svgr::empty()
    };

    let lit = if t >= decisions - 0.15 {
        let rows: Vec<Svgr> = [1usize, 2]
            .iter()
            .enumerate()
            .map(|(i, &ri)| {
                let at = decisions - 0.15 + i as f32 * 0.12;
                let (op, sc, dy) = pop_in(t, at);
                let f = prog(t, at, at + 1.1);
                let flash = if f < 0.2 { f / 0.2 } else if f < 0.45 { 1.0 - (f - 0.2) * 3.2 } else if f < 0.65 { 0.2 + (f - 0.45) * 4.0 } else { 1.0 };
                let x = 380.0 + i as f32 * 600.0;
                let y = 900.0;
                fframes::svgr!(<g opacity={op} transform={format!("translate({} {}) scale({sc}) translate({} {})", x + 280.0, y + 39.0 + dy, -x - 280.0, -y - 39.0)}>{log_row(x, y, &LOG[ri], flash.clamp(0.0, 1.0))}</g>)
            })
            .collect();
        fframes::svgr!(<g>{rows}</g>)
    } else {
        Svgr::empty()
    };

    fframes::svgr!(
        <g>
            <rect width="1920" height="1080" fill={INK} />
            {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, CREAM, 0.07)}
            {log_bg}
            <rect width="1920" height="1080" fill={INK} opacity={0.35 * smooth(ask, ask + 0.5, t)} />
            {counter}
            {qa}
            {lit}
            {crt(0.6)}
        </g>
    )
}

// ---------------------------------------------------------------- outro

const LETTERS: [[&str; 7]; 4] = [
    ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
    ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "XXXXX"],
    ["X...X", "X...X", "X...X", "X...X", ".X.X.", ".X.X.", "..X.."],
    ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
];

/// World units of one mosaic tile: a full 1920x1080 screen, plus the gap between tiles.
const TILE_W: f32 = 1920.0;
const TILE_H: f32 = 1080.0;
const PITCH_X: f32 = 2160.0;
const PITCH_Y: f32 = 1300.0;

/// What a tile shows: a real Hive screen at some moment of the video.
fn tile_body<'a>(i: usize, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
    let name = match i % 10 {
        8 => "hero.jpg".to_owned(),
        k => format!("still_{k}.jpg"),
    };
    match ctx.get_image(&name).map(|im| im.href()) {
        Some(href) => fframes::svgr!(<image href={href} x="0" y="0" width="1920" height="1080" />),
        None => fframes::svgr!(<rect width="1920" height="1080" fill={PAPER} />),
    }
}

/// The closing zoom out: the live workspace becomes one tile in a mosaic of Hive screens, the
/// tiles fly into giant letters, the camera pans across "HIVE", then a cream hexagon opens on
/// the logo and the name.
fn outro<'a>(t: f32, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
    let t0 = demo_end();
    let hive_said = cue("outro", "Hive");
    let humans = cue("outro", "Humans");
    // hold the glyph "HIVE" a beat before the lockup, however the line is voiced
    let lock_at = humans.max(hive_said + 1.9);
    let tick = (t * 12.0) as u32;

    let mut slots = Vec::new();
    for (li, letter) in LETTERS.iter().enumerate() {
        for (r, row) in letter.iter().enumerate() {
            for (c, ch) in row.chars().enumerate() {
                if ch == 'X' {
                    slots.push(((li as f32 * 6.0 + c as f32) * PITCH_X, r as f32 * PITCH_Y));
                }
            }
        }
    }
    let word_w = 23.0 * PITCH_X;
    let word_h = 7.0 * PITCH_Y;
    let word_origin = (-word_w / 2.0 + PITCH_X / 2.0, -word_h / 2.0 + PITCH_Y / 2.0);

    // camera (scale, x, y) in world units: zoom out to the mosaic, fly to the letters, pan, wide
    let zoom_out = in_out(prog(t, t0, t0 + 1.0));
    let fly_t0 = t0 + 0.75;
    let fly = in_out(prog(t, fly_t0, fly_t0 + 0.8));
    let pan = in_out(prog(t, fly_t0 + 0.55, hive_said - 0.1));
    let wide = in_out(prog(t, hive_said - 0.25, hive_said + 0.45));
    let first_letter_x = word_origin.0 + 2.0 * PITCH_X;
    let last_letter_x = word_origin.0 + 20.0 * PITCH_X;
    let s_mosaic = mix(1.0, 0.16, zoom_out);
    let cam_s = mix(mix(s_mosaic, 0.072, fly), 1720.0 / word_w, wide);
    let cam_x = mix(mix(0.0, first_letter_x, fly) + (last_letter_x - first_letter_x) * pan, 0.0, wide);
    let cam_y = 0.0;
    let to_screen = |wx: f32, wy: f32| (960.0 + (wx - cam_x) * cam_s, 540.0 + (wy - cam_y) * cam_s);

    let resolve = in_out(prog(t, lock_at - 0.35, lock_at + 0.35));
    let mut cells: Vec<(i32, i32)> = (-4..=4).flat_map(|x| (-3..=3).map(move |y| (x, y))).collect();
    cells.sort_by(|a, b| {
        let da = (a.0 * a.0) as f32 * 0.6 + (a.1 * a.1) as f32 + hash((a.0 * 13 + a.1 * 7 + 100) as u32) * 0.5;
        let db = (b.0 * b.0) as f32 * 0.6 + (b.1 * b.1) as f32 + hash((b.0 * 13 + b.1 * 7 + 100) as u32) * 0.5;
        da.partial_cmp(&db).unwrap()
    });
    let mut tiles = Vec::new();
    for (i, &(lx, ly)) in slots.iter().enumerate() {
        // mosaic cell: spiral around the center tile (index 0 is the live workspace)
        let (gx, gy) = cells[i.min(cells.len() - 1)];
        let (mx, my) = (gx as f32 * PITCH_X, gy as f32 * PITCH_Y);
        let at = fly_t0 + (lx / word_w) * 0.35 + hash(i as u32) * 0.12;
        let f = bounce(prog(t, at, at + 0.6));
        let (wx, wy) = (mix(mx, word_origin.0 + lx, f), mix(my, word_origin.1 + ly, f));
        let (sx, sy) = to_screen(wx, wy);
        let (w, h) = (TILE_W * cam_s, TILE_H * cam_s);
        if sx + w < -50.0 || sx - w > 1970.0 || sy + h < -50.0 || sy - h > 1130.0 {
            continue;
        }
        let appear = if i == 0 { 1.0 } else { pop(prog(t, t0 + 0.1 + i as f32 * 0.008, t0 + 0.5 + i as f32 * 0.008)) };
        let k = cam_s * appear * (1.0 - resolve);
        if k * TILE_W < 2.0 {
            continue;
        }
        let rot = if i == 0 { 0.0 } else { (1.0 - f) * (hash(i as u32 + 99) - 0.5) * 16.0 };
        let body = if i == 0 && f <= 0.0 {
            // the "Nothing gets lost" frame, exactly as it ended
            saved(DEMO[5].2, DEMO[5].2)
        } else if k * TILE_W > 70.0 {
            tile_body(i, ctx)
        } else {
            let fill = [PAPER, CREAM, BLUE, GREEN, HOT][i % 5];
            fframes::svgr!(<rect width="1920" height="1080" fill={fill} />)
        };
        let border = 18.0;
        let frame_in = smooth(t0, t0 + 0.4, t);
        tiles.push(fframes::svgr!(
            <g transform={format!("translate({sx} {sy}) rotate({rot}) scale({k}) translate({} {})", -TILE_W / 2.0, -TILE_H / 2.0)}>
                <rect x="40" y="40" width={TILE_W} height={TILE_H} rx="60" fill={HOT} opacity={frame_in} />
                <defs><clipPath id={format!("tile-{i}")}><rect width={TILE_W} height={TILE_H} rx={60.0 * frame_in} /></clipPath></defs>
                <g clip-path={format!("url(#tile-{i})")}>{body}</g>
                <rect x={border / 2.0} y={border / 2.0} width={TILE_W - border} height={TILE_H - border} rx="54" fill="none" stroke={INK} stroke-width={border} opacity={frame_in} />
            </g>
        ));
    }

    // the tiles dissolve into a dense glyph "HIVE", like the opening's glyph field
    let dense = in_out(prog(t, hive_said + 0.05, hive_said + 0.6));
    let glyph_word = if dense > 0.0 && wipe_pre(t, lock_at) < 1.0 {
        let g = Grid::screen(9.0);
        let gs = cam_s * (1.0 + 0.04 * prog(t, hive_said, lock_at + 0.5));
        let el = ascii::render(&g, &[CREAM, HOT], tick, 0.08, |c, rr| {
            let (px, py) = g.center(c, rr);
            let wx = cam_x + (px - 960.0) / gs;
            let wy = cam_y + (py - 540.0) / gs;
            let lx = (wx - word_origin.0) / PITCH_X + 0.5;
            let ly = (wy - word_origin.1) / PITCH_Y + 0.5;
            let inside = lx >= 0.0 && ly >= 0.0 && {
                let (ci, ri) = (lx as usize, ly as usize);
                ri < 7 && ci < 23 && ci % 6 < 5 && LETTERS[ci / 6][ri].as_bytes()[ci % 6] == b'X'
            };
            let h = hash2((c * 7 + rr) as u32, 11);
            if inside {
                if noise(c, rr) < dense { (0.7 + 0.3 * h, if h < 0.28 { 1 } else { 0 }) } else { (0.0, 0) }
            } else if h < 0.05 * dense {
                (0.22, 1)
            } else {
                (0.0, 0)
            }
        });
        fframes::svgr!(<g opacity={dense}>{el}{crt(0.8 * dense)}</g>)
    } else {
        Svgr::empty()
    };

    // crisp lockup inside a cream hexagon opening from the center
    let wipe = in_out(prog(t, lock_at - 0.15, lock_at + 0.55));
    let hex_r = 2400.0 * wipe;
    let hex_pts: String = (0..6)
        .map(|i| {
            let a = std::f32::consts::FRAC_PI_3 * i as f32 - std::f32::consts::FRAC_PI_2;
            format!("{},{} ", 960.0 + hex_r * a.cos(), 540.0 + hex_r * a.sin())
        })
        .collect();
    let (lo, ls, _) = pop_in(t, lock_at + 0.1);
    let settle_zoom = 1.0 + 0.04 * prog(t, lock_at, lock_at + 3.0);
    let lockup = if wipe > 0.0 {
        // "people" and "build" exist once the new outro line is voiced; until then the
        // lines follow "Humans"
        let tag_at = cue("outro", "people").max(lock_at + 0.5);
        let world_at = cue("outro", "build").max(tag_at + 0.9);
        let tagline = if t >= tag_at {
            let (op, sc, dy) = pop_in(t, tag_at);
            let label = "Humans + AI agents, building together";
            let w = display_w(label, 46.0) + 70.0;
            let (x, y) = (960.0 - w / 2.0, 640.0);
            fframes::svgr!(
                <g opacity={op} transform={format!("translate(960 {}) rotate(-2) scale({sc}) translate(-960 {})", y + 40.0 + dy, -y - 40.0)}>
                    {card(x, y, w, 84.0, 22.0, PAPER, 6.0, INK, 3.0, false)}
                    <text x="960" y={y + 57.0} text-anchor="middle" font-family={DISPLAY} font-weight="800" font-size="46" letter-spacing="-1.5" fill={INK}>{label.to_owned()}</text>
                </g>
            )
        } else {
            Svgr::empty()
        };
        let (wo, _, wdy) = pop_in(t, world_at);
        let world = if t >= world_at { wo } else { 0.0 };
        fframes::svgr!(
            <g>
                <defs><clipPath id="end-wipe"><polygon points={hex_pts} /></clipPath></defs>
                <g clip-path="url(#end-wipe)">
                    <rect width="1920" height="1080" fill={CREAM} />
                    {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, INK, 0.12)}
                    <g transform={format!("translate(960 540) scale({settle_zoom}) translate(-960 -540)")}>
                        <g opacity={lo} transform={format!("translate(960 430) scale({ls}) translate(-960 -430)")}>
                            {logo(560.0, 330.0, 200.0)}
                            <text x="800" y="505" font-family={DISPLAY} font-weight="800" font-size="210" letter-spacing="-9" fill={INK}>"Hive"</text>
                        </g>
                        {tagline}
                        <text x="960" y={835.0 + wdy} text-anchor="middle" font-family={DISPLAY} font-weight="700" font-size="44" letter-spacing="-1" fill={INK} opacity={world}>"The collaborative workspace for teams shipping with AI."</text>
                    </g>
                </g>
            </g>
        )
    } else {
        Svgr::empty()
    };
    let label = 1.0 - smooth(lock_at - 0.4, lock_at, t);
    fframes::svgr!(
        <g>
            <rect width="1920" height="1080" fill={INK} />
            {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, CREAM, 0.06 * zoom_out)}
            <g opacity={1.0 - dense}>{tiles}</g>
            {glyph_word}
            <g opacity={label * zoom_out}>{hud(t, "HIVE // EVERY SCREEN", 1.0)}</g>
            {lockup}
        </g>
    )
}

// ---------------------------------------------------------------- demo (real app footage)

/// Whose browser each demo clip was recorded in.
const DEMO_WHO: [(&str, &str); 5] = [("Ana", HOT), ("", ""), ("Ana", HOT), ("Ben", BLUE), ("Maya", GREEN)];

/// The current frame of a recording in footage/, drawn into (x, y, w, h). Clips start with
/// their shot.
fn clip<'a>(frame: &Frame, ctx: &FFramesContext<'a, '_>, file: &str, x: f32, y: f32, w: f32, h: f32) -> Svgr<'a> {
    let input = SyncVideoFrameInput { start_from: 0.0, looping: false, editor_fallback_image: None };
    match frame.get_synced_video_frame(ctx, file, &input) {
        Some(c) => {
            let img = c.into_image();
            fframes::svgr!(<image href={img.href()} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid slice" />)
        }
        None => Svgr::empty(),
    }
}

/// "ANA'S SCREEN": whose browser this is.
fn screen_tag(x: f32, y: f32, who: &str, color: &str) -> Svgr<'static> {
    let (st, _) = sticker(x, y, &format!("{}'S SCREEN", who.to_uppercase()), 18.0, PAPER, INK, Some(color), 3.0, 2.5);
    st
}

type Rect = (f32, f32, f32, f32);

/// A person's screen at its recorded size (1600x900, pixel for pixel), centered.
const FULL: Rect = (160.0, 90.0, 1600.0, 900.0);
/// The whole frame, where the outro's mosaic picks up.
const BLEED: Rect = (0.0, 0.0, 1920.0, 1080.0);

/// The three laptops side by side: Ana's, Ben's and Maya's screens.
fn split_rect(k: usize) -> Rect {
    let gap = 44.0;
    let w = (1920.0 - 4.0 * gap) / 3.0;
    (gap + k as f32 * (w + gap), 330.0, w, w * 9.0 / 16.0)
}

fn lerp_rect(a: Rect, b: Rect, p: f32) -> Rect {
    (mix(a.0, b.0, p), mix(a.1, b.1, p), mix(a.2, b.2, p), mix(a.3, b.3, p))
}

const PEOPLE: [(&str, &str); 3] = [("Ana", HOT), ("Ben", BLUE), ("Maya", GREEN)];
/// Whose laptop each demo clip was recorded on (the split view shows all three).
const POV: [usize; 6] = [0, 0, 0, 1, 2, 2];

/// One person's screen as a laptop window: content scaled into the rect, ink outline, a hard
/// shadow in their color, and "<name>'s laptop" underneath (`label` fades it).
fn laptop<'a>(r: Rect, who: usize, content: Svgr<'a>, label: f32, id: &str) -> Svgr<'a> {
    let (x, y, w, h) = r;
    let (name, color) = PEOPLE[who];
    let rx = 18.0 * (w / 1600.0).max(0.5);
    let lsize = if w > 1000.0 { 34.0 } else { 30.0 };
    let text = format!("{name}'s laptop");
    let lw = display_w(&text, lsize) + 34.0;
    let ly = y + h + if w > 1000.0 { 52.0 } else { 56.0 };
    fframes::svgr!(
        <g>
            <rect x={x + 8.0} y={y + 8.0} width={w} height={h} rx={rx} fill={s(color)} />
            <defs><clipPath id={format!("lap-{id}")}><rect x={x} y={y} width={w} height={h} rx={rx} /></clipPath></defs>
            <g clip-path={format!("url(#lap-{id})")}>
                <rect x={x} y={y} width={w} height={h} fill={PAPER} />
                <g transform={format!("translate({x} {y}) scale({})", w / 1600.0)}>{content}</g>
            </g>
            <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke={CREAM} stroke-width="3" />
            <g opacity={label}>
                <circle cx={x + w / 2.0 - lw / 2.0 + 10.0} cy={ly - lsize * 0.34} r={lsize * 0.3} fill={s(color)} />
                <text x={x + w / 2.0 - lw / 2.0 + 30.0} y={ly} font-family={DISPLAY} font-weight="700" font-size={lsize} fill={CREAM}>{text}</text>
            </g>
        </g>
    )
}

/// A recording from footage/ at its native 1600x900 (the laptop scales it into place).
fn rec<'a>(frame: &Frame, ctx: &FFramesContext<'a, '_>, file: &str) -> Svgr<'a> {
    clip(frame, ctx, file, 0.0, 0.0, 1600.0, 900.0)
}

fn still_img<'a>(ctx: &FFramesContext<'a, '_>, name: &str) -> Svgr<'a> {
    match ctx.get_image(name).map(|im| im.href()) {
        Some(href) => fframes::svgr!(<image href={href} width="1600" height="900" />),
        None => Svgr::empty(),
    }
}

/// What is happening, in plain words, and who is doing it: (from, text, person color).
const CAPTIONS: [&[(f32, &str, &str)]; 6] = [
    &[(0.4, "Ana describes what she wants built", HOT), (5.0, "Hive's AI breaks it into a plan of tasks", BLUE)],
    &[],
    &[(0.7, "One click, and AI agents start writing the code", BLUE)],
    &[(1.2, "Ben tells the agent: \"count unique visitors, not hits\"", BLUE), (6.9, "The agent replies and changes its approach", BLUE)],
    &[(1.2, "Maya pauses the agent and edits the code herself", GREEN), (6.0, "Then the agent picks up where she left off", BLUE)],
    &[],
];

/// Caption in the top margin; swaps with a quick fade.
fn caption(i: usize, local: f32, until_all: f32) -> Svgr<'static> {
    let list = CAPTIONS[i];
    let Some(k) = list.iter().rposition(|c| local >= c.0) else { return Svgr::empty() };
    let (at, text, color) = list[k];
    let until = list.get(k + 1).map(|c| c.0).unwrap_or(until_all);
    let a = ease(prog(local, at, at + 0.35)) * (1.0 - ease(prog(local, until - 0.25, until)));
    let dy = 12.0 * (1.0 - ease(prog(local, at, at + 0.35)));
    let size = 40.0;
    let w = display_w(text, size) + 100.0;
    let x = 960.0 - w / 2.0;
    let y = 10.0 - dy;
    fframes::svgr!(
        <g opacity={a}>
            {card(x, y, w, 70.0, 35.0, PAPER, 0.0, INK, 0.0, false)}
            <circle cx={x + 40.0} cy={y + 35.0} r="10" fill={s(color)} />
            <text x={x + 64.0} y={y + 49.0} font-family={DISPLAY} font-weight="700" font-size={size} letter-spacing="-1" fill={INK}>{text.to_owned()}</text>
        </g>
    )
}

/// Real Hive, recorded live on three laptops. Every screen is shown pixel for pixel, never
/// zoomed in. Whenever the view moves to another person, their screen shrinks back into the
/// row of three laptops, the next person's laptop lights up and grows to full size: one shared
/// project, many people.
fn demo<'a>(i: usize, t: f32, frame: &Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
    let (id, file, secs) = DEMO[i];
    let s0 = seg_start(id) - 0.2;
    let local = t - s0;
    let bg = fframes::svgr!(
        <g>
            <rect width="1920" height="1080" fill={INK} />
            {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, CREAM, 0.06)}
        </g>
    );

    let body = if file == "mongo" {
        saved(local, secs)
    } else if file == "split" {
        // in: Ana's laptop shrinks into the row; out: it grows back as the run starts
        let into = in_out(prog(local, 0.0, 0.7));
        let out = in_out(prog(local, secs - 0.6, secs));
        let files = ["split_ana.mp4", "split_ben.mp4", "split_maya.mp4"];
        let mut wins: Vec<Svgr> = (1..3)
            .map(|k| {
                let a = ease(prog(local, 0.35 + k as f32 * 0.1, 0.8 + k as f32 * 0.1)) * (1.0 - out);
                let r = split_rect(k);
                let r = (r.0, r.1 + 30.0 * (1.0 - a), r.2, r.3);
                fframes::svgr!(<g opacity={a}>{laptop(r, k, rec(frame, ctx, files[k]), 1.0, &format!("s{k}"))}</g>)
            })
            .collect();
        let ana_r = if out > 0.0 { lerp_rect(split_rect(0), FULL, out) } else { lerp_rect(FULL, split_rect(0), into) };
        let ana_content = if into < 1.0 { still_img(ctx, "end_0.jpg") } else { rec(frame, ctx, files[0]) };
        wins.push(laptop(ana_r, 0, ana_content, 1.0, "s0"));
        let title_a = ease(prog(local, 0.45, 0.9)) * (1.0 - ease(prog(local, secs - 0.7, secs - 0.35)));
        fframes::svgr!(
            <g>
                {bg}
                <text x="960" y="200" text-anchor="middle" font-family={DISPLAY} font-weight="800" font-size="68" letter-spacing="-2.5" fill={CREAM} opacity={title_a}>"The whole team sees the same plan, live"</text>
                {wins}
            </g>
        )
    } else {
        let who = POV[i];
        // a new person (Ben, then Maya): hand over through the row of laptops
        let handoff = i == 3 || i == 4;
        let shrink = if handoff { in_out(prog(local, 0.0, 0.5)) } else { 1.0 };
        let grow = if handoff { in_out(prog(local, 0.6, 1.15)) } else { 1.0 };
        let row = 1.0 - grow;
        // the last clip ends full-bleed, where the outro's mosaic takes over
        let bleed = 0.0;
        let mut wins = Vec::new();
        if handoff && row > 0.0 {
            let prev = POV[i - 1];
            let prev_still = format!("end_{}.jpg", i - 1);
            for k in 0..3 {
                if k == who {
                    continue;
                }
                let content = if k == prev { still_img(ctx, &prev_still) } else if k == 0 { still_img(ctx, "end_2.jpg") } else if k == 1 { still_img(ctx, "pov_ben.jpg") } else { still_img(ctx, "pov_maya.jpg") };
                let (r, a) = if k == prev {
                    (lerp_rect(FULL, split_rect(k), shrink), 1.0)
                } else {
                    (split_rect(k), ease(prog(local, 0.15, 0.5)))
                };
                wins.push(fframes::svgr!(<g opacity={a * row}>{laptop(r, k, content, ease(prog(local, 0.3, 0.6)), &format!("h{k}"))}</g>));
            }
        }
        // the active person's laptop: lights up in the row, then grows to full size
        let r = if handoff { lerp_rect(split_rect(who), FULL, grow) } else { FULL };
        let r = lerp_rect(r, BLEED, bleed);
        let pop_a = if handoff { ease(prog(local, 0.3, 0.6)) } else { 1.0 };
        let ring = if handoff && row > 0.0 {
            let (x, y, w, h) = r;
            fframes::svgr!(<rect x={x - 10.0} y={y - 10.0} width={w + 20.0} height={h + 20.0} rx="24" fill="none" stroke={HOT} stroke-width="6" opacity={pop_a * row} />)
        } else {
            Svgr::empty()
        };
        wins.push(fframes::svgr!(<g opacity={pop_a}>{ring}{laptop(r, who, rec(frame, ctx, file), 1.0 - bleed, &format!("m{i}"))}</g>));
        fframes::svgr!(
            <g>
                {bg}
                {wins}
                <g opacity={1.0 - bleed}>{caption(i, local, secs - 0.2)}</g>
            </g>
        )
    };
    // the intro ends on solid orange; the first clip comes out of it
    let flash = if i == 0 { 1.0 - in_out(prog(t, s0, s0 + 0.8)) } else { 0.0 };
    fframes::svgr!(
        <g>
            {body}
            <rect width="1920" height="1080" fill={HOT} opacity={flash} />
        </g>
    )
}

/// The outro lockup's hexagon wipe progress at time t (used before it is computed).
fn wipe_pre(t: f32, lock_at: f32) -> f32 {
    in_out(prog(t, lock_at - 0.15, lock_at + 0.55))
}

/// "Nothing gets lost": real records from the run (Ana's request, the agent's reply to Ben,
/// Maya's edit, the Planner's plan) drop into a MongoDB database, then what that buys you.
fn saved(local: f32, secs: f32) -> Svgr<'static> {
    let records = [
        ("CHAT", "Ana", HOT, "Build a URL shortener API one step at a time…"),
        ("AGENT STEP", "#st_42", BLUE, "Got it: Ben wants unique visitors counted…"),
        ("EDIT", "Maya", GREEN, "Maya edited src/redirect.js"),
        ("PLAN", "Planner", BLUE, "Planned it as a 4-step chain, with tests…"),
    ];
    let (dx, dy) = (1420.0, 560.0);
    let mut cards = Vec::new();
    for (k, (kind, who, color, text)) in records.iter().enumerate() {
        let x0 = 170.0;
        let y0 = 300.0 + k as f32 * 128.0;
        let appear = pop(prog(local, 0.3 + k as f32 * 0.18, 0.8 + k as f32 * 0.18));
        let fly = in_out(prog(local, 2.0 + k as f32 * 0.22, 2.7 + k as f32 * 0.22));
        let (w, h) = (820.0, 100.0);
        let x = mix(x0, dx - w * 0.1 / 2.0, fly);
        let y = mix(y0, dy - 30.0, fly) - 60.0 * (4.0 * fly * (1.0 - fly));
        let sc = mix(1.0, 0.1, fly);
        let op = appear.min(1.0) * (1.0 - smooth(0.85, 1.0, fly));
        if op <= 0.0 {
            continue;
        }
        let (st, sw) = sticker(x + 24.0, y + 18.0, kind, 18.0, color, if *color == GREEN || *color == HOT { INK } else { "#ffffff" }, None, 0.0, 2.0);
        cards.push(fframes::svgr!(
            <g opacity={op} transform={format!("translate({x} {y}) scale({sc}) translate({} {})", -x, -y)}>
                {card(x, y, w, h, 18.0, PAPER, 6.0, color, 3.0, false)}
                {st}
                <text x={x + 40.0 + sw} y={y + 46.0} font-family={DISPLAY} font-weight="700" font-size="24" fill={INK}>{who.to_string()}</text>
                <text x={x + 24.0} y={y + 82.0} font-family={DISPLAY} font-weight="500" font-size="26" fill={INK}>{text.to_string()}</text>
            </g>
        ));
    }
    // the database: a stacked cylinder that pulses as records land
    let db_in = pop(prog(local, 0.5, 1.1)).min(1.0);
    let hits = (0..4).filter(|k| local > 2.6 + *k as f32 * 0.22).count();
    let pulse = 1.0 + 0.04 * (1.0 - smooth(0.0, 0.25, (local - 2.6) % 0.22 + if hits > 0 && hits < 4 { 0.0 } else { 1.0 }));
    let (rw, rh) = (300.0, 56.0);
    let disc = |cy: f32, fill: &str| -> Svgr<'static> {
        fframes::svgr!(
            <g>
                <path d={format!("M{} {} L{} {} A{rw} {rh} 0 0 0 {} {} L{} {} Z", dx - rw, cy - 60.0, dx - rw, cy + 40.0, dx + rw, cy + 40.0, dx + rw, cy - 60.0)} fill={s(fill)} stroke={INK} stroke-width="5" />
                <ellipse cx={dx} cy={cy - 60.0} rx={rw} ry={rh} fill={s(fill)} stroke={INK} stroke-width="5" />
            </g>
        )
    };
    let count_label = format!("{} new records", hits);
    let db = fframes::svgr!(
        <g opacity={db_in} transform={format!("translate({dx} {dy}) scale({}) translate({} {})", (0.8 + 0.2 * db_in) * pulse, -dx, -dy)}>
            {disc(dy + 150.0, "#1f9d55")}
            {disc(dy + 40.0, "#22c55e")}
            {disc(dy - 70.0, "#4ade80")}
            <text x={dx} y={dy + 205.0} text-anchor="middle" font-family={DISPLAY} font-weight="800" font-size="64" letter-spacing="-2" fill={INK}>"MongoDB"</text>
        </g>
    );
    let counter = if hits > 0 {
        fframes::svgr!(<text x={dx} y={dy + 330.0} text-anchor="middle" font-family={MONO} font-weight="700" font-size="24" letter-spacing="3" fill={CREAM} opacity="0.8">{count_label.to_uppercase()}</text>)
    } else {
        Svgr::empty()
    };
    let title_a = ease(prog(local, 0.1, 0.5));
    let line_a = ease(prog(local, 3.3, 3.8));
    let _ = secs;
    let fade = ease(prog(local, 0.0, 0.4));
    fframes::svgr!(
        <g opacity={fade}>
            <rect width="1920" height="1080" fill={INK} />
            {dots(0.0, 0.0, 1920.0, 1080.0, 28.0, CREAM, 0.06)}
            <text x="170" y="190" font-family={DISPLAY} font-weight="800" font-size="76" letter-spacing="-2.5" fill={CREAM} opacity={title_a}>"Nothing gets lost."</text>
            {cards}
            {db}
            {counter}
            <g opacity={line_a}>
                <text x="170" y="460" font-family={DISPLAY} font-weight="700" font-size="44" letter-spacing="-1" fill={CREAM}>"Every chat, agent step and edit"</text>
                <text x="170" y="520" font-family={DISPLAY} font-weight="700" font-size="44" letter-spacing="-1" fill={CREAM}>"is saved, per project."</text>
                <text x="170" y="620" font-family={DISPLAY} font-weight="500" font-size="34" fill={CREAM} opacity="0.75">"Anyone can catch up on what happened, and why."</text>
            </g>
        </g>
    )
}
