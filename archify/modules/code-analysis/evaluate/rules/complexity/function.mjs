// Function complexity: functions whose cyclomatic complexity or block nesting
// reaches the configured thresholds. A high count is a maintenance signal (more
// paths to read and test), not a defect, so the strongest level is a warning.
// Function length is reported as evidence but never fires on its own.
//
// The rule runs only when the extractor measured functions (facts.functions is
// present; the Python adapter does, the JS/TS adapter does not yet). Otherwise
// it is left out of findings.rules and complexity is reported as not checked.
// Test and generated files follow the module graph's exclusion policy.
//
// Thresholds (defaults below) can be set in the config:
//   "rules": { "complexity": { "function": { "info": { "complexity": 15, "nesting": 5 },
//                                            "warning": { "complexity": 25, "nesting": 6 } } } }
// The defaults follow the common radon grading (C from 11, D from 21, E from
// 31): info starts inside C, warning inside D. On a 180-file Python project
// they flag about 6% of functions, a quarter of those as warnings.
export const code = 'complexity/function';
export const dimension = 'complexity';
export const severity = 'warning';
export const confidence = 1;

export const DEFAULTS = { info: { complexity: 15, nesting: 5 }, warning: { complexity: 25, nesting: 6 } };

export function enabled(config, facts) {
  return Boolean(facts && Array.isArray(facts.functions));
}

export function thresholds(config) {
  const custom = config?.rules?.complexity?.function || {};
  return {
    info: { ...DEFAULTS.info, ...(custom.info || {}) },
    warning: { ...DEFAULTS.warning, ...(custom.warning || {}) },
  };
}

export function run({ graph, config, facts }) {
  if (!enabled(config, facts)) return [];
  const limits = thresholds(config);
  const excluded = new Set(graph.excluded.roles || []);
  const skip = new Set(facts.files.filter((f) => excluded.has(f.role)).map((f) => f.path));
  const reaches = (fn, level) => fn.complexity >= limits[level].complexity || fn.nesting >= limits[level].nesting;
  return facts.functions
    .filter((fn) => !skip.has(fn.file) && reaches(fn, 'info'))
    .sort((a, b) => b.complexity - a.complexity || b.nesting - a.nesting || compareText(a.file, b.file) || a.line - b.line)
    .map((fn) => {
      const level = reaches(fn, 'warning') ? 'warning' : 'info';
      const length = fn.endLine - fn.line + 1;
      const why = [
        fn.complexity >= limits[level].complexity ? `cyclomatic complexity ${fn.complexity}` : null,
        fn.nesting >= limits[level].nesting ? `nesting depth ${fn.nesting}` : null,
      ].filter(Boolean).join(' and ');
      return {
        code, dimension, severity: level, confidence,
        message: `${fn.qualname} in ${fn.file} has ${why} (${length} lines). More independent paths make it harder to read and to test fully; this is a maintenance signal, not a defect.`,
        subject: { file: fn.file, function: fn.qualname, line: fn.line, endLine: fn.endLine },
        evidence: {
          threshold: limits[level],
          complexity: fn.complexity,
          nesting: fn.nesting,
          deepestLine: fn.deepestLine,
          length,
        },
        supportedFixes: [
          'start at the deepest nested block: extract it into a named helper with its own tests',
          'replace long if/elif chains on one value with a lookup table or dispatch',
          'return early for edge cases so the main path is not nested',
          'if the branching is inherent, raise the threshold in the analysis config rather than splitting artificially',
        ],
      };
    });
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
