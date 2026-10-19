import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { publicGuideData, SCENARIO_RECIPES, startPromptsFor } from '../../archify/recipes/scenarios.mjs';

const root = process.env.ARCHIFY_SITE_ROOT || fileURLToPath(new URL(process.env.ARCHIFY_SITE_TARGET === 'cloudflare' ? '../dist-cloudflare/' : '../dist/', import.meta.url));
const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare' || path.basename(root) === 'dist-cloudflare';
const recipes = publicGuideData();
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const find = (node, id) => attr(node, 'id') === id ? node : (node.childNodes || []).map(child => find(child, id)).find(Boolean);
const text = node => node?.nodeName === '#text' ? node.value : ['script', 'style'].includes(node?.tagName) ? '' : (node?.childNodes || []).map(text).join(' ');
const clean = value => value.replace(/\s+/g, ' ').trim();
const read = (page, lang) => parse(fs.readFileSync(path.join(root, lang === 'zh' && page !== 'index' ? 'zh' : '', `${lang === 'zh' && page === 'index' ? 'zh' : page}.html`), 'utf8'));
const byClass = (node, name) => [...((attr(node, 'class') || '').split(/\s+/).includes(name) ? [node] : []), ...(node.childNodes || []).flatMap(child => byClass(child, name))];
const byTag = (node, tag) => node.tagName === tag ? node : (node.childNodes || []).map(child => byTag(child, tag)).find(Boolean);
function assertProofLink(page, link, lang, proof) {
  const documentUrl = new URL(`${lang === 'zh' ? 'zh/' : ''}guide${cloudflare ? '' : '.html'}`, cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/');
  const base = new URL(attr(byTag(page, 'base'), 'href'), documentUrl);
  const expectedBase = cloudflare ? '/' : '/archify/';
  assert.equal(base.pathname, expectedBase, 'proof links resolve against the deployment base');
  const actual = new URL(attr(link, 'href'), base);
  assert.equal(actual.origin, documentUrl.origin);
  assert.equal(actual.pathname, `${expectedBase}${lang === 'zh' ? 'zh/' : ''}gallery${cloudflare ? '' : '.html'}`);
  assert.equal(actual.search, '');
  assert.equal(actual.hash, `#proof-${proof}`);
}
const links = node => [...(node.tagName === 'a' ? [node] : []), ...(node.childNodes || []).flatMap(links)];

for (const lang of ['en', 'zh']) {
  test(`initial ${lang} guide HTML contains every canonical recipe and its evidence without JavaScript`, () => {
    const page = read('guide', lang);
    const reference = find(page, 'recipe-reference');
    const metrics = byClass(page, 'metric').map(node => clean(text(byTag(node, 'strong'))));
    assert.deepEqual(metrics, [String(recipes.length), String(new Set(recipes.map(recipe => recipe.type)).size), '0']);
    assert.ok(reference, 'a persistent reference section must survive chooser rendering');
    for (const recipe of recipes) {
      const article = find(reference, `recipe-${recipe.id}`);
      assert.ok(article, `stable recipe anchor ${recipe.id}`);
      const content = clean(text(article));
      for (const value of [recipe[lang].title, recipe[lang].question, recipe[lang].summary,
        recipe[lang].useWhen, recipe[lang].avoidWhen, recipe[lang].prompt, ...recipe[lang].include]) {
        assert.ok(content.includes(clean(value)), `${recipe.id}: missing initial ${lang} copy: ${value}`);
      }
      assert.ok(links(article).some(link => /github\.com\/tt-a1i\/archify\/blob\/(?:dev|main)\/archify\/recipes\/scenarios\.mjs$/.test(attr(link, 'href'))));
      if (recipe.proof) {
        const proofLink = links(article).find(link => new URL(attr(link, 'href'), 'https://example.test/').hash === `#proof-${recipe.proof}`);
        assert.ok(proofLink, `missing proof link for ${recipe.id}`);
        assertProofLink(page, proofLink, lang, recipe.proof);
      }
    }
  });
  test(`initial ${lang} gallery count reflects the current source inventory`, () => {
    const page = read('gallery', lang);
    const button = byClass(page, 'filter-button').find(node => attr(node, 'data-filter') === 'all');
    assert.equal(clean(text(button)), lang === 'zh' ? `全部配方 / ${CASES.length}` : `All / ${CASES.length}`);
  });
  test(`initial ${lang} start HTML contains a usable default prompt, evidence, install, and proof`, () => {
    const page = read('start', lang);
    const recipe = SCENARIO_RECIPES.find(item => item.id === 'system-overview');
    const data = JSON.parse(find(page, 'start-data').childNodes.map(node => node.value || '').join(''));
    const count = Object.keys(data).length;
    assert.equal(clean(text(byTag(find(page, 'type-label'), 'strong'))), lang === 'zh' ? `${count} 个入门配方` : `${count} starting recipes`);
    assert.equal(clean(text(find(page, 'recipe-question'))), clean(recipe[lang].question));
    assert.equal(clean(text(find(page, 'recipe-prompt'))), clean(startPromptsFor(recipe, lang).descriptionPrompt));
    for (const evidence of recipe[lang].include) assert.ok(clean(text(find(page, 'include-list'))).includes(clean(evidence)));
    assert.match(text(find(page, 'install-command')), /npx -y skills add tt-a1i\/archify --skill archify --agent codex --global --copy --yes/);
    assertProofLink(page, find(page, 'proof-link'), lang, recipe.proof);
  });
}
test('initial homepage product facts explain identity, inputs, delivery, license and limits', () => {
  const page = read('index', 'en');
  const section = find(page, 'about-archify');
  const content = clean(text(section));
  for (const fact of ['open-source Agent Skill', 'typed JSON', 'interactive HTML', 'Mermaid', 'MIT', 'Codex', 'PNG', 'runtime system behavior', 'stable main']) assert.ok(content.includes(fact), fact);
  const hrefs = links(section).map(link => attr(link, 'href'));
  assert.ok(hrefs.includes('https://github.com/tt-a1i/archify/releases'));
  assert.ok(hrefs.includes('https://github.com/tt-a1i/archify/blob/main/LICENSE'));
});

for (const lang of ['en', 'zh']) {
  test(`initial ${lang} pages distinguish supported types from selected recipes and use the release channel`, () => {
    const release = JSON.parse(fs.readFileSync(new URL('../../archify/skill-release.json', import.meta.url)));
    for (const name of ['index', 'guide', 'start']) {
      const inventory = clean(text(byClass(read(name, lang), 'supported-diagrams')[0]));
      for (const label of lang === 'zh' ? ['类图', '树图', '时间线', '瀑布图', '精选入门示例'] : ['Class', 'Tree', 'Timeline', 'Waterfall', 'selected starting points']) assert.ok(inventory.includes(label), `${name}: ${label}`);
    }
    for (const name of ['start', 'gallery']) {
      const footer = clean(text(byTag(read(name, lang), 'footer')));
      const channel = lang === 'zh' ? (release.channel === 'development' ? '开发版' : '稳定版') : release.channel;
      assert.ok(footer.includes(`v${release.version} · ${channel}`), `${name}: release identity`);
    }
  });
}

for (const lang of ['en', 'zh']) {
  test(`initial ${lang} homepage explains diagrams and one-page answers before JavaScript`, () => {
    const page = read('index', lang);
    const hero = byClass(page, 'hero-copy')[0];
    const heading = clean(text(byTag(hero, 'h1')));
    const lead = clean(text(byClass(hero, 'hero-sub')[0]));
    assert.match(heading, lang === 'zh' ? /图和答案/ : /answers/);
    for (const concept of lang === 'zh'
      ? ['AI Agent', '图', '解答', '结论', '出处', 'HTML', '校验']
      : ['AI agent', 'map', 'one-page answer', 'conclusion', 'sources', 'HTML', 'validated']) {
      assert.ok(lead.includes(concept), `hero must explain ${concept}`);
    }
    const identity = byClass(page, 'facts-identity')[0];
    const identityText = clean(text(identity));
    assert.ok(identityText.includes(lang === 'zh' ? '开源画图技能' : 'open-source diagram skill'));
    assert.deepEqual(links(identity).map(link => [clean(text(link)), attr(link, 'href')]), [
      ['archify.si', 'https://archify.si/'],
      ['tt-a1i/archify', 'https://github.com/tt-a1i/archify'],
    ], 'visible product identity connects the official site and exact source repository');
    const facts = clean(text(find(page, 'about-archify')));
    for (const boundary of lang === 'zh'
      ? ['类型化 JSON', 'Markdown', '系统的实际运行行为', '不用于生成照片或插画']
      : ['typed JSON', 'Markdown', 'not the truth of every claim or runtime system behavior', 'does not generate photos or illustrations']) {
      assert.ok(facts.includes(boundary), `product facts must explain ${boundary}`);
    }
  });
}

for (const lang of ['en', 'zh']) {
  test(`initial ${lang} gallery states its evidence limit and offers generic life-diagram starting points`, () => {
    const page = read('gallery', lang);
    const limit = clean(text(find(page, 'gallery-evidence-limit')));
    assert.ok(limit.includes(lang === 'zh' ? '不提供人工视觉评审结果' : 'not human visual-review results'));
    const description = (function walk(node) {
      return node.tagName === 'meta' && attr(node, 'name') === 'description' ? attr(node, 'content') : (node.childNodes || []).map(walk).find(Boolean);
    })(page);
    assert.ok(description.includes(lang === 'zh' ? '自动验证与人工视觉评审分别列出' : 'Automated validation and human visual review appear separately'));
    const cards = byClass(page, 'life-card').filter(card => links(card).some(link => (attr(link, 'class') || '').split(/\s+/).includes('create-link')));
    assert.equal(cards.length, 4);
    for (const [index, type] of ['workflow', 'lifecycle', 'dataflow', 'sequence'].entries()) {
      const entryLinks = links(cards[index]);
      const create = entryLinks.find(link => (attr(link, 'class') || '').split(/\s+/).includes('create-link'));
      assert.ok(create, `${type}: a next step is available without JavaScript`);
      assert.equal(clean(text(create)), lang === 'zh' ? '按此类型开始' : 'Create this type');
      assert.equal(attr(create, 'href'), `${lang === 'zh' ? 'zh/' : ''}start${cloudflare ? '' : '.html'}?type=${type}&input=description&source=gallery`);
      assert.ok(entryLinks.some(link => attr(link, 'href').endsWith(`.${type}.html?present=1`)), 'existing artifact remains accessible');
      assert.ok(entryLinks.some(link => attr(link, 'href').endsWith(`.${type}.json`)), 'existing source remains accessible');
    }
  });
}
