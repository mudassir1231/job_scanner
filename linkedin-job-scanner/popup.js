// popup.js
let matchedJobs = [];
let isScanning = false;
let totalJobs = 0;

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const searchTermInput = document.getElementById('searchTerm');
const delayInput = document.getElementById('delayInput');
const delayRange = document.getElementById('delayRange');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const currentJobTitle = document.getElementById('currentJobTitle');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');
const matchCount = document.getElementById('matchCount');
const downloadBtn = document.getElementById('downloadBtn');
const warning = document.getElementById('warning');

// Sync delay slider <-> input
delayInput.addEventListener('input', () => {
  let v = parseInt(delayInput.value);
  if (v < 500) v = 500;
  if (v > 10000) v = 10000;
  delayRange.value = v;
});

delayRange.addEventListener('input', () => {
  delayInput.value = delayRange.value;
});

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + (state || '');
  statusText.innerHTML = text;
}

async function getActiveLinkedInTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes('linkedin.com/jobs')) {
    return tab;
  }
  return null;
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SCAN_STARTED') {
    totalJobs = msg.total;
    progressSection.classList.add('visible');
    setStatus('active', `Scanning <span>${totalJobs}</span> jobs`);
  }

  if (msg.action === 'PROGRESS') {
  const pct = Math.round((msg.current / msg.total) * 100);
  progressBar.style.width = pct + '%';
  progressCount.textContent = `${msg.current} / ${msg.total}`;

  if (msg.skipped) {
    currentJobTitle.innerHTML = `<span style="color:var(--muted);font-style:italic">⏭ skipped — ${msg.jobTitle}</span>`;
    setStatus('active', `Scanning <span>${msg.current}/${msg.total}</span> <span style="color:var(--muted);font-size:10px">· skipped</span>`);
  } else {
    currentJobTitle.innerHTML = `${msg.jobTitle} <span style="color:var(--muted);font-size:10px">(${(msg.calculatedDelay/1000).toFixed(1)}s)</span>`;
    setStatus('active', `Scanning <span>${msg.current}/${msg.total}</span> <span style="color:var(--muted);font-size:10px">· wait ${(msg.calculatedDelay/1000).toFixed(1)}s</span>`);
  }
}

  if (msg.action === 'JOB_MATCHED') {
    matchedJobs.push(msg.job);
    addResultItem(msg.job);
    matchCount.textContent = matchedJobs.length;
    resultsSection.classList.add('visible');
  }

  if (msg.action === 'SCAN_COMPLETE') {
    isScanning = false;
    scanComplete();
  }

  if (msg.action === 'SCAN_ERROR') {
    isScanning = false;
    setStatus('stopped', msg.message);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    warning.textContent = '⚠ ' + msg.message;
    warning.classList.add('visible');
  }
});

function addResultItem(job) {
  const item = document.createElement('a');
  item.href = job.link;
  item.target = '_blank';
  item.className = 'result-item';
  item.title = job.title;
  item.innerHTML = `
    <span class="result-num">#${job.index}</span>
    <span class="result-title">${job.title}</span>
    <span class="result-arrow">↗</span>
  `;
  item.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: job.link });
  });
  resultsList.appendChild(item);
}

function scanComplete() {
  setStatus('', `Done — <span>${matchedJobs.length}</span> matches found`);
  startBtn.disabled = false;
  startBtn.textContent = '▶ START SCAN';
  stopBtn.disabled = true;
  currentJobTitle.textContent = 'Complete!';
  progressSection.classList.add('visible');
}

startBtn.addEventListener('click', async () => {
  warning.classList.remove('visible');
  const tab = await getActiveLinkedInTab();

  if (!tab) {
    warning.textContent = '⚠ Please go to LinkedIn Jobs search results page first.';
    warning.classList.add('visible');
    return;
  }

  const term = searchTermInput.value.trim();
  const delay = Math.max(500, Math.min(10000, parseInt(delayInput.value) || 2000));

  // Reset
  matchedJobs = [];
  resultsList.innerHTML = '';
  matchCount.textContent = '0';
  resultsSection.classList.remove('visible');
  progressSection.classList.remove('visible');
  progressBar.style.width = '0%';

  isScanning = true;
  startBtn.disabled = true;
  startBtn.textContent = '⏳ SCANNING...';
  stopBtn.disabled = false;

  // Inject content script if needed then send message
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch(e) {
    // Already injected, that's fine
  }

  chrome.tabs.sendMessage(tab.id, {
    action: 'START_SCAN',
    searchTerm: term,
    delay
  }, (response) => {
    if (chrome.runtime.lastError) {
      // Content script might need injection
      warning.textContent = '⚠ Could not connect to page. Please refresh the LinkedIn Jobs page and try again.';
      warning.classList.add('visible');
      startBtn.disabled = false;
      startBtn.textContent = '▶ START SCAN';
      stopBtn.disabled = true;
      isScanning = false;
    }
  });
});

stopBtn.addEventListener('click', async () => {
  const tab = await getActiveLinkedInTab();
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCAN' });
  }
  isScanning = false;
  setStatus('stopped', 'Scan stopped');
  startBtn.disabled = false;
  startBtn.textContent = '▶ START SCAN';
  stopBtn.disabled = true;
  currentJobTitle.textContent = 'Stopped';
});

downloadBtn.addEventListener('click', () => {
  if (matchedJobs.length === 0) return;

  const term = searchTermInput.value.trim() || '(all jobs)';
  let content = `LinkedIn Job Scanner Results\n`;
  content += `Search Term: "${term}"\n`;
  content += `Date: ${new Date().toLocaleString()}\n`;
  content += `Matched: ${matchedJobs.length} jobs\n`;
  content += `${'='.repeat(60)}\n\n`;

  matchedJobs.forEach((job, i) => {
    content += `${i + 1}. ${job.title}\n`;
    content += `   URL: ${job.link}\n`;
    content += `   Found at: ${new Date(job.timestamp).toLocaleTimeString()}\n\n`;
  });

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linkedin-jobs-${term.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// Check status on open
(async () => {
  const tab = await getActiveLinkedInTab();
  if (!tab) {
    setStatus('', 'Go to LinkedIn Jobs to start');
  } else {
    setStatus('', 'Ready to scan');
    // Ask content if already scanning
    chrome.tabs.sendMessage(tab.id, { action: 'GET_STATUS' }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp && resp.isScanning) {
        isScanning = true;
        setStatus('active', `Resuming scan...`);
        startBtn.disabled = true;
        startBtn.textContent = '⏳ SCANNING...';
        stopBtn.disabled = false;
      }
    });
  }
})();
