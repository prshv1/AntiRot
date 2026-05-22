const API_BASE = 'https://api.antirot.in';
const CLASSIFY_URL = `${API_BASE}/classify`;
const REGISTER_INSTALL_URL = `${API_BASE}/installs/register`;
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
const DEFAULT_COLLAPSED_SECTIONS = {
  uiBlocking: false,
  rules: true,
};

// Cache to avoid re-classifying the same video when no custom rules are active
const classificationCache = new Map();

// ── Message Handler ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'classifyVideo') {
    handleClassification(message.url, sender.tab.id, sendResponse);
    return true; // keep channel open for async response
  }

  if (message.action === 'getState') {
    chrome.storage.local.get(['enabled'], (data) => {
      sendResponse({ enabled: data.enabled !== false });
    });
    return true;
  }
});

// ── Classification Logic ──
async function handleClassification(videoUrl, tabId, sendResponse) {
  try {
    // Check if extension is enabled
    const data = await getStorage([
      'enabled',
      'customInstructions',
      'installId',
      'installToken',
    ]);
    if (data.enabled === false) {
      sendResponse({ action: 'allowed', reason: 'extension_disabled' });
      return;
    }

    const userInstructions = data.customInstructions || '';

    // Check extension cache only when default rules are active. Custom instructions
    // should always reach the server so OpenRouter can apply the latest user rules.
    const cacheKey = getClassificationCacheKey(videoUrl);
    if (cacheKey && !userInstructions.trim() && classificationCache.has(cacheKey)) {
      const cached = classificationCache.get(cacheKey);
      console.log('[AntiRot] Cache hit for', cacheKey, cached);
      sendResponse(cached);
      return;
    }

    let installCredentials = await getOrCreateInstallCredentials(
      data.installId,
      data.installToken
    );

    // Call API
    console.log('[AntiRot] Fetching classification from:', CLASSIFY_URL, 'for video:', videoUrl);
    let response = await requestClassification(videoUrl, userInstructions, installCredentials);

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      console.warn('[AntiRot] Install credentials rejected. Registering a fresh install token.');
      await removeStorage(['installId', 'installToken']);
      installCredentials = await registerInstall();
      response = await requestClassification(videoUrl, userInstructions, installCredentials);
    }

    console.log('[AntiRot] API response status:', response.status);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[AntiRot] API error:', response.status, errData);
      // On API error, default to allowing the video (fail open)
      sendResponse({ action: 'allowed', reason: 'api_error' });
      return;
    }

    const result = await response.json();
    console.log('[AntiRot] API result:', JSON.stringify(result));
    // category: 0 = non-valuable (block), 1 = valuable (allow)
    const isValuable = result.category === 1;

    const responseData = {
      action: isValuable ? 'allowed' : 'blocked',
      category: result.category,
    };

    // Cache the result
    if (cacheKey && !userInstructions.trim()) {
      classificationCache.set(cacheKey, responseData);
      // Evict old cache entries (keep last 100)
      if (classificationCache.size > 100) {
        const firstKey = classificationCache.keys().next().value;
        classificationCache.delete(firstKey);
      }
    }

    // Update stats
    await updateStats(isValuable);

    sendResponse(responseData);
  } catch (err) {
    console.error('[AntiRot] Classification failed:', err);
    sendResponse({ action: 'allowed', reason: 'error' });
  }
}

// ── Stats ──
async function updateStats(isValuable) {
  const key = isValuable ? 'allowedVideos' : 'blockedVideos';
  const data = await getStorage([key]);
  const current = data[key] || 0;
  await setStorage({ [key]: current + 1 });
}

// ── Helpers ──
function extractVideoId(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.endsWith('youtu.be')) {
      return urlObj.pathname.split('/').filter(Boolean)[0] || null;
    }
    if (urlObj.pathname.startsWith('/shorts/')) {
      return urlObj.pathname.split('/').filter(Boolean)[1] || null;
    }
    return urlObj.searchParams.get('v');
  } catch {
    return null;
  }
}

function getClassificationCacheKey(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  const videoKey = videoId || videoUrl.trim();
  if (!videoKey) return null;

  return videoKey;
}

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

function removeStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

async function getOrCreateInstallCredentials(existingInstallId, existingInstallToken) {
  if (existingInstallId && existingInstallToken) {
    return {
      installId: existingInstallId,
      installToken: existingInstallToken,
    };
  }

  return registerInstall(existingInstallId);
}

async function registerInstall(existingInstallId = null) {
  const response = await fetch(REGISTER_INSTALL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requested_install_id: existingInstallId || null,
      client: getClientMetadata(),
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Install registration failed: ${response.status} ${JSON.stringify(errData)}`);
  }

  const credentials = await response.json();
  if (!credentials.install_id || !credentials.install_token) {
    throw new Error('Install registration response was missing credentials.');
  }

  await setStorage({
    installId: credentials.install_id,
    installToken: credentials.install_token,
  });

  return {
    installId: credentials.install_id,
    installToken: credentials.install_token,
  };
}

function requestClassification(videoUrl, userInstructions, installCredentials) {
  return fetch(CLASSIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: videoUrl,
      instructions: userInstructions,
      install_id: installCredentials.installId,
      install_token: installCredentials.installToken,
      client: getClientMetadata(),
    }),
  });
}

function getClientMetadata() {
  const manifest = chrome.runtime.getManifest();
  const nav = globalThis.navigator || {};

  return {
    extension_version: manifest.version,
    extension_name: manifest.name,
    api_base: API_BASE,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: nav.language || null,
    platform: nav.platform || null,
    user_agent: nav.userAgent || null,
  };
}

// ── Install Handler ──
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const existing = await getStorage([
    'installId',
    'installToken',
    'enabled',
    'whitelist',
    'blockedVideos',
    'allowedVideos',
    'customInstructions',
    'focusSettings',
    'collapsedSections',
  ]);
  let installCredentials = null;

  try {
    installCredentials = await getOrCreateInstallCredentials(
      existing.installId,
      existing.installToken
    );
  } catch (err) {
    console.warn('[AntiRot] Install registration will retry on first classification.', err);
  }

  if (reason === 'install') {
    await setStorage({
      enabled: true,
      whitelist: [],
      blockedVideos: 0,
      allowedVideos: 0,
      customInstructions: '',
      focusSettings: DEFAULT_FOCUS_SETTINGS,
      collapsedSections: DEFAULT_COLLAPSED_SECTIONS,
      ...(installCredentials
        ? {
            installId: installCredentials.installId,
            installToken: installCredentials.installToken,
          }
        : {}),
    });
  } else {
    await setStorage({
      ...(installCredentials
        ? {
            installId: installCredentials.installId,
            installToken: installCredentials.installToken,
          }
        : {}),
      enabled: existing.enabled !== undefined ? existing.enabled : true,
      whitelist: existing.whitelist || [],
      blockedVideos: existing.blockedVideos || 0,
      allowedVideos: existing.allowedVideos || 0,
      customInstructions: existing.customInstructions || '',
      focusSettings: {
        ...DEFAULT_FOCUS_SETTINGS,
        ...(existing.focusSettings || {}),
      },
      collapsedSections: {
        ...DEFAULT_COLLAPSED_SECTIONS,
        ...(existing.collapsedSections || {}),
      },
    });
  }

  console.log('[AntiRot] Extension installed, shield active.');
});
