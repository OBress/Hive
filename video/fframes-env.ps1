# Windows only: dot-source before cargo commands in PowerShell:  . .\video\fframes-env.ps1
# fframes links a prebuilt FFmpeg 9 shared build on Windows and needs libclang for bindgen.
$env:FFMPEG_DIR = if ($env:FFMPEG_DIR) { $env:FFMPEG_DIR } else { "$HOME\.fframes\ffmpeg-9.0" }
$env:LIBCLANG_PATH = if ($env:LIBCLANG_PATH) { $env:LIBCLANG_PATH } else { "C:\Program Files\LLVM\bin" }
$env:PATH = "$env:FFMPEG_DIR\bin;$env:PATH"
