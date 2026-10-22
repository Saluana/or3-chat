// Repeatable Blank-theme capture: screenshots plus per-element computed-style snapshots.
//
//   Start the journey harness (any free port; set BLANK_AUDIT_BASE to match):
//     NUXT_SECRETS_PROVIDER= OR3_PRODUCTION_JOURNEY_TEST_HARNESS=true SSR_AUTH_ENABLED=false \
//     OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false OR3_STORAGE_ENABLED=false \
//     OR3_CLOUD_STORAGE_ENABLED=false OR3_BACKGROUND_STREAMING_ENABLED=false \
//     PW_PORT=3547 bun run dev -- --host 127.0.0.1 --port 3547
//   Then, from the repo root:
//     node audit-evidence/blank-consistency-20261021/harness/capture.mjs <outDir> [name,name…]
//
// Capture once on the base commit and once on your change into two directories, then run
// compose.mjs (side-by-side images), snapshot-diff.mjs (computed-style diff) and summary.mjs.
// Repeatable Blank-theme capture. Usage: node cap.mjs <outDir> [only-substring]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BLANK_AUDIT_BASE || 'http://127.0.0.1:3547';
const OUT = process.argv[2];
const ONLY = process.argv[3] || '';
const wanted = (name) => !ONLY || ONLY.split(',').some((o) => name.includes(o));
mkdirSync(OUT, { recursive: true });

const MARKDOWN = [
  '## Designing for clarity',
  '',
  'A good interface feels **calm**: one type scale, a few weights, and `inline code` that sits comfortably in a sentence. Read the [style notes](https://example.com) for more.',
  '',
  '### Principles',
  '- Keep a single type scale',
  '- Use *few* weights',
  '  - Nested items stay aligned',
  '- Let spacing do the grouping',
  '',
  '1. Measure first',
  '2. Change one thing at a time',
  '',
  '> A quote reads as secondary text and stays quieter than the body.',
  '',
  '| Token | Value | Use |',
  '| --- | --- | --- |',
  '| Caption | 12px | Help text |',
  '| Body | 14px | Controls |',
  '| Message | 16px | Reading |',
  '',
  '```ts',
  'export function scale(base: number) {',
  '  return [0.75, 0.875, 1, 1.25].map((step) => base * step);',
  '}',
  '```',
  '',
  'A closing paragraph checks the rhythm that follows a code block.',
].join('\n');

const initScript = ({ dark, md }) => {
  localStorage.setItem('activeTheme', 'blank');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  localStorage.setItem('nuxt-color-mode', dark ? 'dark' : 'light');
  // Wrap whatever fetch the journey fixture installs so one prompt returns rich markdown.
  let inner = window.fetch.bind(window);
  const wrapped = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.includes('/api/__or3-e2e/chat/completions') && body.includes('blank:markdown')) {
      const enc = new TextEncoder();
      const chunks = [md.slice(0, md.length >> 1), md.slice(md.length >> 1)];
      const stream = new ReadableStream({
        start(c) {
          for (const content of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`));
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`));
          c.enqueue(enc.encode('data: [DONE]\n\n'));
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return inner(input, init);
  };
  Object.defineProperty(window, 'fetch', { configurable: true, get: () => wrapped, set: (fn) => { inner = fn; } });
};

async function session({ dark = false, width = 1440, height = 900, touch = false } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.addInitScript(initScript, { dark, md: MARKDOWN });
  await page.goto(`${BASE}/__or3-chat-journey-test?workspace=1`);
  await page.getByRole('textbox', { name: 'Message input' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  return { browser, page };
}

const failures = [];
const metrics = {};
let shotCount = 0;

async function shot(page, name, clip) {
  if (!wanted(name)) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}), animations: 'disabled' });
  shotCount++;
}

async function step(name, fn) {
  if (!wanted(name)) return;
  try { await fn(); } catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); }
}

async function group(name, fn) { try { await fn(); } catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); } }

async function send(page, text, waitText) {
  const input = page.getByRole('textbox', { name: 'Message input' });
  await input.fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
}

// Computed-style inventory of a region (fonts, line-heights, radii) for before/after diffing.
const inventoryFn = (sel) => {
  const root = document.querySelector(sel) || document.body;
  const out = { fonts: {}, radii: {}, fractionalHeights: 0, items: [] };
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) { const k = `${s.fontSize}/${s.fontWeight}/lh${s.lineHeight}`; out.fonts[k] = (out.fonts[k] || 0) + 1; }
    const rad = s.borderTopLeftRadius;
    if (rad !== '0px' && r.width > 20 && r.height > 20 && !rad.includes('e+')) out.radii[rad] = (out.radii[rad] || 0) + 1;
    if (Math.abs(r.height - Math.round(r.height)) > 0.05 && r.height > 12) out.fractionalHeights++;
  }
  return out;
};

const SNAP_PROPS = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopColor','borderTopStyle','backgroundColor','boxShadow','color','opacity','display','visibility','outlineStyle','textDecorationLine','overflowX','overflowY','textTransform','letterSpacing','fontSize','fontWeight','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','borderTopLeftRadius','gap','width','height'];
const snapFn = ([sel, props]) => {
  const root = document.querySelector(sel) || document.body;
  const out = {};
  const walk = (el, path) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    if (s.display === 'none') return;
    const cls = (typeof el.className === 'string' ? el.className : (el.className?.baseVal ?? '')).split(/\s+/).filter((c) => c && !/[\[\]:/!]/.test(c) && !/^(data-v|iconify|i-)/.test(c)).slice(0, 2).join('.');
    const label = el.tagName.toLowerCase() + (cls ? '.' + cls : '');
    const here = path + '>' + label;
    if (r.width > 0 && r.height > 0) {
      const o = {}; for (const p of props) o[p] = s[p]; out[here] = o;
    }
    const counts = {};
    for (const c of el.children) { const k = c.tagName; counts[k] = (counts[k] || 0) + 1; walk(c, here + '#' + counts[k]); }
  };
  walk(root, '');
  return out;
};

async function inventory(page, key, sel) { metrics[key] = await page.evaluate(inventoryFn, sel || 'body'); writeFileSync(`${OUT}/snap-${key}.json`, JSON.stringify(await page.evaluate(snapFn, [sel || 'body', SNAP_PROPS]))); }

const probe = async (page, sels) => page.evaluate((sels) => {
  const r = {};
  for (const [name, sel] of Object.entries(sels)) {
    const el = [...document.querySelectorAll(sel)].find((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
    if (!el) { r[name] = null; continue; }
    const s = getComputedStyle(el), b = el.getBoundingClientRect();
    r[name] = { box: `${b.left.toFixed(1)},${b.top.toFixed(1)} ${b.width.toFixed(1)}x${b.height.toFixed(1)}`, font: `${s.fontSize}/${s.fontWeight}/lh${s.lineHeight}`, pad: s.padding, radius: s.borderTopLeftRadius, color: s.color };
  }
  return r;
}, sels);

const DESKTOP_PROBES = {
  'user bubble': '.cm-user', 'assistant p': '.cm-markdown-assistant p', 'assistant h2': '.cm-markdown-assistant h2', 'assistant h3': '.cm-markdown-assistant h3',
  'assistant li': '.cm-markdown-assistant li', 'inline code': '.cm-markdown-assistant p code', 'blockquote': '.cm-markdown-assistant blockquote',
  'th': '.cm-markdown-assistant th', 'td': '.cm-markdown-assistant td',
  'code header': '[data-streamdown="code-block-header"]', 'code lang': '[data-streamdown="code-lang"]', 'code body': '[data-streamdown="code-body"]', 'code': '[data-streamdown="code"]', 'copy btn': '[data-streamdown="copy-button"]',
  'search': '#nav-header input', 'page-link': '.page-link-btn', 'page-link label': '.page-link-label', 'page-link icon': '.page-link-icon-container',
  'group header': '.sb-group-header', 'group label': '.sb-group-header-label', 'group action': '.sb-group-header-action',
  'chat row': '.unified-sb-item', 'chat row icon': '.unified-sb-item .sb-btn-icon', 'chat row title': '.unified-sb-item .sb-btn-title', 'row time': '.sb-item-time',
  'tab': '.workspace-tab', 'tab title': '.workspace-tab-title', 'tab new': '.workspace-tab-new', 'tab close': '.workspace-tab-close',
  'composer': '.blank2-chat-dropper.chat-input-main', 'composer attach': '.chat-input-attachment-btn button', 'composer send': '.chat-input-send-btn',
};

// ───────────────────────── desktop light ─────────────────────────
await group('d', async () => {
  const { browser, page } = await session();
  try {
    await step('d06-empty-chat', async () => { await shot(page, 'd06-empty-chat'); await inventory(page, 'empty-chat'); });
    await send(page, 'journey:one', 'Hello from deterministic stream.');
    await page.getByRole('button', { name: 'New chat' }).first().click().catch(() => {});
    await send(page, 'journey:two', 'Hello from deterministic stream.').catch(() => {});
    await send(page, 'blank:markdown', 'A closing paragraph checks the rhythm');
    await step('d01-chat-conversation', async () => { await shot(page, 'd01-chat-conversation'); });
    await step('d02-chat-prose', async () => { await shot(page, 'd02-chat-prose', { x: 450, y: 62, width: 990, height: 760 }); });
    await step('d03-sidebar', async () => { await shot(page, 'd03-sidebar', { x: 0, y: 0, width: 450, height: 900 }); });
    await step('d04-tab-strip', async () => { await page.evaluate(() => document.querySelectorAll('.workspace-chrome *').forEach((e) => { if (e.scrollWidth > e.clientWidth + 2) e.scrollLeft = 0; })); await shot(page, 'd04-tab-strip', { x: 450, y: 0, width: 990, height: 64 }); });
    await step('d05-composer', async () => { await shot(page, 'd05-composer', { x: 450, y: 740, width: 990, height: 160 }); });
    metrics.probes = await probe(page, DESKTOP_PROBES);
    await inventory(page, 'chat-conversation');
    await inventory(page, 'sidebar', '#sidebar-container-outer');
    await step('d13-command-palette', async () => {
      await page.keyboard.press('ControlOrMeta+k'); await page.waitForTimeout(700);
      await shot(page, 'd13-command-palette'); await inventory(page, 'palette', '.or3-palette'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    });
    await step('d14-chat-settings', async () => {
      await page.locator('.chat-input-settings-btn button').first().click(); await page.waitForTimeout(700);
      await shot(page, 'd14-chat-settings', { x: 450, y: 300, width: 990, height: 600 }); await inventory(page, 'chat-settings-popover'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    });
    await step('d15-row-menu', async () => {
      const row = page.locator('.unified-sb-item').first(); await row.hover();
      await row.locator('button').last().click(); await page.waitForTimeout(600);
      await shot(page, 'd15-row-menu', { x: 0, y: 0, width: 700, height: 900 }); await inventory(page, 'row-menu'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    });
    await step('d16-tooltip', async () => {
      await page.getByRole('button', { name: 'Dashboard', exact: true }).first().hover(); await page.waitForTimeout(900);
      await shot(page, 'd16-tooltip', { x: 0, y: 150, width: 300, height: 220 });
    });
    await step('d17-tool-calls', async () => {
      await page.getByRole('button', { name: 'New chat' }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      await send(page, 'journey:workspace-find');
      await page.waitForTimeout(3500);
      await shot(page, 'd17-tool-calls', { x: 450, y: 62, width: 990, height: 760 });
      await inventory(page, 'tool-calls', '.chat-container-root, main');
    });
    await step('d18-document-editor', async () => {
      await page.locator('.unified-sb-item', { hasText: 'Workspace evid' }).first().click();
      await page.waitForTimeout(2500);
      await shot(page, 'd18-document-editor');
      await inventory(page, 'document-editor', '.document-editor-root');
    });
    await step('d19-model-catalog', async () => {
      await page.getByRole('button', { name: 'New chat' }).first().click().catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('.chat-input-settings-btn button').first().click(); await page.waitForTimeout(600);
      await page.getByRole('button', { name: /^Model catalog/ }).first().click(); await page.waitForTimeout(1500);
      await shot(page, 'd19-model-catalog'); await inventory(page, 'model-catalog', '[role=dialog]');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    });
    await step('d20-system-prompts', async () => {
      await page.locator('.chat-input-settings-btn button').first().click(); await page.waitForTimeout(600);
      await page.getByRole('button', { name: /^Manage system prompts/ }).first().click(); await page.waitForTimeout(1500);
      await shot(page, 'd20-system-prompts'); await inventory(page, 'system-prompts', '[role=dialog]');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    });
    await step('d21-account-menu', async () => {
      await page.getByRole('button', { name: /Account|Sign in|Profile/ }).first().click(); await page.waitForTimeout(800);
      await shot(page, 'd21-account-menu', { x: 0, y: 500, width: 600, height: 400 }); await inventory(page, 'account-menu');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    });
    // Dashboard flow
    await step('d07-dashboard', async () => {
      await page.getByRole('button', { name: 'Dashboard', exact: true }).first().click(); await page.waitForTimeout(1000);
      await shot(page, 'd07-dashboard');
      await inventory(page, 'dashboard', '[role=dialog]');
    });
    await step('d08-settings', async () => {
      await page.getByRole('button', { name: /^Settings/ }).first().click(); await page.waitForTimeout(1000);
      await shot(page, 'd08-settings'); await inventory(page, 'settings', '[role=dialog]');
    });
    const dlg = { x: 270, y: 40, width: 900, height: 840 };
    for (const [name, key] of [['AI Settings', 'd09-ai-settings'], ['Workspace Profile', 'd10-workspace-profile'], ['Theme Settings', 'd11-theme-settings']]) {
      await step(key, async () => {
        await page.getByRole('button', { name: new RegExp('^' + name) }).first().click(); await page.waitForTimeout(1500);
        await shot(page, key, dlg); await inventory(page, key, '[role=dialog]');
        if (key === 'd09-ai-settings') {
          await page.locator('[role=dialog] .dashboard-page-scroll, [role=dialog] [class*=overflow-y]').first().evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => {});
          await page.waitForTimeout(400); await shot(page, 'd09b-ai-settings-bottom', dlg);
        }
        if (key === 'd11-theme-settings') {
          await page.getByRole('button', { name: 'Typography' }).first().click().catch(() => {}); await page.waitForTimeout(900);
          await shot(page, 'd11b-theme-typography', dlg);
        }
        await page.getByRole('button', { name: /Back to/ }).first().click().catch(() => {}); await page.waitForTimeout(500);
      });
    }
    await step('d12-images', async () => {
      await page.getByRole('button', { name: /Back to|Dashboard/ }).first().click().catch(() => {}); await page.waitForTimeout(500);
      await page.getByRole('button', { name: /^Images/ }).first().click(); await page.waitForTimeout(1200);
      await shot(page, 'd12-images', dlg);
    });
  } finally { await browser.close(); }
});



// ───────────────────────── sidebar page lists (fresh session each: the sidebar remembers its view) ─────────────────────────
for (const [label, file] of [['Chats', 'd22-sidebar-chats'], ['Documents', 'd23-sidebar-documents'], ['Projects', 'd24-sidebar-projects']]) {
  if (!wanted(file)) continue;
  await group(file, async () => {
    const { browser, page } = await session();
    try {
      await send(page, 'journey:one', 'Hello from deterministic stream.');
      await page.locator('.page-link-btn', { hasText: label }).first().click(); await page.waitForTimeout(1000);
      await shot(page, file, { x: 0, y: 0, width: 450, height: 900 });
      await inventory(page, file, '#sidebar-container-outer');
    } finally { await browser.close(); }
  });
}

// ───────────────────────── message details ─────────────────────────
await group('e1', async () => {
  const { browser, page } = await session();
  try {
    const longMsg = 'journey:long ' + 'A long message wraps across several lines so the bubble radius, padding and line height can be judged on more than a single line of text. '.repeat(3);
    await send(page, longMsg, 'Hello from deterministic stream.');
    await step('e01-user-message-long', async () => { await shot(page, 'e01-user-message-long', { x: 450, y: 62, width: 990, height: 420 }); });
  } finally { await browser.close(); }
});
await group('e2', async () => {
  const { browser, page } = await session();
  try {
    await send(page, 'blank:markdown', 'A closing paragraph checks the rhythm');
    await step('e02-message-actions', async () => {
      const msg = page.locator('.cm-assistant').last(); await msg.hover(); await page.waitForTimeout(700);
      await shot(page, 'e02-message-actions', { x: 450, y: 480, width: 990, height: 400 });
    });
  } finally { await browser.close(); }
});

// ───────────────────────── desktop dark ─────────────────────────
await group('k', async () => {
  const { browser, page } = await session({ dark: true });
  try {
    await send(page, 'journey:one', 'Hello from deterministic stream.');
    await send(page, 'blank:markdown', 'A closing paragraph checks the rhythm');
    await step('k01-dark-chat', async () => { await shot(page, 'k01-dark-chat'); });
    await step('k02-dark-sidebar', async () => { await shot(page, 'k02-dark-sidebar', { x: 0, y: 0, width: 450, height: 900 }); });
    metrics.darkProbes = await probe(page, DESKTOP_PROBES);
    await step('k03-dark-settings', async () => {
      await page.getByRole('button', { name: 'Dashboard', exact: true }).first().click(); await page.waitForTimeout(800);
      await page.getByRole('button', { name: /^Settings/ }).first().click(); await page.waitForTimeout(800);
      await page.getByRole('button', { name: /^AI Settings/ }).first().click(); await page.waitForTimeout(1400);
      await shot(page, 'k03-dark-settings', { x: 270, y: 40, width: 900, height: 840 });
    });
  } finally { await browser.close(); }
});

// ───────────────────────── mobile ─────────────────────────
await group('m', async () => {
  const { browser, page } = await session({ width: 390, height: 844, touch: true });
  try {
    await step('m01-empty', async () => { await shot(page, 'm01-empty'); await inventory(page, 'mobile-empty'); });
    await step('m02-bottom-nav', async () => { await shot(page, 'm02-bottom-nav', { x: 0, y: 764, width: 390, height: 80 }); });
    await send(page, 'journey:one', 'Hello from deterministic stream.');
    await send(page, 'blank:markdown', 'A closing paragraph checks the rhythm');
    await step('m03-chat', async () => { await shot(page, 'm03-chat'); });
    await step('m04-drawer', async () => {
      await page.getByRole('button', { name: /Open sidebar/ }).first().click(); await page.waitForTimeout(900);
      await shot(page, 'm04-drawer'); await inventory(page, 'mobile-drawer');
      metrics.mobileProbes = await probe(page, { 'search': '#nav-header input', 'page-link': '.page-link-btn', 'page-link label': '.page-link-label', 'group header': '.sb-group-header', 'group label': '.sb-group-header-label', 'group action': '.sb-group-header-action', 'row': '.unified-sb-item', 'row title': '.unified-sb-item .sb-btn-title', 'nav label': '.mobile-nav-label' });
    });
    await step('m05-more', async () => {
      await page.getByRole('button', { name: 'More' }).first().click(); await page.waitForTimeout(900);
      await shot(page, 'm05-more'); await inventory(page, 'mobile-more', '.mobile-nav-more-sheet');
    });
    await step('m06-tab-switcher', async () => {
      await page.goto(`${BASE}/__or3-chat-journey-test?workspace=1`);
      await page.getByRole('textbox', { name: 'Message input' }).waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
      await page.locator('.workspace-chrome-active-title').first().click(); await page.waitForTimeout(900);
      await shot(page, 'm06-tab-switcher'); await inventory(page, 'mobile-tab-switcher', '[role=dialog]');
    });
    await step('m07-settings', async () => {
      await page.goto(`${BASE}/__or3-chat-journey-test?workspace=1`);
      await page.getByRole('textbox', { name: 'Message input' }).waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
      const jsClick = (loc) => loc.evaluate((el) => el.click());
      await jsClick(page.locator('#mobile-bottom-nav').getByRole('button', { name: 'Dashboard' })); await page.waitForTimeout(1100);
      await jsClick(page.locator('[role=dialog]').getByRole('button', { name: /^Settings/ }).first()); await page.waitForTimeout(900);
      await jsClick(page.locator('[role=dialog]').getByRole('button', { name: /^AI Settings/ }).first()); await page.waitForTimeout(1400);
      await shot(page, 'm07-settings'); await inventory(page, 'mobile-settings', '[role=dialog]');
    });
  } finally { await browser.close(); }
});

writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1));
console.log(`shots: ${shotCount}`);
if (failures.length) console.log('FAILURES:\n' + failures.join('\n'));
