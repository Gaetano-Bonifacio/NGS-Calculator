# NGS Calculator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.2-61dafb.svg)](https://react.dev/)
[![Build step](https://img.shields.io/badge/build%20step-none-brightgreen.svg)](#use-the-calculator)

![NGS Calculator preview](Preview_GitHub.png)

Interactive calculator for next-generation sequencing panel multiplexing and economics. Configure panels, sequencers and flow cells, then compare cost per sample, per run and per year across a current and a future vendor, with optional liquid-handling robot and sequencer add-ons. It runs entirely in the browser with no build step.

Prepared by Gaetano Bonifacio PhD, MBA | 2026

Repository: <https://github.com/Gaetano-Bonifacio/NGS-Calculator>

## Features

- Compare a current vendor against a future vendor side by side.
- See cost per sample, cost per run and cost per year, plus yearly and per-sample savings.
- Toggle multiplexing and watch the flow-cell requirement update with the correct rule (see Verify the calculations).
- Add an optional liquid-handling robot cost and an optional sequencer cost, each applied per sample.
- Charts for quick visual comparison, on a dark interface.
- Single self-contained HTML file, deployable to any static host or GitHub Pages.

## Use the calculator

**Online (live site):**

```
https://gaetano-bonifacio.github.io/NGS-Calculator/
```

Open the link to use the calculator immediately. There is no build step and nothing to install.

**On your own computer:**

1. Download this repository (green **Code** button, then **Download ZIP**) and unzip it.
2. Open `index.html` in any modern web browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

An internet connection is required because the page loads its libraries from public CDNs (see Dependencies).

## What is in this repo

| File | Purpose |
| --- | --- |
| `index.html` | The live demo. A single self-contained file that runs in the browser with no build step. |
| `ngs_calculator.jsx` | The React source for the same component, kept for reading, forking and future builds. |
| `verify.mjs` | A non-regression test for the calculation logic. Run it before publishing any change. |

## Deploy to GitHub Pages

1. Keep `index.html` at the root of the repository.
2. In the repository, open Settings, then Pages.
3. Set Source to Deploy from a branch, pick your default branch and the `/ (root)` folder, then Save.
4. After a minute the demo is live at `https://<your-user>.github.io/<your-repo>/`.

A `.nojekyll` file is included so Pages serves the files as they are.

## Dependencies

The page pulls these pinned libraries from public CDNs at runtime:

- React 18.2.0 and ReactDOM 18.2.0 (unpkg)
- PropTypes 15.8.1 (unpkg)
- Recharts 2.15.4 (jsDelivr)
- Babel standalone 7.24.7 (unpkg), which transpiles the inline component in the browser

Two consequences are worth knowing. The page needs internet access and depends on CDN uptime, and Babel transpiles on load, which adds a short one-time delay that is negligible at this size. If you later want zero runtime dependencies, build the `.jsx` with a bundler such as Vite and deploy the static output instead. If a CDN is unreachable, the page shows a short message naming the missing library rather than a blank screen.

## Verify the calculations

The economic logic is checked against ground truth derived by hand, not copied from any cached spreadsheet value.

```bash
node verify.mjs
```

This runs 40 assertions across three scenarios: a single panel with a robot, a two-panel multiplex, and a large targeted panel with a four-year sequencer add-on, plus empty and zero-volume edge cases. A pass means the source computes what the formulas intend.

The multiplex case specifically confirms the flow-cell rule: the number of flow cells needed when multiplexing is the ceiling of the summed coverage, not a per-panel collapse to one.

## Updating safely

The calculation functions live inline in both `index.html` and `ngs_calculator.jsx`, and a copy lives in `verify.mjs` under the VERBATIM LOGIC marker. If you change the math, update all three and re-run `node verify.mjs` before publishing so a future edit cannot quietly break a result.

## License

Released under the MIT License. See `LICENSE` for the full text.

Copyright 2026 Gaetano Bonifacio. You may use, copy, modify and distribute this software, provided the copyright notice and the permission notice are retained in all copies or substantial portions. Please keep the attribution line in the header and footer of the tool.
