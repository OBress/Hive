//! `cargo run --release -- <command>`: render, preview, frame, strip, inspect, timeline...
//! Run from the video/ folder: voice clips are read from ./audio at startup.

use fframes::{CombinedMediaProvider, EncoderOptions, MediaDirectory, MediaProvider, RenderOptions, cli};
use fframes_skia_renderer::{SkiaPipelineConcurrencyPolicy, SkiaPipelineConfig, cli::SkiaRenderers};
use hive_demo_video::{HiveMedia, HiveVideo};
use std::process::ExitCode;

fn main() -> ExitCode {
    let media = HiveMedia::new().expect("media");
    let voice_dir = MediaDirectory::read_folder("audio").expect("audio/ (run `node tts.mjs` first)");
    let voice = voice_dir.process_media_source().expect("voice clips");
    let all = CombinedMediaProvider::from([&media as &dyn MediaProvider, &voice]);
    let video = HiveVideo::new();

    cli::new(
        &video,
        RenderOptions {
            media: Some(&all),
            default_font: "Rubik",
            video_encoder_options: EncoderOptions {
                preferred_encoder: Some("libx264"),
                codec_params: Some(&[("crf", "18"), ("preset", "medium"), ("tune", "animation")]),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .preview(fframes_native_player::cli_preview)
    .renderers(SkiaRenderers::gpu(SkiaPipelineConfig {
        concurrency_policy: SkiaPipelineConcurrencyPolicy::MaxPerformance,
        ..Default::default()
    }))
    .default_output("hive-demo.mp4")
    .run()
}
