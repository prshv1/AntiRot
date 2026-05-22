// ── State ──
let currentVideoId = null;
let isProcessing = false;
let overlayElement = null;
let loadingElement = null;
let currentTheme = 'dark';
let currentEnabled = true;
let focusSettings = null;
let focusStyleElement = null;
let focusRefreshTimer = null;
let focusRedirecting = false;

const FOCUS_STYLE_ID = 'antirot-focus-style';
const FOCUS_SETTINGS_KEY = 'focusSettings';
const DEFAULT_FOCUS_SETTINGS = {
  hideHomeFeed: false,
  redirectHomeToSubscriptions: false,
  hideVideoSidebar: false,
  hideRecommended: false,
  hideLiveChat: false,
  hidePlaylist: false,
  hideFundraiser: false,
  hideEndScreenFeed: false,
  hideEndScreenCards: false,
  hideShorts: false,
  redirectShorts: false,
  hideComments: false,
  hideMixes: false,
  hideMerchOffers: false,
  hideVideoInfo: false,
  hideTopHeader: false,
  hideNotifications: false,
  hideInaptSearchResults: false,
  hideExploreTrending: false,
  hideMoreFromYouTube: false,
  hideSubscriptions: false,
  disableAutoplay: false,
  disableAnnotations: false,
  minimalWatchPage: false,
  hideSidebar: false,
  hideEndScreen: false,
  hideSearchDistractions: false,
};

// ── Load saved visual and focus settings ──
chrome.storage.local.get(['theme', 'enabled', FOCUS_SETTINGS_KEY], (data) => {
  currentTheme = data.theme || 'dark';
  currentEnabled = data.enabled !== false;
  focusSettings = normalizeFocusSettings(data[FOCUS_SETTINGS_KEY]);
  applyFocusControls();
});

function normalizeFocusSettings(settings) {
  const normalized = {
    ...DEFAULT_FOCUS_SETTINGS,
    ...(settings || {}),
  };

  if (settings?.hideSidebar) normalized.hideVideoSidebar = true;
  if (settings?.hideEndScreen) {
    normalized.hideEndScreenFeed = true;
    normalized.hideEndScreenCards = true;
  }
  if (settings?.hideSearchDistractions) normalized.hideInaptSearchResults = true;

  return normalized;
}

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

// ── Focus Controls ──
function applyFocusControls() {
  if (!focusSettings) return;

  if (!currentEnabled) {
    removeFocusStyle();
    return;
  }

  const css = buildFocusCss(focusSettings);
  if (!css) {
    removeFocusStyle();
  } else {
    ensureFocusStyle().textContent = css;
  }

  scheduleFocusRefresh(0);
}

function ensureFocusStyle() {
  if (focusStyleElement?.isConnected) return focusStyleElement;

  focusStyleElement = document.getElementById(FOCUS_STYLE_ID);
  if (!focusStyleElement) {
    focusStyleElement = document.createElement('style');
    focusStyleElement.id = FOCUS_STYLE_ID;
    document.documentElement.appendChild(focusStyleElement);
  }
  return focusStyleElement;
}

function removeFocusStyle() {
  focusStyleElement?.remove();
  focusStyleElement = null;
  clearRuntimeFocusHides();
}

function buildFocusCss(settings) {
  const rules = [];
  const hideVideoSidebar = settings.hideVideoSidebar || settings.hideSidebar || settings.minimalWatchPage;
  const hideRecommended = settings.hideRecommended || settings.minimalWatchPage;
  const hideLiveChat = settings.hideLiveChat || settings.minimalWatchPage;
  const hidePlaylist = settings.hidePlaylist || settings.minimalWatchPage;
  const hideFundraiser = settings.hideFundraiser || settings.minimalWatchPage;
  const hideEndScreenFeed = settings.hideEndScreenFeed || settings.hideEndScreen || settings.minimalWatchPage;
  const hideEndScreenCards = settings.hideEndScreenCards || settings.hideEndScreen || settings.minimalWatchPage;
  const hideComments = settings.hideComments || settings.minimalWatchPage;
  const hideShorts = settings.hideShorts || settings.minimalWatchPage;
  const hideMixes = settings.hideMixes || settings.minimalWatchPage;
  const hideMerchOffers = settings.hideMerchOffers || settings.minimalWatchPage;
  const hideVideoInfo = settings.hideVideoInfo || settings.minimalWatchPage;
  const hideInaptSearchResults = settings.hideInaptSearchResults || settings.hideSearchDistractions;
  const disableAnnotations = settings.disableAnnotations || settings.minimalWatchPage;

  if (settings.hideHomeFeed) {
    rules.push(`
      ytd-browse[page-subtype="home"] #contents,
      ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
      ytd-browse[page-subtype="home"] ytd-two-column-browse-results-renderer,
      ytd-browse[page-subtype="home"] ytd-section-list-renderer {
        display: none !important;
      }
    `);
  }

  if (hideVideoSidebar) {
    rules.push(`
      ytd-watch-flexy #secondary,
      ytd-watch-flexy #related,
      ytd-watch-flexy ytd-watch-next-secondary-results-renderer {
        display: none !important;
      }

      ytd-watch-flexy #columns {
        justify-content: center !important;
      }

      ytd-watch-flexy #primary {
        max-width: min(100%, 1120px) !important;
      }
    `);
  }

  if (hideRecommended) {
    rules.push(`
      ytd-watch-flexy ytd-watch-next-secondary-results-renderer,
      ytd-watch-flexy #related ytd-compact-video-renderer,
      ytd-watch-flexy #related ytd-compact-radio-renderer,
      ytd-watch-flexy #related ytd-compact-playlist-renderer,
      ytd-watch-flexy #related ytd-reel-shelf-renderer,
      ytd-watch-flexy #secondary ytd-rich-grid-renderer {
        display: none !important;
      }
    `);
  }

  if (hideLiveChat) {
    rules.push(`
      ytd-watch-flexy #chat,
      ytd-watch-flexy #chat-container,
      ytd-watch-flexy ytd-live-chat-frame {
        display: none !important;
      }
    `);
  }

  if (hidePlaylist) {
    rules.push(`
      ytd-watch-flexy #playlist,
      ytd-watch-flexy ytd-playlist-panel-renderer,
      ytd-playlist-panel-renderer {
        display: none !important;
      }
    `);
  }

  if (hideFundraiser) {
    rules.push(`
      ytd-donation-shelf-renderer,
      ytd-fundraiser-renderer,
      ytd-watch-flexy #donation-shelf,
      ytd-watch-flexy [is-donation-shelf] {
        display: none !important;
      }
    `);
  }

  if (hideShorts) {
    rules.push(`
      ytd-rich-shelf-renderer[is-shorts],
      ytd-reel-shelf-renderer,
      ytd-reel-video-renderer,
      ytm-shorts-lockup-view-model,
      ytd-rich-section-renderer:has(a[href^="/shorts"]),
      ytd-rich-item-renderer:has(a[href^="/shorts"]),
      ytd-video-renderer:has(a[href^="/shorts"]),
      ytd-grid-video-renderer:has(a[href^="/shorts"]),
      ytd-compact-video-renderer:has(a[href^="/shorts"]),
      ytd-mini-guide-entry-renderer:has(a[title="Shorts"]),
      ytd-guide-entry-renderer:has(a[title="Shorts"]),
      a[title="Shorts"][href^="/shorts"] {
        display: none !important;
      }
    `);
  }

  if (hideComments) {
    rules.push(`
      ytd-watch-flexy #comments,
      ytd-comments {
        display: none !important;
      }
    `);
  }

  if (hideMixes) {
    rules.push(`
      ytd-radio-renderer,
      ytd-compact-radio-renderer,
      ytd-rich-item-renderer:has(a[href*="start_radio=1"]),
      ytd-rich-item-renderer:has(a[href*="list=RD"]),
      ytd-video-renderer:has(a[href*="start_radio=1"]),
      ytd-video-renderer:has(a[href*="list=RD"]),
      ytd-grid-video-renderer:has(a[href*="start_radio=1"]),
      ytd-grid-video-renderer:has(a[href*="list=RD"]),
      ytd-compact-video-renderer:has(a[href*="start_radio=1"]),
      ytd-compact-video-renderer:has(a[href*="list=RD"]) {
        display: none !important;
      }
    `);
  }

  if (hideMerchOffers) {
    rules.push(`
      ytd-merch-shelf-renderer,
      ytd-ticket-shelf-renderer,
      ytd-product-shelf-renderer,
      ytd-shopping-product-shelf-renderer,
      ytd-commerce-offer-renderer,
      ytd-watch-flexy #ticket-shelf,
      ytd-watch-flexy #merch-shelf,
      ytd-watch-flexy #offer-module,
      ytd-structured-description-content-renderer:has(a[href*="/merch"]) {
        display: none !important;
      }
    `);
  }

  if (hideVideoInfo) {
    rules.push(`
      ytd-watch-flexy ytd-watch-metadata,
      ytd-watch-flexy ytd-video-primary-info-renderer,
      ytd-watch-flexy ytd-video-secondary-info-renderer,
      ytd-watch-flexy #above-the-fold,
      ytd-watch-flexy #meta,
      ytd-watch-flexy #info,
      ytd-watch-flexy #description {
        display: none !important;
      }
    `);
  }

  if (settings.hideTopHeader) {
    rules.push(`
      ytd-masthead,
      #masthead,
      #masthead-container {
        display: none !important;
      }

      ytd-app {
        --ytd-masthead-height: 0px !important;
      }

      ytd-page-manager {
        margin-top: 0 !important;
      }
    `);
  }

  if (settings.hideNotifications) {
    rules.push(`
      ytd-notification-topbar-button-renderer,
      button[aria-label*="Notifications"],
      a[href="/feed/notifications"],
      ytd-guide-entry-renderer:has(a[href="/feed/notifications"]) {
        display: none !important;
      }
    `);
  }

  if (settings.hideExploreTrending) {
    rules.push(`
      a[title="Explore"],
      a[title="Trending"],
      a[href="/feed/explore"],
      a[href="/feed/trending"],
      ytd-guide-entry-renderer:has(a[href="/feed/explore"]),
      ytd-guide-entry-renderer:has(a[href="/feed/trending"]),
      ytd-mini-guide-entry-renderer:has(a[href="/feed/explore"]),
      ytd-mini-guide-entry-renderer:has(a[href="/feed/trending"]) {
        display: none !important;
      }
    `);
  }

  if (settings.hideMoreFromYouTube) {
    rules.push(`
      ytd-guide-section-renderer:has(a[href="/premium"]),
      ytd-guide-section-renderer:has(a[href="/gaming"]),
      ytd-guide-section-renderer:has(a[href="/music"]),
      ytd-guide-section-renderer:has(a[href="/sports"]),
      ytd-guide-section-renderer:has(a[href="/podcasts"]),
      ytd-guide-section-renderer:has(a[href="/movies"]),
      ytd-guide-entry-renderer:has(a[href="/premium"]),
      ytd-guide-entry-renderer:has(a[href="/gaming"]),
      ytd-guide-entry-renderer:has(a[href="/music"]),
      ytd-guide-entry-renderer:has(a[href="/sports"]),
      ytd-guide-entry-renderer:has(a[href="/podcasts"]),
      ytd-guide-entry-renderer:has(a[href="/movies"]) {
        display: none !important;
      }
    `);
  }

  if (settings.hideSubscriptions) {
    rules.push(`
      a[title="Subscriptions"][href="/feed/subscriptions"],
      ytd-guide-entry-renderer:has(a[href="/feed/subscriptions"]),
      ytd-mini-guide-entry-renderer:has(a[href="/feed/subscriptions"]) {
        display: none !important;
      }
    `);
  }

  if (hideEndScreenFeed) {
    rules.push(`
      .ytp-endscreen-content,
      .ytp-suggestion-set {
        display: none !important;
      }
    `);
  }

  if (hideEndScreenCards) {
    rules.push(`
      .ytp-ce-element,
      .ytp-ce-covering-overlay {
        display: none !important;
      }
    `);
  }

  if (disableAnnotations) {
    rules.push(`
      .annotation,
      .video-annotations,
      .ytp-cards-teaser,
      .ytp-card-content,
      .ytp-cards-button,
      .iv-branding {
        display: none !important;
      }
    `);
  }

  if (hideInaptSearchResults) {
    rules.push(`
      ytd-search ytd-reel-shelf-renderer,
      ytd-search ytd-horizontal-card-list-renderer,
      ytd-search ytd-shelf-renderer,
      ytd-search ytd-secondary-search-container-renderer,
      ytd-search ytd-rich-section-renderer,
      ytd-search ytd-radio-renderer,
      ytd-search ytd-video-renderer:has(a[href^="/shorts"]),
      ytd-search ytd-video-renderer:has(a[href*="start_radio=1"]),
      ytd-search ytd-video-renderer:has(a[href*="list=RD"]) {
        display: none !important;
      }
    `);
  }

  if (settings.minimalWatchPage) {
    rules.push(`
      ytd-watch-flexy ytd-reel-shelf-renderer,
      ytd-watch-flexy ytd-horizontal-card-list-renderer,
      ytd-watch-flexy ytd-engagement-panel-section-list-renderer,
      ytd-watch-flexy #clarify-box {
        display: none !important;
      }
    `);
  }

  return rules.join('\n').trim();
}

function scheduleFocusRefresh(delay = 100) {
  clearTimeout(focusRefreshTimer);
  focusRefreshTimer = setTimeout(() => {
    focusRefreshTimer = null;
    applyRuntimeFocusEffects();
  }, delay);
}

function applyRuntimeFocusEffects() {
  if (!currentEnabled || !focusSettings) return;

  clearRuntimeFocusHides();

  if (focusSettings.hideMoreFromYouTube) {
    hideGuideSectionsByTitle(['more from youtube']);
  }

  if (focusSettings.hideSubscriptions) {
    hideGuideSectionsByTitle(['subscriptions']);
  }

  if (
    focusSettings.redirectHomeToSubscriptions
    && !focusSettings.hideSubscriptions
    && isHomeFeedPath()
  ) {
    redirectToFocusFallback('/feed/subscriptions');
    return;
  }

  if (focusSettings.hideExploreTrending && isExploreOrTrendingPath()) {
    redirectToFocusFallback(getDefaultFocusFallbackPath());
    return;
  }

  if (focusSettings.redirectShorts && window.location.pathname.startsWith('/shorts')) {
    redirectToFocusFallback(getDefaultFocusFallbackPath());
    return;
  }

  if (focusSettings.disableAutoplay || focusSettings.minimalWatchPage) {
    disableAutoplayIfEnabled();
  }
}

function clearRuntimeFocusHides() {
  document.querySelectorAll('[data-antirot-focus-hidden="true"]').forEach((el) => {
    el.style.removeProperty('display');
    delete el.dataset.antirotFocusHidden;
  });
}

function hideGuideSectionsByTitle(titleMatches) {
  document.querySelectorAll('ytd-guide-section-renderer').forEach((section) => {
    const titleEl = section.querySelector('#guide-section-title, yt-formatted-string#guide-section-title');
    const title = titleEl?.textContent?.trim().toLowerCase();

    if (title && titleMatches.some((match) => title.includes(match))) {
      section.dataset.antirotFocusHidden = 'true';
      section.style.setProperty('display', 'none', 'important');
    }
  });
}

function isHomeFeedPath() {
  return window.location.pathname === '/' || window.location.pathname === '/feed/what_to_watch';
}

function isExploreOrTrendingPath() {
  return window.location.pathname === '/feed/explore' || window.location.pathname === '/feed/trending';
}

function getDefaultFocusFallbackPath() {
  if (focusSettings.redirectHomeToSubscriptions && !focusSettings.hideSubscriptions) {
    return '/feed/subscriptions';
  }
  return '/';
}

function redirectToFocusFallback(path) {
  if (focusRedirecting) return;

  focusRedirecting = true;
  window.location.replace(`https://www.youtube.com${path}`);
  setTimeout(() => {
    focusRedirecting = false;
  }, 1200);
}

function disableAutoplayIfEnabled() {
  const autoplayToggle = document.querySelector(
    '.ytp-autonav-toggle-button[aria-checked="true"], button.ytp-autonav-toggle-button[aria-checked="true"]'
  );

  if (autoplayToggle) {
    autoplayToggle.click();
  }
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
  currentEnabled = enabled;
  if (!enabled) {
    applyFocusControls();
    isProcessing = false;
    return;
  }

  // Wait briefly for channel info to load
  const channelName = await waitForChannelName(4000);

  // Check whitelist
  if (channelName) {
    const whitelisted = await isChannelWhitelisted(channelName);
    if (whitelisted) {
      console.log(`[AntiRot] Channel "${channelName}" is whitelisted. Skipping.`);
      isProcessing = false;
      return;
    }
  }

  // Show loading state
  showLoading();
  console.log('[AntiRot] Classifying video:', window.location.href);

  // Send to background for classification
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'classifyVideo',
      url: window.location.href,
    });

    console.log('[AntiRot] Classification response:', JSON.stringify(response));

    if (!response) {
      console.error('[AntiRot] No response from background script — service worker may be inactive.');
      removeLoading();
      isProcessing = false;
      return;
    }

    removeLoading();

    if (response.action === 'blocked') {
      console.log('[AntiRot] Video BLOCKED.');
      showBlockOverlay();
    } else {
      console.log(`[AntiRot] Video allowed (reason: ${response.reason || 'classified_ok'}).`);
      cleanup();
    }
  } catch (err) {
    console.error('[AntiRot] Message error:', err);
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
    loadingElement.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    loadingElement.style.opacity = '0';
    loadingElement.style.transform = 'translateY(-8px)';
    const el = loadingElement;
    loadingElement = null;
    setTimeout(() => el.remove(), 250);
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
      <p class="antirot-subtitle">AntiRot blocked this video because it doesn't align with your goals.</p>
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

function handleYoutubeNavigation() {
  applyFocusControls();
  scheduleFocusRefresh(250);
  processVideo();
}

// ── YouTube SPA Navigation Detection ──
// YouTube doesn't do full page loads between videos, so we listen for navigation events

// Method 1: YouTube's custom navigation event
window.addEventListener('yt-navigate-finish', () => {
  handleYoutubeNavigation();
});

// Method 2: popstate for back/forward
window.addEventListener('popstate', () => {
  currentVideoId = null; // reset so we reprocess
  handleYoutubeNavigation();
});

// Method 3: URL change observer (fallback)
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    currentVideoId = null;
    handleYoutubeNavigation();
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

// Method 4: Initial page load
handleYoutubeNavigation();

// Autoplay controls are mounted lazily, so check periodically when enabled.
setInterval(() => {
  if (needsRuntimeFocusEffects()) {
    applyRuntimeFocusEffects();
  }
}, 1500);

function needsRuntimeFocusEffects() {
  return Boolean(
    focusSettings?.disableAutoplay
    || focusSettings?.minimalWatchPage
    || focusSettings?.redirectShorts
    || focusSettings?.redirectHomeToSubscriptions
    || focusSettings?.hideExploreTrending
    || focusSettings?.hideMoreFromYouTube
    || focusSettings?.hideSubscriptions
  );
}

// ── Listen for toggle and theme changes from popup ──
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'toggleChanged') {
    currentEnabled = message.enabled;
    applyFocusControls();

    if (!message.enabled) {
      cleanup();
      currentVideoId = null;
    } else {
      currentVideoId = null;
      handleYoutubeNavigation();
    }
  }

  if (message.action === 'themeChanged') {
    currentTheme = message.theme;
    // Update live elements
    if (overlayElement) overlayElement.dataset.theme = currentTheme;
    if (loadingElement) loadingElement.dataset.theme = currentTheme;
  }

  if (message.action === 'focusSettingsChanged') {
    focusSettings = normalizeFocusSettings(message.settings);
    applyFocusControls();
  }
});
