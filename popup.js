// Configuration
const WEB_APP_URL = 'https://usekalpa.com';
const CONVEX_URL = 'https://convex.usekalpa.com';

// Helper to parse JWT and extract user info
function parseJwtPayload(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

// Extract user info from JWT payload
function getUserInfoFromToken(token) {
  const payload = parseJwtPayload(token);
  if (!payload) return null;

  const email = payload.email || payload.sub || '';
  const name = payload.name || '';

  // Generate initials
  let initials = '?';
  if (name) {
    const parts = name.split(' ').filter(Boolean);
    initials =
      parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();
  } else if (email) {
    initials = email.slice(0, 2).toUpperCase();
  }

  return { email, name, initials };
}

// Check if token is expired
function isTokenExpired(token) {
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) return true;
  // Add 30 second buffer
  return Date.now() >= (payload.exp - 30) * 1000;
}

// Store token with user info
async function storeToken(token, userInfo = null) {
  const info = userInfo || getUserInfoFromToken(token);
  await chrome.storage.local.set({
    convexToken: token,
    userEmail: info?.email || '',
    userInitials: info?.initials || '?',
  });
}

// Clear token and user info
async function clearToken() {
  await chrome.storage.local.remove(['convexToken', 'userEmail', 'userInitials']);
}

// Get stored token info
async function getStoredTokenInfo() {
  const data = await chrome.storage.local.get(['convexToken', 'userEmail', 'userInitials']);
  return {
    token: data.convexToken || null,
    email: data.userEmail || '',
    initials: data.userInitials || '?',
  };
}

// Main initialization
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  const urlElement = document.getElementById('url');
  const titleInput = document.getElementById('titleInput');
  const loopSelect = document.getElementById('loopSelect');
  const loopsNote = document.getElementById('loopsNote');
  const lashButton = document.getElementById('lashButton');
  const messageElement = document.getElementById('message');
  const fetchTokenBtn = document.getElementById('fetchTokenBtn');
  const tokenStatus = document.getElementById('tokenStatus');

  // Auth UI elements
  const authSection = document.getElementById('authSection');
  const authSignedIn = document.getElementById('authSignedIn');
  const authSignedOut = document.getElementById('authSignedOut');
  const authLoading = document.getElementById('authLoading');
  const authAvatar = document.getElementById('authAvatar');
  const authEmail = document.getElementById('authEmail');
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  // Selection and screenshot checkboxes
  const includeSelectionCheckbox = document.getElementById('includeSelection');
  const includeScreenshotCheckbox = document.getElementById('includeScreenshot');

  // Show auth state
  function showAuthState(state, info = {}) {
    authLoading.classList.add('hidden');
    authSignedIn.classList.add('hidden');
    authSignedOut.classList.add('hidden');

    if (state === 'loading') {
      authLoading.classList.remove('hidden');
    } else if (state === 'signed-in') {
      authSignedIn.classList.remove('hidden');
      authAvatar.textContent = info.initials || '?';
      authEmail.textContent = info.email || 'Signed in';
    } else {
      authSignedOut.classList.remove('hidden');
    }
  }

  // Populate current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    urlElement.textContent = tab.url || '';
    titleInput.value = tab.title || '';
  }

  // Load universes from storage
  async function loadUniverses() {
    const { universes } = await chrome.storage.local.get('universes');
    loopSelect.innerHTML = '<option value="">No universe</option>';
    if (universes && universes.length > 0) {
      universes.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u._id;
        opt.textContent = u.name;
        loopSelect.appendChild(opt);
      });
      loopSelect.disabled = false;
      loopsNote.textContent = '';
    } else {
      loopsNote.textContent = 'Sign in to access your universes';
    }
  }

  // Fetch universes from API
  async function fetchUniverses(token) {
    try {
      const res = await fetch(`${CONVEX_URL}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          path: 'universes:getUserUniverses',
          args: {},
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const universes = data.value || [];
        await chrome.storage.local.set({ universes });
        await loadUniverses();
      }
    } catch (e) {
      console.error('Failed to fetch universes:', e);
    }
  }

  // Try to fetch token from web app
  async function tryFetchToken() {
    try {
      const res = await fetch(`${WEB_APP_URL}/api/clerk-token`, {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          // Use user info from API response if available
          const userInfo = data.user
            ? {
                email: data.user.email || '',
                initials:
                  data.user.firstName && data.user.lastName
                    ? (data.user.firstName[0] + data.user.lastName[0]).toUpperCase()
                    : data.user.email
                      ? data.user.email.slice(0, 2).toUpperCase()
                      : '?',
              }
            : getUserInfoFromToken(data.token);

          await storeToken(data.token, userInfo);
          await fetchUniverses(data.token);
          showAuthState('signed-in', userInfo);
          return true;
        }
      }
    } catch (e) {
      console.error('Failed to fetch token:', e);
    }
    return false;
  }

  // Initialize auth state
  async function initAuth() {
    showAuthState('loading');

    const stored = await getStoredTokenInfo();

    if (stored.token && !isTokenExpired(stored.token)) {
      // Valid token exists
      showAuthState('signed-in', { email: stored.email, initials: stored.initials });
      await loadUniverses();
      // Refresh token in background
      tryFetchToken();
    } else {
      // Try to get fresh token
      const success = await tryFetchToken();
      if (!success) {
        showAuthState('signed-out');
        await loadUniverses();
      }
    }
  }

  // Sign in button handler
  signInBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: `${WEB_APP_URL}/sign-in` });
  });

  // Sign out button handler
  signOutBtn?.addEventListener('click', async () => {
    await clearToken();
    await chrome.storage.local.remove('universes');
    showAuthState('signed-out');
    await loadUniverses();
  });

  // Refresh button handler (hidden, for edge cases)
  fetchTokenBtn?.addEventListener('click', async () => {
    fetchTokenBtn.disabled = true;
    tokenStatus.textContent = 'Refreshing...';
    const success = await tryFetchToken();
    tokenStatus.textContent = success ? 'Refreshed!' : 'Could not refresh';
    fetchTokenBtn.disabled = false;
    setTimeout(() => {
      tokenStatus.textContent = '';
    }, 2000);
  });

  // Initialize
  await initAuth();

  // Save button handler
  lashButton.addEventListener('click', async () => {
    lashButton.disabled = true;
    lashButton.textContent = 'Saving...';
    messageElement.textContent = '';
    messageElement.className = 'msg';

    const url = urlElement.textContent;
    const title = titleInput.value;
    const universeId = loopSelect.value || undefined;

    // Get selection if checkbox is checked
    let selection = undefined;
    if (includeSelectionCheckbox?.checked) {
      selection = await getSelectedText();
    }

    // Get screenshot if checkbox is checked
    let screenshot = undefined;
    if (includeScreenshotCheckbox?.checked) {
      screenshot = await captureScreenshot();
    }

    const stored = await getStoredTokenInfo();
    const authenticated = stored.token && !isTokenExpired(stored.token);

    try {
      let response;

      if (authenticated) {
        // Authenticated save via Next.js API
        response = await fetch(`${WEB_APP_URL}/api/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${stored.token}`,
          },
          body: JSON.stringify({ url, title, selection, screenshot, universeId }),
        });
      } else {
        // Unauthenticated save via Convex HTTP endpoint (self-hosted uses /http/ prefix)
        response = await fetch(`${CONVEX_URL}/http/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, title, selection, screenshot }),
        });
      }

      if (response.ok) {
        const data = await response.json();
        const linkId = data.linkId;

        messageElement.textContent = authenticated
          ? 'Saved to Kalpa! ✓'
          : 'Saved! Sign in to sync across devices.';
        messageElement.className = 'msg success';
        lashButton.textContent = 'Saved!';

        // Trigger transcript extraction for YouTube videos
        if (linkId && tab?.id && tab.url?.includes('youtube.com')) {
          try {
            chrome.tabs.sendMessage(tab.id, {
              action: 'extractTranscriptForLink',
              linkId,
            });
          } catch (_e) {
            // Best-effort only; failure here doesn't affect the save UX.
          }
        }

        // Auto-close after showing the success message (longer delay to read it)
        // Close for both authenticated and unauthenticated saves
        setTimeout(() => window.close(), 2500);
      } else {
        throw new Error('Failed to save to Kalpa');
      }
    } catch (error) {
      messageElement.textContent = 'Failed to save. Please try again.';
      messageElement.className = 'error';
      lashButton.disabled = false;
      lashButton.textContent = 'Save to Kalpa';
    }
  });
});

async function getSelectedText() {
  // Get selected text from the page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) return '';

  // Content scripts can't run on chrome://, about://, edge://, or extension pages
  const restrictedProtocols = ['chrome:', 'chrome-extension:', 'about:', 'edge:', 'moz-extension:'];
  try {
    const url = new URL(tab.url);
    if (restrictedProtocols.includes(url.protocol)) {
      // Silently skip - content script not available on these pages
      return '';
    }
  } catch (e) {
    return '';
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getSelectionText',
    });
    return response?.selection || '';
  } catch (error) {
    // Content script may not be loaded yet (e.g., page just loaded)
    // This is expected behavior, not an error
    console.log('[Kalpa] Selection not available (content script not ready)');
    return '';
  }
}

async function captureScreenshot() {
  // Capture screenshot of the current tab
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab();
    return dataUrl;
  } catch (error) {
    console.error('Failed to capture screenshot:', error);
    return null;
  }
}
