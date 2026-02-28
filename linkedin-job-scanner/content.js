// LinkedIn Job Scanner - Content Script

let isScanning = false;
let currentJobIndex = 0;
let matchedJobs = [];
let allJobCards = [];
let scanDelay = 2000;
let searchTerm = '';
let jobsPerPage = 0; // 0 = scan all jobs on page before moving on

// return a random delay within +/-25% of base
function getRandomDelay(base) {
  const variation = base * 0.25;
  return base + (Math.random() * 2 - 1) * variation;
}

function getJobCards() {
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
  
  const link = card.querySelector('a.job-card-list__title, a.job-card-container__link, a[href*="/jobs/view/"]');
  if (link) {
    link.click();
  } else {
    card.click();
  }
  await sleep(500);
}

function clickNextPage() {
  const selectors = [
    'button[aria-label="Next"]',
    'button[aria-label="Next page"]',
    '.artdeco-pagination__button--next',
    'a[aria-label="Next"]',
    'a[aria-label="Next page"]',
    'button[aria-label*="next"]',
    '.jobs-search-pagination button:not(:disabled)'
  ];
  for (const sel of selectors) {
    const buttons = document.querySelectorAll(sel);
    for (const btn of buttons) {
      if (!btn.disabled && (btn.getAttribute('aria-label')?.toLowerCase().includes('next') || btn.textContent.toLowerCase().includes('next'))) {
        btn.click();
        return true;
      }
    }
  }
  return false;
}

async function waitForPageLoad(timeout = 5000) {
  const start = Date.now();
  let lastCount = 0;
  
  while (Date.now() - start < timeout) {
    const cards = getJobCards();
    if (cards.length > 0 && cards.length !== lastCount) {
      await sleep(500);
      return true;
    }
    lastCount = cards.length;
    await sleep(300);
  }
  
  return getJobCards().length > 0;
}

async function loadMoreJobs() {
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
    jobsPerPage = msg.jobsPerPage || 0;
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
  let pageNumber = 1;
  let totalScanned = 0; // cumulative across pages for display

  while (isScanning) {
    console.log(`Scanning page ${pageNumber}...`);
    
    allJobCards = getJobCards();
    
    if (allJobCards.length === 0) {
      chrome.runtime.sendMessage({ action: 'SCAN_ERROR', message: 'No job cards found. Make sure you are on LinkedIn Jobs search page.' });
      break;
    }

    // Determine how many jobs to scan on this page
    const limit = (jobsPerPage > 0) ? Math.min(jobsPerPage, allJobCards.length) : allJobCards.length;

    chrome.runtime.sendMessage({ action: 'SCAN_STARTED', total: limit, page: pageNumber });

    for (let i = 0; i < limit && isScanning; i++) {
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

      const jobDelay = getRandomDelay(scanDelay);

      chrome.runtime.sendMessage({
        action: 'PROGRESS',
        current: i + 1,
        total: limit,
        page: pageNumber,
        jobTitle: title,
        calculatedDelay: Math.round(jobDelay)
      });

      await clickJobCard(card);
      await sleep(jobDelay);

      const descText = await waitForDescription(jobDelay + 2000);

      let matched = false;
      if (!searchTerm) {
        matched = true;
      } else {
        const terms = searchTerm.split(',').map(t => t.trim()).filter(t => t.length > 0);
        matched = terms.some(term => descText.includes(term));
      }

      if (matched) {
        totalScanned++;
        const jobData = {
          title,
          link: link || window.location.href,
          index: totalScanned,
          page: pageNumber,
          timestamp: new Date().toISOString()
        };
        matchedJobs.push(jobData);
        chrome.runtime.sendMessage({ action: 'JOB_MATCHED', job: jobData });
      }

      // Try to load more if near end (only when not using jobsPerPage limit)
      if (jobsPerPage === 0 && i >= allJobCards.length - 3) {
        await loadMoreJobs();
        const newCards = getJobCards();
        if (newCards.length > allJobCards.length) {
          allJobCards = newCards;
        }
      }
    }

    if (!isScanning) break;

    // Attempt to go to next page
    const moved = clickNextPage();
    if (moved) {
      console.log(`Moving to page ${pageNumber + 1}...`);
      pageNumber++;
      const loadedSuccessfully = await waitForPageLoad(8000);
      if (loadedSuccessfully) {
        await sleep(2000);
        continue;
      } else {
        console.log('Failed to load next page');
        break;
      }
    }

    console.log('No more pages to scan');
    break;
  }

  isScanning = false;
}
