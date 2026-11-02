# Jonah OST

A radio-style site for Jonah's music. Every visitor hears the same shuffled stream at the same moment. Nothing runs on a server: each visitor's page works out what's on air from the song list and the clock.

## Adding a song

1. On GitHub, open the `public/songs` folder.
2. Choose **Add file → Upload files** and drop in the new songs (MP3, M4A or WAV).
3. Commit. Vercel rebuilds the site in about a minute and the songs join the shuffle.

The file name becomes the song title, so `05 - Ikea.mp3` shows as "05 - Ikea". To rename a song, rename its file. To remove one, delete its file.

GitHub's website accepts files up to 25 MB each.

## How it works

- `public/index.html` is the whole site.
- `scripts/build-songs.mjs` runs on every deploy. It reads each file in `public/songs`, measures its exact length and writes `public/songs.json`.
- Adding or removing a song reshuffles the running order, so whatever is on air switches for everyone when the new version goes live.
