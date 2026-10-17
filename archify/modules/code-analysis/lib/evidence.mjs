// Evidence check: is what a task (or a finding) cites still what the working
// tree contains? Compares the analysis snapshot with the current files and
// reports, per location, per finding and for the whole task, one of
//   valid         the cited lines are unchanged (possibly moved; see currentStartLine)
//                 and the finding's evidence digest still matches
//   changed       the cited lines, or other code the finding depends on, changed
//   missing       a cited file no longer exists (deleted, renamed) under the root
//   unverifiable  the snapshot holds no text or range for it, or the file cannot be read
// Severity order for the roll-up: missing > changed > unverifiable > valid.
//
// Two levels are checked because they answer different questions. The
// location hash covers exactly the cited lines, so an unrelated edit above a
// function only moves it. The finding's evidenceDigest covers what the rule
// read (whole files for import findings, the function's lines for
// complexity), so an import added elsewhere in a cycle's files still marks
// the finding changed even when the cited import lines are intact.
//
// Paths come from a task file that may have been edited or shared: they are
// resolved inside `root` only (no absolute paths, no `..`, no symlink
// escapes). The check reads files; it never runs project code.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { rangeDigest, splitLines } from './task.mjs';

const RANK = { valid: 0, unverifiable: 1, changed: 2, missing: 3 };

export function worst(statuses) {
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'valid');
}

// Read a repository-relative file under root, or report why not.
export function readInside(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return { status: 'unverifiable', reason: 'path is not a plain repository-relative path' };
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return { status: 'unverifiable', reason: 'analysis root is not readable' }; }
  const target = path.resolve(realRoot, rel);
  if (!fs.existsSync(target)) return { status: 'missing', reason: 'file no longer exists' };
  let real;
  try { real = fs.realpathSync(target); } catch { return { status: 'unverifiable', reason: 'file cannot be resolved' }; }
  const relative = path.relative(realRoot, real);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { status: 'unverifiable', reason: 'file resolves outside the analysis root' };
  try {
    if (!fs.statSync(real).isFile()) return { status: 'missing', reason: 'path is no longer a file' };
    return { status: 'ok', text: fs.readFileSync(real, 'utf8') };
  } catch (error) { return { status: 'unverifiable', reason: `file cannot be read (${error.code || error.message})` }; }
}

// Python decodes a UTF-8 BOM away; Node keeps it. Hash both forms so the
// same bytes are recognized whichever extractor captured them.
function variants(text) {
  return text.charCodeAt(0) === 0xfeff ? [text, text.slice(1)] : [text];
}

// Check one location against the current lines of its file.
export function checkLocation(loc, current) {
  if (!loc.sha256 || !Number.isInteger(loc.startLine)) return { status: 'unverifiable', reason: loc.kind === 'file' ? 'no line evidence to compare' : 'source text was not captured' };
  if (current.status !== 'ok') return { status: current.status, reason: current.reason };
  const length = loc.endLine - loc.startLine + 1;
  for (const text of variants(current.text)) {
    const lines = splitLines(text);
    if (loc.endLine <= lines.length && rangeDigest(lines, loc.startLine, loc.endLine) === loc.sha256) return { status: 'valid' };
    // Moved: the same lines elsewhere in the file (code above was edited). Prefer the nearest match.
    const matches = [];
    for (let start = 1; start + length - 1 <= lines.length; start += 1) {
      if (rangeDigest(lines, start, start + length - 1) === loc.sha256) matches.push(start);
    }
    if (matches.length) {
      const start = matches.sort((a, b) => Math.abs(a - loc.startLine) - Math.abs(b - loc.startLine) || a - b)[0];
      return { status: 'valid', currentStartLine: start, currentEndLine: start + length - 1, reason: `unchanged, moved from line ${loc.startLine} to ${start}` };
    }
  }
  return { status: 'changed', reason: 'cited lines differ from the analysis snapshot' };
}

// Recompute a finding's evidenceDigest from the current files, the way
// evaluate/index.mjs computes it. `shift` maps a function span to where its
// unchanged lines are now. Returns true / false, or null when it cannot tell.
export function digestMatches(digest, readFile, shift = null) {
  if (!digest || !Array.isArray(digest.files)) return null;
  const span = Array.isArray(digest.lines) ? (shift || digest.lines) : null;
  const options = [];
  for (const f of digest.files) {
    const current = readFile(f);
    if (current.status !== 'ok') return current.status === 'missing' ? false : null;
    options.push(variants(current.text).map((text) => [f, sha256(span ? text.split(/\r?\n/).slice(span[0] - 1, span[1]).join('\n') : text)]));
  }
  // Try the with-BOM and without-BOM form of every file (almost always one form each).
  const combos = options.reduce((acc, list) => acc.flatMap((prefix) => list.map((part) => [...prefix, part])), [[]]);
  return combos.slice(0, 64).some((parts) => sha256(JSON.stringify(parts)) === digest.sha256);
}

// Returns a copy of the task with evidence status set from the current tree.
export function verifyTask(task, root, { now = new Date() } = {}) {
  const cache = new Map();
  const readFile = (rel) => { if (!cache.has(rel)) cache.set(rel, readInside(root, rel)); return cache.get(rel); };
  const locations = task.locations.map((loc) => {
    const { status: _s, reason: _r, currentStartLine: _c, currentEndLine: _e, ...base } = loc;
    const result = checkLocation(base, readFile(base.file));
    return { ...base, ...result };
  });
  const perFinding = {};
  for (const f of task.findings) {
    const own = locations.filter((l) => l.findingId === f.id);
    const located = own.filter((l) => l.status !== 'unverifiable');
    const fn = own.find((l) => l.kind === 'function' && l.currentStartLine);
    const matches = digestMatches(f.evidenceDigest, readFile, fn ? [fn.currentStartLine, fn.currentEndLine] : null);
    let status = located.length ? worst(located.map((l) => l.status)) : 'unverifiable';
    let reason = own.find((l) => l.status === status && l.reason)?.reason || null;
    if (status === 'valid' && matches === false) { status = 'changed'; reason = 'the cited lines are unchanged, but other code this finding was computed from changed; re-run the analysis to confirm it still applies'; }
    else if (!located.length && matches === true) { status = 'valid'; reason = 'the files this finding was computed from are unchanged'; }
    else if (!located.length && matches === false) { status = own.some((l) => readFile(l.file).status === 'missing') || f.evidenceDigest?.files?.some((x) => readFile(x).status === 'missing') ? 'missing' : 'changed'; reason = 'the files this finding was computed from changed'; }
    else if (status === 'valid' && matches === null) reason = f.evidenceDigest ? 'cited lines unchanged; the finding digest could not be recomputed' : 'cited lines unchanged; the finding has no evidence digest';
    perFinding[f.id] = { status, ...(reason ? { reason } : {}), digestMatches: matches };
  }
  const status = worst(Object.values(perFinding).map((f) => f.status));
  const counts = {};
  for (const l of locations) counts[l.status] = (counts[l.status] || 0) + 1;
  const reason = status === 'valid'
    ? 'Every cited location and evidence digest matches the current working tree.'
    : `${Object.entries(counts).filter(([s]) => s !== 'valid').map(([s, n]) => `${n} location${n === 1 ? '' : 's'} ${s}`).join(', ') || 'evidence digest changed'}; see each location.`;
  return { ...task, locations, evidence: { status, checkedAt: now.toISOString(), reason, findings: perFinding } };
}

function sha256(text) { return createHash('sha256').update(text).digest('hex'); }
