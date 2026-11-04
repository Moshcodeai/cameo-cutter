# Cameo Cutter

A one-page web app that sends cut jobs straight from a phone to a Silhouette Cameo 4/5, over Bluetooth or a USB cable, with no Silhouette Studio.

Open it in **Chrome on Android**, tap Connect, load an SVG and tap Cut.

- `index.html`: the page (built, self-contained)
- `cutter-core.js`: SVG reading, cut ordering and the Cameo command set
- `src/page.html`: page source; `node build.mjs` inlines the core into `index.html`
- `test/`: checks the JavaScript output byte-for-byte against the Python driver it was ported from

The cutter protocol is ported from [inkscape-silhouette](https://github.com/fablabnbg/inkscape-silhouette) (GPLv2), so this project is GPLv2 too.
