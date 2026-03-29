#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3210);
const UI_DIR = path.join(__dirname, 'ui');
const CRAWLER_SCRIPT = path.join(__dirname, 'smartedu_textbook_batch.js');

let currentJob = null;
let nextJobId = 1;

function isJobActive(job) {
  return job && (job.status === 'running' || job.status === 'stopping');
}

function forceKillProcessTree(job) {
  if (!job?.process?.pid || !isJobActive(job)) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(job.process.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {
      // Ignore taskkill failures if the process already exited.
    });
    return;
  }

  try {
    job.process.kill('SIGKILL');
  } catch (error) {
    // Ignore kill failures if the process already exited.
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function buildCrawlerArgs(payload) {
  const args = [CRAWLER_SCRIPT];

  if (payload.allElectronic) {
    args.push('--all-electronic');
  } else if (payload.url) {
    args.push('--url', String(payload.url));
  } else {
    throw new Error('Missing --url or --all-electronic');
  }

  if (payload.outputDir) args.push('--output-dir', String(payload.outputDir));
  if (payload.userDataDir) args.push('--user-data-dir', String(payload.userDataDir));
  if (payload.headless) args.push('--headless');
  if (payload.force) args.push('--force');
  if (payload.limit) args.push('--limit', String(payload.limit));
  if (payload.stage) args.push('--stage', String(payload.stage));
  if (payload.subject) args.push('--subject', String(payload.subject));
  if (payload.publisher) args.push('--publisher', String(payload.publisher));
  if (payload.grade) args.push('--grade', String(payload.grade));
  if (payload.volume) args.push('--volume', String(payload.volume));
  if (payload.keyword) args.push('--keyword', String(payload.keyword));

  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : String(payload.tags || '')
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean);
  for (const tag of tags) {
    args.push('--tag', tag);
  }

  return args;
}

function serializeJob(job) {
  if (!job) {
    return {
      running: false,
      job: null,
    };
  }

  return {
    running: job.status === 'running',
    job: {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      exitCode: job.exitCode,
      signal: job.signal,
      args: job.args,
      logs: job.logs,
    },
  };
}

function startJob(payload) {
  if (currentJob && isJobActive(currentJob)) {
    throw new Error('A crawl job is already running');
  }

  const args = buildCrawlerArgs(payload);
  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const job = {
    id: nextJobId,
    args,
    process: child,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    signal: null,
    logs: [],
    forceKillTimer: null,
  };
  nextJobId += 1;
  currentJob = job;

  const appendLog = (source, chunk) => {
    const text = chunk.toString('utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      job.logs.push({
        at: new Date().toISOString(),
        source,
        line,
      });
    }
    if (job.logs.length > 2000) {
      job.logs.splice(0, job.logs.length - 2000);
    }
  };

  child.stdout.on('data', (chunk) => appendLog('stdout', chunk));
  child.stderr.on('data', (chunk) => appendLog('stderr', chunk));
  child.on('exit', (code, signal) => {
    const wasStopping = job.status === 'stopping';
    if (job.forceKillTimer) {
      clearTimeout(job.forceKillTimer);
      job.forceKillTimer = null;
    }
    if (wasStopping || signal === 'SIGINT' || signal === 'SIGTERM' || code === 130) {
      job.status = 'stopped';
      job.logs.push({
        at: new Date().toISOString(),
        source: 'system',
        line: 'Job stopped.',
      });
    } else {
      job.status = code === 0 ? 'finished' : 'failed';
    }
    job.endedAt = new Date().toISOString();
    job.exitCode = code;
    job.signal = signal;
  });

  return job;
}

function stopJob() {
  if (!currentJob || currentJob.status !== 'running') {
    throw new Error('No running job');
  }
  const job = currentJob;
  const stopSignal = process.platform === 'win32' ? 'SIGINT' : 'SIGTERM';
  job.status = 'stopping';
  job.logs.push({
    at: new Date().toISOString(),
    source: 'system',
    line: `Stopping job with ${stopSignal}...`,
  });

  try {
    job.process.kill(stopSignal);
  } catch (error) {
    forceKillProcessTree(job);
  }

  job.forceKillTimer = setTimeout(() => {
    forceKillProcessTree(job);
  }, 10000);

  return job;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    sendFile(res, path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/app.js') {
    sendFile(res, path.join(UI_DIR, 'app.js'), 'text/javascript; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/styles.css') {
    sendFile(res, path.join(UI_DIR, 'styles.css'), 'text/css; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
    sendJson(res, 200, serializeJob(currentJob));
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/start') {
    try {
      const payload = await parseBody(req);
      const job = startJob(payload);
      sendJson(res, 200, serializeJob(job));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/stop') {
    try {
      const job = stopJob();
      sendJson(res, 200, serializeJob(job));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`SmartEdu UI listening at http://${HOST}:${PORT}`);
});
