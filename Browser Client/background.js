// ── Config ──
const API_BASE = 'https://anti-rot-341863309794.us-central1.run.app';
const CLASSIFY_URL = `${API_BASE}/classify`;

// Cache to avoid re-classifying the same video
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
    const data = await getStorage(['enabled']);
    if (data.enabled === false) {
      sendResponse({ action: 'allowed', reason: 'extension_disabled' });
      return;
    }

    // Check cache first
    const videoId = extractVideoId(videoUrl);
    if (videoId && classificationCache.has(videoId)) {
      const cached = classificationCache.get(videoId);
      sendResponse(cached);
      return;
    }

    // Call API
    const response = await fetch(CLASSIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[Anti-Rot] API error:', response.status, errData);
      // On API error, default to allowing the video (fail open)
      sendResponse({ action: 'allowed', reason: 'api_error' });
      return;
    }

    const result = await response.json();
    // category: 0 = non-valuable (block), 1 = valuable (allow)
    const isValuable = result.category === 1;

    const responseData = {
      action: isValuable ? 'allowed' : 'blocked',
      category: result.category,
    };

    // Cache the result
    if (videoId) {
      classificationCache.set(videoId, responseData);
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
    console.error('[Anti-Rot] Classification failed:', err);
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
    return urlObj.searchParams.get('v');
  } catch {
    return null;
  }
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

// ── Install Handler ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    whitelist: [],
    blockedVideos: 0,
    allowedVideos: 0,
  });
  console.log('[Anti-Rot] Extension installed, shield active.');
});
