/** Independently authored prose hints; no external dictionary or automatic rewriting.
 * Callers select prose entries, excluding code and URL-only fields.
 * locale sets the sentence-limit fallback; bilingual phrase rules always apply.
 */
const RULES = [
  {id:'qualification', pattern:/示例|本例|不代表|未实测|仅供参考|\billustrative\b|\bnot measured\b/giu,
    reason:'把限定条件写进 scope 或来源', example:'@answer scope="适用于当前请求路径"', fix:'把限定条件写进 scope 或来源，正文直接解释判断和原因。'},
  {id: 'light-verb', pattern: /进行(?:分析|检查|确认)|\b(?:perform an analysis of|carry out an investigation of)\b/giu,
    reason: 'A light-verb construction can obscure the action.', example: '进行检查 → 检查; perform an analysis of → analyze', fix: 'Use the direct action verb where it preserves the meaning; name who performs the action.'},
  {id: 'cliche', pattern: /赋能业务|全方位提升|\b(?:at the end of the day|in today[’']s fast-paced world|unlock the full potential)\b/giu,
    reason: 'This stock phrase gives little information about the concrete outcome.', example: '赋能业务 → 让客服查到订单状态; unlock the full potential → state the specific outcome', fix: 'Replace the stock phrase with the specific action or outcome the reader needs.'},
  {id: 'vague-quantity', pattern: /大量(?:请求|用户|数据)|很多(?:请求|用户|数据)|\b(?:many users|a large number of requests|significantly faster)\b/giu,
    reason: 'The quantity or comparison lacks a stated bound or measurement.', example: '大量请求 → 写明已知请求量或说明未测量; significantly faster → give the measured comparison or say it is unmeasured', fix: 'Add a supported quantity, range or comparison basis; when unknown, state that it is unmeasured. Do not invent a number.'},
  {id: 'redundancy', pattern: /提前预先|重复重复|基本基础|\b(?:each and every|future plans|completely eliminate)\b/giu,
    reason: 'Adjacent wording may repeat the same meaning.', example: '提前预先 → 提前; each and every → each', fix: 'Keep one expression of the meaning unless both terms carry a necessary distinction.'},
];

// Mask URL bodies without changing offsets or swallowing trailing sentence punctuation.
function proseMask(text) {
  return text.replace(/https?:\/\/[^\s<>。！？，；、：）]+/giu, value => {
    // A Markdown link's closing parenthesis is outside the URL. Preserve that
    // delimiter and any following prose, while retaining balanced URL paths.
    let depth = 0, end = value.length;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') {
        if (depth === 0) { end = i; break; }
        depth--;
      }
    }
    const url = value.slice(0, end);
    const tail = url.match(/[.!?,;]+$/u)?.[0] || '';
    const maskedLength = url.length - tail.length;
    return ' '.repeat(maskedLength) + value.slice(maskedLength);
  });
}

function sentences(text) {
  const result = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const decimal = char === '.' && /\d/u.test(text[i - 1] || '') && /\d/u.test(text[i + 1] || '');
    const paragraph = char === '\n' && /^\s*\n/u.test(text.slice(i + 1));
    if ((/[.!?。！？]/u.test(char) && !decimal) || paragraph) {
      result.push({text: text.slice(start, i + 1), offset: start});
      start = i + 1;
    }
  }
  if (start < text.length) result.push({text: text.slice(start), offset: start});
  return result;
}

/**
 * @param {Array<{text:string,line:number,component:string,panelId?:string}>} entries
 * @param {{mode?:'warn'|'strict'|'off',locale?:string,sentenceLimits?:{zh?:number,en?:number}}} options
 * @returns {Array<object>} Existing Archify diagnostics (warning by default).
 * Length is Han characters plus English words/numeric tokens; punctuation is excluded.
 * A sentence containing Han uses zh limit (70), otherwise en limit (35).
 */
export function lintExplainerWriting(entries, {mode = 'warn', locale = 'auto', sentenceLimits = {}} = {}) {
  if (!['warn', 'strict', 'off'].includes(mode)) throw new TypeError('Writing mode must be warn, strict or off');
  if (mode === 'off') return [];
  const limits = {zh: 70, en: 35, ...sentenceLimits};
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Sentence limits must be positive integers');
  }
  const diagnostics = [];
  for (const entry of entries) {
    if (typeof entry.text !== 'string') throw new TypeError('Writing entries require text strings');
    if (['scope','source'].includes(entry.component)) continue;
    const original = entry.text;
    const text = proseMask(original);
    const found = [];
    for (const rule of RULES) {
      // New regex per entry prevents mutable lastIndex from leaking between calls.
      for (const match of text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
        found.push({offset: match.index, rule: rule.id, reason: rule.reason, example: rule.example, fix: rule.fix, matched: match[0]});
      }
    }
    for (const sentence of sentences(text)) {
      const han = sentence.text.match(/\p{Script=Han}/gu)?.length || 0;
      const words = sentence.text.match(/[\p{Script=Latin}\d]+(?:[’'_-][\p{Script=Latin}\d]+)*(?:\.\d+)?/gu)?.length || 0;
      const units = han + words;
      const language = han ? 'zh' : (words ? 'en' : (locale.startsWith('zh') ? 'zh' : 'en'));
      const limit = limits[language];
      if (units > limit) {
        const leading = sentence.text.search(/\S/u);
        found.push({offset: sentence.offset + Math.max(0, leading), rule: 'sentence-length',
          reason: `Sentence has ${units} reading units, above the configured ${language} limit of ${limit}.`,
          example: '先查缓存。未命中时再查数据库。 / Check the cache first. Query the database on a miss.',
          fix: 'Split at a logical action or condition boundary while preserving qualifications and causal links.', units, limit});
      }
    }
    found.sort((a, b) => a.offset - b.offset || a.rule.localeCompare(b.rule, 'en'));
    for (const item of found) {
      diagnostics.push({
        code: `explainer/writing-${item.rule}`, severity: mode === 'strict' ? 'error' : 'warning', message: item.reason,
        subject: {line: (Number.isInteger(entry.line) && entry.line > 0 ? entry.line : 1) + (original.slice(0, item.offset).match(/\n/gu)?.length || 0),
          component: entry.component, ...(entry.panelId === undefined ? {} : {panelId: entry.panelId})},
        evidence: {rule: item.rule, reason: item.reason, example: item.example,
          ...(item.matched ? {matched: item.matched} : {}), ...(item.units ? {units: item.units, limit: item.limit} : {})},
        supportedFixes: [item.fix],
      });
    }
  }
  return diagnostics;
}
