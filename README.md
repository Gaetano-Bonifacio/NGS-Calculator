# NGS Calculator

A single-file, browser-based calculator for evaluating the multiplexing and economics of next-generation sequencing (NGS) panels on a given sequencer and flow cell. It is built for teams comparing sequencing vendor economics and panel multiplexing decisions.

**Live demo:** once GitHub Pages is enabled for this repository, the tool is served at `https://gaetano-bonifacio.github.io/NGS-Calculator/`.

Prepared by Gaetano Bonifacio PhD, MBA | 2026.

## What it does

The calculator is organised into four tabs.

1. **Multiplexing.** Place one or several panels on a single flow cell and see total flow-cell coverage, flow cells needed, run time, samples per year, and a per-panel coverage breakdown. Toggle multiplexing on or off to switch between sharing a flow cell and giving each panel its own.
2. **Current vs Future Vendor.** Configure two vendors side by side and compare cost per sample, cost per run, and yearly cost, with the per-sample and yearly savings. Each vendor shows its own technical output (coverage, flow cells, run time, reads per flow cell).
3. **Product database.** Add or edit the NGS panels (name, M reads per sample, price) and the sequencers and their flow cells (M reads per flow cell, run time). Every lookup across the whole tool updates live, so anything entered here flows through the other tabs.
4. **Combined NGS costs.** Layer optional add-ons onto the future vendor and roll them into a total: a liquid-handling robot, an extra sequencer, resequencing, and data analysis.

## How the numbers work

- **Coverage** of a panel is `(samples x M reads per sample) / M reads per flow cell`. Multiplexed, the flow cells needed is the ceiling of the summed coverage; not multiplexed, it is the sum of each panel rounded up.
- **Cost per sample** is the yearly cost divided by the annual sample volume. **Yearly cost** is the per-run cost (reagents plus flow cells) multiplied by runs per year.
- **Robot and sequencer add-ons** use a per-sample amortization equal to `total price / annual sample volume`, with optional per-sample consumables for the robot.
- **Resequencing** applies a failure rate to the sequencing cost per sample, set independently for the current and future vendor.
- **Data analysis** is an optional cost on the current and/or future vendor, entered either as an annual fee or as a cost per sample. Either side can be left at zero. The annual fee is converted to a per-sample equivalent using that vendor's annual volume; the per-sample cost is converted to a yearly figure the same way. Only the future side rolls into the total-future figures; the current side is shown as its own comparison line.

All routine economics were checked against a spreadsheet recalculation and hand derivation, and the calculation logic ships with a Node verification harness.

## Customising the inputs

Everything is editable in the **Product database** tab without touching code. You can add custom NGS panels with their read budget and price, add or remove sequencers and the flow cells under each, and adjust reads and run times. Robot models and prices are entered directly in the Combined NGS costs tab. This makes it straightforward to drop in any vendor's panel and equipment figures and read off the outcome.

## Running it

- **Hosted:** open the GitHub Pages URL above.
- **Locally:** download `index.html` and open it in any modern browser. It is fully self-contained and needs only internet access to load its libraries from CDN. If a library fails to load, the page shows which one rather than going blank.

## Repository contents

- `index.html` - the self-contained, deployable application (this is what GitHub Pages serves).
- `ngs_calculator.jsx` - the readable React source the application is built from.

## Built with

- React 18.2.0 and ReactDOM (UMD, via unpkg)
- PropTypes 15.8.1 (UMD, via unpkg)
- Recharts 2.15.4 (UMD, via jsDelivr; the 2.15.4 minified UMD bundle is not published on unpkg)
- Babel standalone 7.24.7 for in-browser JSX
- IBM Plex Sans and IBM Plex Mono

## Disclaimer

The outputs are estimates intended to support sequencing economics and multiplexing decisions. They are not financial advice. Verify vendor pricing, read budgets, and equipment costs against current quotes before relying on the results.

## Copyright

Copyright (c) 2026 Gaetano Bonifacio PhD, MBA. All rights reserved.
