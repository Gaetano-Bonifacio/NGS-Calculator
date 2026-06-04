/* =========================================================================
   NGS Calculator - non-regression test (run: node verify.mjs)

   This guards the calculation logic. The block marked VERBATIM LOGIC below
   is copied exactly from ngs_calculator.jsx (and index.html). If you ever
   change the math in the source, paste the updated functions here and re-run
   this file before publishing. Expected values are derived independently by
   hand (see the comments per scenario), so a pass means the source computes
   what the formulas intend, not merely what it computed last time.

   No dependencies. Any Node version with ES modules works.
   ========================================================================= */

// ---- VERBATIM LOGIC ----
const roundup = (x, n = 0) => { const f = 10 ** n; return Math.ceil(Math.abs(x) * f) / f * (x >= 0 ? 1 : -1); };
const perSample = (total, volume) => (volume > 0 ? total / volume : NaN);
function routine(panels, H, fcCost, runs, multiplex, runtime, priceOverride) {
  const rows = []; let seen = false;
  panels.forEach((p, i) => {
    if (!p.name) return;
    const cov = (p.reads && H) ? (p.samples * p.reads) / H : 0;
    const rt = !seen ? runtime : 0; seen = true;
    const price = (priceOverride && priceOverride[i] != null) ? priceOverride[i] : p.price;
    rows.push({ name: p.name, samples: p.samples, price, cov, rt, reads: p.reads, H });
  });
  const E9 = rows.reduce((a, r) => a + r.price * r.samples, 0);
  const N9 = rows.reduce((a, r) => a + r.samples, 0) * runs;
  const rtTotal = rows.reduce((a, r) => a + r.rt, 0);
  const P = rows.reduce((a, r) => a + r.cov, 0);
  const fcNeeded = multiplex ? (P ? Math.ceil(P) : 0) : rows.reduce((a, r) => a + roundup(r.cov), 0);
  const B12 = E9 + fcCost, F12 = B12 * runs, H12 = N9 ? F12 / N9 : 0;
  return { reagent: E9, run_cost: B12, yearly: F12, cost_sample: H12, samples_year: N9, run_time: rtTotal, fc_needed: fcNeeded, prices: rows.map(r => r.price), coverage: P, detail: rows };
}
function model(inp) {
  const cur = routine(inp.curPanels, inp.curH, inp.C10, inp.C11, inp.C4, inp.curRuntime);
  const futOverride = cur.prices.concat([null, null, null]);
  const fut = routine(inp.futPanels, inp.futH, inp.C20, inp.C21, inp.C14, inp.futRuntime, futOverride);
  const K4 = cur.cost_sample, K5 = cur.run_cost, K6 = cur.yearly;
  const K8 = cur.samples_year ? fut.yearly / cur.samples_year : 0, K9 = fut.run_cost, K10 = fut.yearly;
  const robotOn = inp.C25, seqOn = inp.C33;
  const C27 = robotOn ? perSample(inp.robotPrice, inp.robotVol) : 0;
  const C35 = seqOn ? perSample(inp.seqPrice, inp.seqVol) : 0;
  const num = v => typeof v === "number" && !isNaN(v);
  const c27 = num(C27) ? C27 : 0, c35 = num(C35) ? C35 : 0;
  const C28 = inp.C28, sumD = inp.futPanels.reduce((a, p) => a + (p.name ? p.samples : 0), 0);
  const K12 = (K8 + (robotOn ? c27 : 0)) + C28;
  const K20 = K8 + (robotOn ? c27 + C28 : 0) + (seqOn ? c35 : 0);
  const K21 = K9 + (robotOn ? (c27 + C28) * sumD : 0) + (seqOn ? c35 * sumD : 0);
  const K22 = K10 + (robotOn ? (c27 + C28) * sumD * inp.C21 : 0) + (seqOn ? c35 * sumD * inp.C21 : 0);
  return {
    K4, K5, K6, K8, K9, K10, C27, C35, K12, K20, K21, K22,
    robotPriceValid: !robotOn || num(C27), seqPriceValid: !seqOn || num(C35),
    cur_fc: cur.fc_needed, fut_fc: fut.fc_needed, cur_cov: cur.coverage, fut_cov: fut.coverage,
    cur_samples_year: cur.samples_year, fut_samples_year: fut.samples_year,
    yr_savings: K6 - K10, persample_savings: K4 - K8,
  };
}
// ---- END VERBATIM LOGIC ----

let pass = 0, fail = 0;
const T = 1e-6;
function eq(label, got, exp, tol = T) {
  const ok = Math.abs(got - exp) <= tol;
  if (ok) { pass++; } else { fail++; console.log(`  FAIL ${label}: got ${got}, expected ${exp}`); }
}

/* ===== SCENARIO A: single panel, current vs future, robot ON, seq OFF =====
   bundle TSO500 reads=100 price=690
   current: 96 samples, fcReads=4100 (NovaSeq6000 S2), fcCost=3000, runs=20, no mux, rt=36
   future:  96 samples, fcReads=52000 (NovaSeqX 25B), fcCost=5000, runs=20, no mux  (price override 690)
   robot: price=67960 vol=2000 consumables=5
   Hand derivation:
     cur cov = 96*100/4100 = 2.341463...   fc = ceil = 3
     cur E9 = 690*96 = 66240 ; N9 = 1920 ; B12=69240 ; F12=1384800 ; K4=721.25
     fut cov = 96*100/52000 = 0.1846153... fc = 1
     fut E9 = 66240 ; B12=71240=K9 ; F12=1424800=K10
     K8 = 1424800/1920 = 742.0833333...
     C27 = 67960/2000 = 33.98 ; C28=5 ; sumD=96 ; C21=20
     K12 = 742.0833333+33.98+5 = 781.0633333
     K20 = same (seq off) = 781.0633333
     K21 = 71240 + 38.98*96 = 74982.08
     K22 = 1424800 + 38.98*96*20 = 1499641.6 */
{
  const a = model({
    curPanels: [{ name: "TSO500", samples: 96, reads: 100, price: 690 }],
    curH: 4100, curRuntime: 36, C10: 3000, C11: 20, C4: false,
    futPanels: [{ name: "TSO500", samples: 96, reads: 100, price: 690 }],
    futH: 52000, futRuntime: 48, C20: 5000, C21: 20, C14: false,
    C25: true, robotPrice: 67960, robotVol: 2000, C28: 5,
    C33: false, seqPrice: 0, seqVol: 2000,
  });
  console.log("Scenario A: single panel + robot");
  eq("A.cur_cov", a.cur_cov, 96 * 100 / 4100);
  eq("A.cur_fc", a.cur_fc, 3);
  eq("A.fut_fc", a.fut_fc, 1);
  eq("A.K4", a.K4, 721.25);
  eq("A.K5", a.K5, 69240);
  eq("A.K6", a.K6, 1384800);
  eq("A.K8", a.K8, 1424800 / 1920);
  eq("A.K9", a.K9, 71240);
  eq("A.K10", a.K10, 1424800);
  eq("A.C27", a.C27, 33.98);
  eq("A.K12", a.K12, 1424800 / 1920 + 33.98 + 5);
  eq("A.K20", a.K20, 1424800 / 1920 + 33.98 + 5);
  eq("A.K21", a.K21, 74982.08);
  eq("A.K22", a.K22, 1499641.6, 1e-4);
  eq("A.yr_savings", a.yr_savings, 1384800 - 1424800);
}

/* ===== SCENARIO B: two-panel multiplex (the corrected flow-cell logic) =====
   flow cell reads H=5000 (NovaSeq6000 S4), runs=12, fcCost=0
   panel1 TSO500 samples=20 reads=100 price=690 -> cov=2000/5000=0.4
   panel2 PanelB samples=10 reads=200 price=500 -> cov=2000/5000=0.4
   MULTIPLEX: P=0.8 -> fc=ceil(0.8)=1   (bug fix: not collapsed to per-panel 1s)
   NON-MULTIPLEX same inputs: fc=ceil(0.4)+ceil(0.4)=2
   E9=690*20+500*10=18800 ; N9=30*12=360 ; B12=18800 ; F12=225600 ; cost/sample=626.6667 */
{
  const panels = [
    { name: "TSO500", samples: 20, reads: 100, price: 690 },
    { name: "PanelB", samples: 10, reads: 200, price: 500 },
  ];
  const mux = routine(panels, 5000, 0, 12, true, 44);
  const nomux = routine(panels, 5000, 0, 12, false, 44);
  console.log("Scenario B: two-panel multiplex vs non-multiplex");
  eq("B.coverage", mux.coverage, 0.8);
  eq("B.mux_fc", mux.fc_needed, 1);
  eq("B.nomux_fc", nomux.fc_needed, 2);
  eq("B.reagent", mux.reagent, 18800);
  eq("B.samples_year", mux.samples_year, 360);
  eq("B.run_cost", mux.run_cost, 18800);
  eq("B.yearly", mux.yearly, 225600);
  eq("B.cost_sample", mux.cost_sample, 225600 / 360);
  eq("B.run_time", mux.run_time, 44);
}

/* ===== SCENARIO C: MSK-IMPACT, future vendor, 4-year sequencer add-on =====
   bundle MSK-IMPACT reads=150 price=900
   current: 64 samples fcReads=5000 (S4) fcCost=4000 runs=10 no mux
   future:  64 samples fcReads=52000 (25B) fcCost=6000 runs=10 no mux (override 900)
   seq add-on: price=985000 vol=8000 (=2000/yr * 4yr) ; robot OFF
   Hand derivation:
     cur cov=64*150/5000=1.92 fc=2 ; E9=57600 ; N9=640 ; B12=61600 ; F12=616000 ; K4=962.5
     fut cov=64*150/52000=0.1846 fc=1 ; E9=57600 ; B12=63600=K9 ; F12=636000=K10
     K8=636000/640=993.75
     C35=985000/8000=123.125 ; sumD=64 ; C21=10
     K20=993.75+123.125=1116.875
     K21=63600+123.125*64=71480
     K22=636000+123.125*64*10=714800 */
{
  const c = model({
    curPanels: [{ name: "MSK-IMPACT", samples: 64, reads: 150, price: 900 }],
    curH: 5000, curRuntime: 44, C10: 4000, C11: 10, C4: false,
    futPanels: [{ name: "MSK-IMPACT", samples: 64, reads: 150, price: 900 }],
    futH: 52000, futRuntime: 48, C20: 6000, C21: 10, C14: false,
    C25: false, robotPrice: 0, robotVol: 2000, C28: 5,
    C33: true, seqPrice: 985000, seqVol: 8000,
  });
  console.log("Scenario C: MSK-IMPACT + 4yr sequencer");
  eq("C.cur_cov", c.cur_cov, 1.92);
  eq("C.cur_fc", c.cur_fc, 2);
  eq("C.fut_fc", c.fut_fc, 1);
  eq("C.K4", c.K4, 962.5);
  eq("C.K5", c.K5, 61600);
  eq("C.K6", c.K6, 616000);
  eq("C.K8", c.K8, 993.75);
  eq("C.K9", c.K9, 63600);
  eq("C.K10", c.K10, 636000);
  eq("C.C35", c.C35, 123.125);
  eq("C.K20", c.K20, 1116.875);
  eq("C.K21", c.K21, 71480);
  eq("C.K22", c.K22, 714800);
  eq("C.seqValid", c.seqPriceValid ? 1 : 0, 1);
}

/* ===== Guardrail edge cases ===== */
{
  console.log("Edge cases: empty / zero-volume");
  const empty = model({
    curPanels: [{ name: "", samples: 0, reads: null, price: 0 }],
    curH: 0, curRuntime: 0, C10: 0, C11: 0, C4: false,
    futPanels: [{ name: "", samples: 0, reads: null, price: 0 }],
    futH: 0, futRuntime: 0, C20: 0, C21: 0, C14: false,
    C25: true, robotPrice: 1000, robotVol: 0, C28: 5,
    C33: false, seqPrice: 0, seqVol: 0,
  });
  eq("E.K4_nan_guard", isFinite(empty.K4) ? empty.K4 : 0, 0);
  eq("E.robotInvalid", empty.robotPriceValid ? 1 : 0, 0); // vol=0 -> NaN -> invalid
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
