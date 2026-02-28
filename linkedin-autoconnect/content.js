// LinkedIn Auto Connect Content Script

let isRunning = false;
let connectCount = 0;
let delay = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(base) {
  return base + Math.random() * 1500;
}

// Find all Connect buttons on the page (only actual Connect buttons, not Follow/Message)
function findConnectButtons() {
  const buttons = [];
  
  // Method 1: aria-label contains "Connect"
  document.querySelectorAll('button').forEach(btn => {
    const ariaLabel = btn.getAttribute('aria-label') || '';
    const text = btn.innerText?.trim() || '';
    
    // Must say "Connect" but NOT be "Message", "Follow", "Pending", etc.
    if (
      (ariaLabel.toLowerCase().includes('connect') || text === 'Connect') &&
      !ariaLabel.toLowerCase().includes('message') &&
      !ariaLabel.toLowerCase().includes('follow') &&
      !btn.disabled &&
      btn.offsetParent !== null // visible
    ) {
      buttons.push(btn);
    }
  });
  
  return buttons;
}

// Handle the "Send without a note" modal if it appears
async function handleModal() {
  await sleep(1500);
  
  // Look for "Send without a note" button
  const modalButtons = document.querySelectorAll('button');
  for (const btn of modalButtons) {
    const text = btn.innerText?.trim() || '';
    const ariaLabel = btn.getAttribute('aria-label') || '';
    if (
      text.toLowerCase().includes('send without a note') ||
      ariaLabel.toLowerCase().includes('send without a note')
    ) {
      btn.click();
      console.log('[AutoConnect] Clicked "Send without a note"');
      return true;
    }
  }
  
  // Also look for "Send" button in modal context
  for (const btn of modalButtons) {
    const text = btn.innerText?.trim() || '';
    if (text === 'Send' && btn.closest('[role="dialog"]')) {
      btn.click();
      console.log('[AutoConnect] Clicked Send in modal');
      return true;
    }
  }
  
  return false;
}

// Go to next page
async function goToNextPage() {
  // Look for "Next" pagination button
  const nextBtn = document.querySelector('button[aria-label="Next"]') ||
    [...document.querySelectorAll('button')].find(b => b.innerText?.trim() === 'Next');
  
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.click();
    console.log('[AutoConnect] Going to next page...');
    await sleep(3000);
    return true;
  }
  
  // Try URL-based pagination
  const url = new URL(window.location.href);
  const currentPage = parseInt(url.searchParams.get('page') || '1');
  url.searchParams.set('page', currentPage + 1);
  window.location.href = url.toString();
  return true;
}

async function autoConnect() {
  if (!isRunning) return;
  
  updateStatus('running');
  
  const buttons = findConnectButtons();
  console.log(`[AutoConnect] Found ${buttons.length} Connect buttons`);
  
  if (buttons.length === 0) {
    // No buttons found, try next page
    console.log('[AutoConnect] No Connect buttons found, moving to next page...');
    updateStatus('next-page');
    await sleep(2000);
    
    const moved = await goToNextPage();
    if (!moved) {
      updateStatus('done');
      isRunning = false;
    }
    return;
  }
  
  for (const btn of buttons) {
    if (!isRunning) break;
    
    // Scroll to button
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(randomDelay(800));
    
    // Click connect
    btn.click();
    console.log('[AutoConnect] Clicked Connect');
    connectCount++;
    
    // Handle modal
    await handleModal();
    
    await sleep(randomDelay(delay));
    
    // Send update to popup
    chrome.runtime.sendMessage({ type: 'UPDATE_COUNT', count: connectCount }).catch(() => {});
  }
  
  // Done with this page, go to next
  if (isRunning) {
    console.log('[AutoConnect] Page done, moving to next...');
    updateStatus('next-page');
    await sleep(randomDelay(2000));
    await goToNextPage();
    
    // Wait for page load then continue
    await sleep(4000);
    if (isRunning) {
      autoConnect();
    }
  }
}

function updateStatus(status) {
  chrome.runtime.sendMessage({ type: 'STATUS', status, count: connectCount }).catch(() => {});
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START') {
    if (!isRunning) {
      isRunning = true;
      connectCount = 0;
      delay = msg.delay || 3000;
      autoConnect();
    }
    sendResponse({ ok: true });
  }
  
  if (msg.type === 'STOP') {
    isRunning = false;
    updateStatus('stopped');
    sendResponse({ ok: true });
  }
  
  if (msg.type === 'GET_STATUS') {
    sendResponse({ isRunning, count: connectCount });
  }
});
