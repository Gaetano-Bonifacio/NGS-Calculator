import { routine, model } from "./artifact_logic.mjs";

let allok = true, n = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function check(label, got, exp, tol) {
  const ok = approx(got, exp, tol); allok = allok && ok; n++;
  console.log((ok ? "PASS " : "FAIL ") + label + "  got=" + got + "  exp=" + exp);
}

/* Ground truth derived by hand, not read back from the artifact.
   Default: TSO500 (100 M reads/sample, $690), 96 samples, 20 runs.
   Current NovaSeq 6000 / S2 -> H=4100, rt=36, flow cell $3000
   Future  NovaSeq X   / 25B -> H=52000, rt=48, flow cell $5000 */
const TSO = { name: "TruSight Oncology 500", samples: 96, reads: 100, price: 690 };
const empty = { name: "", samples: 0, reads: null, price: 0 };
const curPanels = [TSO, empty, empty];
const futPanels = [{ ...TSO }, empty, empty];

function build(o = {}) {
  return model({
    curPanels, curH: 4100, curRuntime: 36, C10: 3000, C11: 20, C4: false,
    futPanels, futH: 52000, futRuntime: 48, C20: 5000, C21: 20, C14: false,
    C25: o.robot ?? false, robotPrice: o.robotPrice ?? 67960, robotVol: o.robotVol ?? 2000, C28: o.cons ?? 5,
    C33: o.seq ?? false, seqPrice: o.seqPrice ?? 0, seqVol: o.seqVol ?? 2000,
    C40: o.reseq ?? false, curFail: o.cf ?? 0, futFail: o.ff ?? 0,
  });
}

const K4 = 721.25, K6 = 1384800, K8 = 1424800 / 1920, K10 = 1424800, K9 = 71240, K5 = 69240;
const c27 = 33.98, C28 = 5, robotYr = (c27 + C28) * 96 * 20;

/* Scenario 1: base economics, no add-ons */
const s1 = build();
check("[1] current cost/sample K4", s1.K4, K4);
check("[1] current run cost K5", s1.K5, K5);
check("[1] current yearly K6", s1.K6, K6);
check("[1] future cost/sample K8", s1.K8, K8);
check("[1] future run cost K9", s1.K9, K9);
check("[1] future yearly K10", s1.K10, K10);
check("[1] yearly savings", s1.yr_savings, K6 - K10);
check("[1] per-sample savings", s1.persample_savings, K4 - K8);
check("[1] no add-ons K20 == K8", s1.K20, K8);
check("[1] no add-ons K22 == K10", s1.K22, K10);

/* Scenario 2: robot add-on */
const s2 = build({ robot: true });
check("[2] robot/sample C27", s2.C27, c27);
check("[2] future+robot K12", s2.K12, K8 + c27 + C28);
check("[2] total/sample K20", s2.K20, K8 + c27 + C28);
check("[2] total yearly K22", s2.K22, K10 + robotYr);

/* Scenario 3: sequencer add-on */
const s3 = build({ seq: true, seqPrice: 100000, seqVol: 2000 });
const c35 = 50;
check("[3] sequencer/sample C35", s3.C35, c35);
check("[3] total/sample K20", s3.K20, K8 + c35);
check("[3] total yearly K22", s3.K22, K10 + c35 * 96 * 20);

/* Scenario 4: multiplex flow-cell rule (routine, direct) */
const pA = { name: "A", samples: 15, reads: 100, price: 500 };
const pB = { name: "B", samples: 15, reads: 100, price: 500 };
const mxOn = routine([pA, pB], 5000, 0, 1, true, 10);
const mxOff = routine([pA, pB], 5000, 0, 1, false, 10);
check("[4] coverage sum", mxOn.coverage, 0.6);
check("[4] multiplex flow cells = ceil(sum)", mxOn.fc_needed, 1);
check("[4] non-multiplex flow cells = sum of ceilings", mxOff.fc_needed, 2);
check("[4] reagent E9", mxOn.reagent, 15000);
check("[4] samples/year", mxOn.samples_year, 30);

/* Scenario 5: resequencing on, 5% current and 5% future */
const s5 = build({ robot: true, reseq: true, cf: 0.05, ff: 0.05 });
const reseqCur = 0.05 * K4, reseqFut = 0.05 * K8;
check("[5] reseqCur", s5.reseqCur, reseqCur);
check("[5] reseqFut", s5.reseqFut, reseqFut);
check("[5] reseqCurYear", s5.reseqCurYear, 0.05 * K6);
check("[5] reseqFutYear", s5.reseqFutYear, 0.05 * K10);
check("[5] curPlusReseq == K4*1.05", s5.curPlusReseq, K4 * 1.05);
check("[5] futPlusReseq == K8*1.05", s5.futPlusReseq, K8 * 1.05);
check("[5] K20 includes future reseq", s5.K20, K8 + c27 + C28 + reseqFut);
check("[5] K22 includes future reseq yearly", s5.K22, K10 + robotYr + 0.05 * K10);

/* Scenario 6: rate isolation and non-regression */
check("[6] reseq off -> reseqFut 0", build({ reseq: false, cf: 0.5, ff: 0.5 }).reseqFut, 0);
check("[6] reseq off -> K20 unchanged", build({ robot: true, reseq: false }).K20, K8 + c27 + C28);
check("[6] reseq off -> K22 unchanged", build({ robot: true, reseq: false }).K22, K10 + robotYr);
check("[6] current rate does not leak into K20",
  build({ robot: true, reseq: true, cf: 0.5, ff: 0.05 }).K20,
  build({ robot: true, reseq: true, cf: 0.0, ff: 0.05 }).K20);
const asym = build({ reseq: true, cf: 0, ff: 0.10 });
check("[6] asym reseqCur 0", asym.reseqCur, 0);
check("[6] asym reseqFut", asym.reseqFut, 0.10 * K8);
check("[6] asym K22", asym.K22, K10 + 0.10 * K10);

console.log("\nchecks run: " + n);
console.log(allok ? "ALL TESTS PASSED" : "SOME TESTS FAILED");
