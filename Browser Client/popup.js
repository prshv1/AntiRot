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

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  loadStats();
  loadWhitelist();
  loadTheme();
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
