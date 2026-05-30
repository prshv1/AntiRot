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
      remove(keys, callback) {
        const data = readDevStorage();
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((key) => {
          delete data[key];
        });
        localStorage.setItem(storageKey, JSON.stringify(data));
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
const lockdownPanel = document.getElementById('lockdownPanel');
const lockdownCountdown = document.getElementById('lockdownCountdown');
const lockdownDuration = document.getElementById('lockdownDuration');
const lockdownStartBtn = document.getElementById('startLockdownBtn');
const lockdownHint = document.getElementById('lockdownHint');
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
const LOCKDOWN_KEY = 'lockdown';
const LOCKDOWN_SNAPSHOT_KEY = 'lockdownSnapshot';
const MAX_LOCKDOWN_MINUTES = 24 * 60;
const PROTECTED_SETTINGS_KEYS = [
  'enabled',
  'whitelist',
  'customInstructions',
  FOCUS_SETTINGS_KEY,
  'theme',
];
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
let activeLockdown = null;
let lockdownTimerId = null;

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  loadSectionState();
  loadState();
  loadStats();
  loadWhitelist();
  loadTheme();
  loadInstructions();
  loadFocusSettings();
  loadLockdownState();
});

if (chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes[LOCKDOWN_KEY] || changes[LOCKDOWN_SNAPSHOT_KEY]) {
      loadLockdownState();
    }
    if (changes.enabled) loadState();
    if (changes.whitelist) loadWhitelist();
    if (changes.customInstructions) loadInstructions();
    if (changes[FOCUS_SETTINGS_KEY]) loadFocusSettings();
    if (changes.theme) loadTheme();
  });
}

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

// ── Lockdown Mode ──
lockdownStartBtn.addEventListener('click', () => {
  startLockdown();
});

async function startLockdown() {
  if (preventSettingChangeWhileLocked()) return;

  const durationMinutes = Number.parseInt(lockdownDuration.value, 10);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_LOCKDOWN_MINUTES) {
    shakeLockdownInput();
    return;
  }

  lockdownStartBtn.disabled = true;

  const response = await sendRuntimeMessage({
    action: 'startLockdown',
    durationMinutes,
  });

  if (response?.ok && response.lockdown) {
    applyLockdownState({
      active: true,
      lockdown: response.lockdown,
      remainingMs: getRemainingLockdownMs(response.lockdown),
    });
    loadState();
    loadFocusSettings();
    return;
  }

  startLockdownLocally(durationMinutes);
}

function startLockdownLocally(durationMinutes) {
  chrome.storage.local.get(PROTECTED_SETTINGS_KEYS, (data) => {
    const now = Date.now();
    const lockdown = {
      startedAt: now,
      activeUntil: now + durationMinutes * 60 * 1000,
      durationMinutes,
    };

    chrome.storage.local.set({
      enabled: true,
      [LOCKDOWN_KEY]: lockdown,
      [LOCKDOWN_SNAPSHOT_KEY]: buildLockdownSnapshot(data),
    }, () => {
      notifyYoutubeTabs({ action: 'toggleChanged', enabled: true });
      applyLockdownState({
        active: true,
        lockdown,
        remainingMs: getRemainingLockdownMs(lockdown),
      });
      loadState();
      loadFocusSettings();
    });
  });
}

function buildLockdownSnapshot(data) {
  return {
    enabled: true,
    whitelist: Array.isArray(data.whitelist) ? data.whitelist : [],
    customInstructions: data.customInstructions || '',
    focusSettings: prepareFocusSettingsForStorage(data[FOCUS_SETTINGS_KEY]),
    theme: data.theme || 'dark',
  };
}

function loadLockdownState() {
  getLockdownState((state) => {
    applyLockdownState(state);
  });
}

async function getLockdownState(callback) {
  const response = await sendRuntimeMessage({ action: 'getLockdownState' });
  if (response && 'active' in response) {
    callback(response);
    return;
  }

  chrome.storage.local.get([LOCKDOWN_KEY, LOCKDOWN_SNAPSHOT_KEY], (data) => {
    const lockdown = normalizeLockdown(data[LOCKDOWN_KEY]);
    if (!lockdown) {
      callback({ active: false, lockdown: null, remainingMs: 0 });
      return;
    }

    const remainingMs = getRemainingLockdownMs(lockdown);
    if (remainingMs <= 0) {
      chrome.storage.local.remove([LOCKDOWN_KEY, LOCKDOWN_SNAPSHOT_KEY], () => {
        callback({ active: false, lockdown: null, remainingMs: 0 });
      });
      return;
    }

    callback({ active: true, lockdown, remainingMs });
  });
}

function normalizeLockdown(lockdown) {
  if (!lockdown || typeof lockdown !== 'object') return null;
  const activeUntil = Number(lockdown.activeUntil);
  const startedAt = Number(lockdown.startedAt);
  const durationMinutes = Number(lockdown.durationMinutes);
  if (!Number.isFinite(activeUntil) || activeUntil <= 0) return null;

  return {
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    activeUntil,
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
  };
}

function applyLockdownState(state) {
  const lockdown = normalizeLockdown(state?.lockdown);
  const isActive = Boolean(state?.active && lockdown && getRemainingLockdownMs(lockdown) > 0);
  activeLockdown = isActive ? lockdown : null;

  toggleSwitch.checked = isActive ? true : toggleSwitch.checked;
  setSettingsLocked(isActive);
  updateToggleUI(toggleSwitch.checked);
  renderLockdownPanel();

  if (isActive) {
    startLockdownTimer();
  } else {
    stopLockdownTimer();
  }
}

function setSettingsLocked(isLocked) {
  document.body.classList.toggle('lockdown-active', isLocked);

  [
    toggleSwitch,
    themeToggle,
    channelInput,
    addChannelBtn,
    instructionsInput,
    saveInstructionsBtn,
    lockdownDuration,
    lockdownStartBtn,
  ].forEach((control) => {
    if (control) control.disabled = isLocked;
  });

  focusToggles.forEach((toggle) => {
    toggle.disabled = isLocked;
  });

  presetButtons.forEach((button) => {
    button.disabled = isLocked;
  });

  document.querySelectorAll('.remove-btn').forEach((button) => {
    button.disabled = isLocked;
  });
}

function renderLockdownPanel() {
  const isActive = isLockdownActiveNow();
  lockdownPanel.classList.toggle('is-active', isActive);

  if (!isActive) {
    lockdownCountdown.textContent = 'Ready';
    lockdownStartBtn.textContent = 'Start Lockdown';
    lockdownHint.textContent = 'Locks AntiRot on and freezes settings until the timer ends.';
    return;
  }

  const remainingMs = getRemainingLockdownMs();
  lockdownCountdown.textContent = formatDuration(remainingMs);
  lockdownStartBtn.textContent = 'Locked';
  lockdownHint.textContent = `No early unlock. Settings reopen at ${formatEndTime(activeLockdown.activeUntil)}.`;
}

function startLockdownTimer() {
  stopLockdownTimer();
  lockdownTimerId = setInterval(() => {
    if (!isLockdownActiveNow()) {
      activeLockdown = null;
      setSettingsLocked(false);
      updateToggleUI(toggleSwitch.checked);
      renderLockdownPanel();
      stopLockdownTimer();
      loadLockdownState();
      return;
    }

    renderLockdownPanel();
  }, 1000);
  renderLockdownPanel();
}

function stopLockdownTimer() {
  if (!lockdownTimerId) return;
  clearInterval(lockdownTimerId);
  lockdownTimerId = null;
}

function isLockdownActiveNow() {
  return getRemainingLockdownMs() > 0;
}

function getRemainingLockdownMs(lockdown = activeLockdown) {
  if (!lockdown?.activeUntil) return 0;
  return Math.max(0, Number(lockdown.activeUntil) - Date.now());
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatEndTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function preventSettingChangeWhileLocked() {
  if (!isLockdownActiveNow()) return false;
  renderLockdownPanel();
  return true;
}

function shakeLockdownInput() {
  lockdownDuration.style.animation = 'none';
  lockdownDuration.offsetHeight;
  lockdownDuration.style.animation = 'shake 0.4s ease';
  setTimeout(() => {
    lockdownDuration.style.animation = '';
  }, 400);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    if (!chrome.runtime?.sendMessage) {
      resolve(null);
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    } catch {
      resolve(null);
    }
  });
}

// ── Toggle Logic ──
toggleSwitch.addEventListener('change', () => {
  if (preventSettingChangeWhileLocked()) {
    toggleSwitch.checked = true;
    updateToggleUI(true);
    return;
  }

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
  const isLocked = isLockdownActiveNow();
  statusText.textContent = isLocked ? 'Locked' : (isActive ? 'Active' : 'Paused');
  statusText.classList.toggle('inactive', !isActive && !isLocked);
  statusText.classList.toggle('locked', isLocked);
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
      if (preventSettingChangeWhileLocked()) return;
      const idx = parseInt(btn.dataset.index);
      removeChannel(idx);
    });
  });

  setSettingsLocked(isLockdownActiveNow());
}

function addChannel(name) {
  if (preventSettingChangeWhileLocked()) return;

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
  if (preventSettingChangeWhileLocked()) return;

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
  if (preventSettingChangeWhileLocked()) return;

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
    if (preventSettingChangeWhileLocked()) {
      loadFocusSettings();
      return;
    }

    chrome.storage.local.get([FOCUS_SETTINGS_KEY], (data) => {
      const settings = normalizeFocusSettings(data[FOCUS_SETTINGS_KEY]);
      settings[toggle.dataset.focusKey] = toggle.checked;
      saveFocusSettings(settings);
    });
  });
});

presetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (preventSettingChangeWhileLocked()) return;

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
  if (preventSettingChangeWhileLocked()) return;

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
  if (preventSettingChangeWhileLocked()) return;

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
