# Jonah OST

A radio-style site for Jonah's music. Every visitor hears the same shuffled stream at the same moment. Each visitor's page works out what's on air from the song list and the clock, so nothing has to keep playing on a server.

## Adding songs

Open the site, scroll to **Station desk**, enter the station password and tap **Add songs**. New songs reach every listener within about a minute. You can rename or delete them from the same place.

You can also commit audio files to `public/songs`. Those join the shuffle on the next deploy and show a "GitHub" tag in the desk, because they're renamed or deleted in the repo.

## One-time setup in Vercel

1. **Song storage:** in the project, open **Storage → Create → Blob**, choose **Public** access, and connect it to this project. That adds `BLOB_READ_WRITE_TOKEN` automatically.
2. **Password:** open **Settings → Environment Variables**, add `STATION_PASSWORD` with the password you want, and save.
3. **Redeploy:** open **Deployments**, pick the latest one and choose **Redeploy**, so the new settings take effect.

To change the password later, edit `STATION_PASSWORD` and redeploy.

## How it works

- `public/index.html` is the whole site, including the Station desk.
- `api/upload.js` gives the desk a short-lived upload token, only with the right password.
- `api/songs.js` lists the songs and handles adding, renaming and deleting (password required). Each uploaded song's title and exact length are stored in its file name in Blob.
- `lib/duration.mjs` measures MP3, M4A and WAV lengths. `scripts/build-songs.mjs` uses it at deploy time for songs in `public/songs`.
- Adding or removing a song reshuffles the running order, so whatever is on air switches for everyone when listeners pick up the new list.
