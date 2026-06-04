# NGS Calculator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.2-61dafb.svg)](https://react.dev/)
[![Build step](https://img.shields.io/badge/build%20step-none-brightgreen.svg)](#run-it-offline)

![NGS Calculator preview](Preview_GitHub.png)

A free, browser-based calculator for next-generation sequencing (NGS) panel multiplexing and economics. It helps genomics labs and sequencing service teams work out what sequencing really costs, and compare two setups (for example your current vendor against a new instrument or price) side by side, so you can see the cost per sample, per run and per year before you commit.

Prepared by Gaetano Bonifacio PhD, MBA | 2026

Repository: <https://github.com/Gaetano-Bonifacio/NGS-Calculator>

## Try it now

**Live site:**

```
https://gaetano-bonifacio.github.io/NGS-Calculator/
```

Open the link and start entering your values. It runs entirely in your browser. There is nothing to install, no account to create, and the numbers you type never leave your computer.

## What it does

- Compares a current setup against a future setup (a different vendor, instrument or price) at a glance.
- Shows cost per sample, cost per run and cost per year for each setup, plus the yearly and per-sample savings between them.
- Lets you turn multiplexing on or off and shows how many flow cells each setup needs.
- Adds an optional liquid-handling robot cost and an optional sequencer cost, each charged per sample, so you can test the effect of automation or a new instrument.
- Presents everything as clear figures and charts on a dark, easy-to-read interface.

## How to use it

1. Enter your panels. For each panel, give the number of samples, the reads needed per sample, and the reagent price.
2. Describe your sequencing setup: the instrument output, the flow-cell cost and how many runs you do per year.
3. Fill in the same details for the second setup you want to compare against.
4. Optionally switch on the liquid-handling robot and the sequencer add-on, with their cost and the number of samples they apply to.
5. Read the results: cost per sample, per run and per year for both setups, the flow cells required, and the savings between them.

Turning multiplexing on or off recalculates how many flow cells you need, which is often the biggest driver of cost per sample.

## Requirements

The page loads its charting and rendering libraries from public content delivery networks, so it needs an internet connection. If a library cannot load, for example on a restricted network, the page shows a short message naming what is missing rather than a blank screen.

## Run it offline

Prefer to run it without the live site? You can:

1. Download this repository (green **Code** button, then **Download ZIP**) and unzip it.
2. Open `index.html` in any modern web browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

An internet connection is still needed for the libraries mentioned above.

## Can you trust the numbers?

The cost logic is covered by an automated test suite of 40 checks across several scenarios and edge cases, with the expected answers worked out by hand rather than copied from a spreadsheet. The suite confirms, among other things, that multiplexing applies the correct flow-cell rule: the number of flow cells is based on the combined coverage of the pooled panels, not one per panel. As with any estimate, validate the output against your own quotes and conditions before making a purchasing decision.

## What is in this repository

- `index.html` is the calculator itself, a single self-contained file.
- `ngs_calculator.jsx` is the readable source for anyone who wants to inspect or adapt it.
- `verify.mjs` is the automated test suite behind the trust note above.

## License

Released under the MIT License (see `LICENSE`). You are free to use, copy, modify and distribute it, provided the copyright and permission notice are kept. Please keep the attribution line in the header and footer of the tool.

Prepared by Gaetano Bonifacio PhD, MBA | 2026
