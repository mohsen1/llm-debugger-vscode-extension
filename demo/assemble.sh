#!/bin/bash
# Stack two demo takes side by side: ./demo/assemble.sh demo/e2e-script-jev.mov demo/e2e-script-llm.mov [out.mp4]
set -e
LEFT="${1:?usage: assemble.sh LEFT.mov RIGHT.mov [OUT.mp4]}"
RIGHT="${2:?usage: assemble.sh LEFT.mov RIGHT.mov [OUT.mp4]}"
OUT="${3:-demo/side-by-side.mp4}"
for f in "$LEFT" "$RIGHT"; do
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" >/dev/null || { echo "unreadable: $f"; exit 1; }
done
ffmpeg -y -i "$LEFT" -i "$RIGHT" -filter_complex "[0:v]scale=960:-1[l];[1:v]scale=960:-1[r];[l][r]hstack=inputs=2" -c:v libx264 -crf 20 "$OUT"
echo "wrote $OUT"
