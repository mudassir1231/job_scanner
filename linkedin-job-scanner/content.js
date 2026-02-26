// LinkedIn Job Scanner - Content Script

let isScanning = false;
let currentJobIndex = 0;
let matchedJobs = [];
let allJobCards = [];
let scanDelay = 2000;
let searchTerm = '';

function getJobCards() {
  // Try multiple selectors for different LinkedIn layouts
  const selectors = [
    '.jobs-search-results__list-item',
    '.job-card-container',
    '.jobs-search-results-list .occludable-update',
    'li.jobs-search-results__list-item',
    '.scaffold-layout__list-container li'
  ];
  
  for (const sel of selectors) {
    const cards = document.querySelectorAll(sel);
    if (cards.length > 0) return Array.from(cards);
  }
  return [];
}

function getJobTitle(card) {
  const selectors = [
    '.job-card-list__title',
    '.job-card-container__link strong',
    'a.job-card-list__title',
    '.jobs-unified-top-card__job-title',
    'h3.base-search-card__title',
    '.artdeco-entity-lockup__title'
  ];
  for (const sel of selectors) {
    const el = card.querySelector(sel);
    if (el) return el.innerText.trim();
  }
  return 'Unknown Title';
}

function getJobLink(card) {
  const selectors = [
    'a.job-card-list__title',
    'a.job-card-container__link',
    'a[data-control-name="job_card_title"]',
    'a.base-card__full-link'
  ];
  for (const sel of selectors) {
    const el = card.querySelector(sel);
    if (el && el.href) return el.href;
  }
  // Try any link in card
  const link = card.querySelector('a[href*="/jobs/view/"]');
  if (link) return link.href;
  return null;
}

function getDescriptionText() {
  const selectors = [
    '.jobs-description__content',
    '.jobs-box__html-content',
    '#job-details',
    '.jobs-description',
    '.jobs-unified-description__content',
    '.description__text',
    '[class*="job-details-jobs-unified-top-card"]',
    '.job-view-layout'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el.innerText.toLowerCase();
  }
  return document.body.innerText.toLowerCase();
}

async function waitForDescription(timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const text = getDescriptionText();
    if (text && text.length > 100) return text;
    await sleep(300);
  }
  return getDescriptionText();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clickJobCard(card) {
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(300);
  
  // Try clicking the title link first
  const link = card.querySelector('a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"]');
  if (link) {
    link.click();
  } else {
    card.click();
  }
  await sleep(500);
}

// attempt to click the "next page" button in LinkedIn pagination
function clickNextPage() {
  const selectors = [
    'button[aria-label="Next"]',
    'button[aria-label="Next page"]',
    '.artdeco-pagination__button--next',
    'a[aria-label="Next"]',
    'a[aria-label="Next page"]'
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
  }
  return false;
}

async function loadMoreJobs() {
  // Scroll the job list panel to load more
  const listPanel = document.querySelector(
    '.jobs-search-results-list, .scaffold-layout__list-container, .jobs-search__results-list'
  );
  if (listPanel) {
    listPanel.scrollTop = listPanel.scrollHeight;
  } else {
    window.scrollTo(0, document.body.scrollHeight);
  }
  await sleep(1500);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_SCAN') {
    searchTerm = msg.searchTerm.toLowerCase();
    scanDelay = msg.delay;
    matchedJobs = [];
    currentJobIndex = 0;
    isScanning = true;
    runScan().then(() => {
      chrome.runtime.sendMessage({
        action: 'SCAN_COMPLETE',
        matchedJobs
      });
    });
    sendResponse({ status: 'started' });
  }

  if (msg.action === 'STOP_SCAN') {
    isScanning = false;
    sendResponse({ status: 'stopped', matchedJobs });
  }

  if (msg.action === 'GET_STATUS') {
    sendResponse({ isScanning, currentJobIndex, matchedCount: matchedJobs.length });
  }

  return true;
});

async function runScan() {
  // Loop pages while scanning is active
  while (isScanning) {
    // Initial card collection on this page
    allJobCards = getJobCards();
    
    if (allJobCards.length === 0) {
      chrome.runtime.sendMessage({ action: 'SCAN_ERROR', message: 'No job cards found. Make sure you are on LinkedIn Jobs search page.' });
      break;
    }

    chrome.runtime.sendMessage({ action: 'SCAN_STARTED', total: allJobCards.length });

    for (let i = 0; i < allJobCards.length && isScanning; i++) {
      currentJobIndex = i;
      
      // Refresh card list in case DOM updated
      const freshCards = getJobCards();
      if (freshCards.length > allJobCards.length) {
        allJobCards = freshCards;
      }
      
      const card = allJobCards[i];
      if (!card) continue;

      const title = getJobTitle(card);
      const link = getJobLink(card);

      chrome.runtime.sendMessage({
        action: 'PROGRESS',
        current: i + 1,
        total: allJobCards.length,
        jobTitle: title
      });

      // Click the card to load description
      await clickJobCard(card);
      await sleep(scanDelay);

      // Wait for description to load
      const descText = await waitForDescription(scanDelay + 2000);

      let matched = false;
      if (searchTerm && descText.includes(searchTerm)) {
        matched = true;
      } else if (!searchTerm) {
        matched = true; // no filter, collect all
      }

      if (matched) {
        const jobData = {
          title,
          link: link || window.location.href,
          index: i + 1,
          timestamp: new Date().toISOString()
        };
        matchedJobs.push(jobData);
        chrome.runtime.sendMessage({ action: 'JOB_MATCHED', job: jobData });
      }

      // Try to load more if near end
      if (i >= allJobCards.length - 3) {
        await loadMoreJobs();
        const newCards = getJobCards();
        if (newCards.length > allJobCards.length) {
          allJobCards = newCards;
        }
      }
    }

    // if scanning stopped by user, break out
    if (!isScanning) break;

    // at end of current page, attempt to advance
    const moved = clickNextPage();
    if (moved) {
      // allow page to load
      await sleep(3000);
      // continue loop to scan new page
      continue;
    }

    // no further pages
    break;
  }

  isScanning = false;
}
