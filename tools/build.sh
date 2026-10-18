#!/usr/bin/env bash
# 一键生成短片：画面时间线 -> 配乐 -> 逐帧渲染 -> 合成 MP4
# 依赖：node + playwright(chromium)、python3 + numpy/scipy/imageio-ffmpeg
set -euo pipefail
cd "$(dirname "$0")/.."
FRAMES=${FRAMES:-build/frames}
OUT=${OUT:-output/梅香寄北堂.mp4}
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
mkdir -p build output

node tools/timeline.mjs > build/timeline.json
python3 tools/music.py
"$FF" -y -loglevel error -i build/music.wav -c:a aac -b:a 160k src/music.m4a   # 网页预览用
node tools/render.mjs "$FRAMES" 30 4
"$FF" -y -loglevel error -framerate 30 -i "$FRAMES/%05d.jpg" -i build/music.wav \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -profile:v high -level 4.1 \
  -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
echo "完成：$OUT"
