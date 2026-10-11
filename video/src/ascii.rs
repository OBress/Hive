//! Character rendering, the look borrowed from the reference: any brightness field becomes a
//! grid of Space Mono glyphs. One <text> per row, one <tspan> per run of same-colored glyphs.
//! Also: a zoom that dives into the glyphs (each giant glyph is drawn with small glyphs),
//! 3D raymarched shapes and particle bursts, all as brightness fields.

use crate::ease::hash2;
use crate::ui::MONO;
use fframes::Svgr;

/// Light to dense.
pub const RAMP: &[char] = &[' ', '.', ':', '-', '=', '+', '*', 'o', 'e', '8', '0', '#', '@'];

#[derive(Clone, Copy)]
pub struct Grid {
    pub cols: usize,
    pub rows: usize,
    /// Cell size in px; glyph size is derived from the height.
    pub cw: f32,
    pub ch: f32,
    pub x: f32,
    pub y: f32,
}

impl Grid {
    /// Cells covering 1920x1080 at `ch` px rows (Space Mono cells are 0.612 em wide).
    pub fn screen(ch: f32) -> Self {
        let size = ch / 1.12;
        let cw = size * crate::ui::MONO_ADV;
        Grid { cols: (1920.0 / cw).ceil() as usize, rows: (1080.0 / ch).ceil() as usize, cw, ch, x: 0.0, y: 0.0 }
    }

    /// Center of a cell in px.
    pub fn center(&self, c: usize, r: usize) -> (f32, f32) {
        (self.x + (c as f32 + 0.5) * self.cw, self.y + (r as f32 + 0.5) * self.ch)
    }
}

/// Ramp index for brightness `v` at a cell, with some glyphs re-rolled every `tick`.
pub fn ramp_index(v: f32, c: usize, r: usize, tick: u32, shimmer: f32) -> usize {
    let v = v.clamp(0.0, 1.0);
    let mut i = (v * (RAMP.len() - 1) as f32).round() as usize;
    if i > 0 && shimmer > 0.0 {
        let roll = hash2((r * 977 + c) as u32, tick);
        if roll < shimmer {
            i = (i + 1 + (roll * 1000.0) as usize % 2).min(RAMP.len() - 1).max(1);
        }
    }
    i
}

/// Renders `f(col, row) -> (brightness 0..1, tone index)` as glyphs. `tones` are fill colors.
/// `shimmer` re-rolls some glyphs every `tick` so the field feels alive.
pub fn render(g: &Grid, tones: &[&str], tick: u32, shimmer: f32, f: impl Fn(usize, usize) -> (f32, usize)) -> Svgr<'static> {
    let size = g.ch / 1.12;
    let mut rows = Vec::with_capacity(g.rows);
    for r in 0..g.rows {
        let mut spans: Vec<Svgr> = Vec::new();
        let mut run = String::new();
        let mut run_start = 0usize;
        let mut run_tone = usize::MAX;
        let flush = |spans: &mut Vec<Svgr>, run: &mut String, start: usize, tone: usize| {
            if !run.is_empty() && tone < tones.len() {
                spans.push(fframes::svgr!(<tspan x={g.x + start as f32 * g.cw} fill={tones[tone].to_owned()}>{run.clone()}</tspan>));
            }
            run.clear();
        };
        for c in 0..g.cols {
            let (v, tone) = f(c, r);
            let ch = RAMP[ramp_index(v, c, r, tick, shimmer)];
            if ch == ' ' {
                flush(&mut spans, &mut run, run_start, run_tone);
                run_tone = usize::MAX;
                continue;
            }
            if tone != run_tone {
                flush(&mut spans, &mut run, run_start, run_tone);
                run_start = c;
                run_tone = tone;
            }
            run.push(ch);
        }
        flush(&mut spans, &mut run, run_start, run_tone);
        if !spans.is_empty() {
            let y = g.y + (r as f32 + 0.78) * g.ch;
            rows.push(fframes::svgr!(<text y={y} font-family={MONO} font-weight="700" font-size={size}>{spans}</text>));
        }
    }
    fframes::svgr!(<g>{rows}</g>)
}

/// Grayscale bitmap (from `ffmpeg -vf scale=W:H,format=gray -f rawvideo`), sampled 0..1.
pub struct Gray {
    pub w: usize,
    pub h: usize,
    pub px: &'static [u8],
}

impl Gray {
    pub fn at(&self, u: f32, v: f32) -> f32 {
        let x = ((u * self.w as f32) as isize).clamp(0, self.w as isize - 1) as usize;
        let y = ((v * self.h as f32) as isize).clamp(0, self.h as isize - 1) as usize;
        self.px[y * self.w + x] as f32 / 255.0
    }
}

pub static HERO: Gray = Gray { w: 160, h: 54, px: include_bytes!("../data/hero_160x54.gray") };

/// Space Mono Bold glyphs "08#e@o+*", 36x60 each, side by side.
static GLYPHS: Gray = Gray { w: 288, h: 60, px: include_bytes!("../data/glyphs_288x60.gray") };

/// Coverage 0..1 of the glyph drawn for ramp index `i` at (u, v) inside its cell.
fn glyph_coverage(i: usize, u: f32, v: f32) -> f32 {
    let gi = match RAMP[i] {
        '0' => 0,
        '8' => 1,
        '#' => 2,
        'e' => 3,
        '@' => 4,
        'o' => 5,
        '*' => 7,
        _ => 6,
    };
    if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
        return 0.0;
    }
    GLYPHS.at((gi as f32 + u) / 8.0, v)
}

/// A glyph field seen through a camera that zooms `z`x into `focus` (field px). Past ~4x the
/// glyphs are so big that each one is drawn with small glyphs, like the reference.
#[allow(clippy::too_many_arguments)]
pub fn zoom_field(base: &Grid, z: f32, focus: (f32, f32), tones: &[&str], tick: u32, shimmer: f32, f: &dyn Fn(usize, usize) -> (f32, usize)) -> Svgr<'static> {
    let to_field = |sx: f32, sy: f32| (focus.0 + (sx - 960.0) / z, focus.1 + (sy - 540.0) / z);
    let cell_at = |fx: f32, fy: f32| -> Option<(usize, usize, f32, f32)> {
        let cx = (fx - base.x) / base.cw;
        let cy = (fy - base.y) / base.ch;
        if cx < 0.0 || cy < 0.0 || cx >= base.cols as f32 || cy >= base.rows as f32 {
            return None;
        }
        Some((cx as usize, cy as usize, cx.fract(), cy.fract()))
    };
    let fractal = ((z - 3.0) / 2.0).clamp(0.0, 1.0);
    // big glyphs as text
    let big = if fractal < 1.0 {
        let (x0, y0) = to_field(0.0, 0.0);
        let c0 = ((x0 - base.x) / base.cw).floor().max(0.0) as usize;
        let r0 = ((y0 - base.y) / base.ch).floor().max(0.0) as usize;
        let cols = ((1920.0 / z) / base.cw).ceil() as usize + 2;
        let rows = ((1080.0 / z) / base.ch).ceil() as usize + 2;
        let g = Grid {
            cols: cols.min(base.cols.saturating_sub(c0)),
            rows: rows.min(base.rows.saturating_sub(r0)),
            cw: base.cw * z,
            ch: base.ch * z,
            x: 960.0 + (base.x + c0 as f32 * base.cw - focus.0) * z,
            y: 540.0 + (base.y + r0 as f32 * base.ch - focus.1) * z,
        };
        let el = render(&g, tones, tick, shimmer, |c, r| f(c + c0, r + r0));
        fframes::svgr!(<g opacity={1.0 - fractal}>{el}</g>)
    } else {
        Svgr::empty()
    };
    // each big glyph drawn with small glyphs
    let small = if fractal > 0.0 {
        let g = Grid::screen(16.0);
        let el = render(&g, tones, tick, shimmer * 0.5, |c, r| {
            let (sx, sy) = g.center(c, r);
            let (fx, fy) = to_field(sx, sy);
            match cell_at(fx, fy) {
                Some((bc, br, u, v)) => {
                    let (val, tone) = f(bc, br);
                    let i = ramp_index(val, bc, br, tick, shimmer);
                    if i == 0 {
                        return (0.0, 0);
                    }
                    let pick = [10usize, 9, 11, 8, 12, 7, 9, 10][(hash2(bc as u32 * 3 + 1, br as u32 * 5 + 2) * 8.0) as usize % 8];
                    let pick = if val > 0.45 { pick } else { i };
                    let cov = glyph_coverage(pick, (u - 0.1) / 0.8, (v - 0.08) / 0.84);
                    (if cov > 0.25 { 0.35 + 0.45 * cov * (0.7 + 0.3 * hash2((sx as u32) ^ 77, sy as u32)) } else { 0.0 }, tone)
                }
                None => (0.0, 0),
            }
        });
        fframes::svgr!(<g opacity={fractal}>{el}</g>)
    } else {
        Svgr::empty()
    };
    fframes::svgr!(<g>{big}{small}</g>)
}

/// Signed distance (approx.) to a pointy-top regular hexagon with circumradius `r`.
pub fn hex_sdf(x: f32, y: f32, r: f32) -> f32 {
    let (ax, ay) = (x.abs(), y.abs());
    let apothem = r * 0.866_025_4;
    ax.max(0.5 * ax + 0.866_025_4 * ay) - apothem
}

/// Hexagonal prism, pointy top, apothem `h`, half depth `hz` (iq's sdHexPrism, axes swapped).
fn sd_hex_prism(p: [f32; 3], h: f32, hz: f32) -> f32 {
    let k = (-0.866_025_4_f32, 0.5_f32, 0.577_35_f32);
    let (mut x, mut y, z) = (p[1].abs(), p[0].abs(), p[2].abs());
    let d = 2.0 * (k.0 * x + k.1 * y).min(0.0);
    x -= d * k.0;
    y -= d * k.1;
    let dx = ((x - x.clamp(-k.2 * h, k.2 * h)).powi(2) + (y - h).powi(2)).sqrt() * (y - h).signum();
    let dz = z - hz;
    dx.max(dz).min(0.0) + (dx.max(0.0).powi(2) + dz.max(0.0).powi(2)).sqrt()
}

/// Hive's mark in 3D: an orange hex ring and a cream hex core. Returns (distance, material).
fn logo_sdf(p: [f32; 3]) -> (f32, usize) {
    let ring = sd_hex_prism(p, 1.0, 0.22).max(-sd_hex_prism(p, 0.62, 0.5));
    let core = sd_hex_prism(p, 0.44, 0.16);
    if ring < core { (ring, 0) } else { (core, 1) }
}

fn rot(p: [f32; 3], yaw: f32, pitch: f32) -> [f32; 3] {
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    let x = p[0] * cy + p[2] * sy;
    let z = -p[0] * sy + p[2] * cy;
    let y = p[1] * cp - z * sp;
    let z2 = p[1] * sp + z * cp;
    [x, y, z2]
}

/// Raymarched, lit 3D Hive mark seen head-on at view point (x, y) in object units.
/// Returns (brightness, material) or None for background.
pub fn logo3d(x: f32, y: f32, yaw: f32, pitch: f32) -> Option<(f32, usize)> {
    // orthographic ray along +z in view space, marched in object space
    let to_obj = |p: [f32; 3]| rot(rot(p, 0.0, -pitch), -yaw, 0.0);
    let o = to_obj([x, y, -3.0]);
    let d = to_obj([0.0, 0.0, 1.0]);
    let mut t = 1.6;
    for _ in 0..48 {
        let p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
        let (dist, mat) = logo_sdf(p);
        if dist < 0.004 {
            let e = 0.01;
            let n = [
                logo_sdf([p[0] + e, p[1], p[2]]).0 - logo_sdf([p[0] - e, p[1], p[2]]).0,
                logo_sdf([p[0], p[1] + e, p[2]]).0 - logo_sdf([p[0], p[1] - e, p[2]]).0,
                logo_sdf([p[0], p[1], p[2] + e]).0 - logo_sdf([p[0], p[1], p[2] - e]).0,
            ];
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-5);
            let nv = rot(rot([n[0] / len, n[1] / len, n[2] / len], yaw, 0.0), 0.0, pitch);
            let l = [-0.45_f32, -0.55, -0.7];
            let ll = (l[0] * l[0] + l[1] * l[1] + l[2] * l[2]).sqrt();
            let diff = ((nv[0] * l[0] + nv[1] * l[1] + nv[2] * l[2]) / ll).max(0.0);
            let rim = (1.0 - (-nv[2]).max(0.0)).powi(3) * 0.35;
            return Some(((0.18 + 0.82 * diff + rim).min(1.0), mat));
        }
        t += dist;
        if t > 6.0 {
            break;
        }
    }
    None
}

/// Shaded sphere brightness for a disc of radius r at (cx, cy); 0 outside.
pub fn sphere(px: f32, py: f32, cx: f32, cy: f32, r: f32) -> f32 {
    if r <= 0.0 {
        return 0.0;
    }
    let (dx, dy) = ((px - cx) / r, (py - cy) / r);
    let d2 = dx * dx + dy * dy;
    if d2 > 1.0 {
        return 0.0;
    }
    let nz = (1.0 - d2).sqrt();
    let light = (-0.45 * dx - 0.55 * dy + 0.7 * nz).max(0.0);
    0.22 + 0.78 * light
}

/// Brightness buffer for one frame (particles, trails) on a grid.
pub struct Canvas {
    pub g: Grid,
    pub v: Vec<f32>,
    pub tone: Vec<usize>,
}

impl Canvas {
    pub fn new(g: Grid) -> Self {
        Canvas { g, v: vec![0.0; g.cols * g.rows], tone: vec![0; g.cols * g.rows] }
    }

    /// Adds brightness at a point in px.
    pub fn splat(&mut self, x: f32, y: f32, amount: f32, tone: usize) {
        let c = ((x - self.g.x) / self.g.cw).floor();
        let r = ((y - self.g.y) / self.g.ch).floor();
        if c < 0.0 || r < 0.0 || c >= self.g.cols as f32 || r >= self.g.rows as f32 {
            return;
        }
        let i = r as usize * self.g.cols + c as usize;
        self.v[i] = (self.v[i] + amount).min(1.0);
        self.tone[i] = tone;
    }

    pub fn get(&self, c: usize, r: usize) -> (f32, usize) {
        let i = r * self.g.cols + c;
        (self.v[i], self.tone[i])
    }
}
