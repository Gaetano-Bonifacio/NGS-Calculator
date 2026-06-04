# NGS Calculator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![NGS Calculator preview](Preview_GitHub.png)

Interactive calculator for next-generation sequencing panel multiplexing and economics. Configure NGS panels, sequencers and flow cells, then compare cost per sample, per run and per year across a current and a future vendor, with optional liquid-handling robot and sequencer add-ons.

Prepared by Gaetano Bonifacio PhD, MBA | 2026

## What is in this repo

- `index.html` is the live demo. A single self-contained file that runs in any modern browser with no build step.
- `ngs_calculator.jsx` is the React source for the same component, kept for reading, forking and future builds.
- `verify.mjs` is a non-regression test for the calculation logic. Run it before publishing any change.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

An internet connection is required because the demo loads its libraries from a CDN (see Dependencies).

## Publish to GitHub Pages

1. Put `index.html` at the root of the repository.
2. In the repository, go to Settings, then Pages.
3. Set Source to Deploy from a branch, pick your default branch and the `/ (root)` folder, then Save.
4. After a minute the demo is live at `https://<your-user>.github.io/<your-repo>/`.

## Dependencies

The demo pulls these pinned libraries from public CDNs at runtime:

- React 18.2.0 and ReactDOM 18.2.0 (unpkg)
- PropTypes 15.8.1 (unpkg)
- Recharts 2.15.4 (jsDelivr)
- Babel standalone 7.24.7 (unpkg), which transpiles the inline component in the browser

Two consequences worth knowing. The page needs internet access and depends on CDN uptime. And Babel transpiles on load, which adds a short one-time delay that is negligible at this size. If you later want zero runtime dependencies, build the `.jsx` with a bundler such as Vite and deploy the static output instead.

If a CDN is unreachable, the page shows a short message naming the missing library rather than a blank screen.

## Verify the calculations

The economic logic is checked against ground truth that is derived by hand, not copied from any cached spreadsheet value.

```bash
node verify.mjs
```

This runs 40 assertions across three scenarios: a single panel with a robot, a two-panel multiplex, and an MSK-IMPACT panel with a four-year sequencer add-on, plus empty and zero-volume edge cases. A pass means the source computes what the formulas intend.

The multiplex case specifically confirms the corrected flow-cell rule: the number of flow cells needed when multiplexing is the ceiling of the summed coverage, not a per-panel collapse to one.

## Updating safely

The calculation functions live inline in both `index.html` and `ngs_calculator.jsx`, and a copy lives in `verify.mjs` under the VERBATIM LOGIC marker. If you change the math, update all three and re-run `node verify.mjs` before publishing so a future edit cannot quietly break a result.

## License

Released under the MIT License. See `LICENSE` for the full text.

Copyright 2026 Gaetano Bonifacio. You may use, copy, modify and distribute this software, provided the copyright notice and the permission notice are retained in all copies or substantial portions. Please keep the attribution line in the header and footer of the tool.
