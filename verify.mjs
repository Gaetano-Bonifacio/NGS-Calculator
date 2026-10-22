// Numeric verification harness for the NGS Calculator.
// Expected values are derived by hand (shown in comments), not read back from the app.
// Run after `npm run build`:  npm run verify
import { routine, model, ceilSafe, maxPerFlowcell, minDepthForVaf, coverageCheck, SEED_BUNDLES, SEED_SEQUENCERS, defaultScenario, normalizeScenario } from "./artifact_logic.mjs";

let allok = true, n = 0, fails = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function check(label, got, exp, tol) {
  const ok = approx(got, exp, tol); allok = allok && ok; n++; if (!ok) fails++;
  console.log((ok ? "PASS " : "FAIL ") + label + "  got=" + got + "  exp=" + exp);
}
function truthy(label, cond) { allok = allok && !!cond; n++; if (!cond) fails++; console.log((cond ? "PASS " : "FAIL ") + label); }

/* Defaults: TSO500 (100 M reads/sample, $690), 96 samples/run, 20 runs/year, not multiplexed.
   Current NovaSeq 6000 S2 -> H = 8200 M reads, flow cell $3000
   Future  NovaSeq X 25B    -> H = 52000 M reads, flow cell $5000 */
const TSO = { name: "TruSight Oncology 500", samples: 96, reads: 100, price: 690 };
const empty = { name: "", samples: 0, reads: null, price: 0 };
function build(o = {}) {
  return model({
    curPanels: o.curPanels || [TSO, empty, empty], curH: o.curH ?? 8200, curRuntime: 36, C10: 3000, C11: 20, C4: false,
    futPanels: o.futPanels || [{ ...TSO }, empty, empty], futH: 52000, futRuntime: 48, C20: 5000, C21: o.futRuns ?? 20, C14: false,
    C25: o.robot ?? false, robotPrice: o.robotPrice ?? 67960, robotYears: o.robotYears ?? 1, robotVol: o.robotVol ?? 2000, C28: o.cons ?? 5,
    C33: o.seq ?? false, seqPrice: o.seqPrice ?? 0, seqYears: o.seqYears ?? 1, seqVol: o.seqVol ?? 2000,
    C40: o.reseq ?? false, curFail: o.cf ?? 0, futFail: o.ff ?? 0,
    C45: o.data ?? false, dataMode: o.dataMode ?? "annual", dataCurAnnual: o.dca ?? 0, dataFutAnnual: o.dfa ?? 0, dataCurPer: o.dcp ?? 0, dataFutPer: o.dfp ?? 0,
  });
}

/* Hand derivation
   Current: coverage 96 x 100 / 8200 = 1.1707 -> 2 flow cells; reagents 96 x 690 = 66,240
            run = 66,240 + 2 x 3,000 = 72,240; yearly x 20 = 1,444,800; volume 1,920 -> 752.50 / sample
   Future:  coverage 9,600 / 52,000 = 0.1846 -> 1 flow cell; run = 66,240 + 5,000 = 71,240
            yearly 1,424,800; / 1,920 = 742.083333 */
const K4 = 752.5, K5 = 72240, K6 = 1444800, K8 = 1424800 / 1920, K9 = 71240, K10 = 1424800;
const c27 = 67960 / 2000, C28 = 5, robotS = c27 + C28, robotYr = robotS * 1920;

console.log("\n[1] Base economics (no add-ons)");
const s1 = build();
check("[1] current flow cells / run", s1.cur_fc, 2);
check("[1] current cost/sample K4", s1.K4, K4);
check("[1] current run cost K5 (flow cell cost x 2)", s1.K5, K5);
check("[1] current yearly K6", s1.K6, K6);
check("[1] future flow cells / run", s1.fut_fc, 1);
check("[1] future cost/sample K8", s1.K8, K8);
check("[1] future run cost K9", s1.K9, K9);
check("[1] future yearly K10", s1.K10, K10);
check("[1] yearly savings", s1.yr_savings, 20000);
check("[1] per-sample savings", s1.persample_savings, K4 - K8);
check("[1] no add-ons K20 == K8", s1.K20, K8);
check("[1] no add-ons K22 == K10", s1.K22, K10);
check("[1] current avg fill = 1.1707 / 2", s1.cur_fill, 9600 / 8200 / 2);

console.log("\n[1b] Non-regression vs previous release where only one flow cell is needed (future side unchanged)");
const old = build({ curH: 4100 });
check("[1b] future K9 unchanged from v2 (71,240)", old.K9, 71240);
check("[1b] future K10 unchanged from v2 (1,424,800)", old.K10, 1424800);
check("[1b] future K8 unchanged from v2 (1,424,800 / 1,920)", old.K8, 1424800 / 1920);
check("[1b] C1 fix: 3 flow cells on H=4100 cost 3 x 3,000 (v2 charged 1)", old.K5, 66240 + 9000);

console.log("\n[2] Robot add-on");
const s2 = build({ robot: true });
check("[2] robot/sample C27 = 67,960 / 2,000", s2.C27, c27);
check("[2] future+robot K12", s2.K12, K8 + robotS);
check("[2] total/sample K20", s2.K20, K8 + robotS);
check("[2] total yearly K22", s2.K22, K10 + robotYr);
check("[2] total run K21 = K9 + 38.98 x 96", s2.K21, K9 + robotS * 96);
check("[2] 5-year depreciation: 67,960 / 5 / 2,000", build({ robot: true, robotYears: 5 }).C27, 6.796);
check("[2] robot off: K12 == K8 (no stray consumables)", build({ robot: false }).K12, K8);

console.log("\n[3] Sequencer add-on");
const s3 = build({ seq: true, seqPrice: 100000, seqVol: 2000 });
check("[3] sequencer/sample = 100,000 / 2,000", s3.C35, 50);
check("[3] total/sample K20", s3.K20, K8 + 50);
check("[3] total yearly K22", s3.K22, K10 + 50 * 1920);
check("[3] 4-year depreciation", build({ seq: true, seqPrice: 100000, seqVol: 2000, seqYears: 4 }).C35, 12.5);

console.log("\n[4] Flow cell counting");
const pA = { name: "A", samples: 15, reads: 100, price: 500 }, pB = { name: "B", samples: 15, reads: 100, price: 500 };
const mxOn = routine([pA, pB], 5000, 0, 1, true, 10);
check("[4] multiplex coverage 0.3 + 0.3", mxOn.coverage, 0.6);
check("[4] multiplex flow cells = ceil(0.6)", mxOn.fc_needed, 1);
check("[4] multiplex reagents 30 x 500", mxOn.reagent, 15000);
const mxOff = routine([pA, pB], 5000, 0, 1, false, 10);
check("[4] not multiplexed: only the first panel counts (samples)", mxOff.samples_run, 15);
check("[4] not multiplexed: flow cells = ceil(0.3)", mxOff.fc_needed, 1);
check("[4] not multiplexed: reagents 15 x 500", mxOff.reagent, 7500);
const fl = routine([{ name: "a", samples: 100, reads: 1, price: 0 }, { name: "b", samples: 200, reads: 1, price: 0 }, { name: "c", samples: 700, reads: 1, price: 0 }], 1000, 0, 1, true, 1);
check("[4] float noise: 0.1 + 0.2 + 0.7 needs 1 flow cell (plain ceil gives 2)", fl.fc_needed, 1);
check("[4] exactly full: 82 x 100 on 8,200 = 1 flow cell", routine([{ ...TSO, samples: 82 }], 8200, 0, 1, false, 1).fc_needed, 1);
check("[4] one over: 83 x 100 on 8,200 = 2 flow cells", routine([{ ...TSO, samples: 83 }], 8200, 0, 1, false, 1).fc_needed, 2);
const over = routine([{ name: "a", samples: 6, reads: 100, price: 0 }, { name: "b", samples: 6, reads: 100, price: 0 }], 1000, 0, 1, true, 1);
check("[4] multiplex 0.6 + 0.6 = 2 flow cells", over.fc_needed, 2);
check("[4] multiplex avg fill 1.2 / 2", over.fill, 0.6);
const cost3 = routine([{ name: "a", samples: 25, reads: 100, price: 10 }], 1000, 1000, 2, false, 1);
check("[4] 2.5 coverage -> 3 flow cells", cost3.fc_needed, 3);
check("[4] run cost = 250 reagents + 3 x 1,000", cost3.run_cost, 3250);
check("[4] cost/sample = 6,500 / 50", cost3.cost_sample, 130);
check("[4] ceilSafe(0) = 0", ceilSafe(0), 0);
check("[4] empty panel rows are ignored", routine([empty, empty], 1000, 500, 1, true, 1).fc_needed, 0);

console.log("\n[5] Resequencing");
const s5 = build({ robot: true, reseq: true, cf: 0.05, ff: 0.05 });
check("[5] reseqCur = 5% x 752.50", s5.reseqCur, 37.625);
check("[5] reseqFut = 5% x K8", s5.reseqFut, 0.05 * K8);
check("[5] reseqCurYear", s5.reseqCurYear, 0.05 * K6);
check("[5] reseqFutYear", s5.reseqFutYear, 0.05 * K10);
check("[5] K20 includes future reseq", s5.K20, K8 + robotS + 0.05 * K8);
check("[5] K22 includes future reseq yearly", s5.K22, K10 + robotYr + 0.05 * K10);
check("[5] current rate does not leak into K20",
  build({ robot: true, reseq: true, cf: 0.5, ff: 0.05 }).K20, build({ robot: true, reseq: true, cf: 0, ff: 0.05 }).K20);
check("[5] reseq off -> reseqFut 0", build({ reseq: false, cf: 0.5, ff: 0.5 }).reseqFut, 0);

console.log("\n[6] Data analysis");
const s6 = build({ data: true, dataMode: "annual", dca: 50000, dfa: 50000 });
check("[6] annual fee per sample = 50,000 / 1,920", s6.dataFutPerSample, 50000 / 1920);
check("[6] K20 = K8 + fee / volume", s6.K20, K8 + 50000 / 1920);
check("[6] K22 = K10 + 50,000", s6.K22, K10 + 50000);
const s6b = build({ data: true, dataMode: "persample", dcp: 20, dfp: 0 });
check("[6] per-sample current yearly = 20 x 1,920", s6b.dataCurYear, 38400);
check("[6] future 0 leaves K20 = K8", s6b.K20, K8);

console.log("\n[7] Future cost per sample uses the future volume (C2)");
const big = build({ futPanels: [{ ...TSO, samples: 192 }, empty, empty], futRuns: 20 });
/* 192 x 100 / 52,000 = 0.369 -> 1 flow cell; run = 132,480 + 5,000 = 137,480; yearly 2,749,600; volume 3,840 */
check("[7] future yearly", big.K10, 2749600);
check("[7] K8 = 2,749,600 / 3,840 (v2 divided by the current 1,920)", big.K8, 2749600 / 3840);

console.log("\n[8] Current all-in");
const s8 = build({ reseq: true, cf: 0.05, ff: 0.05, data: true, dataMode: "persample", dcp: 20, dfp: 20 });
check("[8] curAllIn = 752.50 + 37.625 + 20", s8.curAllIn, 810.125);
check("[8] curAllInYear = 1,444,800 x 1.05 + 38,400", s8.curAllInYear, 1444800 * 1.05 + 38400);

console.log("\n[9] Negative and blank inputs count as 0");
const neg = routine([{ name: "a", samples: -5, reads: 100, price: 10 }], 1000, -300, 2, false, 1);
check("[9] negative samples -> 0 samples", neg.samples_run, 0);
check("[9] negative flow cell cost -> 0", neg.run_cost, 0);
check("[9] blank runs -> 0 yearly", routine([{ name: "a", samples: 5, reads: 100, price: 10 }], 1000, 100, "", false, 1).yearly, 0);

console.log("\n[10] Seeded flow cells vs vendor samples-per-flow-cell guidance (independent cross-check)");
const H = (seq, fc) => SEED_SEQUENCERS.find(s => s.name === seq).flowcells.find(f => f.name === fc).reads;
// [sequencer, flow cell, M reads/sample, vendor samples per flow cell, max ratio allowed]
// Seeds use the upper end of each spec range (NovaSeq 6000 S2 is 6.6-8.2B), so the app may fit a few more than the vendor guide.
const guide = [
  ["NextSeq 550", "High Output", 100, 8], ["NextSeq 2000", "P2 2x150", 100, 8], ["NextSeq 2000", "P3 2x150", 100, 24], ["NextSeq 2000", "P4 2x150", 100, 36],
  ["NovaSeq 6000", "SP 2x150", 100, 16], ["NovaSeq 6000", "S1", 100, 32], ["NovaSeq 6000", "S2", 100, 72, 1.3], ["NovaSeq 6000", "S4", 100, 192],
  ["NovaSeq X", "1.5B", 100, 32], ["NovaSeq X", "10B", 100, 192], ["NovaSeq X", "25B", 100, 480],
  ["NextSeq 2000", "P4 2x150", 800, 4], ["NovaSeq 6000", "S1", 800, 4], ["NovaSeq 6000", "S2", 800, 8, 1.3], ["NovaSeq 6000", "S4", 800, 24], ["NovaSeq X", "1.5B", 800, 4], ["NovaSeq X", "10B", 800, 24], ["NovaSeq X", "25B", 800, 64],
  ["NextSeq 550", "High Output", 66, 12], ["NextSeq 2000", "P2 2x150", 66, 12], ["NextSeq 2000", "P3 2x150", 66, 36], ["NextSeq 2000", "P4 2x150", 66, 48], ["NovaSeq 6000", "SP 2x150", 66, 24], ["NovaSeq 6000", "S1", 66, 48], ["NovaSeq X", "1.5B", 66, 48],
  ["NextSeq 550", "Mid Output", 16.25, 16], ["NextSeq 550", "High Output", 16.25, 48],
  ["MiSeq", "v3 2x300", 1, 48], ["MiSeq", "v3 2x300", 2.08, 24],
];
guide.forEach(([s, f, r, g, tol = 1.15]) => {
  const m = maxPerFlowcell(H(s, f), r);
  truthy("[10] " + s + " " + f + " at " + r + "M: app fits " + m + ", vendor guide " + g, m >= g && m <= g * tol);
});
truthy("[10] v2 seed error caught: S4 at 5,000 would fit only 50 TSO500 (guide 192)", maxPerFlowcell(5000, 100) < 192);

console.log("\n[11] Seed and scenario integrity");
const bundleRead = name => SEED_BUNDLES.find(b => b.name === name).reads;
check("[11] TSO500 seed = 100", bundleRead("TruSight Oncology 500"), 100);
truthy("[11] panel ids unique", new Set(SEED_BUNDLES.map(b => b.id)).size === SEED_BUNDLES.length);
const fcIds = SEED_SEQUENCERS.flatMap(s => s.flowcells.map(f => f.id));
truthy("[11] flow cell ids unique", new Set(fcIds).size === fcIds.length);
const d = defaultScenario();
truthy("[11] default scenario flow cells resolve", [d.current, d.future, d.mplex].every(st => fcIds.includes(st.flowcellId)));
truthy("[11] normalize(default) keeps panels", JSON.stringify(normalizeScenario(d).current.panels) === JSON.stringify(d.current.panels));
truthy("[11] normalize rejects other schema", normalizeScenario({ schema: 2 }) === null);
truthy("[11] normalize rejects garbage", normalizeScenario("x") === null);
truthy("[11] normalize fills missing parts", normalizeScenario({ schema: 3 }).robots.length === d.robots.length);

console.log("\n[12] Coverage requirement");
/* Somatic rule: depth = variant reads / VAF. */
check("[12] 50 reads at 5% VAF -> 1,000x", minDepthForVaf(0.05, 50), 1000);
check("[12] 50 reads at 2% VAF -> 2,500x", minDepthForVaf(0.02, 50), 2500);
check("[12] 50 reads at 3% VAF -> 1,667x (rounded up)", minDepthForVaf(0.03, 50), 1667);
truthy("[12] VAF 0 or 100% -> no depth", minDepthForVaf(0, 50) === null && minDepthForVaf(1, 50) === null);
const COV = { germlineMin: 30, minAltReads: 50, minToMean: 20 };
/* TSO500: 1,000 / 20% = 5,000x mean; 100M reads give 3,500x -> needs 100 x 5,000 / 3,500 = 142.86M */
const tsoC = coverageCheck({ app: "Somatic", depth: 3500, reads: 100, vaf: 5 }, COV);
check("[12] TSO500 required depth 1,000x", tsoC.reqMin, 1000);
check("[12] TSO500 required mean 5,000x", tsoC.reqMean, 5000);
check("[12] TSO500 reads needed 142.86M", tsoC.readsNeeded, 100 * 5000 / 3500);
truthy("[12] TSO500 at 3,500x mean is below 5,000x", tsoC.meets === false);
const tsoFlat = coverageCheck({ app: "Somatic", depth: 3500, reads: 100, vaf: 5 }, { ...COV, minToMean: 100 });
check("[12] with no uniformity margin TSO500 needs 28.57M", tsoFlat.readsNeeded, 100 * 1000 / 3500);
/* Germline: 30x / 20% = 150x mean; 16.25M reads giving 100x -> needs 24.375M */
const gC = coverageCheck({ app: "Germline", depth: 100, reads: 16.25, vaf: 5 }, COV);
check("[12] germline required mean 150x", gC.reqMean, 150);
check("[12] germline reads needed 24.375M", gC.readsNeeded, 24.375);
truthy("[12] germline at 100x mean is below requirement", gC.meets === false);
truthy("[12] no mean depth -> no check", coverageCheck({ app: "Somatic", depth: "", reads: 100, vaf: 5 }, COV) === null);
truthy("[12] no application -> no check", coverageCheck({ app: "", depth: 3500, reads: 100, vaf: 5 }, COV) === null);
check("[12] seeded TSO500 mean depth 3,500x (Illumina)", SEED_BUNDLES[0].depth, 3500);

console.log("\n" + (allok ? "ALL " + n + " CHECKS PASSED" : fails + " OF " + n + " CHECKS FAILED"));
