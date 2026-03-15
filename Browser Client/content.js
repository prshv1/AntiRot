// ── State ──
let currentVideoId = null;
let isProcessing = false;
let overlayElement = null;
let loadingElement = null;
let currentTheme = 'dark';

// ── Load saved theme ──
chrome.storage.local.get(['theme'], (data) => {
  currentTheme = data.theme || 'dark';
});

// ── YouTube Video Page Detection ──
// ONLY triggers on /watch pages, ignores home, shorts, subs, etc.
function isVideoPage() {
  return window.location.pathname === '/watch' && new URLSearchParams(window.location.search).has('v');
}

function getCurrentVideoId() {
  return new URLSearchParams(window.location.search).get('v');
}

// ── Channel Name Extraction ──
function getChannelName() {
  // Try multiple selectors YouTube uses for channel name
  const selectors = [
    'ytd-video-owner-renderer ytd-channel-name yt-formatted-string a',
    'ytd-video-owner-renderer #channel-name yt-formatted-string a',
    'ytd-video-owner-renderer #channel-name a',
    '#owner #channel-name yt-formatted-string a',
    '#upload-info #channel-name yt-formatted-string a',
    'ytd-channel-name#channel-name yt-formatted-string#text a',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }
  return null;
}

// ── Whitelist Check ──
async function isChannelWhitelisted(channelName) {
  if (!channelName) return false;

  return new Promise((resolve) => {
    chrome.storage.local.get(['whitelist'], (data) => {
      const list = data.whitelist || [];
      const match = list.some(
        (wl) => wl.toLowerCase() === channelName.toLowerCase()
      );
      resolve(match);
    });
  });
}

// ── Check Extension State ──
async function isEnabled() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['enabled'], (data) => {
      resolve(data.enabled !== false);
    });
  });
}

// ── Main Classification Flow ──
async function processVideo() {
  if (!isVideoPage()) {
    cleanup();
    return;
  }

  const videoId = getCurrentVideoId();
  if (!videoId || videoId === currentVideoId || isProcessing) return;

  currentVideoId = videoId;
  isProcessing = true;

  // Check if extension is enabled
  const enabled = await isEnabled();
  if (!enabled) {
    isProcessing = false;
    return;
  }

  // Wait briefly for channel info to load
  const channelName = await waitForChannelName(4000);

  // Check whitelist
  if (channelName) {
    const whitelisted = await isChannelWhitelisted(channelName);
    if (whitelisted) {
      console.log(`[Anti-Rot] Channel "${channelName}" is whitelisted. Skipping.`);
      isProcessing = false;
      return;
    }
  }

  // Show loading state
  showLoading();

  // Send to background for classification
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'classifyVideo',
      url: window.location.href,
    });

    removeLoading();

    if (response.action === 'blocked') {
      showBlockOverlay();
    } else {
      cleanup();
    }
  } catch (err) {
    console.error('[Anti-Rot] Message error:', err);
    removeLoading();
  }

  isProcessing = false;
}

// Wait for channel name to appear in DOM (YouTube loads it async)
function waitForChannelName(timeout = 4000) {
  return new Promise((resolve) => {
    const name = getChannelName();
    if (name) return resolve(name);

    const interval = setInterval(() => {
      const n = getChannelName();
      if (n) {
        clearInterval(interval);
        resolve(n);
      }
    }, 300);

    setTimeout(() => {
      clearInterval(interval);
      resolve(getChannelName());
    }, timeout);
  });
}

// ── Loading Indicator ──
function showLoading() {
  if (loadingElement) return;

  loadingElement = document.createElement('div');
  loadingElement.id = 'antirot-loading';
  loadingElement.dataset.theme = currentTheme;
  loadingElement.innerHTML = `
    <div class="antirot-loading-inner">
      <div class="antirot-spinner"></div>
      <span>Scanning...</span>
    </div>
  `;
  document.body.appendChild(loadingElement);
}

function removeLoading() {
  if (loadingElement) {
    loadingElement.remove();
    loadingElement = null;
  }
}

// ── Block Overlay ──
function showBlockOverlay() {
  if (overlayElement) return;

  overlayElement = document.createElement('div');
  overlayElement.id = 'antirot-overlay';
  overlayElement.dataset.theme = currentTheme;
  overlayElement.innerHTML = `
    <div class="antirot-overlay-content">
      <div class="antirot-icon-wrap">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
          <line x1="12" y1="22" x2="12" y2="15.5"/>
          <polyline points="22 8.5 12 15.5 2 8.5"/>
        </svg>
      </div>
      <h1 class="antirot-title">Time is Valuable</h1>
      <p class="antirot-subtitle">Anti-Rot blocked this video because it doesn't align with your goals.</p>
      <p class="antirot-quote" id="antirot-quote"></p>
      <div class="antirot-actions">
        <button id="antirot-goback" class="antirot-btn antirot-btn-primary">← Go Back</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlayElement);

  // Inject random motivational quote
  const quotes = [
    "The grind doesn't stop for a 10-minute distraction.",
    "You're not bored. You're avoiding the work that matters.",
    "Discipline is choosing between what you want now and what you want most.",
    "Every minute here is a minute stolen from your future self.",
    "Winners don't scroll. They build.",
    "Your competition is working right now. Are you?",
    "Comfort is the enemy of growth.",
    "You didn't come this far to only come this far.",
    "The algorithm feeds you what keeps you average.",
    "Hard choices, easy life. Easy choices, hard life.",
  ];
  const quoteEl = document.getElementById('antirot-quote');
  quoteEl.textContent = `"${quotes[Math.floor(Math.random() * quotes.length)]}"`;

  // Pause the video
  const video = document.querySelector('video');
  if (video) video.pause();

  // Button listeners
  document.getElementById('antirot-goback').addEventListener('click', () => {
    window.history.back();
  });

  // Animate in
  requestAnimationFrame(() => {
    overlayElement.classList.add('antirot-visible');
  });
}

function cleanup() {
  if (overlayElement) {
    overlayElement.classList.remove('antirot-visible');
    setTimeout(() => {
      overlayElement?.remove();
      overlayElement = null;
    }, 300);
  }
  removeLoading();
}

// ── YouTube SPA Navigation Detection ──
// YouTube doesn't do full page loads between videos, so we listen for navigation events

// Method 1: YouTube's custom navigation event
window.addEventListener('yt-navigate-finish', () => {
  processVideo();
});

// Method 2: popstate for back/forward
window.addEventListener('popstate', () => {
  currentVideoId = null; // reset so we reprocess
  processVideo();
});

// Method 3: URL change observer (fallback)
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    currentVideoId = null;
    processVideo();
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

// Method 4: Initial page load
processVideo();

// ── Listen for toggle and theme changes from popup ──
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'toggleChanged') {
    if (!message.enabled) {
      cleanup();
      currentVideoId = null;
    } else {
      currentVideoId = null;
      processVideo();
    }
  }

  if (message.action === 'themeChanged') {
    currentTheme = message.theme;
    // Update live elements
    if (overlayElement) overlayElement.dataset.theme = currentTheme;
    if (loadingElement) loadingElement.dataset.theme = currentTheme;
  }
});
