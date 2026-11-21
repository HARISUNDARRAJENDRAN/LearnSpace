# LearnSpace intro film

The 32-second product intro on the landing page hero (`apps/web/public/media/learnspace-intro.mp4`).
It is a [HyperFrames](https://hyperframes.heygen.com) project: HTML scenes animated with GSAP and rendered
frame by frame to MP4. Sound effects only, no music, made with [earshot](https://github.com/Leonxlnx/earshot).

- `index.html`: the root timeline, shared styles and camera helpers (`LS.focus`, `LS.at`, `LS.click`), and the sound clips.
- `compositions/`: one scene per file (hook, discover, plan, study, notes, practice, research, progress, verbs, endcard).
- `assets/ui/`: real app screens captured at 1600×1000 (2× DPR) from the local app; overlays in the scenes use those
  screenshot coordinates. The learner's name and email were swapped for "Alex Rivera" before capture.
- `assets/thumbs/`: lesson thumbnails from the local catalog.
- `scripts/sfx.txt` lists each sound cue; `scripts/cues.json` says which frame each belongs to.

## Rebuild

```bash
npx hyperframes@0.9.61 preview               # edit and scrub in the browser
scripts/render-sfx.sh                        # re-render the sound kit (needs `uv tool install git+https://github.com/Leonxlnx/earshot`)
node scripts/place-sfx.mjs                   # re-time the <audio> clips: each file's peak lands one frame after its cue
npx hyperframes@0.9.61 check                 # lint, layout and contrast
npx hyperframes@0.9.61 render -q delivery -f 30 -o renders/learnspace-intro.mp4

# web encode and poster for the hero
ffmpeg -i renders/learnspace-intro.mp4 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 128k ../../apps/web/public/media/learnspace-intro.mp4
ffmpeg -i renders/learnspace-intro.mp4 -frames:v 1 -c:v libwebp -quality 85 ../../apps/web/public/media/learnspace-intro-poster.webp

# Reframe the desktop footage for mobile and preserve the original audio.
media=../../apps/web/public/media
ffmpeg -y -i "$media/learnspace-intro.mp4" -filter_complex \
  "[0:v]split[bg][fg];[bg]crop=864:1080,scale=864:1080,boxblur=32:2,eq=brightness=-0.08[back];[fg]scale=864:486[front];[back][front]overlay=(W-w)/2:(H-h)/2" \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a copy -movflags +faststart "$media/learnspace-intro-portrait.mp4"
ffmpeg -y -i "$media/learnspace-intro-portrait.mp4" -frames:v 1 -quality 85 "$media/learnspace-intro-portrait-poster.webp"
```

Set `DO_NOT_TRACK=1` to keep the HyperFrames CLI from sending usage telemetry.
