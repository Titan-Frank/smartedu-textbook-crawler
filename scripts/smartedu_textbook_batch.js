#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_VERSION_URL =
  'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROFILE_DIR = '.smartedu-profile';
const DETAIL_PAGE_ERROR_PATTERNS = [
  '403',
  '404',
  '500',
  'forbidden',
  'not found',
  'access denied',
  '无权限',
  '暂无权限',
  '拒绝访问',
  '资源不存在',
  '内容不存在',
  '页面不存在',
  '服务异常',
  '服务繁忙',
  '加载失败',
];

let activePrompt = null;
let activeContext = null;
let shutdownPromise = null;

function resolveProjectPath(...segments) {
  return path.resolve(PROJECT_ROOT, ...segments);
}

function normalizeCliUrl(value) {
  return String(value || '')
    .replace(/\\([?=&])/g, '$1')
    .trim();
}

function parseIntegerOption(rawValue, flag, { min = 0 } = {}) {
  const value = Number.parseInt(String(rawValue || ''), 10);
  if (!Number.isFinite(value) || Number.isNaN(value) || value < min) {
    throw new Error(`${flag} must be an integer greater than or equal to ${min}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    url: '',
    allElectronic: false,
    outputDir: '',
    userDataDir: resolveProjectPath(DEFAULT_PROFILE_DIR),
    headless: false,
    force: false,
    limit: 0,
    concurrency: 1,
    resume: true,
    tags: [],
    keyword: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') {
      options.url = normalizeCliUrl(argv[index + 1] || '');
      index += 1;
    } else if (arg === '--all-electronic') {
      options.allElectronic = true;
    } else if (arg === '--output-dir') {
      options.outputDir = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--user-data-dir') {
      options.userDataDir = argv[index + 1]
        ? path.resolve(argv[index + 1])
        : resolveProjectPath(DEFAULT_PROFILE_DIR);
      index += 1;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--limit') {
      options.limit = parseIntegerOption(argv[index + 1], '--limit', { min: 0 });
      index += 1;
    } else if (arg === '--concurrency') {
      options.concurrency = parseIntegerOption(argv[index + 1], '--concurrency', { min: 1 });
      index += 1;
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--no-resume') {
      options.resume = false;
    } else if (arg === '--tag') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value for --tag');
      }
      options.tags.push(value.trim());
      index += 1;
    } else if (arg === '--stage') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value for --stage');
      }
      options.tags.push(value.trim());
      index += 1;
    } else if (arg === '--subject') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value for --subject');
      }
      options.tags.push(value.trim());
      index += 1;
    } else if (arg === '--publisher') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value for --publisher');
      }
      options.tags.push(value.trim());
      index += 1;
    } else if (arg === '--grade') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value for --grade');
      }
      options.tags.push(value.trim());
      index += 1;
    } else if (arg === '--volume') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value for --volume');
      }
      options.tags.push(value.trim());
      index += 1;
    } else if (arg === '--keyword') {
      options.keyword = (argv[index + 1] || '').trim();
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.url && !options.allElectronic) {
    throw new Error('Missing required argument: use --url <smartedu-list-url> or --all-electronic');
  }

  if (!options.outputDir) {
    if (options.url) {
      const parsedUrl = new URL(options.url);
      const defaultTag = parsedUrl.searchParams.get('defaultTag') || 'smartedu';
      const safeTag = defaultTag.replace(/[^\w.-]+/g, '_');
      options.outputDir = resolveProjectPath('downloads', `smartedu_${safeTag}`);
    } else if (options.allElectronic) {
      options.outputDir = resolveProjectPath('downloads', 'smartedu_all_electronic');
    }
  } else {
    options.outputDir = path.resolve(options.outputDir);
  }

  return options;
}

function printHelp(exitCode) {
  console.log(`Usage:
  node scripts/smartedu_textbook_batch.js (--url <smartedu-list-url> | --all-electronic) [options]

Options:
  --all-electronic       Crawl all SmartEdu electronic textbooks
  --output-dir <dir>      Save PDFs and manifest under this directory
  --user-data-dir <dir>   Chromium profile directory for SmartEdu login state
  --headless              Run Chromium in headless mode
  --force                 Re-download files even if they already exist
  --limit <n>             Download only the first n matched textbooks
  --concurrency <n>       Number of textbooks to download in parallel
  --resume                Resume from existing manifest.json (default)
  --no-resume             Ignore manifest.json and start the task fresh
  --tag <name>            Extra tag-name filter, repeatable
  --stage <name>          Convenience tag filter, e.g. 小学/初中/高中
  --subject <name>        Convenience tag filter, e.g. 数学/语文
  --publisher <name>      Convenience tag filter, e.g. 沪教版/统编版
  --grade <name>          Convenience tag filter, e.g. 一年级/高中年级
  --volume <name>         Convenience tag filter, e.g. 上册/必修 第一册
  --keyword <text>        Match title/provider text
  --help, -h              Show this help

Example:
  node scripts/smartedu_textbook_batch.js --url "https://basic.smartedu.cn/tchMaterial?defaultTag=e7bbb2de-0590-11ed-9c79-92fc3b3249d5%2F6a74973a-0772-11ed-ac74-092ab92074e6%2F44bee8bc-54e6-11ed-9c34-850ba61fa9f4%2Fe7bbd296-0590-11ed-9c79-92fc3b3249d5" --output-dir ./downloads/smartedu_textbooks

  node scripts/smartedu_textbook_batch.js --all-electronic --stage 小学 --subject 数学 --output-dir ./downloads/smartedu_primary_math
`);
  process.exit(exitCode);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function getFilterTagIds(listUrl) {
  const parsedUrl = new URL(listUrl);
  const defaultTag = parsedUrl.searchParams.get('defaultTag');
  if (!defaultTag) {
    throw new Error('The provided URL does not contain a defaultTag parameter');
  }
  return decodeURIComponent(defaultTag)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

function itemMatchesTagIds(item, filterTagIds) {
  const itemTagIds = new Set((item.tag_list || []).map((tag) => tag.tag_id));
  return filterTagIds.every((tagId) => itemTagIds.has(tagId));
}

function itemMatchesTagNames(item, filterTagNames) {
  if (!filterTagNames.length) {
    return true;
  }
  const itemTagNames = new Set((item.tag_list || []).map((tag) => tag.tag_name));
  return filterTagNames.every((tagName) => itemTagNames.has(tagName));
}

function itemMatchesKeyword(item, keyword) {
  if (!keyword) {
    return true;
  }
  const haystack = [item.title, item.provider_list?.[0]?.name || '', item.description || '']
    .join(' ')
    .toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

function sanitizeFilename(value) {
  return value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function buildOutputFilename(item, seq) {
  const parts = uniqueNonEmpty([
    String(seq).padStart(2, '0'),
    item.stage,
    item.subject,
    item.publisherTag,
    item.grade,
    item.volumeTag,
    item.title,
    item.id,
  ]);
  return `${sanitizeFilename(parts.join('_'))}.pdf`;
}

function buildDetailUrl(itemId) {
  return `https://basic.smartedu.cn/tchMaterial/detail?contentType=assets_document&contentId=${itemId}&catalogType=tchMaterial&subCatalog=tchMaterial`;
}

function extractSourcePdfUrl(frameUrl) {
  try {
    const viewerUrl = new URL(frameUrl);
    return viewerUrl.searchParams.get('file') || '';
  } catch (error) {
    return '';
  }
}

function isLoginPageUrl(url) {
  return String(url || '').includes('/uias/login');
}

async function inspectDetailPageState(page, response) {
  const currentUrl = page.url();
  if (isLoginPageUrl(currentUrl)) {
    return {
      loginRequired: true,
      fatalMessage: '',
    };
  }

  const status =
    response && typeof response.status === 'function' ? response.status() : null;
  if (typeof status === 'number' && status >= 400) {
    return {
      loginRequired: false,
      fatalMessage: `Detail page responded with HTTP ${status}`,
    };
  }

  try {
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim());
    if (!bodyText) {
      return {
        loginRequired: false,
        fatalMessage: '',
      };
    }

    const normalized = bodyText.toLowerCase();
    const matchedPattern = DETAIL_PAGE_ERROR_PATTERNS.find((pattern) =>
      normalized.includes(pattern.toLowerCase()),
    );
    if (matchedPattern) {
      const snippet = bodyText.slice(0, 160);
      return {
        loginRequired: false,
        fatalMessage: `Detail page shows an error state: ${snippet || matchedPattern}`,
      };
    }
  } catch (error) {
    // Ignore transient evaluation errors while the page is still rendering.
  }

  return {
    loginRequired: false,
    fatalMessage: '',
  };
}

function createPrompt() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    async ask(question) {
      return new Promise((resolve) => {
        rl.question(question, resolve);
      });
    },
    close() {
      rl.close();
    },
  };
}

function closePrompt(prompt) {
  if (!prompt) {
    return;
  }
  try {
    prompt.close();
  } catch (error) {
    // Ignore readline close errors during shutdown.
  }
}

async function closeContext(context) {
  if (!context) {
    return;
  }
  try {
    await context.close();
  } catch (error) {
    // Ignore browser close errors during shutdown.
  }
}

function installSignalHandlers() {
  const handleSignal = (signal) => {
    if (shutdownPromise) {
      return;
    }

    console.warn(`\nReceived ${signal}, shutting down crawler...`);
    shutdownPromise = (async () => {
      closePrompt(activePrompt);
      await closeContext(activeContext);
    })().finally(() => {
      process.exit(130);
    });
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));
}

async function ensureDir(directory) {
  await fs.promises.mkdir(directory, { recursive: true });
}

async function collectMatchedItems(options) {
  const filterTagIds = options.url ? getFilterTagIds(options.url) : [];
  const filterTagNames = [...options.tags];
  if (options.allElectronic && !filterTagNames.includes('电子教材')) {
    filterTagNames.unshift('电子教材');
  }
  const versionInfo = await fetchJson(DATA_VERSION_URL);
  const partUrls = String(versionInfo.urls || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const matched = [];
  const seenIds = new Set();
  for (const partUrl of partUrls) {
    const partItems = await fetchJson(partUrl);
    for (const item of partItems) {
      if (item.status !== 'ONLINE') {
        continue;
      }
      if (filterTagIds.length && !itemMatchesTagIds(item, filterTagIds)) {
        continue;
      }
      if (!itemMatchesTagNames(item, filterTagNames)) {
        continue;
      }
      if (!itemMatchesKeyword(item, options.keyword)) {
        continue;
      }
      if (seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);
      matched.push({
        id: item.id,
        title: item.title,
        tags: (item.tag_list || []).map((tag) => tag.tag_name),
        provider: item.provider_list?.[0]?.name || '',
        stage: (item.tag_list || []).find((tag) => tag.tag_dimension_id === 'zxxxd')?.tag_name || '',
        subject: (item.tag_list || []).find((tag) => tag.tag_dimension_id === 'zxxxk')?.tag_name || '',
        publisherTag: (item.tag_list || []).find((tag) => tag.tag_dimension_id === 'zxxbb')?.tag_name || '',
        grade: (item.tag_list || []).find((tag) => tag.tag_dimension_id === 'zxxnj')?.tag_name || '',
        volumeTag: (item.tag_list || []).find((tag) => tag.tag_dimension_id === 'zxxcc')?.tag_name || '',
      });
    }
  }

  matched.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN'));
  return matched;
}

async function waitForPdfFrame(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = page.frames().find((entry) => isPdfViewerFrameUrl(entry.url()));
    if (frame) {
      return {
        frame,
        loginRequired: false,
      };
    }

    const state = await inspectDetailPageState(page);
    if (state.loginRequired) {
      return {
        frame: null,
        loginRequired: true,
      };
    }
    if (state.fatalMessage) {
      throw new Error(state.fatalMessage);
    }

    await page.waitForTimeout(1000);
  }
  return {
    frame: null,
    loginRequired: false,
  };
}

function isPdfViewerFrameUrl(frameUrl) {
  if (!frameUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(frameUrl);
    return (
      parsedUrl.pathname.endsWith('/viewer.html') &&
      (parsedUrl.searchParams.has('file') || parsedUrl.hash.includes('file='))
    );
  } catch (error) {
    return false;
  }
}

async function waitForPdfReady(frame, page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await inspectDetailPageState(page);
    if (state.loginRequired) {
      throw new Error('Login expired while waiting for the PDF viewer');
    }
    if (state.fatalMessage) {
      throw new Error(state.fatalMessage);
    }

    try {
      const ready = await frame.evaluate(() => !!window.PDFViewerApplication?.pdfDocument);
      const pages = await frame.evaluate(() => window.PDFViewerApplication?.pagesCount || 0);
      if (ready) {
        return pages;
      }
    } catch (error) {
      // Ignore transient frame evaluation errors while the viewer is booting.
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Timed out waiting for PDF.js viewer to finish loading');
}

async function promptForLogin(prompt, page) {
  console.log('\nSmartEdu 可能要求登录后才能查看原始 PDF。');
  console.log(`当前页面：${page.url()}`);

  if (prompt) {
    await prompt.ask('请在打开的浏览器里完成登录，然后回车继续...');
    return;
  }

  console.log('当前终端不可交互，改为在浏览器中等待登录完成...');
  await page.waitForFunction(
    () => !window.location.href.includes('/uias/login'),
    undefined,
    { timeout: 300000 },
  );
}

function createLoginCoordinator(prompt) {
  let currentLoginPromise = null;

  return async function ensureLoggedIn(page) {
    if (currentLoginPromise) {
      console.log('检测到已有页面正在等待登录完成，复用这次登录状态...');
      await currentLoginPromise;
      return;
    }

    currentLoginPromise = promptForLogin(prompt, page);
    try {
      await currentLoginPromise;
    } finally {
      currentLoginPromise = null;
    }
  };
}

async function downloadOneBook({ page, item, seq, outputDir, force, ensureLoggedIn }) {
  const detailUrl = buildDetailUrl(item.id);
  const filename = buildOutputFilename(item, seq);
  const outputPath = path.join(outputDir, filename);

  if (!force && fs.existsSync(outputPath)) {
    return {
      seq,
      status: 'skipped',
      id: item.id,
      title: item.title,
      detailUrl,
      outputPath,
      reason: 'already_exists',
    };
  }

  let response = await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let state = await inspectDetailPageState(page, response);
  if (state.fatalMessage) {
    throw new Error(state.fatalMessage);
  }

  let frameState = await waitForPdfFrame(page, 15000);
  if (!frameState.frame && frameState.loginRequired) {
    await ensureLoggedIn(page);
    response = await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    state = await inspectDetailPageState(page, response);
    if (state.fatalMessage) {
      throw new Error(state.fatalMessage);
    }
    frameState = await waitForPdfFrame(page, 30000);
  }
  const frame = frameState.frame;
  if (!frame) {
    throw new Error('PDF.js iframe was not found on the detail page');
  }

  const pages = await waitForPdfReady(frame, page, 240000);
  const sourcePdfUrl = extractSourcePdfUrl(frame.url());

  const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
  await frame.evaluate(async (downloadName) => {
    const data = await window.PDFViewerApplication.pdfDocument.getData();
    const blob = new Blob([data], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = downloadName;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      anchor.remove();
    }, 10000);
  }, filename);

  const download = await downloadPromise;
  await download.saveAs(outputPath);

  const stats = await fs.promises.stat(outputPath);

  return {
    seq,
    status: 'downloaded',
    id: item.id,
    title: item.title,
    detailUrl,
    sourcePdfUrl,
    outputPath,
    bytes: stats.size,
    pages,
  };
}

function getManifestPath(outputDir) {
  return path.join(outputDir, 'manifest.json');
}

async function loadManifest(outputDir) {
  const manifestPath = getManifestPath(outputDir);
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`Failed to read existing manifest, ignoring resume state. Detail: ${error.message}`);
    return [];
  }
}

function createResumeEntry({ previousEntry, item, seq, outputDir }) {
  const detailUrl = buildDetailUrl(item.id);
  const outputPath = path.join(outputDir, buildOutputFilename(item, seq));
  const result = {
    ...previousEntry,
    seq,
    id: item.id,
    title: item.title,
    detailUrl,
    outputPath,
    resumed: true,
  };

  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    result.bytes = stats.size;
  }

  return result;
}

function shouldResumeItem({ previousEntry, item, seq, outputDir, options }) {
  if (!options.resume || options.force || !previousEntry) {
    return null;
  }

  if (previousEntry.id !== item.id) {
    return null;
  }

  if (previousEntry.status !== 'downloaded' && previousEntry.status !== 'skipped') {
    return null;
  }

  const outputPath = path.join(outputDir, buildOutputFilename(item, seq));
  if (!fs.existsSync(outputPath)) {
    return null;
  }

  return createResumeEntry({ previousEntry, item, seq, outputDir });
}

function createManifestStore({ outputDir, items, previousEntries }) {
  const manifestPath = getManifestPath(outputDir);
  const manifest = new Array(items.length).fill(null);
  const previousEntryMap = new Map(
    previousEntries
      .filter((entry) => entry && entry.id)
      .map((entry) => [entry.id, entry]),
  );
  let writeQueue = Promise.resolve();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const previousEntry = previousEntryMap.get(item.id);
    if (!previousEntry) {
      continue;
    }
    manifest[index] = {
      ...previousEntry,
      seq: index + 1,
      id: item.id,
      title: item.title,
      detailUrl: buildDetailUrl(item.id),
      outputPath:
        previousEntry.outputPath || path.join(outputDir, buildOutputFilename(item, index + 1)),
    };
  }

  function snapshot() {
    return manifest
      .filter(Boolean)
      .slice()
      .sort((left, right) => (left.seq || 0) - (right.seq || 0));
  }

  async function persist() {
    writeQueue = writeQueue.then(() =>
      fs.promises.writeFile(manifestPath, `${JSON.stringify(snapshot(), null, 2)}\n`, 'utf8'),
    );

    try {
      await writeQueue;
    } catch (error) {
      console.warn(`Failed to save manifest checkpoint. Detail: ${error.message}`);
    }
  }

  return {
    manifestPath,
    get(index) {
      return manifest[index];
    },
    async set(index, entry) {
      manifest[index] = entry;
      await persist();
    },
    async flush() {
      await persist();
    },
    snapshot,
  };
}

async function createWorkerPages(context, workerCount) {
  const pages = [];
  const initialPage = context.pages()[0] || (await context.newPage());
  pages.push(initialPage);

  while (pages.length < workerCount) {
    pages.push(await context.newPage());
  }

  return pages;
}

async function downloadWithWorkers({ context, items, options, prompt, manifestStore }) {
  const workerCount = Math.min(options.concurrency, items.length);
  const pages = await createWorkerPages(context, workerCount);
  const ensureLoggedIn = createLoginCoordinator(prompt);
  let nextIndex = 0;

  await Promise.all(
    pages.map(async (page, workerIndex) => {
      const workerLabel = `worker ${workerIndex + 1}/${workerCount}`;

      while (true) {
        const itemIndex = nextIndex;
        nextIndex += 1;
        if (itemIndex >= items.length) {
          return;
        }

        const item = items[itemIndex];
        const resumeEntry = shouldResumeItem({
          previousEntry: manifestStore.get(itemIndex),
          item,
          seq: itemIndex + 1,
          outputDir: options.outputDir,
          options,
        });

        if (resumeEntry) {
          await manifestStore.set(itemIndex, resumeEntry);
          console.log(
            `\n[${itemIndex + 1}/${items.length}] [${workerLabel}] 续传跳过: ${item.title}`,
          );
          continue;
        }

        console.log(`\n[${itemIndex + 1}/${items.length}] [${workerLabel}] ${item.title}`);

        try {
          const result = await downloadOneBook({
            page,
            item,
            seq: itemIndex + 1,
            outputDir: options.outputDir,
            force: options.force,
            ensureLoggedIn,
          });
          await manifestStore.set(itemIndex, result);
          console.log(`[${workerLabel}] Saved: ${result.outputPath}`);
        } catch (error) {
          const failure = {
            seq: itemIndex + 1,
            status: 'failed',
            id: item.id,
            title: item.title,
            detailUrl: buildDetailUrl(item.id),
            error: error.message,
          };
          await manifestStore.set(itemIndex, failure);
          console.error(`[${workerLabel}] Failed: ${item.title}`);
          console.error(error.message);
        }
      }
    }),
  );

  return manifestStore.snapshot();
}

async function saveManifest(outputDir, manifest) {
  const manifestPath = getManifestPath(outputDir);
  await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

async function launchBrowserContext(chromium, options) {
  const noDisplay =
    process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const effectiveHeadless = options.headless || noDisplay;

  if (noDisplay && !options.headless) {
    console.warn('No graphical session detected, falling back to headless mode.');
  }

  const launchOptions = {
    headless: effectiveHeadless,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
  };

  try {
    return await chromium.launchPersistentContext(options.userDataDir, {
      ...launchOptions,
      channel: 'chrome',
    });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (!message.toLowerCase().includes('chrom') && !message.toLowerCase().includes('executable')) {
      throw error;
    }
  }

  try {
    return await chromium.launchPersistentContext(options.userDataDir, launchOptions);
  } catch (error) {
    const detail = String(error && error.message ? error.message : error);
    throw new Error(
      `Unable to launch local Chrome or Playwright Chromium. ${
        noDisplay
          ? 'No graphical session is available and headless fallback also failed.'
          : 'Install Chrome, or run: npx playwright install chromium'
      } Detail: ${detail}`,
    );
  }
}

async function main() {
  installSignalHandlers();
  const options = parseArgs(process.argv.slice(2));
  await ensureDir(options.outputDir);

  const items = await collectMatchedItems(options);
  const limitedItems = options.limit > 0 ? items.slice(0, options.limit) : items;
  const previousManifest = options.resume && !options.force ? await loadManifest(options.outputDir) : [];

  if (limitedItems.length === 0) {
    throw new Error('No matching textbooks were found for the provided SmartEdu page');
  }

  console.log(`Matched ${limitedItems.length} textbooks`);
  limitedItems.forEach((item, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. ${item.title}`);
  });
  if (options.resume && !options.force && previousManifest.length > 0) {
    console.log(`Resume checkpoint found: ${previousManifest.length} entries`);
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    throw new Error(
      "Missing dependency 'playwright'. Run: npm install playwright && npx playwright install chromium",
    );
  }
  const prompt = createPrompt();
  activePrompt = prompt;

  const context = await launchBrowserContext(chromium, options);
  activeContext = context;
  let manifest = [];
  const manifestStore = createManifestStore({
    outputDir: options.outputDir,
    items: limitedItems,
    previousEntries: previousManifest,
  });

  try {
    console.log(`Concurrency: ${Math.min(options.concurrency, limitedItems.length)}`);
    manifest = await downloadWithWorkers({
      context,
      items: limitedItems,
      options,
      prompt,
      manifestStore,
    });
  } finally {
    closePrompt(prompt);
    activePrompt = null;
    await closeContext(context);
    activeContext = null;
  }

  await manifestStore.flush();
  const manifestPath = await saveManifest(options.outputDir, manifest);
  const downloadedCount = manifest.filter((item) => item.status === 'downloaded').length;
  const skippedCount = manifest.filter((item) => item.status === 'skipped').length;
  const failedCount = manifest.filter((item) => item.status === 'failed').length;

  console.log('\nDone');
  console.log(`Downloaded: ${downloadedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
