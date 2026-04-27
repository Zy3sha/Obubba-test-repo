#!/usr/bin/env node
/*
 * SLEEP ENGINE AUDIT — comprehensive real-life scenario matrix
 * =============================================================
 * Exercises the pure math helpers from the sleep engine against many
 * scenarios that real parents actually log, asserting invariants that
 * must ALWAYS hold regardless of age, override, wake-time, or pattern.
 *
 * When you add a new scenario or find a new bug:
 *   1. Add a scenario below that reproduces the bad input
 *   2. Add an invariant if the bug violates a new rule
 *   3. Fix the engine until `npm test` exits 0
 *   4. The scenario lives here forever as a regression guard
 *
 * Run:  node test/sleep-engine-audit.js
 * Exit: 0 on clean audit, 1 if any CRITICAL invariant fails
 */

// ─── Pure helpers copied verbatim from app.jsx ────────────────────────
// Keep in sync with app.jsx whenever sleep-engine functions change.

function getWakeWindow(ageWeeks) {
  // Kept in sync with app.jsx: defensive guard for NaN/undefined/negative age.
  // Without this, NaN comparisons always return false → findIndex returns -1 →
  // idx pins at the 36mo+ stage (6–12h wake window) — catastrophic for a
  // newborn during a calcAge glitch.
  if (typeof ageWeeks !== "number" || isNaN(ageWeeks) || ageWeeks < 0) {
    return { min: 60, max: 90, midpoint: 75, label: "~60–90 min" };
  }
  const months = ageWeeks / 4.33;
  let min, max, label;
  const stages = [
    [1.39, 30, 90],
    [3,    45, 90],
    [5,    75, 120],
    [7,    120, 180],
    [9,    150, 210],
    [12,   180, 240],
    [15,   210, 270],
    [19,   270, 330],
    [36,   300, 360],
    [Infinity, 360, 720]
  ];
  let idx = stages.findIndex(s => months < s[0]);
  if (idx < 0) idx = stages.length - 1;
  min = stages[idx][1]; max = stages[idx][2];
  // Two-sided blending (matches app.jsx): smooth both approaching and leaving
  // a stage boundary so week-to-week changes stay under ~30 min.
  if (idx < stages.length - 1) {
    const boundaryMo = stages[idx][0];
    const weeksUntil = (boundaryMo - months) * 4.33;
    if (weeksUntil <= 2 && weeksUntil >= 0) {
      const nxt = stages[idx + 1];
      const blend = Math.max(0, Math.min(0.5, (2 - weeksUntil) / 4));
      min = Math.round(min * (1 - blend) + nxt[1] * blend);
      max = Math.round(max * (1 - blend) + nxt[2] * blend);
    }
  }
  if (idx > 0) {
    const prevBoundaryMo = stages[idx - 1][0];
    const weeksSince = (months - prevBoundaryMo) * 4.33;
    if (weeksSince >= 0 && weeksSince <= 2) {
      const prev = stages[idx - 1];
      const blend = Math.max(0, Math.min(0.5, (2 - weeksSince) / 4));
      min = Math.round(min * (1 - blend) + prev[1] * blend);
      max = Math.round(max * (1 - blend) + prev[2] * blend);
    }
  }
  label = max <= 90 ? `${min}–${max} min` : `${(min/60).toFixed(1).replace('.0','')}–${(max/60).toFixed(1).replace('.0','')} hrs`;
  return { min, max, label, midpoint: Math.round((min+max)/2) };
}

function progressiveWW(ageWeeks, napIndex, totalNaps, disruptionMode = false) {
  const ww = getWakeWindow(ageWeeks);
  const range = ww.max - ww.min;
  if (totalNaps <= 1) {
    let base = ww.midpoint;
    if (disruptionMode) base = Math.round(base * 0.8);
    return base;
  }
  const ratio = Math.min(napIndex / totalNaps, 1);
  const scaled = 0.15 + ratio * 0.7;
  let result = Math.round(ww.min + range * scaled);
  if (disruptionMode) result = Math.round(result * 0.8);
  return result;
}

function getAgeNapProfile(ageWeeks) {
  if ((!ageWeeks && ageWeeks !== 0)) return { expectedNaps:3, idealNapDurMin:30, idealNapDurMax:90, idealTotalMin:120, idealTotalMax:240 };
  const months = ageWeeks / 4.33;
  // Keep the higher nap count around major transitions so the engine does
  // not force an abrupt drop exactly when families need flexible guidance.
  if (ageWeeks < 6)  return { expectedNaps:5, idealNapDurMin:20, idealNapDurMax:60,  idealTotalMin:240, idealTotalMax:360 };
  if (months < 3)    return { expectedNaps:4, idealNapDurMin:30, idealNapDurMax:90,  idealTotalMin:180, idealTotalMax:300 };
  if (months < 5)    return { expectedNaps:3, idealNapDurMin:40, idealNapDurMax:90,  idealTotalMin:150, idealTotalMax:240 };
  if (months < 7)    return { expectedNaps:3, idealNapDurMin:45, idealNapDurMax:120, idealTotalMin:120, idealTotalMax:210 };
  if (months < 9)    { const r = { expectedNaps:2, idealNapDurMin:60, idealNapDurMax:120, idealTotalMin:120, idealTotalMax:210 }; if (ageWeeks >= 28 && ageWeeks <= 31) r.expectedNaps = 3; return r; }
  if (months < 12)   return { expectedNaps:2, idealNapDurMin:60, idealNapDurMax:120, idealTotalMin:120, idealTotalMax:180 };
  if (months < 15)   return { expectedNaps:2, idealNapDurMin:50, idealNapDurMax:110, idealTotalMin:90,  idealTotalMax:150 };
  if (ageWeeks < 78) { const r = { expectedNaps:1, idealNapDurMin:60, idealNapDurMax:120, idealTotalMin:60,  idealTotalMax:120 }; if (ageWeeks >= 63 && ageWeeks <= 67) r.expectedNaps = 2; return r; }
  return               { expectedNaps:1, idealNapDurMin:60, idealNapDurMax:90,  idealTotalMin:60,  idealTotalMax:90  };
}

function clampBedtime(mins, ageWeeks) {
  const aw = ageWeeks;
  const lo = (aw && aw < 13) ? 17*60 : 18*60;
  let hi;
  if (!aw || aw < 6)   hi = 22*60;
  else if (aw < 13)    hi = 21*60;
  else if (aw < 26)    hi = 20*60;
  else if (aw < 39)    hi = 20*60;
  else if (aw < 52)    hi = 20*60+30;
  else                 hi = 20*60+30;
  hi = Math.min(hi, 22*60+30);
  return Math.max(lo, Math.min(hi, mins));
}

function clampWake(mins) {
  return Math.max(5*60, Math.min(9*60+30, mins));
}

function clampWakeWindow(wwMins, ageWeeks) {
  const ww = getWakeWindow(ageWeeks);
  return Math.max(ww.min, Math.min(ww.max, wwMins));
}

function clampNapDuration(dur, ageWeeks) {
  const maxDur = ageWeeks < 13 ? 120 : ageWeeks < 26 ? 90 : ageWeeks < 52 ? 120 : 150;
  return Math.max(15, Math.min(maxDur, dur));
}

// Simulates applyScheduleAdjustment clamping like the real app does.
function applyScheduleOverride(wakeMins, bedMins, ageWeeks) {
  let wake = null, bed = null;
  if (wakeMins != null) wake = clampWake(wakeMins);
  if (bedMins != null)  bed = clampBedtime(bedMins, ageWeeks);
  // Feasibility: bed - wake must allow enough awake time for all naps + wake windows
  if (wake != null && bed != null) {
    const ww = getWakeWindow(ageWeeks);
    const profile = getAgeNapProfile(ageWeeks);
    const totalDay = bed - wake;
    const minNeeded = profile.expectedNaps * 30 + (profile.expectedNaps + 1) * ww.min;
    if (totalDay < minNeeded) {
      bed = clampBedtime(wake + minNeeded, ageWeeks);
    }
  }
  return { wake, bed };
}

// ─── Simplified schedule projection (mirror of fixed app.jsx loop) ───
function projectDayPlan({ ageWeeks, wakeMins, avgNapDur, targetBedMins, disruptionMode = false, completedNaps = [], napOnFirstStart = null }) {
  const w = ageWeeks;
  const ww = getWakeWindow(w);
  const profile = getAgeNapProfile(w);
  const expectedTotal = profile.expectedNaps;
  const ageBedCeiling = clampBedtime(24*60, w);
  // ── INPUT CLAMPS ── never trust raw input. clamp both nap duration and
  // target bedtime to age-safe ranges BEFORE the placement loop runs.
  const safeNapDur = clampNapDuration(avgNapDur || profile.idealNapDurMin, w);
  const safeTargetBed = targetBedMins != null ? Math.min(targetBedMins, ageBedCeiling) : null;
  const napFitCeiling = Math.min(safeTargetBed || ageBedCeiling, ageBedCeiling);
  const minBedWW = w < 30 ? 60 : 90;

  const items = [];
  items.push({ type: "wake", time: wakeMins, label: "Wake" });

  // Replay any completed naps first (like app.jsx does)
  let cursor = wakeMins;
  let napsDone = 0;
  for (const n of completedNaps) {
    items.push({ type: "nap", start: n.start, end: n.end, label: `Nap ${napsDone+1}`, dur: n.end - n.start });
    cursor = n.end;
    napsDone++;
  }

  // Active nap (in progress)
  if (napOnFirstStart != null) {
    const estimatedEnd = napOnFirstStart + safeNapDur;
    items.push({ type: "nap", start: napOnFirstStart, end: estimatedEnd, label: `Nap ${napsDone+1} (active)`, dur: safeNapDur, active: true });
    cursor = estimatedEnd;
    napsDone++;
  }

  let napIdx = napsDone;
  while (napIdx < expectedTotal) {
    const napStart = cursor + clampWakeWindow(progressiveWW(w, napIdx, expectedTotal, disruptionMode), w);
    const isLast = napIdx === expectedTotal - 1;
    let napDur = safeNapDur;
    let isBridge = false;
    let placed = false;

    if (napStart + minBedWW > napFitCeiling) break;

    if (isLast) {
      const durations = [safeNapDur, Math.round(safeNapDur * 0.7), 25, 20, 15];
      for (const tryDur of durations) {
        if (napStart + tryDur + minBedWW <= napFitCeiling) {
          napDur = tryDur;
          isBridge = tryDur <= 25;
          placed = true;
          break;
        }
      }
      if (!placed) break;
    } else {
      if (napStart + safeNapDur + minBedWW > napFitCeiling) break;
      placed = true;
    }

    const napEnd = napStart + napDur;
    items.push({ type: "nap", start: napStart, end: napEnd, label: isBridge ? "Bridge nap" : `Nap ${napIdx+1}`, dur: napDur, bridge: isBridge });
    cursor = napEnd;
    napIdx++;
  }

  let bedMins;
  if (safeTargetBed && safeTargetBed >= cursor + minBedWW) {
    bedMins = safeTargetBed;
  } else if (safeTargetBed) {
    const lastNapIdx = items.length - 1;
    const lastNap = items[lastNapIdx];
    if (lastNap && lastNap.type === "nap" && !lastNap.active) {
      items.splice(lastNapIdx, 1);
      bedMins = safeTargetBed;
    } else {
      bedMins = cursor + minBedWW;
    }
  } else {
    bedMins = clampBedtime(cursor + progressiveWW(w, napIdx, expectedTotal, disruptionMode), w);
  }

  // If the desired bedtime leaves a wake window that is too long, insert
  // consultant-style rescue/bridge naps until bedtime is reachable. This
  // mirrors the live engine's catch-up nap intent and protects catnap days.
  let bridgeGuard = 0;
  while (bedMins - cursor > ww.max + 15 && bridgeGuard < 4) {
    const bridgeDur = w < 22 ? 25 : w < 39 ? 20 : 15;
    const bridgeStart = Math.max(cursor + 10, cursor + Math.round(ww.min * 0.8));
    const bridgeEnd = bridgeStart + bridgeDur;
    if (bridgeEnd + minBedWW > Math.min(bedMins, ageBedCeiling)) break;
    items.push({ type: "nap", start: bridgeStart, end: bridgeEnd, label: "Bridge nap", dur: bridgeDur, bridge: true });
    cursor = bridgeEnd;
    bridgeGuard++;
  }

  items.push({ type: "bed", time: bedMins, label: "Bedtime" });

  return { items, bedMins };
}

// ─── Invariant checker ──────────────────────────────────────────────
function checkInvariants(scenario, plan) {
  const issues = [];
  const w = scenario.ageWeeks;
  const items = plan.items;
  const naps = items.filter(i => i.type === "nap");
  const bed = items.find(i => i.type === "bed");
  const wake = items.find(i => i.type === "wake");
  const minBedWW = w < 30 ? 60 : 90;

  // I-1: every nap must END at least minBedWW before bedtime
  naps.forEach((n, idx) => {
    if (n.end > bed.time - minBedWW + 1) {
      issues.push(`[I-1] Nap ${idx+1} ends at ${mtp(n.end)} but bedtime is ${mtp(bed.time)} (needs ${minBedWW}min gap)`);
    }
  });

  // I-1b: CRITICAL — no nap may end AT or AFTER bedtime
  naps.forEach((n, idx) => {
    if (n.end > bed.time) {
      issues.push(`[I-1b CRITICAL] Nap ${idx+1} ends at ${mtp(n.end)} which is AFTER bedtime ${mtp(bed.time)}`);
    }
  });

  // I-2: bedtime within age ceiling
  const ageCeiling = clampBedtime(24*60, w);
  if (bed.time > ageCeiling + 1) {
    issues.push(`[I-2] Bedtime ${mtp(bed.time)} exceeds age ceiling ${mtp(ageCeiling)} for ${w}w`);
  }

  // I-3: wake is in safe range 5:00-9:30
  if (wake.time < 5*60 || wake.time > 9*60+30) {
    issues.push(`[I-3] Wake ${mtp(wake.time)} outside safe range 5:00am-9:30am`);
  }

  // I-4: each nap duration is positive and within safe range
  naps.forEach((n, idx) => {
    if (n.dur <= 0) issues.push(`[I-4a CRITICAL] Nap ${idx+1} has non-positive duration ${n.dur}`);
    if (n.dur > 210) issues.push(`[I-4b] Nap ${idx+1} duration ${n.dur}min exceeds safe 210min max`);
  });

  // I-5: wake windows between ENGINE-PREDICTED naps within age range.
  // User-provided completed/active naps (replay input) are exempt — parents
  // don't always nap on schedule. Only engine output is held to the standard.
  const ww = getWakeWindow(w);
  const completedCount = (scenario.completedNaps || []).length + (scenario.napOnFirstStart != null ? 1 : 0);
  let lastSleepEnd = wake.time;
  naps.forEach((n, idx) => {
    const wakeWindow = n.start - lastSleepEnd;
    const isEnginePredicted = idx >= completedCount;
    if (isEnginePredicted) {
      if (wakeWindow < ww.min * 0.5) {
        issues.push(`[I-5a] Wake window before Nap ${idx+1} is ${wakeWindow}min (age min: ${ww.min})`);
      }
      if (wakeWindow > ww.max * 1.8) {
        issues.push(`[I-5b] Wake window before Nap ${idx+1} is ${wakeWindow}min (age max: ${ww.max})`);
      }
    }
    lastSleepEnd = n.end;
  });
  const finalWW = bed.time - lastSleepEnd;
  if (finalWW < minBedWW - 1) {
    issues.push(`[I-5c CRITICAL] Last wake window ${finalWW}min is less than minBedWW ${minBedWW}min`);
  }

  // I-6: events in chronological order
  let prevTime = null;
  for (const item of items) {
    const t = item.start !== undefined ? item.start : item.time;
    if (prevTime !== null && t < prevTime) {
      issues.push(`[I-6 CRITICAL] Events out of order: ${item.label} at ${mtp(t)} is before previous ${mtp(prevTime)}`);
    }
    prevTime = item.end !== undefined ? item.end : t;
  }

  // I-7: no NaN / Infinity / undefined in output
  items.forEach((item, idx) => {
    const vals = [item.time, item.start, item.end, item.dur];
    for (const v of vals) {
      if (v !== undefined && (isNaN(v) || !isFinite(v))) {
        issues.push(`[I-7 CRITICAL] Item ${idx} (${item.label}) has invalid value: ${JSON.stringify(item)}`);
      }
    }
  });

  // I-8: if no targetBedMins, bedtime must not collapse to the wake ceiling
  if (!scenario.targetBedMins && naps.length > 0) {
    const lastNap = naps[naps.length - 1];
    if (bed.time < lastNap.end) {
      issues.push(`[I-8 CRITICAL] No-override bedtime ${mtp(bed.time)} collapsed before last nap end ${mtp(lastNap.end)}`);
    }
  }

  // I-9: nap count within reasonable range for age
  const profile = getAgeNapProfile(w);
  const structuralNaps = naps.filter(n => !n.bridge);
  if (structuralNaps.length > profile.expectedNaps + 2) {
    issues.push(`[I-9] ${structuralNaps.length} structural naps scheduled, age expects ${profile.expectedNaps} (+2 tolerance)`);
  }

  // I-10: total day sleep within 50% of ideal range (soft)
  const totalNap = naps.reduce((s, n) => s + n.dur, 0);
  if (totalNap > 0 && totalNap < profile.idealTotalMin * 0.3) {
    issues.push(`[I-10 WARN] Total day nap ${totalNap}min is well below ideal ${profile.idealTotalMin}-${profile.idealTotalMax}min`);
  }
  if (totalNap > profile.idealTotalMax * 1.5) {
    issues.push(`[I-10 WARN] Total day nap ${totalNap}min exceeds ideal max ${profile.idealTotalMax}min by >50%`);
  }

  // I-11: engine-predicted wake windows are non-decreasing (progressive).
  // User-logged completed naps are excluded because real parents don't
  // perfectly follow progressive WW.
  const enginePredicted = naps.filter((n, idx) => idx >= completedCount && !n.bridge);
  if (enginePredicted.length >= 2) {
    let prevWW = null;
    let prevEnd = completedCount > 0 ? naps[completedCount-1].end : wake.time;
    enginePredicted.forEach((n, i) => {
      const thisWW = n.start - prevEnd;
      if (prevWW !== null && thisWW < prevWW * 0.85) {
        issues.push(`[I-11] Non-progressive wake windows in engine output: ${prevWW}min then ${thisWW}min`);
      }
      prevWW = thisWW;
      prevEnd = n.end;
    });
  }

  // I-12: bridge naps must be ≤ 25 minutes
  naps.forEach((n, idx) => {
    if (n.label && n.label.toLowerCase().includes("bridge") && n.dur > 25) {
      issues.push(`[I-12] Bridge nap ${idx+1} is ${n.dur}min (max 25min)`);
    }
  });

  // I-13: completed naps must be preserved (not overwritten by projection)
  if (scenario.completedNaps && scenario.completedNaps.length) {
    const scheduledCompletedCount = items.filter(i => i.type === "nap" && !i.active).length;
    if (scheduledCompletedCount < scenario.completedNaps.length) {
      issues.push(`[I-13 CRITICAL] ${scenario.completedNaps.length} completed naps provided but only ${scheduledCompletedCount} in output`);
    }
  }

  // I-14: target bedtime should be honored if feasible (within 30 min) UNLESS override conflicts
  if (scenario.targetBedMins && scenario.targetBedMins <= ageCeiling && Math.abs(bed.time - scenario.targetBedMins) > 30) {
    // Only flag if naps could have left room
    const totalAwake = bed.time - wake.time;
    const minDayLen = profile.expectedNaps * 30 + (profile.expectedNaps + 1) * ww.min;
    if (totalAwake >= minDayLen) {
      issues.push(`[I-14] Target bedtime ${mtp(scenario.targetBedMins)} was achievable but plan produced ${mtp(bed.time)} (${Math.abs(bed.time - scenario.targetBedMins)}min off)`);
    }
  }

  // I-15: total 24h sleep budget sanity (WHO guidance ranges)
  const nightSleepEstimate = (24*60) - (bed.time - wake.time);
  const total24h = nightSleepEstimate + totalNap;
  // WHO: 0-3mo: 14-17h, 4-11mo: 12-16h, 1-2y: 11-14h, 3-5y: 10-13h
  const whoRange = w < 13 ? [14*60, 17*60]
                  : w < 52 ? [12*60, 16*60]
                  : w < 104 ? [11*60, 14*60]
                  : [10*60, 13*60];
  if (total24h < whoRange[0] - 60) {
    issues.push(`[I-15 WARN] Estimated 24h sleep ${Math.floor(total24h/60)}h${total24h%60}m is below WHO guidance ${Math.floor(whoRange[0]/60)}-${Math.floor(whoRange[1]/60)}h`);
  }
  if (total24h > whoRange[1] + 60) {
    issues.push(`[I-15 WARN] Estimated 24h sleep ${Math.floor(total24h/60)}h${total24h%60}m exceeds WHO guidance ${Math.floor(whoRange[0]/60)}-${Math.floor(whoRange[1]/60)}h`);
  }

  return issues;
}

function mtp(mins) {
  if (mins == null || isNaN(mins)) return "??";
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins) % 60;
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,"0")}${ap}`;
}

function hm(mins) {
  if (mins == null || isNaN(mins)) return "??";
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.round(Math.abs(mins) % 60);
  if (h <= 0) return `${m}m`;
  return m ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
}

// ─── Scenario matrix — REAL LIFE ─────────────────────────────────────
const scenarios = [
  // ═══════════════════════════════════════════════════════════════
  //  NORMAL BASELINES — healthy typical days across all ages
  // ═══════════════════════════════════════════════════════════════
  { category: "Normal baseline", name: "Newborn 2w — frequent short naps", ageWeeks: 2, wakeMins: 8*60, avgNapDur: 40, targetBedMins: 21*60 },
  { category: "Normal baseline", name: "6wk — 4-nap consolidating", ageWeeks: 6, wakeMins: 7*60+30, avgNapDur: 50, targetBedMins: 20*60 },
  { category: "Normal baseline", name: "3mo — 3-4 nap day", ageWeeks: 12, wakeMins: 7*60, avgNapDur: 60, targetBedMins: 19*60 },
  { category: "Normal baseline", name: "4mo — post-regression recovery", ageWeeks: 16, wakeMins: 7*60, avgNapDur: 55, targetBedMins: 19*60 },
  { category: "Normal baseline", name: "5mo normal (Oliver's bracket)", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 19*60 },
  { category: "Normal baseline", name: "6mo — 3 solid naps", ageWeeks: 26, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60 },
  { category: "Normal baseline", name: "7mo — transitioning to 2 naps", ageWeeks: 30, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60 },
  { category: "Normal baseline", name: "9mo — solid 2-nap", ageWeeks: 39, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60 },
  { category: "Normal baseline", name: "12mo — 2-nap", ageWeeks: 52, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60+30 },
  { category: "Normal baseline", name: "15mo — 1-nap transition", ageWeeks: 65, wakeMins: 7*60, avgNapDur: 120, targetBedMins: 19*60+30 },
  { category: "Normal baseline", name: "18mo — single nap", ageWeeks: 78, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60+30 },
  { category: "Normal baseline", name: "2y — solid single nap", ageWeeks: 104, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60+30 },
  { category: "Normal baseline", name: "3y — dropping nap", ageWeeks: 156, wakeMins: 7*60, avgNapDur: 60, targetBedMins: 19*60+30 },

  // ═══════════════════════════════════════════════════════════════
  //  CATNAPPERS — the classic "why won't my baby nap longer?" mum
  // ═══════════════════════════════════════════════════════════════
  { category: "Catnapper", name: "3mo catnap king — 25m naps", ageWeeks: 12, wakeMins: 7*60, avgNapDur: 25, targetBedMins: 19*60 },
  { category: "Catnapper", name: "4mo catnap queen — 20m naps", ageWeeks: 16, wakeMins: 7*60, avgNapDur: 20, targetBedMins: 19*60 },
  { category: "Catnapper", name: "5mo 30m naps", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 30, targetBedMins: 19*60 },
  { category: "Catnapper", name: "6mo short naps — under stimulation concern", ageWeeks: 26, wakeMins: 7*60, avgNapDur: 35, targetBedMins: 19*60 },
  { category: "Catnapper", name: "7mo 20m naps", ageWeeks: 30, wakeMins: 7*60, avgNapDur: 20, targetBedMins: 19*60 },

  // ═══════════════════════════════════════════════════════════════
  //  LONG SLEEPERS — the opposite problem
  // ═══════════════════════════════════════════════════════════════
  { category: "Long sleeper", name: "3mo 2h naps", ageWeeks: 12, wakeMins: 7*60, avgNapDur: 120, targetBedMins: 19*60 },
  { category: "Long sleeper", name: "5mo 2h30 naps", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 150, targetBedMins: 19*60 },
  { category: "Long sleeper", name: "7mo 3h nap (single long)", ageWeeks: 30, wakeMins: 7*60, avgNapDur: 180, targetBedMins: 19*60 },

  // ═══════════════════════════════════════════════════════════════
  //  EARLY RISERS
  // ═══════════════════════════════════════════════════════════════
  { category: "Early riser", name: "5mo 5am wake", ageWeeks: 22, wakeMins: 5*60, avgNapDur: 75, targetBedMins: 18*60+30 },
  { category: "Early riser", name: "7mo 5:15am wake", ageWeeks: 30, wakeMins: 5*60+15, avgNapDur: 90, targetBedMins: 19*60 },
  { category: "Early riser", name: "12mo 5:30am wake (split night?)", ageWeeks: 52, wakeMins: 5*60+30, avgNapDur: 90, targetBedMins: 19*60 },
  { category: "Early riser", name: "Edge: 5:00am exact", ageWeeks: 22, wakeMins: 5*60, avgNapDur: 60, targetBedMins: 19*60 },

  // ═══════════════════════════════════════════════════════════════
  //  LATE RISERS — holiday days, regression recoveries
  // ═══════════════════════════════════════════════════════════════
  { category: "Late riser", name: "5mo 9am late wake", ageWeeks: 22, wakeMins: 9*60, avgNapDur: 75, targetBedMins: 19*60 },
  { category: "Late riser", name: "5mo 9:30am ceiling", ageWeeks: 22, wakeMins: 9*60+30, avgNapDur: 75, targetBedMins: 19*60 },
  { category: "Late riser", name: "7mo 9:15am + 6:30 bed override", ageWeeks: 30, wakeMins: 9*60+15, avgNapDur: 75, targetBedMins: 18*60+30,
    // 9:15am wake + 6:30pm bed override + 75m avgNaps = long sleep budget
    // deliberately engineered to test the override path. The resulting 17h15m
    // total exceeds WHO 12-16h for 4-11mo, which I-15 correctly flags. This is
    // an INTENTIONAL edge case, not a bug in the engine.
    expectedWarnings: ["I-15"] },
  { category: "Late riser", name: "12mo 9am", ageWeeks: 52, wakeMins: 9*60, avgNapDur: 90, targetBedMins: 19*60+30 },

  // ═══════════════════════════════════════════════════════════════
  //  PARENT-SET SCHEDULE OVERRIDES
  // ═══════════════════════════════════════════════════════════════
  { category: "Override", name: "5mo override 7-7 normal", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 19*60, override: { wake: 7*60, bed: 19*60 } },
  { category: "Override", name: "5mo override 6:30-6:30 (tight)", ageWeeks: 22, wakeMins: 6*60+30, avgNapDur: 75, targetBedMins: 18*60+30, override: { wake: 6*60+30, bed: 18*60+30 } },
  { category: "Override", name: "5mo override 8-8 (late)", ageWeeks: 22, wakeMins: 8*60, avgNapDur: 75, targetBedMins: 20*60, override: { wake: 8*60, bed: 20*60 } },
  { category: "Override", name: "5mo override 5-6 (5 hr day)", ageWeeks: 22, wakeMins: 5*60, avgNapDur: 75, targetBedMins: 18*60, override: { wake: 5*60, bed: 18*60 } },
  { category: "Override", name: "5mo IMPOSSIBLE override 10pm", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 22*60, override: { wake: 7*60, bed: 22*60 } },
  { category: "Override", name: "5mo IMPOSSIBLE override 5pm", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 17*60, override: { wake: 7*60, bed: 17*60 } },
  { category: "Override", name: "THE SHIPPED BUG: 5mo late wake + 6:30 override", ageWeeks: 22, wakeMins: 8*60+19, avgNapDur: 75, targetBedMins: 18*60+30, override: { wake: 7*60, bed: 18*60+30 } },

  // ═══════════════════════════════════════════════════════════════
  //  SICK / TEETHING — disruptionMode=true
  // ═══════════════════════════════════════════════════════════════
  { category: "Sick/teething", name: "5mo teething day (-20% WW)", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 45, targetBedMins: 18*60+30, disruptionMode: true },
  { category: "Sick/teething", name: "7mo fever day", ageWeeks: 30, wakeMins: 7*60+30, avgNapDur: 60, targetBedMins: 19*60, disruptionMode: true },
  { category: "Sick/teething", name: "12mo teething + late wake", ageWeeks: 52, wakeMins: 8*60+30, avgNapDur: 60, targetBedMins: 19*60+30, disruptionMode: true },

  // ═══════════════════════════════════════════════════════════════
  //  COMPLETED NAPS — mid-day projections (already logged naps)
  // ═══════════════════════════════════════════════════════════════
  { category: "Mid-day projection", name: "5mo after 1 nap logged (9am-10am)",
    ageWeeks: 22, wakeMins: 7*60, avgNapDur: 60, targetBedMins: 19*60,
    completedNaps: [{ start: 9*60, end: 10*60 }] },
  { category: "Mid-day projection", name: "5mo after 2 naps (9-10, 12-1)",
    ageWeeks: 22, wakeMins: 7*60, avgNapDur: 60, targetBedMins: 19*60,
    completedNaps: [{ start: 9*60, end: 10*60 }, { start: 12*60, end: 13*60 }] },
  { category: "Mid-day projection", name: "5mo after 2 long naps (11-1, 2:30-4)",
    ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 19*60,
    completedNaps: [{ start: 11*60, end: 13*60 }, { start: 14*60+30, end: 16*60 }] },
  { category: "Mid-day projection", name: "7mo 1 nap done (10am-12pm)",
    ageWeeks: 30, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60,
    completedNaps: [{ start: 10*60, end: 12*60 }] },

  // ═══════════════════════════════════════════════════════════════
  //  ACTIVE NAP IN PROGRESS
  // ═══════════════════════════════════════════════════════════════
  { category: "Active nap", name: "5mo nap on (started 1pm)",
    ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 19*60,
    napOnFirstStart: 13*60 },
  { category: "Active nap", name: "7mo nap on (started 10am)",
    ageWeeks: 30, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60,
    napOnFirstStart: 10*60 },

  // ═══════════════════════════════════════════════════════════════
  //  INCONSISTENT LOGGING — not every parent logs every event
  // ═══════════════════════════════════════════════════════════════
  { category: "Inconsistent logging", name: "5mo wake only (no naps logged yet)",
    ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 19*60 },
  { category: "Inconsistent logging", name: "5mo one mystery nap (2h-3:30pm, none earlier)",
    ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 19*60,
    completedNaps: [{ start: 14*60, end: 15*60+30 }] },
  { category: "Inconsistent logging", name: "3mo only evening nap logged",
    ageWeeks: 12, wakeMins: 7*60, avgNapDur: 60, targetBedMins: 19*60,
    completedNaps: [{ start: 17*60, end: 17*60+45 }],
    // Parent logged only 1 nap out of ~4 typical for a 3mo. Engine honestly
    // reflects the partial data: low total nap (45m) and low 24h sleep
    // (12h45m). Both I-10 and I-15 WARN fire correctly. This tests that the
    // engine doesn't hallucinate missing naps — if a parent forgets to log,
    // we report honestly instead of inventing data. Expected warnings.
    expectedWarnings: ["I-10", "I-15"] },

  // ═══════════════════════════════════════════════════════════════
  //  AGE BOUNDARY TRANSITIONS — where nap count changes
  // ═══════════════════════════════════════════════════════════════
  { category: "Age boundary", name: "Just-6wk (nap count 5→4)", ageWeeks: 6, wakeMins: 7*60, avgNapDur: 50, targetBedMins: 20*60 },
  { category: "Age boundary", name: "13wk exact (bedtime lo 5pm→6pm)", ageWeeks: 13, wakeMins: 7*60, avgNapDur: 60, targetBedMins: 19*60 },
  { category: "Age boundary", name: "Exactly 5mo (3-nap start)", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 19*60 },
  { category: "Age boundary", name: "30wk exact (3→2 nap transition)", ageWeeks: 30, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60 },
  { category: "Age boundary", name: "65wk (2→1 nap transition)", ageWeeks: 65, wakeMins: 7*60, avgNapDur: 120, targetBedMins: 19*60+30 },
  { category: "Age boundary", name: "78wk (confirmed 1-nap)", ageWeeks: 78, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60+30 },

  // ═══════════════════════════════════════════════════════════════
  //  EDGE CASES & STRESS TESTS
  // ═══════════════════════════════════════════════════════════════
  { category: "Edge case", name: "0wk exactly", ageWeeks: 0, wakeMins: 9*60, avgNapDur: 30, targetBedMins: 22*60 },
  { category: "Edge case", name: "Very late bed 10pm for newborn", ageWeeks: 2, wakeMins: 9*60, avgNapDur: 30, targetBedMins: 22*60 },
  { category: "Edge case", name: "5mo no target bed (engine chooses)", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: null },
  { category: "Edge case", name: "5mo 10m micro-nap avg", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 10, targetBedMins: 19*60 },
  { category: "Edge case", name: "5mo absurd 5h nap avg (should clamp)", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 300, targetBedMins: 19*60 },
  { category: "Edge case", name: "Unknown age (null weeks)", ageWeeks: null, wakeMins: 7*60, avgNapDur: 60, targetBedMins: 19*60 },

  // ═══════════════════════════════════════════════════════════════
  //  REAL PARENT PATTERNS — stuff mums actually do
  // ═══════════════════════════════════════════════════════════════
  { category: "Real parent", name: "Working-mum cap: morning drop-off forces late nap", ageWeeks: 22, wakeMins: 6*60+30, avgNapDur: 75, targetBedMins: 19*60,
    completedNaps: [{ start: 11*60, end: 12*60+15 }] },
  { category: "Real parent", name: "Bedshare mum: baby naps on chest, no start logged",
    ageWeeks: 16, wakeMins: 7*60+30, avgNapDur: 45, targetBedMins: 19*60 },
  { category: "Real parent", name: "Car nap accident: 5pm 20m catnap",
    ageWeeks: 30, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60,
    completedNaps: [{ start: 10*60, end: 11*60+30 }, { start: 14*60, end: 15*60+15 }, { start: 17*60, end: 17*60+20 }] },
  { category: "Real parent", name: "Missed wake log: 10am first activity",
    ageWeeks: 22, wakeMins: 10*60, avgNapDur: 75, targetBedMins: 19*60 }, // clamped to 9:30
  { category: "Real parent", name: "DST forward spring: 6am becomes 7am",
    ageWeeks: 22, wakeMins: 6*60, avgNapDur: 75, targetBedMins: 19*60 },
  { category: "Real parent", name: "DST backward fall: 8am feels like 7am",
    ageWeeks: 22, wakeMins: 8*60, avgNapDur: 75, targetBedMins: 19*60 },
  { category: "Real parent", name: "First-time mum over-logs: every 30min micro nap",
    ageWeeks: 6, wakeMins: 7*60, avgNapDur: 30, targetBedMins: 20*60,
    completedNaps: [{ start: 7*60+45, end: 8*60+15 }, { start: 9*60, end: 9*60+30 }, { start: 10*60+30, end: 11*60 }] },
  { category: "Real parent", name: "Overtired bed at 8:30pm",
    ageWeeks: 22, wakeMins: 7*60, avgNapDur: 75, targetBedMins: 20*60+30 }, // clamped to 8pm for 5mo

  // ═══════════════════════════════════════════════════════════════
  //  NAP TRANSITIONS (regression weeks)
  // ═══════════════════════════════════════════════════════════════
  { category: "Transition", name: "4-month regression — fragmented short naps",
    ageWeeks: 17, wakeMins: 6*60+30, avgNapDur: 35, targetBedMins: 19*60 },
  { category: "Transition", name: "8-10mo regression — nap refusal day",
    ageWeeks: 36, wakeMins: 6*60+45, avgNapDur: 45, targetBedMins: 19*60 },
  { category: "Transition", name: "12mo 2-1 transition — some days 2 naps, some 1",
    ageWeeks: 52, wakeMins: 7*60, avgNapDur: 120, targetBedMins: 19*60+30 },
];

// ─── Run audit ───────────────────────────────────────────────────────
let totalIssues = 0;
let criticalIssues = 0;
let warnIssues = 0;
const byCategory = {};
const criticals = [];

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  OBUBBA SLEEP ENGINE AUDIT — real-life scenario matrix");
console.log("═══════════════════════════════════════════════════════════════\n");

for (const scenario of scenarios) {
  // If scenario has override, simulate applyScheduleAdjustment clamping first
  let effectiveTargetBed = scenario.targetBedMins;
  if (scenario.override) {
    const clamped = applyScheduleOverride(scenario.override.wake, scenario.override.bed, scenario.ageWeeks);
    if (clamped.bed != null) effectiveTargetBed = clamped.bed;
  }
  // Also clamp wake
  let effectiveWake = scenario.wakeMins != null ? clampWake(scenario.wakeMins) : scenario.wakeMins;

  const plan = projectDayPlan({
    ageWeeks: scenario.ageWeeks,
    wakeMins: effectiveWake,
    avgNapDur: scenario.avgNapDur,
    targetBedMins: effectiveTargetBed,
    disruptionMode: scenario.disruptionMode,
    completedNaps: scenario.completedNaps,
    napOnFirstStart: scenario.napOnFirstStart,
  });

  const rawIssues = checkInvariants({ ...scenario, wakeMins: effectiveWake, targetBedMins: effectiveTargetBed }, plan);
  // Expected warnings: scenarios can declare which WARN codes are intentional
  // (edge cases deliberately tested, not engine bugs). Filter them out before
  // counting so they stop adding noise to the summary. Any unexpected NEW
  // warning will still show up — the expected list is exact-match per code.
  const expected = scenario.expectedWarnings || [];
  const isExpected = (issue) => {
    if (!issue.includes("WARN")) return false;
    return expected.some(code => issue.includes("[" + code + " "));
  };
  const issues = rawIssues.filter(i => !isExpected(i));
  const criticalHits = issues.filter(i => i.includes("CRITICAL"));
  const warnHits = issues.filter(i => i.includes("WARN"));
  const otherHits = issues.filter(i => !i.includes("CRITICAL") && !i.includes("WARN"));

  const status = criticalHits.length > 0 ? "🚨 CRIT"
               : otherHits.length > 0   ? "⚠️  WARN"
               : warnHits.length > 0    ? "💡 INFO"
               : "✅ PASS";

  byCategory[scenario.category] = byCategory[scenario.category] || { pass: 0, warn: 0, crit: 0 };
  if (criticalHits.length) byCategory[scenario.category].crit++;
  else if (otherHits.length) byCategory[scenario.category].warn++;
  else byCategory[scenario.category].pass++;

  if (criticalHits.length === 0 && otherHits.length === 0 && warnHits.length === 0) {
    // Silent pass — don't print every single PASS, only summary
  } else {
    console.log(`${status}  [${scenario.category}] ${scenario.name}`);
    console.log(`       wake ${mtp(scenario.wakeMins)} (→${mtp(plan.items.find(i=>i.type==="wake").time)}), avgNap ${scenario.avgNapDur}m, targetBed ${effectiveTargetBed != null ? mtp(effectiveTargetBed) : "(none)"}${scenario.disruptionMode ? ", teething" : ""}${scenario.completedNaps ? `, ${scenario.completedNaps.length} logged` : ""}${scenario.napOnFirstStart ? ", nap on" : ""}`);
    const line = plan.items.map(i => {
      if (i.type === "wake") return `☀️ ${mtp(i.time)}`;
      if (i.type === "nap") return i.active ? `💤 ${mtp(i.start)}-${mtp(i.end)}` : `😴 ${mtp(i.start)}-${mtp(i.end)}`;
      if (i.type === "bed") return `🌙 ${mtp(i.time)}`;
    }).join("  →  ");
    console.log(`       ${line}`);
    issues.forEach(i => console.log(`       ${i}`));
    console.log();
  }

  totalIssues += issues.length;
  if (criticalHits.length) {
    criticalIssues++;
    criticals.push({ scenario: scenario.name, category: scenario.category, issues: criticalHits });
  }
  warnIssues += warnHits.length;
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  SUMMARY BY CATEGORY");
console.log("═══════════════════════════════════════════════════════════════");
Object.entries(byCategory).forEach(([cat, counts]) => {
  const total = counts.pass + counts.warn + counts.crit;
  console.log(`  ${counts.crit ? "🚨" : counts.warn ? "⚠️" : "✅"}  ${cat.padEnd(25)}  ${counts.pass}/${total} pass${counts.warn ? `, ${counts.warn} warn` : ""}${counts.crit ? `, ${counts.crit} CRIT` : ""}`);
});

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`  ${scenarios.length} scenarios run`);
console.log(`  ${totalIssues} total issues`);
console.log(`  ${criticalIssues} CRITICAL scenarios`);
console.log(`  ${warnIssues} soft warnings`);
console.log("═══════════════════════════════════════════════════════════════\n");

if (criticals.length) {
  console.log("CRITICAL FAILURES (must fix before launch):\n");
  criticals.forEach(c => {
    console.log(`  🚨 [${c.category}] ${c.scenario}`);
    c.issues.forEach(i => console.log(`     ${i}`));
    console.log();
  });
}

// ═══════════════════════════════════════════════════════════════
// CONSULTANT SIMULATIONS — age, nap duration, nap timing, bedtime
// ═══════════════════════════════════════════════════════════════
// These scenarios sit above raw invariants. They check whether the plan feels
// sleep-consultant sensible for parents: no abrupt transition drops, no tiny
// babies pushed far past max wake windows, no late naps hidden without review.
const consultantSimulations = [
  { category: "Newborn", name: "2w newborn, frequent short naps, late bedtime", ageWeeks: 2, wakeMins: 8*60, avgNapDur: 40, targetBedMins: 21*60, expectedProfileNaps: 5 },
  { category: "Newborn", name: "6w circadian forming, 50m naps", ageWeeks: 6, wakeMins: 7*60+30, avgNapDur: 50, targetBedMins: 20*60, expectedProfileNaps: 4 },
  { category: "Young baby", name: "3mo catnap day, early bedtime target", ageWeeks: 12, wakeMins: 7*60, avgNapDur: 25, targetBedMins: 19*60 },
  { category: "Young baby", name: "5mo short-nap day, 30m naps", ageWeeks: 22, wakeMins: 7*60, avgNapDur: 30, targetBedMins: 19*60, expectedProfileNaps: 3 },
  { category: "Young baby", name: "6mo teething mode, shorter wake windows", ageWeeks: 26, wakeMins: 7*60, avgNapDur: 45, targetBedMins: 18*60+30, disruptionMode: true },
  { category: "Transition", name: "7mo 3-to-2 transition keeps optional 3rd nap", ageWeeks: 30, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60, expectedProfileNaps: 3 },
  { category: "Crawler", name: "9mo stable 2-nap day", ageWeeks: 39, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60, expectedProfileNaps: 2 },
  { category: "Crawler", name: "12mo late wake, 2-nap pressure test", ageWeeks: 52, wakeMins: 9*60, avgNapDur: 90, targetBedMins: 19*60+30, expectedProfileNaps: 2 },
  { category: "Toddler", name: "15mo 2-to-1 transition keeps optional 2nd nap", ageWeeks: 65, wakeMins: 7*60, avgNapDur: 120, targetBedMins: 19*60+30, expectedProfileNaps: 2 },
  { category: "Toddler", name: "18mo confirmed 1-nap day", ageWeeks: 78, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60+30, expectedProfileNaps: 1 },
  { category: "Toddler", name: "2y solid single nap", ageWeeks: 104, wakeMins: 7*60, avgNapDur: 90, targetBedMins: 19*60+30, expectedProfileNaps: 1 },
];

const consultantFailures = [];
const consultantFlags = [];

function consultantRecord(kind, sim, msg, plan) {
  const line = plan.items.map(i => {
    if (i.type === "wake") return `wake ${mtp(i.time)}`;
    if (i.type === "nap") return `${i.label || "nap"} ${mtp(i.start)}-${mtp(i.end)}`;
    if (i.type === "bed") return `bed ${mtp(i.time)}`;
    return "";
  }).filter(Boolean).join(" -> ");
  const entry = { category: sim.category, name: sim.name, msg, line };
  if (kind === "failure") consultantFailures.push(entry);
  else consultantFlags.push(entry);
}

for (const sim of consultantSimulations) {
  const effectiveWake = sim.wakeMins != null ? clampWake(sim.wakeMins) : sim.wakeMins;
  const plan = projectDayPlan({
    ageWeeks: sim.ageWeeks,
    wakeMins: effectiveWake,
    avgNapDur: sim.avgNapDur,
    targetBedMins: sim.targetBedMins,
    disruptionMode: sim.disruptionMode,
    completedNaps: sim.completedNaps || [],
    napOnFirstStart: sim.napOnFirstStart,
  });
  const profile = getAgeNapProfile(sim.ageWeeks);
  const ww = getWakeWindow(sim.ageWeeks);
  const issues = checkInvariants({ ...sim, wakeMins: effectiveWake }, plan);
  const criticalHits = issues.filter(i => i.includes("CRITICAL"));
  if (criticalHits.length) {
    criticalHits.forEach(i => consultantRecord("failure", sim, i, plan));
  }

  if (sim.expectedProfileNaps != null && profile.expectedNaps !== sim.expectedProfileNaps) {
    consultantRecord("failure", sim, `Expected profile ${sim.expectedProfileNaps} naps, got ${profile.expectedNaps}`, plan);
  }

  const naps = plan.items.filter(i => i.type === "nap");
  const bed = plan.items.find(i => i.type === "bed");
  const wake = plan.items.find(i => i.type === "wake");
  const lastNapEnd = naps.length ? naps[naps.length - 1].end : wake.time;
  const finalWW = bed.time - lastNapEnd;
  const tolerance = sim.ageWeeks < 13 ? 30 : sim.ageWeeks < 52 ? 45 : 60;

  if (naps.length && finalWW > ww.max + tolerance) {
    consultantRecord("flag", sim, `Final wake window ${hm(finalWW)} exceeds age max ${hm(ww.max)} by >${tolerance}m. Review bridge nap or earlier bedtime copy.`, plan);
  }
  if (sim.avgNapDur <= 35 && naps.length && finalWW > ww.max + 15) {
    consultantRecord("flag", sim, `Catnap day ends with ${hm(finalWW)} final wake window. Parent-facing advice should mention rescue nap or earlier bedtime.`, plan);
  }
  if (sim.ageWeeks >= 39) {
    const lateNap = naps.find(n => n.start >= 17*60+30 && !n.bridge);
    if (lateNap) {
      consultantRecord("flag", sim, `Late nap starts at ${mtp(lateNap.start)} for an older baby/toddler. Make sure UI explains this as a pressure-test day, not a default routine.`, plan);
    }
  }
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  CONSULTANT SIMULATIONS — age × naps × bedtime");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`  ${consultantSimulations.length} scenarios run`);
console.log(`  Hard failures:       ${consultantFailures.length}`);
console.log(`  Review flags:        ${consultantFlags.length}`);
if (consultantFailures.length) {
  console.log("\n  Hard failures:");
  consultantFailures.forEach(f => console.log(`    🚨 [${f.category}] ${f.name}: ${f.msg} | ${f.line}`));
}
if (consultantFlags.length) {
  console.log("\n  Review flags:");
  consultantFlags.slice(0, 12).forEach(f => console.log(`    ⚠️  [${f.category}] ${f.name}: ${f.msg} | ${f.line}`));
  if (consultantFlags.length > 12) console.log(`    … and ${consultantFlags.length - 12} more`);
}
console.log("═══════════════════════════════════════════════════════════════\n");

// ═══════════════════════════════════════════════════════════════
// COMBINATORIAL SWEEP — exhaust every age × wake × nap-duration × bedtime
// ═══════════════════════════════════════════════════════════════
// The scenario matrix above is hand-picked real-life cases. This sweep
// walks every plausible input combination and asserts INVARIANTS that must
// hold regardless of input. Finds: age-boundary glitches, off-by-one in the
// WW blending, NaN producers, nap-count/duration mismatches, and so on.
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  COMBINATORIAL SWEEP — every age × wake × nap pattern");
console.log("═══════════════════════════════════════════════════════════════\n");

const _sweepFailures = [];
const _sweepWarns = [];
let _sweepTotal = 0;

function _sweepFail(bucket, msg, ctx) {
  const entry = { bucket, msg, ctx };
  if (_sweepFailures.length < 200) _sweepFailures.push(entry);
}
function _sweepWarn(bucket, msg, ctx) {
  if (_sweepWarns.length < 100) _sweepWarns.push({ bucket, msg, ctx });
}

// ─── Audit 1: raw helper outputs across every age in weeks ──────────────
for (let aw = 0; aw <= 156; aw++) { // 0 → 3 years
  const ww = getWakeWindow(aw);
  const np = getAgeNapProfile(aw);

  if (typeof ww.min !== "number" || typeof ww.max !== "number" || typeof ww.midpoint !== "number") {
    _sweepFail("getWakeWindow", "non-numeric field", { aw, ww });
  }
  if (isNaN(ww.min) || isNaN(ww.max) || isNaN(ww.midpoint)) {
    _sweepFail("getWakeWindow", "NaN field", { aw, ww });
  }
  if (ww.min <= 0 || ww.max <= 0) {
    _sweepFail("getWakeWindow", "non-positive WW", { aw, ww });
  }
  if (ww.min > ww.max) {
    _sweepFail("getWakeWindow", "min > max", { aw, ww });
  }
  if (ww.midpoint < ww.min || ww.midpoint > ww.max) {
    _sweepFail("getWakeWindow", "midpoint outside [min,max]", { aw, ww });
  }
  if (typeof ww.label !== "string" || ww.label.length === 0) {
    _sweepFail("getWakeWindow", "missing label", { aw, ww });
  }

  // Nap profile invariants
  if (typeof np.expectedNaps !== "number" || np.expectedNaps < 0 || np.expectedNaps > 6) {
    _sweepFail("getAgeNapProfile", "bad expectedNaps", { aw, np });
  }
  if (np.idealNapDurMin > np.idealNapDurMax) {
    _sweepFail("getAgeNapProfile", "dur min > max", { aw, np });
  }
  if (np.idealTotalMin > np.idealTotalMax) {
    _sweepFail("getAgeNapProfile", "total min > max", { aw, np });
  }
  if (np.idealNapDurMin <= 0 || np.idealTotalMin < 0) {
    _sweepFail("getAgeNapProfile", "non-positive duration", { aw, np });
  }
  // Sanity: if you take every nap at max duration you shouldn't exceed total max by >2x
  const _maxBudget = np.expectedNaps * np.idealNapDurMax;
  if (np.expectedNaps > 0 && _maxBudget < np.idealTotalMin) {
    _sweepFail("getAgeNapProfile", "expectedNaps × idealNapDurMax < idealTotalMin (impossible to hit target)", { aw, np });
  }
  _sweepTotal++;
}

// ─── Audit 2: age-to-age transitions never jolt WW by more than 30 min ──
// A tiny week-to-week change shouldn't flip wake window by 60+ minutes —
// that'd be a transition cliff that surprises the prediction engine.
let _prevWW = null;
for (let aw = 0; aw <= 156; aw++) {
  const ww = getWakeWindow(aw);
  if (_prevWW) {
    const dMin = Math.abs(ww.min - _prevWW.min);
    const dMax = Math.abs(ww.max - _prevWW.max);
    // Age-boundary transitions use 2-week blending so a single week shouldn't jump >30min
    if (dMin > 30 || dMax > 60) {
      _sweepWarn("WW-transition", "week→week jump > 30/60 min (possible boundary cliff)", {
        aw, prev: _prevWW, now: ww, dMin, dMax
      });
    }
  }
  _prevWW = ww;
}

// ─── Audit 3: progressiveWW never returns NaN/negative, respects bounds ─
for (let aw = 2; aw <= 120; aw += 2) {
  for (let totalNaps = 1; totalNaps <= 5; totalNaps++) {
    for (let napIdx = 0; napIdx < totalNaps; napIdx++) {
      for (const disrupt of [false, true]) {
        const v = progressiveWW(aw, napIdx, totalNaps, disrupt);
        if (typeof v !== "number" || isNaN(v)) {
          _sweepFail("progressiveWW", "NaN/non-number", { aw, napIdx, totalNaps, disrupt, v });
        }
        if (v <= 0) _sweepFail("progressiveWW", "non-positive", { aw, napIdx, totalNaps, disrupt, v });
        if (v > 720) _sweepFail("progressiveWW", "absurd value > 12h", { aw, napIdx, totalNaps, disrupt, v });
        _sweepTotal++;
      }
    }
  }
}

// ─── Audit 4: defensive guard — NaN/undefined/null age doesn't crash ────
for (const bad of [null, undefined, NaN, -1, -10, "abc", {}]) {
  try {
    const ww = getWakeWindow(bad);
    if (!ww || typeof ww.min !== "number" || isNaN(ww.min)) {
      _sweepFail("getWakeWindow-defensive", "bad input produced bad output", { bad, ww });
    }
  } catch (e) {
    _sweepFail("getWakeWindow-defensive", "threw: " + e.message, { bad });
  }
  try {
    const np = getAgeNapProfile(bad);
    if (!np || typeof np.expectedNaps !== "number" || isNaN(np.expectedNaps)) {
      _sweepFail("getAgeNapProfile-defensive", "bad input produced bad output", { bad, np });
    }
  } catch (e) {
    _sweepFail("getAgeNapProfile-defensive", "threw: " + e.message, { bad });
  }
  _sweepTotal += 2;
}

// ─── Audit 5: projectDayPlan invariant sweep ────────────────────────────
// For every plausible combination, the projected plan must have:
//   • wake is first, bed is last
//   • all times in [0, 1440)
//   • nap starts after previous nap ends (for completed naps)
//   • no NaN times
for (let aw = 2; aw <= 120; aw += 4) {
  for (let wakeH = 5; wakeH <= 9; wakeH++) {
    for (const wakeM of [0, 30]) {
      const wakeMins = wakeH * 60 + wakeM;
      for (const avgNapDur of [30, 45, 60, 90, 120]) {
        for (const bedH of [18, 19, 20, 21]) {
          const targetBedMins = bedH * 60;
          for (const disrupt of [false, true]) {
            _sweepTotal++;
            let plan;
            try {
              plan = projectDayPlan({ ageWeeks: aw, wakeMins, avgNapDur, targetBedMins, disruptionMode: disrupt });
            } catch (e) {
              _sweepFail("projectDayPlan", "threw: " + e.message, { aw, wakeMins, avgNapDur, targetBedMins, disrupt });
              continue;
            }
            if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) {
              _sweepFail("projectDayPlan", "no items", { aw, wakeMins, avgNapDur, targetBedMins, disrupt });
              continue;
            }
            const first = plan.items[0];
            const last = plan.items[plan.items.length - 1];
            if (first.type !== "wake") _sweepFail("projectDayPlan", "first item not wake", { aw, wakeMins, avgNapDur, targetBedMins, first });
            if (last.type !== "bed")   _sweepFail("projectDayPlan", "last item not bed",   { aw, wakeMins, avgNapDur, targetBedMins, last });
            // Every time field is a sane number
            plan.items.forEach((it, i) => {
              const t = it.time != null ? it.time : (it.start != null ? it.start : null);
              if (t == null || typeof t !== "number" || isNaN(t) || t < 0 || t >= 1440) {
                _sweepFail("projectDayPlan", "invalid time field", { aw, wakeMins, avgNapDur, targetBedMins, i, it });
              }
              if (it.type === "nap") {
                if (typeof it.end !== "number" || isNaN(it.end)) {
                  _sweepFail("projectDayPlan", "nap end NaN", { aw, wakeMins, avgNapDur, targetBedMins, i, it });
                } else if (it.end < it.start) {
                  // Allow cross-midnight wrap for end, but only if end+1440 > start and end < 360
                  if (!(it.end < 360 && it.start >= 360)) {
                    _sweepFail("projectDayPlan", "nap end before start", { aw, wakeMins, avgNapDur, targetBedMins, i, it });
                  }
                }
              }
            });
            // Naps in order (no overlap)
            const naps = plan.items.filter(i => i.type === "nap");
            for (let i = 1; i < naps.length; i++) {
              if (naps[i].start < naps[i-1].end && !(naps[i].start < 360 && naps[i-1].end >= 360)) {
                _sweepFail("projectDayPlan", "nap overlaps previous", { aw, wakeMins, avgNapDur, targetBedMins, naps });
                break;
              }
            }
          }
        }
      }
    }
  }
}

// ─── Report ─────────────────────────────────────────────────────────────
console.log(`  Combinations tested: ${_sweepTotal}`);
console.log(`  Hard failures:       ${_sweepFailures.length}`);
console.log(`  Warnings:            ${_sweepWarns.length}`);

if (_sweepFailures.length > 0) {
  // Group by bucket for readability
  const byBucket = {};
  _sweepFailures.forEach(f => { byBucket[f.bucket] = (byBucket[f.bucket] || []); byBucket[f.bucket].push(f); });
  console.log("\n  Failure buckets:");
  Object.entries(byBucket).forEach(([b, arr]) => {
    console.log(`    🚨 ${b}: ${arr.length}`);
    // Show first 3 examples per bucket
    arr.slice(0, 3).forEach(f => {
      console.log(`       - ${f.msg} | ${JSON.stringify(f.ctx).slice(0, 200)}`);
    });
    if (arr.length > 3) console.log(`       … and ${arr.length - 3} more`);
  });
}

if (_sweepWarns.length > 0 && _sweepFailures.length === 0) {
  const byBucket = {};
  _sweepWarns.forEach(f => { byBucket[f.bucket] = (byBucket[f.bucket] || []); byBucket[f.bucket].push(f); });
  console.log("\n  Warning buckets:");
  Object.entries(byBucket).forEach(([b, arr]) => {
    console.log(`    ⚠️  ${b}: ${arr.length}`);
    arr.slice(0, 3).forEach(f => {
      console.log(`       - ${f.msg} | ${JSON.stringify(f.ctx).slice(0, 200)}`);
    });
    if (arr.length > 3) console.log(`       … and ${arr.length - 3} more`);
  });
}

console.log("═══════════════════════════════════════════════════════════════\n");

// Non-zero exit on hard failures so CI / npm test catches them
if (_sweepFailures.length > 0 || criticals.length > 0 || consultantFailures.length > 0) process.exit(1);

process.exit(criticalIssues > 0 || consultantFailures.length > 0 ? 1 : 0);
