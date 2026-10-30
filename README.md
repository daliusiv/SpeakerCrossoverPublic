# Crossover Designer

A simple, mobile-friendly passive speaker crossover designer that runs entirely in the browser — inspired by XSim, but aimed at being quick to learn.

## Features

- **Drivers** — pick from a starter library (Dayton, SB Acoustics, Scan-Speak, SEAS, Peerless, Vifa) or type Thiele/Small parameters by hand. Save your own drivers (including files) to "My library".
- **T/S simulation** — infinite baffle, sealed or vented box, plus a simple baffle-step model. "Suggest box" gives a Qtc 0.707 sealed or rule-of-thumb vented alignment.
- **FRD / ZMA import** — upload `.frd`, `.zma`, `.txt` files or the manufacturer's `.zip` directly (it is unpacked in the browser). Drag & drop works on desktop. Missing phase is computed as minimum phase.
- **Finding data** — each driver links to the manufacturer and to searches for its FRD/ZMA files; the Sources tab lists known download sites and measurement tools. "URL" loads a direct link when the host allows it.
- **Crossover editor** — series/shunt ladder of R, L (with DCR), C, Zobel, trap and notch parts. "Design network" creates textbook 1st–4th order filters (Butterworth, Bessel, Linkwitz-Riley), L-pads and Zobels.
- **Charts** — SPL (each driver + sum), phase, impedance and group delay with tap-to-read cursor.
- **Optimiser** — Nelder-Mead fit of unlocked part values to a flat target with a minimum-impedance limit, then rounding to E12/E24 values.
- **Export** — summed/driver FRD and ZMA, T/S model as FRD+ZMA, parts list, chart PNG, project JSON, and share links (project compressed into the URL).
- Autosaves in the browser. No server, no accounts, no build step.

## Run locally

ES modules need a web server (opening `index.html` from disk will not work):

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Tests (Node 20+): `npm test`

## Deploy

The included workflow publishes the site to GitHub Pages on every push to `main`. In the repository settings choose **Pages → Source: GitHub Actions**. Any static host (Netlify, Cloudflare Pages, etc.) works too — just serve the folder.

## Notes & limits

- Library T/S values are approximate datasheet figures for a quick start. Verify against the current datasheet, and use measured FRD/ZMA for a real build.
- The T/S model ignores cone break-up and directivity; trust measured data over it at high frequencies.
- Sensitivity is dB SPL at 2.83 V / 1 m; the amplifier is ideal (zero output impedance).

## Code layout

| File | Purpose |
| --- | --- |
| `js/model.js` | T/S driver model, ladder network solver, auto-design, optimiser |
| `js/dsp.js` | FFT, interpolation, minimum-phase |
| `js/parse.js` | FRD/ZMA parse & export, ZIP reader |
| `js/drivers.js` | Driver library and data sources |
| `js/chart.js` | Canvas chart |
| `js/app.js` | User interface |
| `js/store.js` | Autosave, user library, share links |
