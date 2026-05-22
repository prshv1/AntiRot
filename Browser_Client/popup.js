if (!globalThis.chrome?.storage?.local) {
  const storageKey = 'antirot-dev-storage';

  function readDevStorage() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch {
      return {};
    }
  }

  const chromeFallback = globalThis.chrome || {};
  chromeFallback.storage = {
    local: {
      get(keys, callback) {
        const data = readDevStorage();

        if (Array.isArray(keys)) {
          callback(Object.fromEntries(keys.map((key) => [key, data[key]])));
          return;
        }

        if (typeof keys === 'string') {
          callback({ [keys]: data[keys] });
          return;
        }

        callback(data);
      },
      set(value, callback) {
        localStorage.setItem(storageKey, JSON.stringify({ ...readDevStorage(), ...value }));
        callback?.();
      },
    },
  };
  chromeFallback.tabs = chromeFallback.tabs || {
    query(_query, callback) {
      callback([]);
    },
  };
  globalThis.chrome = chromeFallback;
}

// ── DOM Elements ──
const toggleSwitch = document.getElementById('toggleSwitch');
const statusText = document.getElementById('statusText');
const blockedCount = document.getElementById('blockedCount');
const allowedCount = document.getElementById('allowedCount');
const channelInput = document.getElementById('channelInput');
const addChannelBtn = document.getElementById('addChannelBtn');
const whitelistContainer = document.getElementById('whitelistContainer');
const whitelistCount = document.getElementById('whitelistCount');
const emptyHint = document.getElementById('emptyHint');
const themeToggle = document.getElementById('themeToggle');
const instructionsInput = document.getElementById('instructionsInput');
const saveInstructionsBtn = document.getElementById('saveInstructionsBtn');
const focusToggles = Array.from(document.querySelectorAll('.focus-toggle'));
const presetButtons = Array.from(document.querySelectorAll('.preset-btn'));
const sectionToggles = Array.from(document.querySelectorAll('[data-section-toggle]'));

const FOCUS_SETTINGS_KEY = 'focusSettings';
const FOCUS_LEGACY_KEYS = new Set(['hideSidebar', 'hideEndScreen', 'hideSearchDistractions']);
const COLLAPSED_SECTIONS_KEY = 'collapsedSections';
const DEFAULT_COLLAPSED_SECTIONS = {
  uiBlocking: false,
  rules: true,
};
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
const FOCUS_PRESETS = {
  off: { ...DEFAULT_FOCUS_SETTINGS },
  balanced: {
    ...DEFAULT_FOCUS_SETTINGS,
    hideVideoSidebar: true,
    hideRecommended: true,
    hideShorts: true,
    hideEndScreenFeed: true,
    hideEndScreenCards: true,
    disableAutoplay: true,
    disableAnnotations: true,
    hideInaptSearchResults: true,
  },
  strict: {
    ...DEFAULT_FOCUS_SETTINGS,
    hideHomeFeed: true,
    redirectHomeToSubscriptions: true,
    hideVideoSidebar: true,
    hideRecommended: true,
    hideLiveChat: true,
    hidePlaylist: true,
    hideFundraiser: true,
    hideEndScreenFeed: true,
    hideEndScreenCards: true,
    hideShorts: true,
    redirectShorts: true,
    hideComments: true,
    hideMixes: true,
    hideMerchOffers: true,
    hideVideoInfo: true,
    hideTopHeader: false,
    hideNotifications: true,
    hideInaptSearchResults: true,
    hideExploreTrending: true,
    hideMoreFromYouTube: true,
    hideSubscriptions: false,
    disableAutoplay: true,
    disableAnnotations: true,
    minimalWatchPage: true,
    hideSidebar: false,
    hideEndScreen: false,
    hideSearchDistractions: false,
  },
};

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  loadSectionState();
  loadState();
  loadStats();
  loadWhitelist();
  loadTheme();
  loadInstructions();
  loadFocusSettings();
});

// ── Collapsible Sections ──
function loadSectionState() {
  chrome.storage.local.get([COLLAPSED_SECTIONS_KEY], (data) => {
    renderSectionState(normalizeSectionState(data[COLLAPSED_SECTIONS_KEY]));
  });
}

function normalizeSectionState(savedState) {
  const state = {
    ...DEFAULT_COLLAPSED_SECTIONS,
    ...(savedState || {}),
  };

  if (savedState && savedState.rules === undefined) {
    state.rules = Boolean(savedState.whitelist) && Boolean(savedState.customInstructions);
  }

  return state;
}

function renderSectionState(state) {
  sectionToggles.forEach((button) => {
    const sectionName = button.dataset.sectionToggle;
    const section = document.querySelector(`[data-section="${sectionName}"]`);
    const isCollapsed = Boolean(state[sectionName]);

    section?.classList.toggle('collapsed', isCollapsed);
    button.setAttribute('aria-expanded', String(!isCollapsed));
  });
}

function toggleSection(sectionName) {
  chrome.storage.local.get([COLLAPSED_SECTIONS_KEY], (data) => {
    const state = normalizeSectionState(data[COLLAPSED_SECTIONS_KEY]);
    state[sectionName] = !Boolean(state[sectionName]);

    chrome.storage.local.set({ [COLLAPSED_SECTIONS_KEY]: state }, () => {
      renderSectionState(state);
    });
  });
}

sectionToggles.forEach((button) => {
  button.addEventListener('click', () => {
    toggleSection(button.dataset.sectionToggle);
  });
});

// ── Toggle Logic ──
toggleSwitch.addEventListener('change', () => {
  const isActive = toggleSwitch.checked;
  chrome.storage.local.set({ enabled: isActive });
  updateToggleUI(isActive);

  // Notify all YouTube tabs about the state change
  chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleChanged', enabled: isActive }).catch(() => {});
    });
  });
});

function updateToggleUI(isActive) {
  statusText.textContent = isActive ? 'Active' : 'Paused';
  statusText.classList.toggle('inactive', !isActive);
}

// ── Stats ──
function loadStats() {
  chrome.storage.local.get(['blockedVideos', 'allowedVideos'], (data) => {
    blockedCount.textContent = data.blockedVideos || 0;
    allowedCount.textContent = data.allowedVideos || 0;
  });
}

// ── State ──
function loadState() {
  chrome.storage.local.get(['enabled'], (data) => {
    const isActive = data.enabled !== false; // default ON
    toggleSwitch.checked = isActive;
    updateToggleUI(isActive);
  });
}

// ── Whitelist ──
function loadWhitelist() {
  chrome.storage.local.get(['whitelist'], (data) => {
    const list = data.whitelist || [];
    renderWhitelist(list);
  });
}

function renderWhitelist(list) {
  whitelistContainer.innerHTML = '';
  whitelistCount.textContent = list.length;

  if (list.length === 0) {
    emptyHint.classList.remove('hidden');
  } else {
    emptyHint.classList.add('hidden');
    list.forEach((channel, index) => {
      const item = document.createElement('div');
      item.className = 'channel-item';
      item.innerHTML = `
        <span class="channel-name" title="${escapeHtml(channel)}">${escapeHtml(channel)}</span>
        <button class="remove-btn" data-index="${index}" title="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;
      whitelistContainer.appendChild(item);
    });
  }

  // Attach remove listeners
  document.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      removeChannel(idx);
    });
  });
}

function addChannel(name) {
  const cleaned = name.trim();
  if (!cleaned) return;

  chrome.storage.local.get(['whitelist'], (data) => {
    const list = data.whitelist || [];

    // Check for duplicates (case-insensitive)
    if (list.some((ch) => ch.toLowerCase() === cleaned.toLowerCase())) {
      shakeInput();
      return;
    }

    list.push(cleaned);
    chrome.storage.local.set({ whitelist: list }, () => {
      renderWhitelist(list);
      channelInput.value = '';
      channelInput.focus();
    });
  });
}

function removeChannel(index) {
  chrome.storage.local.get(['whitelist'], (data) => {
    const list = data.whitelist || [];
    list.splice(index, 1);
    chrome.storage.local.set({ whitelist: list }, () => {
      renderWhitelist(list);
    });
  });
}

// ── Input Handling ──
addChannelBtn.addEventListener('click', () => {
  addChannel(channelInput.value);
});

channelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addChannel(channelInput.value);
  }
});

// ── Focus Controls ──
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

function prepareFocusSettingsForStorage(settings) {
  const normalized = normalizeFocusSettings(settings);
  normalized.hideSidebar = normalized.hideVideoSidebar;
  normalized.hideEndScreen = normalized.hideEndScreenFeed || normalized.hideEndScreenCards;
  normalized.hideSearchDistractions = normalized.hideInaptSearchResults;
  return normalized;
}

function loadFocusSettings() {
  chrome.storage.local.get([FOCUS_SETTINGS_KEY], (data) => {
    renderFocusSettings(normalizeFocusSettings(data[FOCUS_SETTINGS_KEY]));
  });
}

function renderFocusSettings(settings) {
  focusToggles.forEach((toggle) => {
    toggle.checked = Boolean(settings[toggle.dataset.focusKey]);
  });
  updatePresetState(settings);
}

function updatePresetState(settings) {
  const matchedPreset = Object.entries(FOCUS_PRESETS).find(([, preset]) => (
    focusSettingsEqual(settings, preset)
  ))?.[0] || 'custom';

  presetButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.focusPreset === matchedPreset);
  });
}

function focusSettingsEqual(left, right) {
  return Object.keys(DEFAULT_FOCUS_SETTINGS)
    .filter((key) => !FOCUS_LEGACY_KEYS.has(key))
    .every((key) => Boolean(left[key]) === Boolean(right[key]));
}

function saveFocusSettings(settings) {
  const normalized = prepareFocusSettingsForStorage(settings);

  chrome.storage.local.set({ [FOCUS_SETTINGS_KEY]: normalized }, () => {
    renderFocusSettings(normalized);
    notifyYoutubeTabs({ action: 'focusSettingsChanged', settings: normalized });
  });
}

function notifyYoutubeTabs(message) {
  chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

focusToggles.forEach((toggle) => {
  toggle.addEventListener('change', () => {
    chrome.storage.local.get([FOCUS_SETTINGS_KEY], (data) => {
      const settings = normalizeFocusSettings(data[FOCUS_SETTINGS_KEY]);
      settings[toggle.dataset.focusKey] = toggle.checked;
      saveFocusSettings(settings);
    });
  });
});

presetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const preset = FOCUS_PRESETS[button.dataset.focusPreset];
    if (!preset) return;
    saveFocusSettings(preset);
  });
});

// ── Helpers ──
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function shakeInput() {
  channelInput.style.animation = 'none';
  channelInput.offsetHeight; // trigger reflow
  channelInput.style.animation = 'shake 0.4s ease';
  setTimeout(() => {
    channelInput.style.animation = '';
  }, 400);
}

// Add shake keyframe dynamically
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-4px); }
    40% { transform: translateX(4px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(3px); }
  }
`;
document.head.appendChild(style);

// ── Custom Instructions ──
function loadInstructions() {
  chrome.storage.local.get(['customInstructions'], (data) => {
    instructionsInput.value = data.customInstructions || '';
  });
}

saveInstructionsBtn.addEventListener('click', () => {
  const instructions = instructionsInput.value.trim();
  chrome.storage.local.set({ customInstructions: instructions }, () => {
    // Visual feedback
    const originalText = saveInstructionsBtn.innerHTML;
    saveInstructionsBtn.classList.add('saved');
    saveInstructionsBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Saved!
    `;
    setTimeout(() => {
      saveInstructionsBtn.classList.remove('saved');
      saveInstructionsBtn.innerHTML = originalText;
    }, 1500);
  });
});

// ── Theme Toggle ──
function loadTheme() {
  chrome.storage.local.get(['theme'], (data) => {
    const theme = data.theme || 'dark';
    applyTheme(theme);
  });
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
}

themeToggle.addEventListener('click', () => {
  const isCurrentlyLight = document.body.classList.contains('light');
  const newTheme = isCurrentlyLight ? 'dark' : 'light';

  applyTheme(newTheme);
  chrome.storage.local.set({ theme: newTheme });

  // Sync theme to all YouTube tabs (for overlay styling)
  chrome.tabs.query({ url: 'https://www.youtube.com/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { action: 'themeChanged', theme: newTheme }).catch(() => {});
    });
  });
});
