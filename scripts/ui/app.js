const form = document.getElementById('crawl-form');
const allElectronic = document.getElementById('allElectronic');
const urlInput = document.getElementById('url');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const jobStatus = document.getElementById('jobStatus');
const jobMeta = document.getElementById('jobMeta');
const logOutput = document.getElementById('logOutput');

let pollingTimer = null;

function toggleUrlInput() {
  urlInput.disabled = allElectronic.checked;
  urlInput.closest('label').classList.toggle('disabled', allElectronic.checked);
}

function setStatus(label, tone = 'idle') {
  jobStatus.textContent = label;
  jobStatus.dataset.tone = tone;
}

function renderJob(data) {
  if (!data || !data.job) {
    setStatus('空闲', 'idle');
    jobMeta.textContent = '尚未启动任务。';
    logOutput.textContent = '';
    return;
  }

  const { job, running } = data;
  if (running) {
    setStatus('运行中', 'running');
  } else if (job.status === 'finished') {
    setStatus('已完成', 'success');
  } else if (job.status === 'stopped') {
    setStatus('已停止', 'idle');
  } else if (job.status === 'failed') {
    setStatus('失败', 'error');
  } else {
    setStatus(job.status, 'idle');
  }

  const meta = [
    `任务 #${job.id}`,
    `状态: ${job.status}`,
    `开始: ${job.startedAt || '-'}`,
    job.endedAt ? `结束: ${job.endedAt}` : null,
    job.exitCode !== null ? `退出码: ${job.exitCode}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  jobMeta.textContent = meta;

  const lines = (job.logs || []).map((entry) => `[${entry.at}] ${entry.source}: ${entry.line}`);
  logOutput.textContent = lines.join('\n');
  logOutput.scrollTop = logOutput.scrollHeight;
}

async function fetchStatus() {
  const response = await fetch('/api/status');
  const data = await response.json();
  renderJob(data);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function startPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
  }
  pollingTimer = setInterval(fetchStatus, 1500);
}

function collectFormPayload() {
  const formData = new FormData(form);
  return {
    allElectronic: allElectronic.checked,
    url: formData.get('url'),
    stage: formData.get('stage'),
    subject: formData.get('subject'),
    publisher: formData.get('publisher'),
    grade: formData.get('grade'),
    volume: formData.get('volume'),
    keyword: formData.get('keyword'),
    outputDir: formData.get('outputDir'),
    userDataDir: formData.get('userDataDir'),
    limit: Number(formData.get('limit') || 0),
    concurrency: Number(formData.get('concurrency') || 1),
    headless: formData.get('headless') === 'on',
    resume: formData.get('resume') === 'on',
    force: formData.get('force') === 'on',
    tags: formData
      .get('tags')
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  startBtn.disabled = true;
  try {
    const data = await postJson('/api/start', collectFormPayload());
    renderJob(data);
    startPolling();
  } catch (error) {
    alert(error.message);
  } finally {
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  try {
    const data = await postJson('/api/stop', {});
    renderJob(data);
  } catch (error) {
    alert(error.message);
  } finally {
    stopBtn.disabled = false;
  }
});

allElectronic.addEventListener('change', toggleUrlInput);

toggleUrlInput();
fetchStatus();
startPolling();
