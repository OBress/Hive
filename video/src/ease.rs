//! Time helpers and the app's own easing curves (web/app/globals.css).

/// 0..1 progress of `t` through `a..b`, clamped.
pub fn prog(t: f32, a: f32, b: f32) -> f32 {
    ((t - a) / (b - a)).clamp(0.0, 1.0)
}

pub fn mix(a: f32, b: f32, p: f32) -> f32 {
    a + (b - a) * p
}

/// CSS `cubic-bezier(x1, y1, x2, y2)` evaluated at `x` (0..1).
pub fn cubic_bezier(x1: f32, y1: f32, x2: f32, y2: f32, x: f32) -> f32 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let curve = |p1: f32, p2: f32, u: f32| {
        let v = 1.0 - u;
        3.0 * v * v * u * p1 + 3.0 * v * u * u * p2 + u * u * u
    };
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        if curve(x1, x2, mid) < x { lo = mid } else { hi = mid }
    }
    curve(y1, y2, (lo + hi) / 2.0)
}

/// `--ease`: smooth settle.
pub fn ease(p: f32) -> f32 {
    cubic_bezier(0.32, 0.72, 0.0, 1.0, p)
}
/// `--bounce`: hover and press.
pub fn bounce(p: f32) -> f32 {
    cubic_bezier(0.34, 1.57, 0.64, 1.0, p)
}
/// `--pop`: entrances.
pub fn pop(p: f32) -> f32 {
    cubic_bezier(0.34, 2.27, 0.64, 1.0, p)
}
pub fn in_out(p: f32) -> f32 {
    cubic_bezier(0.65, 0.0, 0.35, 1.0, p)
}
pub fn expo_out(p: f32) -> f32 {
    if p >= 1.0 { 1.0 } else { 1.0 - 2f32.powf(-10.0 * p) }
}
pub fn expo_in(p: f32) -> f32 {
    if p <= 0.0 { 0.0 } else { 2f32.powf(10.0 * (p - 1.0)) }
}

/// `hv-pop-in` (.42 s, --pop) starting at `at`: (opacity, scale, y offset).
pub fn pop_in(t: f32, at: f32) -> (f32, f32, f32) {
    let p = prog(t, at, at + 0.42);
    let e = pop(p);
    (prog(t, at, at + 0.12), mix(0.85, 1.0, e), mix(8.0, 0.0, e))
}

/// `hv-settle`: 1 -> 1.055 -> 1 over .5 s.
pub fn settle(t: f32, at: f32) -> f32 {
    let p = prog(t, at, at + 0.5);
    if p <= 0.0 || p >= 1.0 {
        return 1.0;
    }
    if p < 0.4 { mix(1.0, 1.055, bounce(p / 0.4)) } else { mix(1.055, 1.0, ease((p - 0.4) / 0.6)) }
}

/// `hv-wiggle`: rotate 0 -> -3 -> 3 -> 0 deg over .5 s.
pub fn wiggle(t: f32, at: f32) -> f32 {
    let p = prog(t, at, at + 0.5);
    if p <= 0.0 || p >= 1.0 {
        return 0.0;
    }
    (p * std::f32::consts::TAU).sin() * -3.0
}

/// Stable pseudo random 0..1 for an integer.
pub fn hash(mut x: u32) -> f32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    (x & 0xff_ffff) as f32 / 0xff_ffff as f32
}

pub fn hash2(a: u32, b: u32) -> f32 {
    hash(a.wrapping_mul(73_856_093) ^ b.wrapping_mul(19_349_663))
}
