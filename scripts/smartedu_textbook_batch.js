#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_VERSION_URL =
  'https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json';
const DEFAULT_PROFILE_DIR = '.smartedu-profile';

let activePrompt = null;
let activeContext = null;
let shutdownPromise = null;

function normalizeCliUrl(value) {
  return String(value || '')
    .replace(/\\([?=&])/g, '$1')
    .trim();
}

function parseArgs(argv) {
  const options = {
    url: '',
    allElectronic: false,
    outputDir: '',
    userDataDir: path.resolve(DEFAULT_PROFILE_DIR),
    headless: false,
    force: false,
    limit: 0,
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
      options.userDataDir = path.resolve(argv[index + 1] || DEFAULT_PROFILE_DIR);
      index += 1;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--limit') {
      options.limit = Number(argv[index + 1] || '0');
      index += 1;
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
      options.outputDir = path.resolve('downloads', `smartedu_${safeTag}`);
    } else if (options.allElectronic) {
      options.outputDir = path.resolve('downloads', 'smartedu_all_electronic');
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
    const frame = page.frames().find((entry) => entry.url().includes('/pdfjs/2.15/web/viewer.html'));
    if (frame) {
      return frame;
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function waitForPdfReady(frame, page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
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

async function downloadOneBook({ page, item, seq, outputDir, force, prompt }) {
  const detailUrl = buildDetailUrl(item.id);
  const filename = buildOutputFilename(item, seq);
  const outputPath = path.join(outputDir, filename);

  if (!force && fs.existsSync(outputPath)) {
    return {
      status: 'skipped',
      id: item.id,
      title: item.title,
      detailUrl,
      outputPath,
      reason: 'already_exists',
    };
  }

  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });

  let frame = await waitForPdfFrame(page, 15000);
  if (!frame) {
    await promptForLogin(prompt, page);
    frame = await waitForPdfFrame(page, 120000);
  }
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

async function saveManifest(outputDir, manifest) {
  const manifestPath = path.join(outputDir, 'manifest.json');
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

  if (limitedItems.length === 0) {
    throw new Error('No matching textbooks were found for the provided SmartEdu page');
  }

  console.log(`Matched ${limitedItems.length} textbooks`);
  limitedItems.forEach((item, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. ${item.title}`);
  });

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

  const page = context.pages()[0] || (await context.newPage());
  const manifest = [];

  try {
    for (let index = 0; index < limitedItems.length; index += 1) {
      const item = limitedItems[index];
      console.log(`\n[${index + 1}/${limitedItems.length}] ${item.title}`);
      try {
        const result = await downloadOneBook({
          page,
          item,
          seq: index + 1,
          outputDir: options.outputDir,
          force: options.force,
          prompt,
        });
        manifest.push(result);
        console.log(`Saved: ${result.outputPath}`);
      } catch (error) {
        const failure = {
          status: 'failed',
          id: item.id,
          title: item.title,
          detailUrl: buildDetailUrl(item.id),
          error: error.message,
        };
        manifest.push(failure);
        console.error(`Failed: ${item.title}`);
        console.error(error.message);
      }
    }
  } finally {
    closePrompt(prompt);
    activePrompt = null;
    await closeContext(context);
    activeContext = null;
  }

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
