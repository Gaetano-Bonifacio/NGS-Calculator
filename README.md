<img width="1774" height="887" alt="NGS Calculator preview" src="https://github.com/user-attachments/assets/ae78fa8f-0e7d-4e32-9425-9929ed88d8ec" />

A browser-based calculator for evaluating the multiplexing and economics of next-generation sequencing (NGS) panels on a given sequencer and flow cell. It is built for teams comparing sequencing setups and panel multiplexing decisions.

**Live tool:** [gaetano-bonifacio.github.io/NGS-Calculator](https://gaetano-bonifacio.github.io/NGS-Calculator/)

by Gaetano Bonifacio PhD, MBA | 2026

## What it does

The calculator is organised into four tabs.

1. **Multiplexing.** See how many samples of one or several panels fit on a flow cell, the total coverage, the average fill per flow cell, and the flow cells needed per run. With multiplexing off, a single panel is placed on the flow cell.
2. **Current vs Future Sequencing Setup.** Compare cost per sample, per run and per year, with savings. By default the future setup keeps the current panels and only the sequencer, flow cell, flow cell cost and runs change. Switch "Same panels as current vendor" to No to compare different panels (they start as a copy).
3. **Product database.** Edit NGS panels, sequencers, flow cells and liquid-handling robots. Commercial panels are pre-filled where the vendor states or implies the reads per sample, each with its source.
4. **Combined NGS costs.** Layer optional add-ons onto the future setup and roll them into a total: a liquid-handling robot, a sequencer, resequencing and data analysis. A "current all-in" line compares like for like.

## How the numbers work

- **Read convention.** "M reads" always means total reads, counting both reads of a paired-end cluster. Panels and flow cells use the same convention (Illumina states TSO 500 as 100M paired-end reads and fits 192 samples on a NovaSeq 6000 S4, which yields 16-20B paired-end reads).
- **Coverage** of a panel is `samples x M reads per sample / M reads per flow cell`.
- **Flow cells per run:** multiplexed, the ceiling of the summed coverage; not multiplexed, the ceiling of the single panel's coverage. Rounding ignores floating-point noise, so a flow cell filled to exactly 100% counts as one.
- **Run cost** is panel reagents plus flow cell cost x flow cells needed. **Yearly cost** is run cost x runs per year.
- **Cost per sample** is the yearly cost divided by that setup's own annual sample volume.
- **Robot and sequencer add-ons:** per-sample cost = `(price / depreciation years) / annual sample volume on that equipment`, plus per-sample consumables for the robot. The yearly figure allocates that per-sample cost to the future setup's annual volume.
- **Resequencing** applies a failure rate to the sequencing cost per sample, set separately for each vendor.
- **Data analysis** is an annual fee (divided by that vendor's annual volume) or a cost per sample, per vendor. Only the future side rolls into the total future figures.

## Pre-filled data and sources

| Item | Basis | Source |
|---|---|---|
| TruSight Oncology 500 (100M), TSO 500 ctDNA v2 (800M) | Vendor-stated | [Illumina TSO 500](https://www.illumina.com/products/by-type/clinical-research-products/trusight-oncology-500.html), [Illumina TSO 500 ctDNA v2](https://knowledge.illumina.com/library-preparation/trusight-oncology-tumor-library-prep/library-preparation-trusight-oncology-tumor-library-prep-reference_material-list/000002931) |
| AmpliSeq Comprehensive Panel v3 (16.25M), AmpliSeq Focus Panel (1M) | Derived from vendor samples per run | [Illumina Comprehensive v3](https://www.illumina.com/products/by-type/sequencing-kits/library-prep-kits/ampliseq-comprehensive-panel.html), [Illumina Focus](https://supportassets.illumina.com/products/by-type/sequencing-kits/library-prep-kits/ampliseq-focus-panel.html) |
| MSK-IMPACT powered with SOPHiA DDM (66M per tumor/normal pair) | Vendor-stated | [SOPHiA GENETICS factsheet](https://d3e30vlyff459p.cloudfront.net/2b75c131-2c1d-4268-be32-67d15945dcb8/fca87090-fd77-41b2-823b-bd5adb172b9b/fca87090-fd77-41b2-823b-bd5adb172b9b_source__v.pdf) |
| SOPHiA DDM Clinical Exome Solution v3 (16.25M), Whole Exome Solution v2 (80M) | Vendor-stated performance basis | [CES v3](https://www.sophiagenetics.com/wp-content/uploads/2024/09/CESv3-Factsheet.pdf), [WES v2](https://www.sophiagenetics.com/wp-content/uploads/2024/09/WESv2-Factsheet.pdf) |
| SOPHiA Solid Tumor Solution (2.08M) | Derived from vendor samples per run | [STS datasheet](https://www.dlongwood.com/wp-content/uploads/2020/01/STS_SOPHIA_GENETICS_RUO_DATASHEET_EN.pdf) |
| NovaSeq 6000, NovaSeq X, NextSeq 1000/2000, MiSeq, AVITI flow cells | Checked against vendor specification pages | [NovaSeq 6000](https://www.illumina.com/systems/sequencing-platforms/novaseq/specifications.html), [NovaSeq X](https://www.illumina.com/systems/sequencing-platforms/novaseq-x-plus/specifications.html), [NextSeq 1000/2000](https://www.illumina.com/systems/sequencing-platforms/nextseq-1000-2000/specifications.html), [MiSeq](https://www.illumina.com/systems/sequencing-platforms/miseq/specifications.html), [AVITI](https://elementbiosciences.com/products/aviti/specs) |
| MiSeq i100 Plus, NextSeq 550, MGI T7, MGI G400 | Not verified | Marked in the app |

Panel prices are left blank (except the TSO 500 example): enter your own. The verification harness cross-checks the flow cell table against the vendors' published samples-per-flow-cell guidance.

## Your data

Edits are saved automatically in your own browser, on your own device. They never change the published tool, and other visitors always start from the default data. Use **Export** to save a scenario as a JSON file, **Import** to load one, and **Reset** to return to the defaults.

## Running it

- **Hosted:** open the link above.
- **Locally:** download `index.html` and open it in any modern browser. It needs internet access to load its libraries from CDN. If a library fails to load, the page names it rather than going blank.

## Developing

`ngs_calculator.jsx` is the single source. `index.html` and `artifact_logic.mjs` are generated from it; do not edit them by hand.

```bash
npm install        # Babel, used only at build time
npm run build      # writes index.html (JSX precompiled, no in-browser Babel) and artifact_logic.mjs
npm run verify     # numeric checks with hand-derived values and vendor cross-checks
```

## Repository contents

- `index.html` - the deployable application served by GitHub Pages.
- `ngs_calculator.jsx` - the readable React source.
- `build.mjs` - builds `index.html` and `artifact_logic.mjs` from the source.
- `artifact_logic.mjs` - generated calculation module used by the tests.
- `verify.mjs` - verification harness.

## Built with

- React 18.2.0 and ReactDOM (UMD, via unpkg)
- PropTypes 15.8.1 (UMD, via unpkg)
- Recharts 2.15.4 (UMD, via jsDelivr; the 2.15.4 minified UMD bundle is not published on unpkg)
- JSX precompiled with Babel 7.24.7 at build time
- IBM Plex Sans and IBM Plex Mono

## Disclaimer

The outputs are estimates intended to support sequencing economics and multiplexing decisions. They are not financial advice.

## Copyright

Copyright (c) 2026 Gaetano Bonifacio PhD, MBA. All rights reserved.
