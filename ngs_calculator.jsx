import React, { useState, useMemo, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

/* =========================================================================
   VERIFIED CALCULATION LOGIC
   Read convention: "M reads" always means total reads, counting both reads of
   a paired-end cluster (Illumina states TSO 500 as "100M paired-end reads" and
   fits 192 samples on a NovaSeq 6000 S4 = 16-20B paired-end reads). Panels and
   flow cells must use the same convention.
   Coverage of a panel = samples x M reads per sample / M reads per flow cell.
   Flow cells per run: multiplexed = ceiling of the summed coverage; not
   multiplexed = one panel only, ceiling of its coverage.
   Run cost = panel reagents + flow cell cost x flow cells needed.
   Cost per sample = yearly cost / that vendor's own annual sample volume.
   Robot and sequencer per-sample cost = (price / depreciation years) / annual
   sample volume on that equipment; yearly = per-sample x future annual volume.
   Data analysis = optional cost on the current and/or future vendor, entered as
   an annual fee (per-sample equivalent = fee / that vendor's annual volume) or a
   cost per sample (yearly = cost x that vendor's annual volume).
   ========================================================================= */
const ROBOT_MODELS = ["STAR (Hamilton)", "STARlet (Hamilton)", "Biomek i5 (Beckman Coulter)", "Biomek i7 (Beckman Coulter)", "Fontus (Revvity)"];

const EPS = 1e-9;
// Ceiling that ignores floating-point noise (0.1 + 0.2 + 0.7 = 1.0000000000000002 -> 1, not 2)
const ceilSafe = x => (x > EPS ? Math.ceil(x - EPS) : 0);
// Non-negative number: blanks, text and negative values count as 0
const nn = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
const perSample = (total, volume) => (volume > 0 ? total / volume : NaN);
const years = y => (nn(y) > 0 ? nn(y) : 1);
const maxPerFlowcell = (H, reads) => (H > 0 && reads > 0 ? Math.floor(H / reads + EPS) : null);

// Somatic depth needed to see k variant reads at this VAF: depth = k / VAF.
// Example: 50 variant reads at 5% VAF -> 1,000x.
function minDepthForVaf(vaf, k) {
  const f = nn(vaf), kk = nn(k);
  if (!(f > 0 && f < 1) || !kk) return null;
  return Math.ceil(kk / f - EPS);
}
// Coverage requirement for a panel. Germline: minimum depth per base. Somatic: depth for
// the panel's VAF. The weakest bases reach minToMean % of the mean, so required mean =
// required minimum / (minToMean / 100). Depth scales with reads, so reads needed =
// stated reads x required mean / stated mean depth.
function coverageCheck(b, cov) {
  const depth = nn(b.depth), reads = nn(b.reads);
  if (!b.app || !depth || !reads) return null;
  const somatic = b.app === "Somatic";
  const reqMin = somatic ? minDepthForVaf(nn(b.vaf) / 100, cov.minAltReads) : nn(cov.germlineMin);
  const ratio = nn(cov.minToMean) / 100;
  if (!reqMin || !ratio) return null;
  const reqMean = reqMin / ratio;
  const readsNeeded = reads * reqMean / depth;
  return { somatic, reqMin, reqMean, readsNeeded, depth, meets: reads >= readsNeeded - EPS };
}

function routine(panels, H, fcCost, runs, multiplex, runtime) {
  // Not multiplexed: a single panel per flow cell, so only the first row counts.
  const active = multiplex ? panels : panels.slice(0, 1);
  const rows = active.filter(p => p && p.name).map(p => {
    const samples = nn(p.samples), reads = p.reads == null ? null : nn(p.reads), price = nn(p.price);
    const cov = (reads && H > 0) ? (samples * reads) / H : 0;
    return { name: p.name, samples, reads, price, cov, fc: ceilSafe(cov), maxPerFC: maxPerFlowcell(H, reads) };
  });
  const reagent = rows.reduce((a, r) => a + r.price * r.samples, 0);
  const samplesRun = rows.reduce((a, r) => a + r.samples, 0);
  const samplesYear = samplesRun * nn(runs);
  const coverage = rows.reduce((a, r) => a + r.cov, 0);
  const fcNeeded = multiplex ? ceilSafe(coverage) : rows.reduce((a, r) => a + r.fc, 0);
  const fcRunCost = nn(fcCost) * fcNeeded;
  const runCost = reagent + fcRunCost;
  const yearly = runCost * nn(runs);
  const costSample = samplesYear ? yearly / samplesYear : 0;
  return {
    reagent, fc_cost_run: fcRunCost, run_cost: runCost, yearly, cost_sample: costSample,
    samples_run: samplesRun, samples_year: samplesYear, run_time: rows.length ? nn(runtime) : 0,
    fc_needed: fcNeeded, coverage, fill: fcNeeded ? coverage / fcNeeded : 0, detail: rows,
    reagent_sample: samplesRun ? reagent / samplesRun : 0, fc_sample: samplesRun ? fcRunCost / samplesRun : 0,
  };
}
function model(inp) {
  const cur = routine(inp.curPanels, inp.curH, inp.C10, inp.C11, inp.C4, inp.curRuntime);
  const fut = routine(inp.futPanels, inp.futH, inp.C20, inp.C21, inp.C14, inp.futRuntime);
  const K4 = cur.cost_sample, K5 = cur.run_cost, K6 = cur.yearly;
  const K8 = fut.cost_sample, K9 = fut.run_cost, K10 = fut.yearly;
  const robotOn = !!inp.C25, seqOn = !!inp.C33;
  const C27 = robotOn ? perSample(nn(inp.robotPrice) / years(inp.robotYears), nn(inp.robotVol)) : 0;
  const C35 = seqOn ? perSample(nn(inp.seqPrice) / years(inp.seqYears), nn(inp.seqVol)) : 0;
  const num = v => typeof v === "number" && !isNaN(v);
  const c27 = num(C27) ? C27 : 0, c35 = num(C35) ? C35 : 0;
  const C28 = robotOn ? nn(inp.C28) : 0;
  const robotSample = robotOn ? c27 + C28 : 0, seqSample = seqOn ? c35 : 0;
  // Resequencing: failure rate x sequencing cost per sample (and x yearly sequencing cost).
  const reseqOn = !!inp.C40;
  const fCur = reseqOn ? nn(inp.curFail) : 0, fFut = reseqOn ? nn(inp.futFail) : 0;
  const reseqCur = fCur * K4, reseqFut = fFut * K8;
  const reseqCurYear = fCur * K6, reseqFutYear = fFut * K10;
  const curPlusReseq = K4 + reseqCur, futPlusReseq = K8 + reseqFut;
  const curPlusReseqYear = K6 + reseqCurYear, futPlusReseqYear = K10 + reseqFutYear;
  // Data analysis: per vendor, annual fee or cost per sample. Only the future side
  // feeds the total future figures; the current side is its own comparison line.
  const dataOn = !!inp.C45, dMode = inp.dataMode, futVol = fut.samples_year, curVol = cur.samples_year;
  const dCurPer = nn(inp.dataCurPer), dFutPer = nn(inp.dataFutPer);
  const dCurAnn = nn(inp.dataCurAnnual), dFutAnn = nn(inp.dataFutAnnual);
  const dataCurPerSample = dataOn ? (dMode === "annual" ? (curVol > 0 ? dCurAnn / curVol : 0) : dCurPer) : 0;
  const dataFutPerSample = dataOn ? (dMode === "annual" ? (futVol > 0 ? dFutAnn / futVol : 0) : dFutPer) : 0;
  const dataCurYear = dataOn ? (dMode === "annual" ? dCurAnn : dCurPer * curVol) : 0;
  const dataFutYear = dataOn ? (dMode === "annual" ? dFutAnn : dFutPer * futVol) : 0;
  const dataCurValid = !dataOn || dMode !== "annual" || curVol > 0;
  const dataFutValid = !dataOn || dMode !== "annual" || futVol > 0;
  const curPlusData = K4 + dataCurPerSample, futPlusData = K8 + dataFutPerSample;
  const curPlusDataYear = K6 + dataCurYear, futPlusDataYear = K10 + dataFutYear;
  // Current all-in: current vendor with its own resequencing and data analysis.
  const curAllIn = K4 + reseqCur + dataCurPerSample, curAllInYear = K6 + reseqCurYear + dataCurYear;
  const K12 = K8 + robotSample;
  const K20 = K8 + reseqFut + dataFutPerSample + robotSample + seqSample;
  const K21 = K9 + (robotSample + seqSample) * fut.samples_run;
  const K22 = K10 + reseqFutYear + dataFutYear + (robotSample + seqSample) * futVol;
  return {
    K4, K5, K6, K8, K9, K10, C27, C35, K12, K20, K21, K22,
    reseqCur, reseqFut, reseqCurYear, reseqFutYear, curPlusReseq, futPlusReseq, curPlusReseqYear, futPlusReseqYear,
    dataCurPerSample, dataFutPerSample, dataCurYear, dataFutYear, dataCurValid, dataFutValid,
    curPlusData, futPlusData, curPlusDataYear, futPlusDataYear, futVol, curVol, curAllIn, curAllInYear,
    robotSample, seqSample,
    robotPriceValid: !robotOn || num(C27), seqPriceValid: !seqOn || num(C35),
    cur_fc: cur.fc_needed, fut_fc: fut.fc_needed, cur_runtime: cur.run_time, fut_runtime: fut.run_time,
    cur_cov: cur.coverage, fut_cov: fut.coverage, cur_fill: cur.fill, fut_fill: fut.fill,
    cur_samples_year: cur.samples_year, fut_samples_year: fut.samples_year,
    cur_H: inp.curH, fut_H: inp.futH, cur, fut,
    yr_savings: K6 - K10, persample_savings: K4 - K8,
  };
}

/* ============================ SEEDED DATA ============================ */
// M reads = total reads per sample (both reads of a pair). "Basis" tells how solid each value is.
const SRC = {
  tso500: "https://www.illumina.com/products/by-type/clinical-research-products/trusight-oncology-500.html",
  tso500ct: "https://knowledge.illumina.com/library-preparation/trusight-oncology-tumor-library-prep/library-preparation-trusight-oncology-tumor-library-prep-reference_material-list/000002931",
  ampComp: "https://www.illumina.com/products/by-type/sequencing-kits/library-prep-kits/ampliseq-comprehensive-panel.html",
  ampFocus: "https://supportassets.illumina.com/products/by-type/sequencing-kits/library-prep-kits/ampliseq-focus-panel.html",
  msk: "https://d3e30vlyff459p.cloudfront.net/2b75c131-2c1d-4268-be32-67d15945dcb8/fca87090-fd77-41b2-823b-bd5adb172b9b/fca87090-fd77-41b2-823b-bd5adb172b9b_source__v.pdf",
  ces: "https://www.sophiagenetics.com/wp-content/uploads/2024/09/CESv3-Factsheet.pdf",
  wes: "https://www.sophiagenetics.com/wp-content/uploads/2024/09/WESv2-Factsheet.pdf",
  sts: "https://www.dlongwood.com/wp-content/uploads/2020/01/STS_SOPHIA_GENETICS_RUO_DATASHEET_EN.pdf",
  nova6000: "https://www.illumina.com/systems/sequencing-platforms/novaseq/specifications.html",
  novaX: "https://www.illumina.com/systems/sequencing-platforms/novaseq-x-plus/specifications.html",
  next2000: "https://www.illumina.com/systems/sequencing-platforms/nextseq-1000-2000/specifications.html",
  miseq: "https://www.illumina.com/systems/sequencing-platforms/miseq/specifications.html",
  aviti: "https://elementbiosciences.com/products/aviti/specs",
  ilmnExome: "https://emea.illumina.com/content/dam/illumina/gcs/assembled-assets/marketing-literature/illumina-dna-exome-enrich-m-gl-00002/illumina-dna-exome-enrich-data-sheet-m-gl-00002.pdf",
  ilmnRna: "https://knowledge.illumina.com/library-preparation/general/library-preparation-general-reference_material-list/000010216",
  archer: "https://www.idtdna.com/pages/products/next-generation-sequencing/archer-ngs-assay-solutions/solid-tumor-research/",
  pillarSt: "https://www.illumina.com/content/dam/illumina/gcs/assembled-assets/marketing-literature/pillar-oncoreveal-solid-tumor-data-sheet-m-gl-03147/pillar-oncoreveal-solid-tumor-data-sheet-m-gl-03147.PDF",
  pillarLbx: "https://www.illumina.com/content/dam/illumina/gcs/assembled-assets/marketing-literature/pillar-oncoreveal-essential-lbx-data-sheet-m-gl-03145/pillar-oncoreveal-essential-lbx-data-sheet-m-gl-03145.PDF",
  xgen: "https://www.idtdna.com/pages/products/next-generation-sequencing/workflow/xgen-ngs-hybridization-capture/pre-designed-hyb-cap-panels/exome-hyb-panel-v2",
  agilentV8: "https://agilent.com/cs/library/datasheets/public/V5-datasheet-exome-v8-5994-3154EN-agilent.pdf",
  twistExome: "https://www.twistbioscience.com/content/dam/twistbioscience/resources/2025-08/DOC-001266_ProductSheet_Exome2.0-REV2%20singles.pdf",
};
const SEED_BUNDLES = [
  { id: "p-tso500", name: "TruSight Oncology 500", vendor: "Illumina", reads: 100, price: 690, basis: "Vendor-stated", source: SRC.tso500, note: "100M paired-end reads per sample, 3,500x coverage", app: "Somatic", depth: 3500, vaf: 5 },
  { id: "p-tso500ctdna", name: "TruSight Oncology 500 ctDNA v2", vendor: "Illumina", reads: 800, price: 0, basis: "Vendor-stated", source: SRC.tso500ct, note: "~800M paired-end reads per sample, ~35,000x before UMI collapsing. Mean depth left blank: the variant-read rule applies to unique reads.", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-ampli-comp3", name: "AmpliSeq for Illumina Comprehensive Panel v3", vendor: "Illumina", reads: 16.25, price: 0, basis: "Derived", source: SRC.ampComp, note: "16 samples per NextSeq 550 Mid Output (260M reads) and 48 per High Output (800M reads), 500x minimum", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-ampli-focus", name: "AmpliSeq for Illumina Focus Panel", vendor: "Illumina", reads: 1, price: 0, basis: "Derived", source: SRC.ampFocus, note: "48 samples per MiSeq v3 (50M reads), 500x minimum", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-sophia-msk", name: "MSK-IMPACT powered with SOPHiA DDM (tumor + normal pair)", vendor: "SOPHiA GENETICS", reads: 66, price: 0, basis: "Vendor-stated", source: SRC.msk, note: "66M paired-end reads per tumor/normal pair (12 pairs per NextSeq 550 High Output). Count one sample per pair.", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-sophia-ces3", name: "SOPHiA DDM Clinical Exome Solution v3", vendor: "SOPHiA GENETICS", reads: 16.25, price: 0, basis: "Vendor-stated", source: SRC.ces, note: "Performance data at 16.25M reads per sample (16 per NextSeq Mid Output)", app: "Germline", depth: "", vaf: 5 },
  { id: "p-sophia-wes2", name: "SOPHiA DDM Whole Exome Solution v2", vendor: "SOPHiA GENETICS", reads: 80, price: 0, basis: "Vendor-stated", source: SRC.wes, note: "Performance data at 80M reads per sample (the factsheet also lists 12 samples per NextSeq 550 High Output, about 67M each)", app: "Germline", depth: "", vaf: 5 },
  { id: "p-sophia-sts", name: "SOPHiA Solid Tumor Solution (42 genes)", vendor: "SOPHiA GENETICS", reads: 2.08, price: 0, basis: "Derived", source: SRC.sts, note: "24 samples per MiSeq v3 (50M reads) at 1000x median depth", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-ilmn-exome25", name: "Illumina DNA Prep with Exome 2.5 Enrichment", vendor: "Illumina", reads: 50, price: 0, basis: "Vendor-stated", source: SRC.ilmnExome, note: "Validation data: 50M paired-end reads (2x101) gave 63x mean target coverage over 37.5 Mb", app: "Germline", depth: 63, vaf: 5 },
  { id: "p-ilmn-rnaexome25", name: "Illumina Rapid RNA Prep with Exome 2.5 Enrichment", vendor: "Illumina", reads: 50, price: 0, basis: "Vendor-stated", source: SRC.ilmnRna, note: "25M clusters (50M reads) per sample; 16 per NextSeq P2. RNA: coverage rule not applied.", app: "", depth: "", vaf: 5 },
  { id: "p-archer-core", name: "Archer VARIANTPlex Core Solid Tumor (60 genes)", vendor: "Archer (IDT)", reads: 4.5, price: 0, basis: "Vendor-stated", source: SRC.archer + "archer-variantplex-core-solid-tumor-panel", note: "Recommended number of reads 4.5M. Archer does not say whether both reads of a pair are counted.", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-archer-focus2", name: "Archer VARIANTPlex Solid Tumor Focus v2 (20 genes)", vendor: "Archer (IDT)", reads: 1.5, price: 0, basis: "Vendor-stated", source: SRC.archer + "archer-variantplex-solid-tumor-focus-v2-panel", note: "Recommended number of reads 1.5M. Archer does not say whether both reads of a pair are counted.", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-archer-pan", name: "Archer VARIANTPlex Pan Solid Tumor (185 genes)", vendor: "Archer (IDT)", reads: 25, price: 0, basis: "Vendor-stated", source: SRC.archer + "archer-variantplex-pan-solid-tumor-panel", note: "Recommended number of reads 25M. Archer does not say whether both reads of a pair are counted.", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-archer-complete", name: "Archer VARIANTPlex Complete Solid Tumor (430 genes)", vendor: "Archer (IDT)", reads: 45, price: 0, basis: "Vendor-stated", source: SRC.archer + "archer-variantplex-complete-solid-tumor-panel", note: "Recommended number of reads 45M. Archer does not say whether both reads of a pair are counted.", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-archer-sarcoma2", name: "Archer FUSIONPlex Sarcoma v2 (63 genes, RNA)", vendor: "Archer (IDT)", reads: 2, price: 0, basis: "Vendor-stated", source: SRC.archer + "archer-fusionplex-sarcoma-v2-panel", note: "Recommended number of reads 2M. RNA fusion panel: coverage rule not applied.", app: "", depth: "", vaf: 5 },
  { id: "p-pillar-st", name: "Pillar oncoReveal Solid Tumor (48 genes)", vendor: "Pillar Biosciences", reads: 2, price: 0, basis: "Vendor-stated", source: SRC.pillarSt, note: "~2M paired-end reads per sample; vendor claims SNV/indel detection down to 1% VAF; 98% of targets above 0.2x mean", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-pillar-lbx", name: "Pillar oncoReveal Essential LBx (34 genes)", vendor: "Pillar Biosciences", reads: 10, price: 0, basis: "Vendor-stated", source: SRC.pillarLbx, note: "~10M paired-end reads per sample; liquid biopsy; vendor claims detection down to 0.1% VAF", app: "Somatic", depth: "", vaf: 5 },
  { id: "p-idt-xgen-exome2", name: "IDT xGen Exome Hyb Panel v2", vendor: "IDT", reads: 50, price: 0, basis: "Benchmark", source: SRC.xgen, note: "Vendor comparison data: 5 Gb at 2x100 (50M reads) gave 64.5x mean target coverage. Not a sequencing recommendation.", app: "Germline", depth: 64.5, vaf: 5 },
  { id: "p-agilent-exome-v8", name: "Agilent SureSelect Human All Exon V8", vendor: "Agilent", reads: 50, price: 0, basis: "Benchmark", source: SRC.agilentV8, note: "Vendor benchmark downsampled to 50M reads (5 Gb, 2x100). Not a sequencing recommendation.", app: "Germline", depth: "", vaf: 5 },
  { id: "p-twist-exome2", name: "Twist Exome 2.0", vendor: "Twist Bioscience", reads: 40, price: 0, basis: "Benchmark", source: SRC.twistExome, note: "Vendor comparison data used 6 Gb per sample; 40M reads assumes 2x150 (read length not stated). Not a sequencing recommendation.", app: "Germline", depth: "", vaf: 5 },
  { id: "p-custom-1", name: "", vendor: "", reads: 0, price: 0, basis: "Custom", source: "", note: "", app: "", depth: "", vaf: 5 },
  { id: "p-custom-2", name: "", vendor: "", reads: 0, price: 0, basis: "Custom", source: "", note: "", app: "", depth: "", vaf: 5 },
];
// Flow cells grouped by sequencer: [name, M reads per flow cell (total reads), run time in hours]
const SEED_SEQUENCERS = [
  { id: "s-aviti", name: "AVITI", source: SRC.aviti, verified: true, flowcells: [["Low Output 2x150", 500, 27], ["Medium Output 2x150", 1000, 31], ["Medium Output 2x300", 200, 51], ["High Output 2x150", 2000, 38], ["High Output 2x300", 600, 60]] },
  { id: "s-miseq", name: "MiSeq", source: SRC.miseq, verified: true, flowcells: [["v2 Nano 2x150", 2, 17], ["v2 Micro 2x150", 8, 19], ["v2 2x150", 30, 24], ["v2 2x250", 30, 39], ["v3 2x75", 50, 21], ["v3 2x300", 50, 56]] },
  { id: "s-miseqi100", name: "MiSeq i100 plus", source: "", verified: false, flowcells: [["50M PE 150", 100, 7.5], ["50M PE 300", 100, 15.5], ["100M PE", 200, 8]] },
  { id: "s-nextseq550", name: "NextSeq 550", source: "", verified: false, flowcells: [["Mid Output", 260, 26], ["High Output", 800, 29]] },
  { id: "s-nextseq1000", name: "NextSeq 1000", source: SRC.next2000, verified: true, flowcells: [["P1 2x150", 200, 17], ["P1 2x300", 200, 34], ["P2 2x150", 800, 22], ["P2 2x300", 800, 42]] },
  { id: "s-nextseq2000", name: "NextSeq 2000", source: SRC.next2000, verified: true, flowcells: [["P1 2x150", 200, 17], ["P1 2x300", 200, 34], ["P2 2x150", 800, 22], ["P2 2x300", 800, 42], ["P3 2x150", 2400, 40], ["P4 2x150", 3600, 44]] },
  { id: "s-novaseq6000", name: "NovaSeq 6000", source: SRC.nova6000, verified: true, flowcells: [["SP 2x150", 1600, 25], ["SP 2x250", 1600, 38], ["S1", 3200, 25], ["S2", 8200, 36], ["S4", 20000, 44]] },
  { id: "s-novaseqx", name: "NovaSeq X", source: SRC.novaX, verified: true, flowcells: [["1.5B", 3200, 23], ["10B", 20000, 25], ["25B", 52000, 48]] },
  { id: "s-mgit7", name: "MGI T7", source: "", verified: false, flowcells: [["FCL 1 lane, 1 flow cell", 11600, 24]] },
  { id: "s-mgig400", name: "MGI G400", source: "", verified: false, flowcells: [["DNBSeq FCL 1 of 4", 900, 56], ["DNBSeq FCS 300 reads", 300, 98], ["DNBSeq FCS 150 reads", 550, 37]] },
].map(s => ({ ...s, flowcells: s.flowcells.map(([name, reads, runtime], i) => ({ id: s.id + "-f" + i, name, reads, runtime })) }));
const SEED_ROBOTS = ROBOT_MODELS.map((name, i) => ({ id: "r-" + i, name, price: name.startsWith("STARlet") ? 67960 : 0, consumables: name.startsWith("STARlet") ? 5 : 0, years: 1 }));
const fcId = (seqId, name) => (SEED_SEQUENCERS.find(s => s.id === seqId).flowcells.find(f => f.name === name) || {}).id;
const COPYRIGHT = "by Gaetano Bonifacio PhD, MBA | 2026";
const STORE_KEY = "ngs-calculator:v3";
const SCHEMA = 3;

function defaultScenario() {
  return {
    schema: SCHEMA, tab: "compare",
    bundles: SEED_BUNDLES, sequencers: SEED_SEQUENCERS, robots: SEED_ROBOTS,
    current: { multiplex: "No", panels: [{ bundleId: "p-tso500", samples: 96 }, { bundleId: "", samples: 0 }, { bundleId: "", samples: 0 }],
      sequencerId: "s-novaseq6000", flowcellId: fcId("s-novaseq6000", "S2"), flowcellCost: 3000, runs: 20 },
    future: { samePanels: "Yes", multiplex: "No", panels: [{ bundleId: "p-tso500", samples: 96 }, { bundleId: "", samples: 0 }, { bundleId: "", samples: 0 }],
      sequencerId: "s-novaseqx", flowcellId: fcId("s-novaseqx", "25B"), flowcellCost: 5000, runs: 20 },
    mplex: { multiplex: "Yes", panels: [{ bundleId: "p-tso500", samples: 48 }, { bundleId: "", samples: 0 }, { bundleId: "", samples: 0 }],
      sequencerId: "s-novaseq6000", flowcellId: fcId("s-novaseq6000", "S4"), runs: 12 },
    robot: { enabled: "Yes", robotId: "r-1", volume: 2000 },
    seq: { enabled: "No", sequencerId: "s-novaseqx", price: 0, years: 1, volume: 2000 },
    reseq: { enabled: "No", curRate: 5, futRate: 5 },
    data: { enabled: "No", mode: "Annual fee", curAnnual: 50000, futAnnual: 50000, curPer: 20, futPer: 20 },
    coverage: { sizeByReq: "No", germlineMin: 30, minAltReads: 50, minToMean: 20 },
  };
}
// Accepts a saved or imported scenario and fills any missing parts from the defaults.
function normalizeScenario(s) {
  const d = defaultScenario();
  if (!s || typeof s !== "object" || s.schema !== SCHEMA) return null;
  const arr = (v, fb) => (Array.isArray(v) ? v : fb);
  const obj = (v, fb) => (v && typeof v === "object" && !Array.isArray(v) ? { ...fb, ...v } : fb);
  const panels = (v, fb) => (Array.isArray(v) && v.length ? v.slice(0, 3).map(p => ({ bundleId: String((p && p.bundleId) || ""), samples: p && p.samples !== undefined ? p.samples : 0 })) : fb);
  const out = {
    schema: SCHEMA, tab: ["multiplex", "compare", "database", "combined"].includes(s.tab) ? s.tab : d.tab,
    bundles: arr(s.bundles, d.bundles).filter(b => b && b.id).map(b => ({ ...{ name: "", vendor: "", reads: 0, price: 0, basis: "Custom", source: "", note: "", app: "", depth: "", vaf: 5 }, ...b })),
    sequencers: arr(s.sequencers, d.sequencers).filter(x => x && x.id).map(x => ({ name: "", source: "", verified: false, ...x, flowcells: arr(x.flowcells, []).filter(f => f && f.id) })),
    robots: arr(s.robots, d.robots).filter(r => r && r.id),
    current: obj(s.current, d.current), future: obj(s.future, d.future), mplex: obj(s.mplex, d.mplex),
    robot: obj(s.robot, d.robot), seq: obj(s.seq, d.seq), reseq: obj(s.reseq, d.reseq), data: obj(s.data, d.data), coverage: obj(s.coverage, d.coverage),
  };
  out.current.panels = panels(out.current.panels, d.current.panels);
  out.future.panels = panels(out.future.panels, d.future.panels);
  out.mplex.panels = panels(out.mplex.panels, d.mplex.panels);
  return out;
}
function loadSaved() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? normalizeScenario(JSON.parse(raw)) : null;
  } catch (e) { return null; }
}
function saveScenario(s) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
}
function clearSaved() {
  try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* storage unavailable */ }
}
const uid = p => p + "-" + Math.random().toString(36).slice(2, 9);

/* ============================ FORMATTERS ============================ */
const usd0 = n => (n == null || isNaN(n)) ? "-" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = n => (n == null || isNaN(n)) ? "-" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = n => (n == null || isNaN(n)) ? "-" : (n * 100).toFixed(1) + "%";
const int = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString("en-US");
const fmtM = v => (v == null || isNaN(v)) ? "-" : (Math.round(v * 10) / 10).toLocaleString("en-US");
const covReq = b => b.check.somatic ? nn(b.vaf) + "% VAF" : int(b.check.reqMin) + "x minimum";
const covText = b => {
  const c = b.check;
  if (b.sized) return "Sized by coverage: " + fmtM(c.readsNeeded) + " M reads for " + covReq(b) + " (" + int(c.reqMean) + "x mean)";
  if (c.meets) return "Meets " + covReq(b) + ": needs " + int(c.reqMean) + "x mean, has " + int(c.depth) + "x";
  return "Below " + covReq(b) + ": needs " + fmtM(c.readsNeeded) + " M reads (" + int(c.reqMean) + "x mean)";
};
const compactUsd = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return "$" + (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return "$" + Math.round(v);
};

/* ============================ UI PRIMITIVES ============================ */
function Field({ label, children, hint, group }) {
  const head = <span className="field-label">{label}{hint && <em className="field-hint">{hint}</em>}</span>;
  // Button groups use a div: a <label> around buttons would let a click on the text press the first button.
  if (group) return <div className="field" role="group" aria-label={label}>{head}{children}</div>;
  return <label className="field">{head}{children}</label>;
}
function Select({ value, onChange, options, placeholder }) {
  const known = options.some(o => o.value === value);
  return (
    <select className="ctrl" value={known ? value : ""} onChange={e => onChange(e.target.value)}>
      {(!known || placeholder) && <option value="" disabled={!!placeholder && known}>{placeholder || "Select"}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function Num({ value, onChange, step = 1, min = 0, ariaLabel }) {
  return <input className="ctrl num" type="number" inputMode="decimal" step={step} min={min} value={value} aria-label={ariaLabel}
    onChange={e => onChange(e.target.value === "" ? "" : Math.max(min, Number(e.target.value)))} />;
}
function Toggle({ value, onChange, options = ["Yes", "No"] }) {
  return (
    <div className="toggle">
      {options.map(v => (
        <button type="button" key={v} aria-pressed={value === v} className={"toggle-btn" + (value === v ? " on" : "")} onClick={() => onChange(v)}>{v}</button>
      ))}
    </div>
  );
}
function PanelSelect({ value, onChange, bundles, first }) {
  const named = bundles.filter(b => b.name);
  const groups = {};
  named.forEach(b => { const g = b.vendor || "Custom"; (groups[g] = groups[g] || []).push(b); });
  const missing = value && !named.some(b => b.id === value);
  return (
    <select className={"ctrl" + (missing ? " warn" : "")} value={missing ? "__missing" : value} onChange={e => onChange(e.target.value === "__missing" ? value : e.target.value)} aria-label="NGS panel">
      <option value="">{first ? "Select panel" : "(none)"}</option>
      {missing && <option value="__missing">(removed from database)</option>}
      {Object.keys(groups).sort().map(g => (
        <optgroup key={g} label={g}>{groups[g].map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
      ))}
    </select>
  );
}
function Warnings({ items }) {
  if (!items || !items.length) return null;
  return (
    <ul className="warns" role="status">
      {items.map((w, i) => <li key={i} className={w.level === "info" ? "info" : ""}><span className="wic" aria-hidden="true">{w.level === "info" ? "i" : "!"}</span>{w.text}</li>)}
    </ul>
  );
}
function Confirm({ text, onYes, onNo }) {
  return (
    <span className="confirm" role="alert">{text}
      <button type="button" className="btn danger sm" onClick={onYes}>Remove</button>
      <button type="button" className="btn ghost sm" onClick={onNo}>Cancel</button>
    </span>
  );
}

/* ============================ ROUTINE HELPERS ============================ */
function resolvePanels(panels, bMap) {
  return panels.map(p => {
    const b = p.bundleId ? bMap[p.bundleId] : null;
    return { name: b && b.name ? b.name : "", samples: nn(p.samples), reads: b ? nn(b.reads) : null, price: b ? nn(b.price) : 0, missing: !!p.bundleId && !(b && b.name) };
  });
}
function routineWarnings(st, resolved, fc, r, bMap) {
  const w = [];
  const multiplex = st.multiplex === "Yes";
  const visible = multiplex ? st.panels : st.panels.slice(0, 1);
  const seen = {};
  visible.forEach((p, i) => {
    const res = resolved[i];
    if (res.missing) w.push({ text: "Row " + (i + 1) + ": the selected panel was removed or renamed to blank in Products & Requirements." });
    else if (!p.bundleId && nn(p.samples) > 0) w.push({ text: "Row " + (i + 1) + " has samples but no panel, so it is ignored." });
    else if (p.bundleId && res.name && !res.reads) w.push({ text: res.name + " has 0 M reads per sample in Products & Requirements, so it adds no coverage." });
    if (p.bundleId && res.name) { if (seen[p.bundleId]) w.push({ text: res.name + " is selected in more than one row." }); seen[p.bundleId] = true; }
  });
  if (!fc.found) w.push({ text: "Pick a sequencer and flow cell." });
  else if (!fc.reads) w.push({ text: "The selected flow cell has 0 M reads in Products & Requirements." });
  if (r.fc_needed > 1) w.push({ level: "info", text: "Needs " + r.fc_needed + " flow cells per run (average fill " + pct1(r.fill) + "). Run time is for one run: check how many flow cells your instrument runs at once." });
  return w;
}

/* ============================ ROUTINE EDITOR ============================ */
function PanelRows({ state, set, bundles, H, readOnly }) {
  const multiplex = state.multiplex === "Yes";
  const rows = multiplex ? state.panels : state.panels.slice(0, 1);
  const bMap = Object.fromEntries(bundles.map(b => [b.id, b]));
  const setPanel = (i, key, v) => set({ ...state, panels: state.panels.map((p, idx) => idx === i ? { ...p, [key]: v } : p) });
  return (
    <div className="panels">
      <div className="panels-head"><span>NGS panel</span><span>Samples / run</span></div>
      {rows.map((p, i) => {
        const b = bMap[p.bundleId];
        const max = b ? maxPerFlowcell(H, nn(b.reads)) : null;
        return (
          <div key={i}>
            {readOnly ? (
              <div className="panel-row ro"><div className="ctrl ro">{b && b.name ? b.name : "(none)"}</div><div className="ctrl ro num">{nn(p.samples)}</div></div>
            ) : (
              <div className="panel-row">
                <PanelSelect value={p.bundleId} onChange={v => setPanel(i, "bundleId", v)} bundles={bundles} first={i === 0} />
                <input className="ctrl num" type="number" inputMode="numeric" min={0} value={p.samples} aria-label={"Samples per run, row " + (i + 1)}
                  onChange={e => setPanel(i, "samples", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))} />
              </div>
            )}
            {b && b.name && max != null && <div className="rowhint">Fits up to <b className="num">{int(max)}</b> samples per flow cell at {fmtM(nn(b.reads))} M reads each</div>}
            {b && b.name && b.check && <div className={"rowhint cov " + (b.check.meets || b.sized ? "ok" : "short")}><span className="cdot" aria-hidden="true" />{covText(b)}</div>}
          </div>
        );
      })}
    </div>
  );
}
function SeqFlowFields({ state, set, sequencers, children }) {
  const seqOpts = sequencers.map(s => ({ value: s.id, label: s.name || "(unnamed sequencer)" }));
  const seqObj = sequencers.find(s => s.id === state.sequencerId);
  const flowOpts = (seqObj ? seqObj.flowcells : []).map(f => ({ value: f.id, label: f.name || "(unnamed flow cell)" }));
  const fcObj = seqObj && seqObj.flowcells.find(f => f.id === state.flowcellId);
  const setSeq = id => {
    const s = sequencers.find(x => x.id === id);
    const keep = s && s.flowcells.some(f => f.id === state.flowcellId);
    set({ ...state, sequencerId: id, flowcellId: keep ? state.flowcellId : (s && s.flowcells[0] ? s.flowcells[0].id : "") });
  };
  return (
    <div className="grid2">
      <Field label="Sequencer"><Select value={state.sequencerId} onChange={setSeq} options={seqOpts} placeholder="Select sequencer" /></Field>
      <Field label="Flow cell" hint={fcObj ? int(nn(fcObj.reads)) + " M reads · " + nn(fcObj.runtime) + " h run" : null}>
        <Select value={state.flowcellId} onChange={v => set({ ...state, flowcellId: v })} options={flowOpts} placeholder="Select flow cell" />
      </Field>
      {children}
    </div>
  );
}
function Readout({ r, active, costSample, showCost = true }) {
  const cells = [
    ["Flow cells / run", active ? int(r.fc_needed) : "-"],
    ["Total coverage", active ? pct1(r.coverage) : "-"],
    ["Avg fill / flow cell", active ? pct1(r.fill) : "-"],
    ["Run time (hrs)", active ? r.run_time : "-"],
    ["Samples / year", active ? int(r.samples_year) : "-"],
  ];
  if (showCost) cells.push(["Cost / sample", active ? usd2(costSample) : "-"]);
  return (
    <div className="readout">
      <div className="readout-h">Technical output</div>
      <div className="readout-grid">
        {cells.map(([l, v]) => <div className="rocell" key={l}><div className="l">{l}</div><div className="v num">{v}</div></div>)}
      </div>
    </div>
  );
}
function RoutineCard({ title, accent, state, set, effective, bundles, sequencers, r, active, costSample, warnings, mirrorToggle }) {
  const H = r.H;
  const readOnly = mirrorToggle && state.samePanels === "Yes";
  return (
    <div className="card" style={{ "--accent": accent }}>
      <div className="card-head"><span className="dot" /> {title}</div>
      {mirrorToggle && (
        <Field label="Same panels as current vendor?" hint="Yes: only the sequencer setup changes. No: choose different panels." group>
          <Toggle value={state.samePanels} onChange={mirrorToggle} />
        </Field>
      )}
      {!readOnly && (
        <Field label="Multiplex panels on one flow cell?" hint={state.multiplex === "Yes" ? "Up to 3 panels share each flow cell" : "One panel per flow cell"} group>
          <Toggle value={state.multiplex} onChange={v => set({ ...state, multiplex: v })} />
        </Field>
      )}
      <PanelRows state={effective} set={set} bundles={bundles} H={H} readOnly={readOnly} />
      {readOnly && <div className="note small">Panels and samples per run mirror the current vendor. Switch to "No" to change them (they start as a copy).</div>}
      <SeqFlowFields state={state} set={set} sequencers={sequencers}>
        <Field label="Flow cell cost ($ per flow cell)"><Num value={state.flowcellCost} onChange={v => set({ ...state, flowcellCost: v })} step={10} /></Field>
        <Field label="Runs per year"><Num value={state.runs} onChange={v => set({ ...state, runs: v })} /></Field>
      </SeqFlowFields>
      <Warnings items={warnings} />
      <Readout r={r} active={active} costSample={costSample} />
    </div>
  );
}

/* ============================ OUTPUT TABLES AND CHARTS ============================ */
function FinRow({ label, cost, base, isCurrent, fmt = usd2, strong }) {
  const delta = isCurrent ? null : (base - cost);
  const pct = isCurrent ? null : (base ? 1 - cost / base : null);
  const good = delta != null && delta > 0.005;
  const bad = delta != null && delta < -0.005;
  return (
    <tr className={strong ? "strong" : ""}>
      <td className="rl">{label}</td>
      <td className="rn">{fmt(cost)}</td>
      <td className={"rn" + (good ? " good" : bad ? " bad" : "")}>{isCurrent ? "-" : (delta >= 0 ? "+" : "") + fmt(delta)}</td>
      <td className={"rn" + (good ? " good" : bad ? " bad" : "")}>{isCurrent ? "-" : pct1(pct)}</td>
    </tr>
  );
}
function FinTable({ head, children }) {
  return (
    <div className="tscroll">
      <table className="fin">
        <thead><tr><th>{head}</th><th>Amount</th><th>Saving vs current</th><th>Change</th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const SEG = {
  panels: { label: "Panels", color: "#36d6c3" },
  flow: { label: "Flow cells", color: "#94a3b8" },
  reseq: { label: "Resequencing", color: "#ff7a85" },
  data: { label: "Data analysis", color: "#a78bfa" },
  robot: { label: "Robot", color: "#f2a65a" },
  seq: { label: "Sequencer", color: "#7aa2ff" },
};
function StackChart({ data, keys, fmt, title }) {
  const used = keys.filter(k => data.some(d => d[k] > 0));
  if (!data.length || !used.length) return null;
  const tip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const total = payload.reduce((a, p) => a + (p.value || 0), 0);
    return (
      <div className="ctip num">
        <div className="ctip-h">{label}</div>
        {payload.slice().reverse().filter(p => p.value > 0).map(p => <div key={p.dataKey}><span className="sw" style={{ background: p.color }} />{SEG[p.dataKey].label}: {fmt(p.value)}</div>)}
        <div className="ctip-t">Total: {fmt(total)}</div>
      </div>
    );
  };
  return (
    <figure className="chart" aria-label={title}>
      <figcaption className="chart-h">{title}</figcaption>
      <div className="chartwrap">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#1f2935" />
            <XAxis dataKey="name" tick={{ fill: "#8b9bb0", fontSize: 11 }} axisLine={{ stroke: "#1f2935" }} tickLine={false} interval={0} />
            <YAxis tick={{ fill: "#8b9bb0", fontSize: 10 }} axisLine={false} tickLine={false} width={56} tickFormatter={compactUsd} />
            <Tooltip content={tip} cursor={{ fill: "rgba(255,255,255,.03)" }} />
            <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11, color: "#8b9bb0", paddingTop: 6 }} formatter={k => SEG[k].label} />
            {used.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={SEG[k].color} radius={i === used.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/* ============================ STYLES ============================ */
const CSS = `
  *{box-sizing:border-box}
  .wrap{--bg:#0a0e14;--panel:#121821;--panel2:#0f141c;--line:#1f2935;--ink:#e6edf3;--mut:#8b9bb0;--teal:#36d6c3;--amber:#f2a65a;--accent2:#7aa2ff;--violet:#a78bfa;--good:#3fe0a0;--bad:#ff7a85;
    background:radial-gradient(1200px 600px at 15% -10%,#142031 0%,#0a0e14 55%);background-color:#0a0e14;min-height:100vh;color:var(--ink);
    font-family:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;padding:0 0 40px;}
  .num{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}
  .topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding:26px 30px 18px;border-bottom:1px solid var(--line);
    background:linear-gradient(180deg,rgba(54,214,195,.06),transparent);flex-wrap:wrap;}
  .title{font-size:26px;font-weight:600;letter-spacing:-.02em;margin:0;}
  .title b{color:var(--teal);font-weight:600;}
  .sub{color:var(--mut);font-size:13px;margin-top:4px;max-width:560px;line-height:1.5;}
  .topright{display:flex;flex-direction:column;align-items:flex-end;gap:10px;}
  .credit{font-size:11.5px;color:var(--mut);font-family:'IBM Plex Mono',monospace;text-align:right;}
  .tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end;}
  .saved{font-size:11px;color:var(--mut);margin-right:4px;}
  .saved .d{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--good);margin-right:5px;vertical-align:middle;}
  .cardfoot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;}
  .cardfoot .note.small{margin:0;}
  .btn:disabled{opacity:.45;cursor:not-allowed;}
  .notice{margin:12px 30px 0;padding:9px 13px;border-radius:9px;font-size:12.5px;border:1px solid color-mix(in srgb,var(--teal) 40%,transparent);background:color-mix(in srgb,var(--teal) 10%,transparent);}
  .notice.err{border-color:color-mix(in srgb,var(--bad) 45%,transparent);background:color-mix(in srgb,var(--bad) 10%,transparent);}
  .layout{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:18px;padding:22px 30px;}
  @media(max-width:980px){.layout{grid-template-columns:minmax(0,1fr);}}
  .col-h{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--mut);margin:0 0 10px;font-weight:600;}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 16px 18px;margin-bottom:16px;position:relative;overflow:hidden;}
  .card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent);}
  .card-head{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin-bottom:14px;letter-spacing:.01em;}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent);flex:none;}
  .field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;min-width:0;}
  .field-label{font-size:12px;color:var(--mut);font-weight:500;}
  .field-hint{display:block;font-style:normal;font-size:11px;color:var(--mut);opacity:.75;margin-top:2px;}
  .ctrl{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:9px 10px;font-size:13px;width:100%;min-width:0;outline:none;transition:border .15s;font-family:inherit;}
  .ctrl.num{font-family:'IBM Plex Mono',monospace;}
  .ctrl:focus-visible,.toggle-btn:focus-visible,.btn:focus-visible,.tab:focus-visible,.delx:focus-visible,.dbtable input:focus-visible,.seqname:focus-visible{outline:2px solid var(--teal);outline-offset:1px;}
  .ctrl.warn{border-color:var(--amber);}
  .ctrl.ro{color:var(--mut);background:transparent;border-style:dashed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  select.ctrl{appearance:none;cursor:pointer;padding-right:28px;background-image:linear-gradient(45deg,transparent 50%,var(--mut) 50%),linear-gradient(135deg,var(--mut) 50%,transparent 50%);background-position:calc(100% - 16px) 16px,calc(100% - 11px) 16px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;}
  select.ctrl option,select.ctrl optgroup{background:#121821;color:var(--ink);}
  .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px;}
  .toggle{display:flex;gap:6px;}
  .toggle-btn{flex:1;background:var(--panel2);border:1px solid var(--line);color:var(--mut);padding:8px;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;transition:all .15s;font-family:inherit;}
  .toggle-btn:hover{color:var(--ink);}
  .toggle-btn.on{background:color-mix(in srgb,var(--accent,var(--teal)) 18%,transparent);border-color:var(--accent,var(--teal));color:var(--ink);}
  .panels{margin-bottom:12px;}
  .panels-head{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:10px;font-size:11px;color:var(--mut);margin-bottom:6px;padding:0 2px;}
  .panel-row{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:10px;margin-bottom:4px;}
  .rowhint{font-size:11px;color:var(--mut);margin:0 2px 9px;}
  .rowhint b{color:var(--teal);font-weight:600;}
  .rowhint.cov{display:flex;gap:6px;align-items:baseline;margin-top:-6px;}
  .cdot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--good);transform:translateY(-1px);}
  .rowhint.short .cdot{background:var(--bad);} .rowhint.short{color:var(--ink);}
  .covstat{font-size:11px;white-space:nowrap;} .covstat.ok{color:var(--good);} .covstat.short{color:var(--bad);}
  .dbtable select:disabled,.dbtable input:disabled{opacity:.45;}
  .modebar{margin:12px 30px 0;font-size:12px;color:var(--mut);display:flex;gap:8px;align-items:center;}
  .modebar .cdot{background:var(--teal);}
  .outpanel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:16px;min-width:0;}
  .out-h{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);font-weight:600;margin:0 0 12px;display:flex;align-items:center;gap:8px;}
  .out-h .bar{width:18px;height:2px;background:var(--teal);}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:6px;}
  .kpi{background:var(--panel2);border:1px solid var(--line);border-radius:11px;padding:12px 13px;min-width:0;}
  .kpi .l{font-size:11px;color:var(--mut);margin-bottom:6px;}
  .kpi .v{font-size:19px;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere;}
  .kpi .v.good{color:var(--good);} .kpi .v.bad{color:var(--bad);}
  .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
  table.fin{width:100%;border-collapse:collapse;margin-top:4px;min-width:420px;}
  table.fin th{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);text-align:right;padding:6px 8px;font-weight:600;border-bottom:1px solid var(--line);}
  table.fin th:first-child{text-align:left;}
  table.fin td{padding:8px;font-size:13px;border-bottom:1px solid rgba(31,41,53,.5);}
  table.fin tr.strong td{font-weight:600;border-top:1px solid var(--line);}
  td.rl{color:var(--ink);} td.rn{text-align:right;font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap;}
  td.rn.good{color:var(--good);} td.rn.bad{color:var(--bad);}
  .readout{margin-top:14px;padding-top:13px;border-top:1px dashed var(--line);}
  .readout-h{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);font-weight:600;margin-bottom:9px;}
  .readout-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
  .rocell{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:8px 10px;min-width:0;}
  .rocell .l{font-size:10px;color:var(--mut);line-height:1.3;} .rocell .v{font-size:15px;font-weight:600;margin-top:3px;overflow-wrap:anywhere;}
  .addon{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 12px;}
  .price-chip{display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap;background:color-mix(in srgb,var(--teal) 12%,transparent);border:1px solid color-mix(in srgb,var(--teal) 35%,transparent);
    border-radius:8px;padding:7px 11px;font-size:13px;margin-top:4px;}
  .price-chip .tag{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--teal);}
  .price-chip.invalid{background:color-mix(in srgb,var(--bad) 12%,transparent);border-color:color-mix(in srgb,var(--bad) 40%,transparent);}
  .price-chip.invalid .tag{color:var(--bad);}
  .section{margin:22px 30px 0;}
  .disc{border:1px solid var(--line);border-radius:12px;background:var(--panel2);margin:12px 30px 0;}
  .disc summary{cursor:pointer;padding:11px 16px;font-size:12.5px;font-weight:600;color:var(--ink);list-style:none;display:flex;align-items:center;gap:9px;}
  .disc summary::-webkit-details-marker{display:none;}
  .disc summary .ic{color:var(--teal);font-family:'IBM Plex Mono',monospace;}
  .disc[open] summary .ic{transform:rotate(90deg);}
  .disc .body{padding:0 16px 14px;}
  .disc ul{margin:0;padding-left:18px;}
  .disc li{margin:3px 0;}
  .dbtable{width:100%;border-collapse:collapse;font-size:12.5px;}
  .dbtable th{text-align:left;color:var(--mut);font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;padding:6px;border-bottom:1px solid var(--line);white-space:nowrap;}
  .dbtable td{padding:4px 6px;border-bottom:1px solid rgba(31,41,53,.4);vertical-align:middle;}
  .dbtable input,.dbtable select{background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:5px 7px;font-size:12.5px;width:100%;font-family:inherit;min-width:0;}
  .dbtable input.dup{border-color:var(--amber);}
  .dbtable .num input{font-family:'IBM Plex Mono',monospace;}
  .dbtable tr.pending td{background:color-mix(in srgb,var(--bad) 8%,transparent);}
  .panels-db{min-width:1180px;} .flow-db{min-width:520px;} .robot-db{min-width:600px;}
  .panels-db td:first-child{min-width:280px;} .flow-db td:first-child,.robot-db td:first-child{min-width:170px;}
  .seqgroup{border:1px solid var(--line);border-radius:11px;padding:12px 13px;margin-bottom:12px;background:var(--panel2);}
  .seqgroup-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;}
  .seqname{flex:1;min-width:160px;background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px 10px;font-size:13.5px;font-weight:600;font-family:inherit;}
  .seqname.dup{border-color:var(--amber);}
  .btn{background:color-mix(in srgb,var(--teal) 16%,transparent);border:1px solid color-mix(in srgb,var(--teal) 40%,transparent);color:var(--teal);border-radius:8px;padding:7px 13px;font-size:12.5px;cursor:pointer;font-weight:600;font-family:inherit;white-space:nowrap;}
  .btn:hover{background:color-mix(in srgb,var(--teal) 24%,transparent);}
  .btn.ghost{background:transparent;border-color:var(--line);color:var(--mut);}
  .btn.ghost:hover{color:var(--ink);border-color:var(--mut);}
  .btn.danger{background:color-mix(in srgb,var(--bad) 16%,transparent);border-color:color-mix(in srgb,var(--bad) 45%,transparent);color:var(--bad);}
  .btn.sm{padding:4px 9px;font-size:11.5px;}
  .delx{background:transparent;border:1px solid transparent;color:var(--bad);cursor:pointer;font-size:12px;opacity:.7;border-radius:6px;padding:4px 7px;font-family:inherit;white-space:nowrap;}
  .delx:hover{opacity:1;border-color:color-mix(in srgb,var(--bad) 40%,transparent);}
  .confirm{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--bad);flex-wrap:wrap;}
  .note{font-size:12.5px;color:var(--mut);line-height:1.65;}
  .note.small{font-size:11.5px;margin:-4px 0 12px;}
  .note b{color:var(--ink);font-weight:600;}
  .note a,.srcl{color:var(--teal);}
  .badge{display:inline-block;font-size:10px;padding:2px 7px;border-radius:20px;border:1px solid var(--line);color:var(--mut);white-space:nowrap;}
  .badge.v{color:var(--good);border-color:color-mix(in srgb,var(--good) 40%,transparent);}
  .badge.f{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,transparent);}
  .badge.b{color:var(--accent2);border-color:color-mix(in srgb,var(--accent2) 40%,transparent);}
  .warns{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;}
  .warns li{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.5;color:var(--ink);background:color-mix(in srgb,var(--amber) 9%,transparent);border:1px solid color-mix(in srgb,var(--amber) 35%,transparent);border-radius:8px;padding:7px 10px;}
  .warns li.info{background:color-mix(in srgb,var(--accent2) 8%,transparent);border-color:color-mix(in srgb,var(--accent2) 32%,transparent);}
  .wic{flex:none;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;background:var(--amber);color:#0a0e14;margin-top:1px;}
  .warns li.info .wic{background:var(--accent2);}
  .foot{margin:26px 30px 0;padding-top:16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:11.5px;color:var(--mut);font-family:'IBM Plex Mono',monospace;flex-wrap:wrap;gap:8px;}
  .chart{margin:16px 0 0;}
  .chart-h{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);font-weight:600;margin-bottom:4px;}
  .chartwrap{height:230px;}
  .ctip{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.6;}
  .ctip-h{font-weight:600;margin-bottom:2px;font-family:'IBM Plex Sans',sans-serif;}
  .ctip-t{border-top:1px solid var(--line);margin-top:4px;padding-top:3px;font-weight:600;}
  .sw{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;}
  .tabs{display:flex;gap:2px;padding:0 30px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(54,214,195,.04),transparent);overflow-x:auto;scrollbar-width:none;}
  .tabs::-webkit-scrollbar{display:none;}
  .tab{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--mut);padding:13px 15px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px;transition:color .15s;white-space:nowrap;}
  .tab:hover{color:var(--ink);}
  .tab.active{color:var(--ink);border-bottom-color:var(--teal);}
  .tab .ix{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--teal);opacity:.85;}
  .tab.ref{margin-left:auto;border-left:1px solid var(--line);}
  .tab.ref .ix{font-family:inherit;font-size:13px;}
  .secthead{margin:22px 30px 0;font-size:13px;color:var(--mut);line-height:1.6;}
  .secthead b{color:var(--ink);}
  .mxbk{width:100%;border-collapse:collapse;margin-top:10px;min-width:440px;}
  .mxbk th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);text-align:right;padding:6px 8px;border-bottom:1px solid var(--line);font-weight:600;}
  .mxbk th:first-child{text-align:left;}
  .mxbk td{padding:7px 8px;font-size:12.5px;border-bottom:1px solid rgba(31,41,53,.5);text-align:right;}
  .mxbk td:first-child{text-align:left;color:var(--ink);}
  .mxbk td.n{font-family:'IBM Plex Mono',monospace;}
  .vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
  @media(max-width:640px){
    .topbar{padding:20px 16px 14px;align-items:flex-start;}
    .topright{align-items:flex-start;width:100%;}
    .credit{text-align:left;}
    .tools{justify-content:flex-start;}
    .title{font-size:22px;}
    .tabs{padding:0 8px;}
    .tab{padding:12px 10px;font-size:12.5px;}
    .layout{padding:16px;gap:4px;}
    .secthead,.disc,.notice,.modebar{margin-left:16px;margin-right:16px;}
    .section{margin:16px 16px 0;}
    .foot{margin:22px 16px 0;}
    .outpanel{padding:14px;}
    .card{padding:14px 13px 16px;}
    .panels-head,.panel-row{grid-template-columns:minmax(0,1fr) 86px;}
    .kpi .v{font-size:17px;}
    .readout-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
  }
  @media(max-width:420px){.grid2{grid-template-columns:minmax(0,1fr);}}
  @media print{.tabs,.tools,.disc,.notice{display:none !important;}.wrap{background:#fff;color:#000;}}
`;

/* ============================ APP ============================ */
export default function NGSCalculator() {
  const [init] = useState(() => loadSaved() || defaultScenario());
  const [bundles, setBundles] = useState(init.bundles);
  const [sequencers, setSequencers] = useState(init.sequencers);
  const [robots, setRobots] = useState(init.robots);
  const [current, setCurrent] = useState(init.current);
  const [future, setFuture] = useState(init.future);
  const [mplex, setMplex] = useState(init.mplex);
  const [robot, setRobot] = useState(init.robot);
  const [seq, setSeq] = useState(init.seq);
  const [reseq, setReseq] = useState(init.reseq);
  const [data, setData] = useState(init.data);
  const [coverage, setCoverage] = useState(init.coverage);
  const [tab, setTab] = useState(init.tab);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const tabRefs = useRef({});

  const scenario = { schema: SCHEMA, tab, bundles, sequencers, robots, current, future, mplex, robot, seq, reseq, data, coverage };
  useEffect(() => { setSaved(saveScenario(scenario)); }, [tab, bundles, sequencers, robots, current, future, mplex, robot, seq, reseq, data, coverage]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t); }, [notice]);

  const applyScenario = s => {
    setBundles(s.bundles); setSequencers(s.sequencers); setRobots(s.robots); setCurrent(s.current); setFuture(s.future);
    setMplex(s.mplex); setRobot(s.robot); setSeq(s.seq); setReseq(s.reseq); setData(s.data); setCoverage(s.coverage); setTab(s.tab); setPending(null);
  };
  const exportScenario = () => {
    try {
      const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ngs-calculator-scenario-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setNotice({ text: "Scenario exported as a JSON file." });
    } catch (e) { setNotice({ err: true, text: "Export is not available in this browser." }); }
  };
  const importScenario = e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = normalizeScenario(JSON.parse(String(reader.result)));
        if (!s) throw new Error("schema");
        applyScenario(s); setNotice({ text: "Scenario imported from " + f.name + "." });
      } catch (err) { setNotice({ err: true, text: "That file is not an NGS Calculator scenario (version " + SCHEMA + ")." }); }
    };
    reader.readAsText(f);
  };
  const resetAll = () => { clearSaved(); applyScenario(defaultScenario()); setNotice({ text: "Reset to the default data. Your saved changes in this browser were cleared." }); };

  /* ---------- lookups ---------- */
  // Effective panels: each carries its coverage check; with "size by coverage" on, reads per sample = reads needed.
  const sizeByReq = coverage.sizeByReq === "Yes";
  const effBundles = useMemo(() => bundles.map(b => {
    const check = coverageCheck(b, coverage);
    return sizeByReq && check ? { ...b, check, reads: check.readsNeeded, sized: true } : { ...b, check };
  }), [bundles, coverage, sizeByReq]);
  const bMap = useMemo(() => Object.fromEntries(effBundles.map(b => [b.id, b])), [effBundles]);
  const resolveFC = st => {
    const s = sequencers.find(x => x.id === st.sequencerId);
    const f = s && s.flowcells.find(x => x.id === st.flowcellId);
    return f ? { found: true, reads: nn(f.reads), runtime: nn(f.runtime), name: f.name, seqName: s.name } : { found: false, reads: 0, runtime: 0, name: "", seqName: s ? s.name : "" };
  };
  const futEff = future.samePanels === "Yes" ? { ...future, panels: current.panels, multiplex: current.multiplex } : future;
  const robotObj = robots.find(r => r.id === robot.robotId) || null;

  const calc = useMemo(() => {
    const cf = resolveFC(current), ff = resolveFC(futEff);
    const curRes = resolvePanels(current.panels, bMap), futRes = resolvePanels(futEff.panels, bMap);
    const out = model({
      curPanels: curRes, curH: cf.reads, curRuntime: cf.runtime, C10: current.flowcellCost, C11: current.runs, C4: current.multiplex === "Yes",
      futPanels: futRes, futH: ff.reads, futRuntime: ff.runtime, C20: future.flowcellCost, C21: future.runs, C14: futEff.multiplex === "Yes",
      C25: robot.enabled === "Yes" && !!robotObj, robotPrice: robotObj ? robotObj.price : 0, robotYears: robotObj ? robotObj.years : 1, robotVol: robot.volume, C28: robotObj ? robotObj.consumables : 0,
      C33: seq.enabled === "Yes", seqPrice: seq.price, seqYears: seq.years, seqVol: seq.volume,
      C40: reseq.enabled === "Yes", curFail: nn(reseq.curRate) / 100, futFail: nn(reseq.futRate) / 100,
      C45: data.enabled === "Yes", dataMode: data.mode === "Annual fee" ? "annual" : "persample",
      dataCurAnnual: data.curAnnual, dataFutAnnual: data.futAnnual, dataCurPer: data.curPer, dataFutPer: data.futPer,
    });
    out.cur.H = cf.reads; out.fut.H = ff.reads;
    return { out, cf, ff, curRes, futRes, curWarn: routineWarnings(current, curRes, cf, out.cur, bMap), futWarn: routineWarnings(futEff, futRes, ff, out.fut, bMap) };
  }, [current, future, robot, robotObj, seq, reseq, data, bMap, sequencers]);
  const { out } = calc;

  const mx = useMemo(() => {
    const fc = resolveFC(mplex);
    const res = resolvePanels(mplex.panels, bMap);
    const r = routine(res, fc.reads, 0, mplex.runs, mplex.multiplex === "Yes", fc.runtime);
    r.H = fc.reads;
    return { r, fc, warn: routineWarnings(mplex, res, fc, r, bMap) };
  }, [mplex, bMap, sequencers]);

  /* ---------- database editing ---------- */
  const numOrBlank = v => (v === "" ? "" : Math.max(0, Number(v)));
  const updateBundle = (id, key, v) => setBundles(bundles.map(b => b.id === id ? { ...b, [key]: ["reads", "price", "depth", "vaf"].includes(key) ? numOrBlank(v) : v } : b));
  const addBundle = () => setBundles([...bundles, { id: uid("p"), name: "", vendor: "", reads: 0, price: 0, basis: "Custom", source: "", note: "" }]);
  const clearPanelRefs = id => {
    const strip = st => ({ ...st, panels: st.panels.map(p => p.bundleId === id ? { ...p, bundleId: "" } : p) });
    setCurrent(strip(current)); setFuture(strip(future)); setMplex(strip(mplex));
  };
  const delBundle = id => { clearPanelRefs(id); setBundles(bundles.filter(b => b.id !== id)); setPending(null); };
  const updateSeqName = (id, name) => setSequencers(sequencers.map(s => s.id === id ? { ...s, name } : s));
  const addSequencer = () => setSequencers([...sequencers, { id: uid("s"), name: "", source: "", verified: false, flowcells: [] }]);
  const clearSeqRefs = (seqId, fId) => {
    const fix = st => {
      if (fId ? st.flowcellId !== fId : st.sequencerId !== seqId) return st;
      return fId ? { ...st, flowcellId: "" } : { ...st, sequencerId: "", flowcellId: "" };
    };
    setCurrent(fix(current)); setFuture(fix(future)); setMplex(fix(mplex));
    if (!fId && seq.sequencerId === seqId) setSeq({ ...seq, sequencerId: "" });
  };
  const delSequencer = id => { clearSeqRefs(id); setSequencers(sequencers.filter(s => s.id !== id)); setPending(null); };
  const addFlow = sid => setSequencers(sequencers.map(s => s.id === sid ? { ...s, flowcells: [...s.flowcells, { id: uid("f"), name: "", reads: 0, runtime: 0 }] } : s));
  const updateFlow = (sid, fid, key, v) => setSequencers(sequencers.map(s => s.id === sid ? { ...s, flowcells: s.flowcells.map(f => f.id === fid ? { ...f, [key]: key === "name" ? v : numOrBlank(v) } : f) } : s));
  const delFlow = (sid, fid) => { clearSeqRefs(sid, fid); setSequencers(sequencers.map(s => s.id === sid ? { ...s, flowcells: s.flowcells.filter(f => f.id !== fid) } : s)); setPending(null); };
  const updateRobot = (id, key, v) => setRobots(robots.map(r => r.id === id ? { ...r, [key]: key === "name" ? v : numOrBlank(v) } : r));
  const addRobot = () => setRobots([...robots, { id: uid("r"), name: "", price: 0, consumables: 0, years: 1 }]);
  const delRobot = id => { if (robot.robotId === id) setRobot({ ...robot, robotId: "" }); setRobots(robots.filter(r => r.id !== id)); setPending(null); };

  const usedPanels = new Set([...current.panels, ...(future.samePanels === "Yes" ? [] : future.panels), ...mplex.panels].map(p => p.bundleId).filter(Boolean));
  const usedSeqs = new Set([current.sequencerId, future.sequencerId, mplex.sequencerId, seq.enabled === "Yes" ? seq.sequencerId : ""].filter(Boolean));
  const usedFlows = new Set([current.flowcellId, future.flowcellId, mplex.flowcellId].filter(Boolean));
  const dupNames = list => { const c = {}; list.forEach(x => { const k = (x.name || "").trim().toLowerCase(); if (k) c[k] = (c[k] || 0) + 1; }); return k => !!k && c[(k || "").trim().toLowerCase()] > 1; };
  const isDupPanel = dupNames(bundles), isDupSeq = dupNames(sequencers), isDupRobot = dupNames(robots);
  const askDelete = (key, inUse, fn) => (inUse ? setPending(key) : fn());

  /* ---------- derived view state ---------- */
  const curActive = out.cur.samples_run > 0 && out.cur_H > 0;
  const futActive = out.fut.samples_run > 0 && out.fut_H > 0;
  const bothActive = curActive && futActive;
  const mplexActive = mx.r.samples_run > 0 && mx.r.H > 0;
  const robotValid = out.robotPriceValid, seqValid = out.seqPriceValid;
  const anyCurAddon = reseq.enabled === "Yes" || data.enabled === "Yes";
  const volMismatch = bothActive && Math.round(out.cur_samples_year) !== Math.round(out.fut_samples_year);
  const compareWarn = [];
  if (!curActive) compareWarn.push({ text: "Current vendor: select a panel with samples per run and a flow cell with reads." });
  if (!futActive) compareWarn.push({ text: "Future vendor: select a panel with samples per run and a flow cell with reads." });
  if (volMismatch) compareWarn.push({ level: "info", text: "Annual volumes differ (current " + int(out.cur_samples_year) + " vs future " + int(out.fut_samples_year) + " samples). Cost per sample is the fair comparison; yearly totals reflect different volumes." });
  const useAsCurrent = () => {
    setCurrent({ ...current, multiplex: mplex.multiplex, panels: mplex.panels.map(p => ({ ...p })), sequencerId: mplex.sequencerId, flowcellId: mplex.flowcellId, runs: mplex.runs });
    setTab("compare");
    setNotice({ text: "Multiplexing setup copied to the current vendor. Check the flow cell cost." });
  };
  const setFutureMirror = v => setFuture(v === "No" && future.samePanels === "Yes" ? { ...future, samePanels: "No", panels: current.panels.map(p => ({ ...p })), multiplex: current.multiplex } : { ...future, samePanels: v });

  const compareChart = bothActive ? [
    { name: "Current", panels: out.cur.reagent * nn(current.runs), flow: out.cur.fc_cost_run * nn(current.runs) },
    { name: "Future", panels: out.fut.reagent * nn(future.runs), flow: out.fut.fc_cost_run * nn(future.runs) },
  ] : [];
  const combinedChart = bothActive ? [
    { name: anyCurAddon ? "Current all-in" : "Current", panels: out.cur.reagent_sample, flow: out.cur.fc_sample, reseq: out.reseqCur, data: out.dataCurPerSample },
    { name: "Future", panels: out.fut.reagent_sample, flow: out.fut.fc_sample },
    { name: "Future TCO", panels: out.fut.reagent_sample, flow: out.fut.fc_sample, reseq: out.reseqFut, data: out.dataFutPerSample, robot: out.robotSample, seq: out.seqSample },
  ] : [];
  const dataChipValid = out.dataCurValid && out.dataFutValid;
  const TABS = [["multiplex", "01", "Multiplexing"], ["compare", "02", "Current vs Future Sequencing Setup"], ["combined", "03", "Total Cost of Ownership"], ["database", "", "Products & Requirements"]];
  const onTabKey = (e, i) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
    setTab(n); const el = tabRefs.current[n]; if (el) el.focus();
  };
  const seqOptions = sequencers.map(s => ({ value: s.id, label: s.name || "(unnamed sequencer)" }));
  const robotOptions = robots.map(r => ({ value: r.id, label: r.name || "(unnamed robot)" }));

  return (
    <div className="wrap">
      <style>{CSS}</style>

      <header className="topbar">
        <div>
          <h1 className="title">NGS <b>Calculator</b></h1>
          <div className="sub">Evaluate the multiplexing and economics of NGS panels for a given sequencer and flow cell</div>
        </div>
        <div className="topright">
          <div className="credit">{COPYRIGHT}</div>
          <div className="tools">
            <span className="saved" title="Your edits are kept only in this browser on this device. Other visitors always see the default data.">{saved ? <><span className="d" />Saved in this browser</> : "Not saved (storage unavailable)"}</span>
            <button type="button" className="btn ghost sm" onClick={exportScenario}>Export</button>
            <button type="button" className="btn ghost sm" onClick={() => fileRef.current && fileRef.current.click()}>Import</button>
            {pending === "reset"
              ? <Confirm text="Clear your changes?" onYes={resetAll} onNo={() => setPending(null)} />
              : <button type="button" className="btn ghost sm" onClick={() => setPending("reset")}>Reset</button>}
            <input ref={fileRef} type="file" accept="application/json,.json" className="vh" onChange={importScenario} aria-label="Import scenario file" />
          </div>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Calculator sections">
        {TABS.map(([id, ix, label], i) => (
          <button type="button" key={id} role="tab" id={"tab-" + id} aria-selected={tab === id} aria-controls={"panel-" + id} tabIndex={tab === id ? 0 : -1}
            ref={el => { tabRefs.current[id] = el; }} className={"tab" + (tab === id ? " active" : "") + (ix ? "" : " ref")} onClick={() => setTab(id)} onKeyDown={e => onTabKey(e, i)}>
            {ix ? <span className="ix">{ix}</span> : <span className="ix" aria-hidden="true">&#9881;</span>}{label}
          </button>
        ))}
      </nav>
      {notice && <div className={"notice" + (notice.err ? " err" : "")} role="status">{notice.text}</div>}
      {sizeByReq && tab !== "database" && <div className="modebar"><span className="cdot" aria-hidden="true" />Reads per sample follow the coverage requirement for panels with a mean depth (set in Products & Requirements).</div>}

      <main role="tabpanel" id={"panel-" + tab} aria-labelledby={"tab-" + tab}>
      {/* SECTION 1 - MULTIPLEXING */}
      {tab === "multiplex" && (<>
        <div className="secthead"><b>Multiplexing.</b> Check how many samples of one or several panels fit on a flow cell, and how many flow cells a run needs. Use it on its own, or copy the setup to the current vendor.</div>
        <div className="layout">
          <div>
            <div className="col-h">Input</div>
            <div className="card" style={{ "--accent": "var(--teal)" }}>
              <div className="card-head"><span className="dot" /> Panels and flow cell</div>
              <Field label="Multiplex panels on one flow cell?" hint={mplex.multiplex === "Yes" ? "Up to 3 panels share each flow cell" : "One panel per flow cell"} group>
                <Toggle value={mplex.multiplex} onChange={v => setMplex({ ...mplex, multiplex: v })} />
              </Field>
              <PanelRows state={mplex} set={setMplex} bundles={effBundles} H={mx.r.H} />
              <SeqFlowFields state={mplex} set={setMplex} sequencers={sequencers}>
                <Field label="Runs per year"><Num value={mplex.runs} onChange={v => setMplex({ ...mplex, runs: v })} /></Field>
              </SeqFlowFields>
              <Warnings items={mx.warn} />
              <div className="cardfoot"><button type="button" className="btn" onClick={useAsCurrent} disabled={!mplexActive}>Use as current setup</button><span className="note small">Copies panels, samples, sequencer, flow cell and runs to the current vendor.</span></div>
            </div>
          </div>
          <div>
            <div className="col-h">Technical output</div>
            <div className="outpanel">
              <div className="out-h"><span className="bar" /> Coverage and flow cells</div>
              {!mplexActive ? <div className="note">Select a panel with samples per run and a flow cell to see coverage.</div> : (<>
                <div className="kpis">
                  <div className="kpi"><div className="l">Flow cells needed / run</div><div className="v num">{int(mx.r.fc_needed)}</div></div>
                  <div className="kpi"><div className="l">Total flow cell coverage</div><div className="v num">{pct1(mx.r.coverage)}</div></div>
                  <div className="kpi"><div className="l">Average fill / flow cell</div><div className="v num">{pct1(mx.r.fill)}</div></div>
                </div>
                <div className="note" style={{ margin: "6px 0 8px" }}>{mplex.multiplex === "Yes" ? "Multiplexed: panels share the flow cell. Flow cells needed is the ceiling of the summed coverage." : "Not multiplexed: one panel on the flow cell. Flow cells needed is the ceiling of its coverage."}</div>
                {mplex.multiplex === "Yes" && (
                  <div className="tscroll">
                    <table className="mxbk">
                      <thead><tr><th>Panel</th><th>Samples / run</th><th>M reads / sample</th><th>Coverage</th><th>Max / flow cell</th></tr></thead>
                      <tbody>
                        {mx.r.detail.map((d, i) => (
                          <tr key={i}><td>{d.name}</td><td className="n">{int(d.samples)}</td><td className="n">{d.reads != null ? d.reads : "-"}</td><td className="n">{pct1(d.cov)}</td><td className="n">{d.maxPerFC != null ? int(d.maxPerFC) : "-"}</td></tr>
                        ))}
                        <tr><td><b>Total</b></td><td className="n">{int(mx.r.samples_run)}</td><td className="n">-</td><td className="n"><b>{pct1(mx.r.coverage)}</b></td><td className="n">{int(mx.r.fc_needed)} flow cell{mx.r.fc_needed === 1 ? "" : "s"}</td></tr>
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="readout" style={{ marginTop: 14 }}>
                  <div className="readout-grid">
                    <div className="rocell"><div className="l">M reads / flow cell</div><div className="v num">{int(mx.r.H)}</div></div>
                    <div className="rocell"><div className="l">Run time (hrs)</div><div className="v num">{mx.r.run_time}</div></div>
                    <div className="rocell"><div className="l">Samples / year</div><div className="v num">{int(mx.r.samples_year)}</div></div>
                    {mplex.multiplex !== "Yes" && mx.r.detail[0] && <div className="rocell"><div className="l">Max samples / flow cell</div><div className="v num">{mx.r.detail[0].maxPerFC != null ? int(mx.r.detail[0].maxPerFC) : "-"}</div></div>}
                  </div>
                </div>
              </>)}
            </div>
          </div>
        </div>
      </>)}

      {/* SECTION 2 - CURRENT VS FUTURE SEQUENCING SETUP */}
      {tab === "compare" && (<>
        <div className="secthead"><b>Current vs Future Sequencing Setup.</b> By default the future setup keeps the current panels and only the sequencer, flow cell, cost and runs change. Switch "Same panels" to No to compare different panels.</div>
        <div className="layout">
          <div>
            <div className="col-h">Input</div>
            <RoutineCard title="Current Vendor" accent="#5b6b7a" state={current} set={setCurrent} effective={current} bundles={effBundles} sequencers={sequencers}
              r={out.cur} active={curActive} costSample={out.K4} warnings={calc.curWarn} />
            <RoutineCard title="Future Vendor" accent="var(--teal)" state={future} set={setFuture} effective={futEff} bundles={effBundles} sequencers={sequencers}
              r={out.fut} active={futActive} costSample={out.K8} warnings={calc.futWarn} mirrorToggle={setFutureMirror} />
          </div>
          <div>
            <div className="col-h">Financial output</div>
            <div className="outpanel">
              <div className="out-h"><span className="bar" /> Current vs future setup</div>
              <Warnings items={compareWarn} />
              {bothActive && (<>
                <div className="kpis" style={{ marginTop: compareWarn.length ? 12 : 0 }}>
                  <div className="kpi"><div className="l">Yearly savings</div><div className={"v num " + (out.yr_savings > 0 ? "good" : out.yr_savings < 0 ? "bad" : "")}>{usd0(out.yr_savings)}</div></div>
                  <div className="kpi"><div className="l">Per-sample savings</div><div className={"v num " + (out.persample_savings > 0 ? "good" : out.persample_savings < 0 ? "bad" : "")}>{usd2(out.persample_savings)}</div></div>
                  <div className="kpi"><div className="l">Future / sample</div><div className="v num">{usd2(out.K8)}</div></div>
                </div>
                <FinTable head="Cost / sample">
                  <FinRow label="Current Vendor" cost={out.K4} base={out.K4} isCurrent />
                  <FinRow label="Future Vendor" cost={out.K8} base={out.K4} />
                </FinTable>
                <div style={{ marginTop: 14 }} />
                <FinTable head="Run cost (per run)">
                  <FinRow label="Current Vendor" cost={out.K5} base={out.K5} isCurrent fmt={usd0} />
                  <FinRow label="Future Vendor" cost={out.K9} base={out.K5} fmt={usd0} />
                </FinTable>
                <div style={{ marginTop: 14 }} />
                <FinTable head="Yearly cost">
                  <FinRow label="Current Vendor" cost={out.K6} base={out.K6} isCurrent fmt={usd0} />
                  <FinRow label="Future Vendor" cost={out.K10} base={out.K6} fmt={usd0} />
                </FinTable>
                <StackChart title="Yearly cost: panels vs flow cells" data={compareChart} keys={["panels", "flow"]} fmt={usd0} />
              </>)}
            </div>
          </div>
        </div>
      </>)}

      {/* SECTION 3 - PRODUCT DATABASE */}
      {tab === "database" && (
        <div className="section">
          <div className="secthead" style={{ margin: "0 0 6px" }}><b>Products & Requirements.</b> The panels, sequencers, flow cells, robots and coverage rules used by every tab. Changes apply live, and renaming an item keeps it selected everywhere.</div>
          <div className="note" style={{ marginBottom: 4 }}><b>Read convention:</b> M reads always means total reads, counting both reads of a paired-end cluster (for example Illumina states TSO 500 as 100M paired-end reads). Enter panels and flow cells in the same convention.</div>
          <div className="outpanel" style={{ marginTop: 14 }}>
            <div className="out-h"><span className="bar" /> Coverage requirements</div>
            <div className="addon">
              <Field label="Germline: minimum depth per base (x)" hint="Recommended 30x"><Num value={coverage.germlineMin} onChange={v => setCoverage({ ...coverage, germlineMin: v })} /></Field>
              <Field label="Somatic: minimum variant reads" hint="Depth per base = reads / VAF (50 at 5% = 1,000x)"><Num value={coverage.minAltReads} onChange={v => setCoverage({ ...coverage, minAltReads: v })} min={1} /></Field>
              <Field label="Uniformity: 95% of bases reach (% of mean)" hint="Illumina metric: bases above 0.2x mean = 20"><Num value={coverage.minToMean} onChange={v => setCoverage({ ...coverage, minToMean: v })} min={1} /></Field>
            </div>
            <Field label="Size panels by coverage requirement?" hint="No: use the vendor reads per sample. Yes: use the reads needed to meet the requirement (panels with a mean depth only)." group>
              <Toggle value={coverage.sizeByReq} onChange={v => setCoverage({ ...coverage, sizeByReq: v })} />
            </Field>
            <div className="note">Somatic depth = {int(nn(coverage.minAltReads))} variant reads / the panel's VAF (5% VAF needs {int(minDepthForVaf(0.05, coverage.minAltReads))}x). Both are per-base minimums for at least 95% of target bases, so required mean depth = required depth / {int(nn(coverage.minToMean))}%. Reads needed = stated reads x required mean depth / stated mean depth.</div>
          </div>
          <div className="outpanel">
            <div className="out-h"><span className="bar" /> NGS panels</div>
            <div className="note" style={{ marginBottom: 10 }}>Commercial panels are pre-filled where a vendor states or implies the reads per sample. <span className="badge v">Vendor-stated</span> comes from the vendor's documentation, <span className="badge f">Derived</span> is flow cell output divided by the vendor's recommended samples per run, <span className="badge b">Benchmark</span> is the read count a vendor used in its own comparison data, not a recommendation. Prices are blank: enter your own. To check coverage, set Germline or Somatic and the mean depth the vendor states at those reads.</div>
            <div className="tscroll">
              <table className="dbtable panels-db">
                <thead><tr><th>NGS panel</th><th style={{ width: 130 }}>Vendor</th><th style={{ width: 110 }}>M reads / sample</th><th style={{ width: 100 }}>Price ($)</th><th style={{ width: 110 }}>Use</th><th style={{ width: 100 }}>Mean depth (x)</th><th style={{ width: 80 }}>VAF (%)</th><th style={{ width: 150 }}>Coverage</th><th style={{ width: 110 }}>Basis</th><th style={{ width: 80 }} /></tr></thead>
                <tbody>
                  {bundles.map(b => (
                    <tr key={b.id} className={pending === "p:" + b.id ? "pending" : ""}>
                      <td><input value={b.name} placeholder="Panel name" className={isDupPanel(b.name) ? "dup" : ""} title={isDupPanel(b.name) ? "Duplicate name" : b.note || ""} aria-label="Panel name" onChange={e => updateBundle(b.id, "name", e.target.value)} /></td>
                      <td><input value={b.vendor} placeholder="Vendor" aria-label="Vendor" onChange={e => updateBundle(b.id, "vendor", e.target.value)} /></td>
                      <td className="num"><input type="number" min={0} step="any" value={b.reads} aria-label="M reads per sample" onChange={e => updateBundle(b.id, "reads", e.target.value)} /></td>
                      <td className="num"><input type="number" min={0} step="any" value={b.price} aria-label="Price" onChange={e => updateBundle(b.id, "price", e.target.value)} /></td>
                      <td><select value={b.app || ""} aria-label="Germline or somatic" onChange={e => updateBundle(b.id, "app", e.target.value)}><option value="">-</option><option value="Germline">Germline</option><option value="Somatic">Somatic</option></select></td>
                      <td className="num"><input type="number" min={0} step="any" value={b.depth} aria-label="Mean depth at the stated reads" onChange={e => updateBundle(b.id, "depth", e.target.value)} /></td>
                      <td className="num"><input type="number" min={0} max={100} step="any" value={b.app === "Somatic" ? b.vaf : ""} disabled={b.app !== "Somatic"} placeholder={b.app === "Germline" ? int(nn(coverage.germlineMin)) + "x" : ""} aria-label="Lowest VAF to detect, percent" onChange={e => updateBundle(b.id, "vaf", e.target.value)} /></td>
                      <td>{(() => {
                        if (!b.app) return <span className="covstat">-</span>;
                        const c = coverageCheck(b, coverage);
                        if (!c) return <span className="covstat">Add mean depth</span>;
                        return <span className={"covstat " + (c.meets ? "ok" : "short")} title={"Needs " + int(c.reqMin) + "x minimum, " + int(c.reqMean) + "x mean"}>{c.meets ? "Meets" : "Below"} &middot; needs {fmtM(c.readsNeeded)} M</span>;
                      })()}</td>
                      <td>
                        {b.source ? <a className="srcl" href={b.source} target="_blank" rel="noopener noreferrer" title={b.note || "Source"}><span className={"badge " + (b.basis === "Vendor-stated" ? "v" : b.basis === "Derived" ? "f" : b.basis === "Benchmark" ? "b" : "")}>{b.basis}</span></a>
                          : <span className="badge">{b.basis || "Custom"}</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {pending === "p:" + b.id
                          ? <Confirm text="In use." onYes={() => delBundle(b.id)} onNo={() => setPending(null)} />
                          : <button type="button" className="delx" aria-label={"Remove " + (b.name || "panel")} onClick={() => askDelete("p:" + b.id, usedPanels.has(b.id), () => delBundle(b.id))}>Remove</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bundles.some(b => isDupPanel(b.name)) && <Warnings items={[{ text: "Two panels share the same name. Rename one so they are easy to tell apart in the selectors." }]} />}
            <div style={{ marginTop: 10 }}><button type="button" className="btn" onClick={addBundle}>+ Add panel</button></div>
          </div>

          <div className="outpanel">
            <div className="out-h"><span className="bar" /> Sequencers and their flow cells</div>
            <div className="note" style={{ marginBottom: 12 }}>Flow cells are grouped under the sequencer they run on. Values marked <span className="badge v">Checked</span> were checked against the vendor's specification page (upper end of the stated range for NovaSeq 6000, stated minimum for NovaSeq X). <span className="badge f">Not verified</span> values have not yet been checked against a vendor specification.</div>
            {sequencers.map(s => (
              <div className="seqgroup" key={s.id}>
                <div className="seqgroup-head">
                  <input className={"seqname" + (isDupSeq(s.name) ? " dup" : "")} value={s.name} placeholder="Sequencer name" aria-label="Sequencer name" onChange={e => updateSeqName(s.id, e.target.value)} />
                  {s.verified && s.source ? <a className="srcl" href={s.source} target="_blank" rel="noopener noreferrer"><span className="badge v">Checked</span></a> : <span className="badge f">Not verified</span>}
                  {pending === "s:" + s.id
                    ? <Confirm text={usedSeqs.has(s.id) ? "In use. Remove sequencer?" : "Remove sequencer?"} onYes={() => delSequencer(s.id)} onNo={() => setPending(null)} />
                    : <button type="button" className="delx" onClick={() => setPending("s:" + s.id)}>Remove sequencer</button>}
                </div>
                <div className="tscroll">
                  <table className="dbtable flow-db">
                    <thead><tr><th>Flow cell</th><th style={{ width: 130 }}>M reads / flow cell</th><th style={{ width: 110 }}>Run time (hrs)</th><th style={{ width: 150 }} /></tr></thead>
                    <tbody>
                      {s.flowcells.map(f => (
                        <tr key={f.id} className={pending === "f:" + f.id ? "pending" : ""}>
                          <td><input value={f.name} placeholder="Flow cell name" aria-label="Flow cell name" onChange={e => updateFlow(s.id, f.id, "name", e.target.value)} /></td>
                          <td className="num"><input type="number" min={0} step="any" value={f.reads} aria-label="M reads per flow cell" onChange={e => updateFlow(s.id, f.id, "reads", e.target.value)} /></td>
                          <td className="num"><input type="number" min={0} step="any" value={f.runtime} aria-label="Run time in hours" onChange={e => updateFlow(s.id, f.id, "runtime", e.target.value)} /></td>
                          <td style={{ textAlign: "right" }}>
                            {pending === "f:" + f.id
                              ? <Confirm text="In use." onYes={() => delFlow(s.id, f.id)} onNo={() => setPending(null)} />
                              : <button type="button" className="delx" aria-label={"Remove " + (f.name || "flow cell")} onClick={() => askDelete("f:" + f.id, usedFlows.has(f.id), () => delFlow(s.id, f.id))}>Remove</button>}
                          </td>
                        </tr>
                      ))}
                      {s.flowcells.length === 0 && <tr><td colSpan={4} className="note" style={{ padding: "8px 6px" }}>No flow cells yet. Add one below.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 8 }}><button type="button" className="btn ghost" onClick={() => addFlow(s.id)}>+ Add flow cell{s.name ? " to " + s.name : ""}</button></div>
              </div>
            ))}
            {sequencers.some(s => isDupSeq(s.name)) && <Warnings items={[{ text: "Two sequencers share the same name. Rename one so they are easy to tell apart." }]} />}
            <div style={{ marginTop: 12 }}><button type="button" className="btn" onClick={addSequencer}>+ Add sequencer</button></div>
          </div>

          <div className="outpanel">
            <div className="out-h"><span className="bar" /> Liquid-handling robots</div>
            <div className="note" style={{ marginBottom: 10 }}>Robots used in Total Cost of Ownership. Enter a purchase price or a lease cost, and the years it covers. Per-sample cost = cost / years / annual sample volume on the robot.</div>
            <div className="tscroll">
              <table className="dbtable robot-db">
                <thead><tr><th>Robot</th><th style={{ width: 130 }}>Purchase or lease ($)</th><th style={{ width: 130 }}>Consumables ($ / sample)</th><th style={{ width: 120 }}>Spread over (yrs)</th><th style={{ width: 150 }} /></tr></thead>
                <tbody>
                  {robots.map(r => (
                    <tr key={r.id} className={pending === "r:" + r.id ? "pending" : ""}>
                      <td><input value={r.name} placeholder="Robot name" className={isDupRobot(r.name) ? "dup" : ""} aria-label="Robot name" onChange={e => updateRobot(r.id, "name", e.target.value)} /></td>
                      <td className="num"><input type="number" min={0} step="any" value={r.price} aria-label="Robot price" onChange={e => updateRobot(r.id, "price", e.target.value)} /></td>
                      <td className="num"><input type="number" min={0} step="any" value={r.consumables} aria-label="Consumables per sample" onChange={e => updateRobot(r.id, "consumables", e.target.value)} /></td>
                      <td className="num"><input type="number" min={1} step="any" value={r.years} aria-label="Depreciation years" onChange={e => updateRobot(r.id, "years", e.target.value)} /></td>
                      <td style={{ textAlign: "right" }}>
                        {pending === "r:" + r.id
                          ? <Confirm text="In use." onYes={() => delRobot(r.id)} onNo={() => setPending(null)} />
                          : <button type="button" className="delx" aria-label={"Remove " + (r.name || "robot")} onClick={() => askDelete("r:" + r.id, robot.robotId === r.id && robot.enabled === "Yes", () => delRobot(r.id))}>Remove</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10 }}><button type="button" className="btn" onClick={addRobot}>+ Add robot</button></div>
          </div>
        </div>
      )}

      {/* SECTION 4 - COMBINED NGS COSTS */}
      {tab === "combined" && (<>
        <div className="secthead"><b>Total Cost of Ownership.</b> Add equipment (purchase or lease), resequencing and data analysis on top of the future sequencing setup, and compare the total with the current vendor.</div>
        <details className="disc">
          <summary><span className="ic">&#9656;</span> How the total cost of ownership is calculated</summary>
          <div className="body note">
            <ul>
              <li><b>Robot and sequencer (purchase or lease):</b> per-sample cost = cost / years / annual sample volume on that equipment. Enter a purchase price spread over its years of use, or a lease cost with its term. The yearly figure allocates that per-sample cost to the future setup's own annual volume.</li>
              <li><b>Resequencing:</b> failure rate x sequencing cost per sample, set separately for each vendor.</li>
              <li><b>Data analysis:</b> an annual fee (divided by that vendor's annual volume) or a cost per sample, per vendor. Either side can be 0.</li>
              <li><b>Current all-in</b> adds the current vendor's own resequencing and data analysis, so it compares like for like with the future total cost of ownership.</li>
            </ul>
          </div>
        </details>
        <div className="layout">
          <div>
            <div className="col-h">Add-ons</div>
            <div className="card" style={{ "--accent": "var(--amber)" }}>
              <div className="card-head"><span className="dot" /> Liquid-handling robot</div>
              <Field label="Include a robot?" group><Toggle value={robot.enabled} onChange={v => setRobot({ ...robot, enabled: v })} /></Field>
              {robot.enabled === "Yes" && (<>
                <div className="addon">
                  <Field label="Robot model" hint="Edit robots in Products & Requirements"><Select value={robot.robotId} onChange={v => setRobot({ ...robot, robotId: v })} options={robotOptions} placeholder="Select robot" /></Field>
                  <Field label="Annual sample volume" hint="All samples run on the robot"><Num value={robot.volume} onChange={v => setRobot({ ...robot, volume: v })} step={100} /></Field>
                </div>
                {robotObj && (
                  <div className="addon">
                    <Field label="Purchase or lease cost ($)"><Num value={robotObj.price} onChange={v => updateRobot(robotObj.id, "price", v)} step={1000} /></Field>
                    <Field label="Spread over (years)" hint="Years of use, or the lease term"><Num value={robotObj.years} onChange={v => updateRobot(robotObj.id, "years", v)} min={1} /></Field>
                    <Field label="Consumables ($ / sample)"><Num value={robotObj.consumables} onChange={v => updateRobot(robotObj.id, "consumables", v)} step={0.5} /></Field>
                  </div>
                )}
                <div className={"price-chip" + (robotValid && robotObj ? "" : " invalid")}>
                  <span className="tag">robot / sample</span>
                  <span className="num">{!robotObj ? "Select a robot" : robotValid ? usd2(out.C27) + " + " + usd2(nn(robotObj.consumables)) + " consumables" : "Enter annual sample volume"}</span>
                </div>
              </>)}
            </div>
            <div className="card" style={{ "--accent": "var(--accent2)" }}>
              <div className="card-head"><span className="dot" /> Sequencer</div>
              <Field label="Include a sequencer?" group><Toggle value={seq.enabled} onChange={v => setSeq({ ...seq, enabled: v })} /></Field>
              {seq.enabled === "Yes" && (<>
                <div className="addon">
                  <Field label="Sequencer"><Select value={seq.sequencerId} onChange={v => setSeq({ ...seq, sequencerId: v })} options={seqOptions} placeholder="Select sequencer" /></Field>
                  <Field label="Purchase or lease cost ($)"><Num value={seq.price} onChange={v => setSeq({ ...seq, price: v })} step={1000} /></Field>
                  <Field label="Spread over (years)" hint="Years of use, or the lease term"><Num value={seq.years} onChange={v => setSeq({ ...seq, years: v })} min={1} /></Field>
                  <Field label="Annual sample volume" hint="All samples run on the sequencer"><Num value={seq.volume} onChange={v => setSeq({ ...seq, volume: v })} step={100} /></Field>
                </div>
                <div className={"price-chip" + (seqValid ? "" : " invalid")}>
                  <span className="tag">sequencer / sample</span>
                  <span className="num">{seqValid ? usd2(out.C35) : "Enter annual sample volume"}</span>
                </div>
              </>)}
            </div>
            <div className="card" style={{ "--accent": "var(--bad)" }}>
              <div className="card-head"><span className="dot" /> Resequencing</div>
              <Field label="Include resequencing?" group><Toggle value={reseq.enabled} onChange={v => setReseq({ ...reseq, enabled: v })} /></Field>
              {reseq.enabled === "Yes" && (<>
                <div className="grid2">
                  <Field label="Current failure rate (%)" hint="of current cost / sample"><Num value={reseq.curRate} onChange={v => setReseq({ ...reseq, curRate: v })} step={0.5} /></Field>
                  <Field label="Future failure rate (%)" hint="of future cost / sample"><Num value={reseq.futRate} onChange={v => setReseq({ ...reseq, futRate: v })} step={0.5} /></Field>
                </div>
                <div className="price-chip">
                  <span className="tag">reseq / sample</span>
                  <span className="num">cur {usd2(out.reseqCur)} &middot; fut {usd2(out.reseqFut)}</span>
                </div>
              </>)}
            </div>
            <div className="card" style={{ "--accent": "var(--violet)" }}>
              <div className="card-head"><span className="dot" /> Data analysis</div>
              <Field label="Include data analysis?" group><Toggle value={data.enabled} onChange={v => setData({ ...data, enabled: v })} /></Field>
              {data.enabled === "Yes" && (<>
                <Field label="Cost model" group>
                  <Toggle value={data.mode} onChange={v => setData({ ...data, mode: v })} options={["Annual fee", "Per sample"]} />
                </Field>
                {data.mode === "Annual fee"
                  ? <div className="grid2">
                      <Field label="Current annual fee ($)" hint="0 to skip current"><Num value={data.curAnnual} onChange={v => setData({ ...data, curAnnual: v })} step={1000} /></Field>
                      <Field label="Future annual fee ($)" hint="0 to skip future"><Num value={data.futAnnual} onChange={v => setData({ ...data, futAnnual: v })} step={1000} /></Field>
                    </div>
                  : <div className="grid2">
                      <Field label="Current ($ / sample)" hint="0 to skip current"><Num value={data.curPer} onChange={v => setData({ ...data, curPer: v })} step={1} /></Field>
                      <Field label="Future ($ / sample)" hint="0 to skip future"><Num value={data.futPer} onChange={v => setData({ ...data, futPer: v })} step={1} /></Field>
                    </div>}
                <div className={"price-chip" + (dataChipValid ? "" : " invalid")}>
                  <span className="tag">data / sample</span>
                  <span className="num">cur {usd2(out.dataCurPerSample)} &middot; fut {usd2(out.dataFutPerSample)}</span>
                </div>
              </>)}
            </div>
          </div>
          <div>
            <div className="col-h">Combined output</div>
            <div className="outpanel">
              <div className="out-h"><span className="bar" /> Total cost of ownership vs current</div>
              <Warnings items={compareWarn} />
              {bothActive && (<>
                <div className="kpis" style={{ marginTop: compareWarn.length ? 12 : 0 }}>
                  <div className="kpi"><div className="l">Future TCO / sample</div><div className="v num">{usd2(out.K20)}</div></div>
                  <div className="kpi"><div className="l">{anyCurAddon ? "Saving vs current all-in" : "Saving vs current"} / sample</div><div className={"v num " + ((anyCurAddon ? out.curAllIn : out.K4) - out.K20 > 0 ? "good" : "bad")}>{usd2((anyCurAddon ? out.curAllIn : out.K4) - out.K20)}</div></div>
                  <div className="kpi"><div className="l">{anyCurAddon ? "Saving vs current all-in" : "Saving vs current"} / year</div><div className={"v num " + ((anyCurAddon ? out.curAllInYear : out.K6) - out.K22 > 0 ? "good" : "bad")}>{usd0((anyCurAddon ? out.curAllInYear : out.K6) - out.K22)}</div></div>
                </div>
                <FinTable head="Cost / sample">
                  <FinRow label="Current Vendor" cost={out.K4} base={out.K4} isCurrent />
                  {reseq.enabled === "Yes" && <FinRow label="Current + resequencing" cost={out.curPlusReseq} base={out.K4} />}
                  {data.enabled === "Yes" && <FinRow label="Current + data analysis" cost={out.curPlusData} base={out.K4} />}
                  {anyCurAddon && <FinRow label="Current all-in" cost={out.curAllIn} base={out.K4} />}
                  <FinRow label="Future Vendor" cost={out.K8} base={out.K4} />
                  {reseq.enabled === "Yes" && <FinRow label="Future + resequencing" cost={out.futPlusReseq} base={out.K4} />}
                  {robot.enabled === "Yes" && <FinRow label="Future + robot" cost={out.K12} base={out.K4} />}
                  {seq.enabled === "Yes" && <FinRow label="Future + sequencer" cost={out.K8 + out.seqSample} base={out.K4} />}
                  {data.enabled === "Yes" && <FinRow label="Future + data analysis" cost={out.futPlusData} base={out.K4} />}
                  <FinRow label="Total cost of ownership (future)" cost={out.K20} base={out.K4} strong />
                </FinTable>
                <div style={{ marginTop: 14 }} />
                <FinTable head="Yearly cost">
                  <FinRow label="Current Vendor" cost={out.K6} base={out.K6} isCurrent fmt={usd0} />
                  {reseq.enabled === "Yes" && <FinRow label="Current + resequencing" cost={out.curPlusReseqYear} base={out.K6} fmt={usd0} />}
                  {data.enabled === "Yes" && <FinRow label="Current + data analysis" cost={out.curPlusDataYear} base={out.K6} fmt={usd0} />}
                  {anyCurAddon && <FinRow label="Current all-in" cost={out.curAllInYear} base={out.K6} fmt={usd0} />}
                  <FinRow label="Future Vendor" cost={out.K10} base={out.K6} fmt={usd0} />
                  {reseq.enabled === "Yes" && <FinRow label="Future + resequencing" cost={out.futPlusReseqYear} base={out.K6} fmt={usd0} />}
                  {data.enabled === "Yes" && <FinRow label="Future + data analysis" cost={out.futPlusDataYear} base={out.K6} fmt={usd0} />}
                  <FinRow label="Total cost of ownership (future)" cost={out.K22} base={out.K6} fmt={usd0} strong />
                </FinTable>
                <StackChart title="Cost per sample breakdown" data={combinedChart} keys={["panels", "flow", "reseq", "data", "robot", "seq"]} fmt={usd2} />
              </>)}
            </div>
          </div>
        </div>
      </>)}
      </main>

      <footer className="foot">
        <span>{COPYRIGHT}</span>
        <span>M reads = total reads, counting both reads of a pair</span>
      </footer>
    </div>
  );
}
