const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const countDisplay = document.getElementById('countDisplay');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const delaySlider = document.getElementById('delaySlider');
const delayVal = document.getElementById('delayVal');

delaySlider.addEventListener('input', () => {
  delayVal.textContent = (delaySlider.value / 1000).toFixed(1) + 's';
});

function setStatus(status, count) {
  if (count !== undefined) countDisplay.textContent = count;
  
  statusBadge.className = 'status-badge';
  
  switch(status) {
    case 'running':
      statusBadge.classList.add('running');
      statusText.textContent = 'Running';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      break;
    case 'next-page':
      statusBadge.classList.add('running');
      statusText.textContent = 'Next Page';
      break;
    case 'stopped':
      statusBadge.classList.add('stopped');
      statusText.textContent = 'Stopped';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      break;
    case 'done':
      statusText.textContent = 'Done';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      break;
    default:
      statusText.textContent = 'Idle';
      startBtn.disabled = false;
      stopBtn.disabled = true;
  }
}

startBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url.includes('linkedin.com')) {
    statusText.textContent = 'Open LinkedIn first!';
    statusBadge.style.color = '#ef4444';
    return;
  }
  
  chrome.tabs.sendMessage(tab.id, {
    type: 'START',
    delay: parseInt(delaySlider.value)
  });
  
  setStatus('running');
});

stopBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'STOP' });
  setStatus('stopped');
});

// Listen for updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_COUNT') {
    countDisplay.textContent = msg.count;
  }
  if (msg.type === 'STATUS') {
    setStatus(msg.status, msg.count);
  }
});

// Get current status on popup open
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url.includes('linkedin.com')) {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, (resp) => {
      if (resp) {
        countDisplay.textContent = resp.count;
        setStatus(resp.isRunning ? 'running' : 'stopped');
      }
    });
  }
}

init();
