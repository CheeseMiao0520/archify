// Review: how this run's findings relate to what the team already decided
// (the baseline) and to the previous run (the comparison). Both rely on the
// stable finding id; the evidence digest tells "same problem, same code" from
// "same problem, code changed since".
//
// Baseline file (`--baseline`), kept in the repository and reviewed like code:
//   { "schema_version": 1,
//     "accepted": [{ "id": "COMP-…", "code": "complexity/function",
//                    "reason": "main loop; split after the 2.0 release",
//                    "sha256": "<evidenceDigest.sha256 when accepted>" }] }
//
// Per finding the review status is
//   open             not in the baseline
//   accepted         in the baseline, evidence unchanged (or no digest recorded)
//   accepted-changed in the baseline, but its evidence changed since: re-review
// Baseline entries whose finding no longer occurs are reported as stale: the
// problem was fixed or moved, and the entry can be removed.
//
// Comparison with the previous run's findings.json lists findings that are
// new, fixed (gone), and evidence-changed. A run without a previous result has
// no comparison rather than "everything is new".
import { fail } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

export function validateBaseline(doc, file = null) {
  const errors = schemaErrors('baseline', doc);
  if (errors.length) fail('baseline/invalid', `The baseline${file ? ` ${file}` : ''} does not match baseline.schema.json.`, {
    subject: { file }, evidence: { errors: errors.slice(0, 20) },
    supportedFixes: ['fix the listed fields', 'regenerate it with `archify code-analysis check --update-baseline`'],
  });
  return doc;
}

export function reviewFindings(diagnostics, { baseline = null, previous = null } = {}) {
  const accepted = new Map((baseline?.accepted || []).map((entry) => [entry.id, entry]));
  const current = new Map(diagnostics.map((d) => [d.id, d]));
  const before = previous ? new Map((previous.diagnostics || []).map((d) => [d.id, d])) : null;

  const findings = {};
  for (const d of diagnostics) {
    const entry = accepted.get(d.id);
    const digest = d.evidenceDigest?.sha256 || null;
    const status = !entry ? 'open' : entry.sha256 && digest && entry.sha256 !== digest ? 'accepted-changed' : 'accepted';
    const prior = before ? before.get(d.id) : undefined;
    const since = !before ? null : !prior ? 'new' : (prior.evidenceDigest?.sha256 || null) !== digest ? 'evidence-changed' : 'unchanged';
    findings[d.id] = { status, ...(entry ? { reason: entry.reason } : {}), ...(since ? { since } : {}) };
  }

  const ids = (filter) => diagnostics.filter(filter).map((d) => d.id).sort(compareText);
  return {
    schema_version: 1,
    baseline: baseline ? {
      entries: accepted.size,
      accepted: ids((d) => findings[d.id].status === 'accepted'),
      changed: ids((d) => findings[d.id].status === 'accepted-changed'),
      stale: [...accepted.values()].filter((e) => !current.has(e.id)).map((e) => ({ id: e.id, code: e.code, reason: e.reason })).sort((a, b) => compareText(a.id, b.id)),
    } : null,
    comparison: before ? {
      previousSnapshot: previous.repository?.snapshotId || null,
      new: ids((d) => findings[d.id].since === 'new'),
      evidenceChanged: ids((d) => findings[d.id].since === 'evidence-changed'),
      fixed: [...before.values()].filter((d) => !current.has(d.id)).map((d) => ({ id: d.id, code: d.code, severity: d.severity, message: d.message })).sort((a, b) => compareText(a.id, b.id)),
      unchanged: diagnostics.filter((d) => findings[d.id].since === 'unchanged').length,
    } : null,
    findings,
  };
}

// A finding counts against a gate unless it is accepted with unchanged evidence.
export function isOpen(review, id) {
  return !review || !review.findings[id] || review.findings[id].status !== 'accepted';
}

// A baseline that accepts every current finding. Reasons of entries that are
// still current are kept; new entries get `reason`. Stale entries are dropped.
export function baselineFrom(diagnostics, { existing = null, reason }) {
  const kept = new Map((existing?.accepted || []).map((e) => [e.id, e]));
  return {
    schema_version: 1,
    accepted: [...diagnostics].sort((a, b) => compareText(a.id, b.id)).map((d) => ({
      id: d.id, code: d.code,
      reason: kept.get(d.id)?.reason || reason,
      ...(d.evidenceDigest?.sha256 ? { sha256: d.evidenceDigest.sha256 } : {}),
    })),
  };
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
