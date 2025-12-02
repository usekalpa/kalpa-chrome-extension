// Default configuration
// Self-hosted Convex HTTP origin (HTTP actions are served at /http/<path>)
const DEFAULT_CONVEX = "https://convex.usekalpa.com";
// Production Kalpa web app (used for /api/save, /api/clerk-token, /api/universes-list, etc.)
const DEFAULT_WEBAPP = "https://usekalpa.com";
const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1000; // Refresh if <10 min remaining

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        convexUrl: DEFAULT_CONVEX,
        webAppUrl: DEFAULT_WEBAPP,
        apiToken: "",
        tokenExpiresAt: 0,
      },
      resolve
    );
  });
}

// Check if token needs refresh
function shouldRefreshToken(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() > expiresAt - TOKEN_REFRESH_THRESHOLD_MS;
}

// Silently refresh token if user has active web session
async function tryRefreshToken() {
  try {
    const { webAppUrl, tokenExpiresAt } = await getConfig();
    
    // Only refresh if token exists and is about to expire
    if (!shouldRefreshToken(tokenExpiresAt)) return;
    
    const res = await fetch(`${webAppUrl}/api/clerk-token`, {
      credentials: "include",
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data?.token) {
        const newExpiresAt = Date.now() + 55 * 60 * 1000; // 55 minutes
        await chrome.storage.local.set({
          apiToken: data.token,
          tokenExpiresAt: newExpiresAt,
        });
        console.log("[Kalpa] Token refreshed silently");
      }
    }
  } catch (err) {
    // Silent fail - user will need to manually fetch if this fails
    console.log("[Kalpa] Silent token refresh failed (expected if not signed in)");
  }
}

// Refresh token on browser startup
chrome.runtime.onStartup.addListener(() => {
  tryRefreshToken();
});

// Also refresh when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  tryRefreshToken();
});

// Periodic token refresh check (every 30 minutes)
chrome.alarms.create("tokenRefresh", { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tokenRefresh") {
    tryRefreshToken();
  }
});

async function saveToKalpa({ url, title, selection, screenshot, universeId }) {
  try {
    const { convexUrl, apiToken } = await getConfig();
    const response = await fetch(`${convexUrl}/http/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({ url, title, selection, screenshot, universeId }),
    });

    if (!response.ok) {
      return { success: false };
    }

    // Parse response to get linkId for transcript updates
    const data = await response.json();
    return { success: true, linkId: data.linkId };
  } catch (error) {
    console.error("Failed to save to Kalpa from background:", error);
    return { success: false };
  }
}

/**
 * Send YouTube transcript update to backend
 * Called after initial save completes for YouTube videos
 */
async function updateTranscript({ linkId, transcript }) {
  try {
    const { convexUrl, apiToken } = await getConfig();
    const response = await fetch(`${convexUrl}/http/update-transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({ linkId, transcript }),
    });

    if (!response.ok) {
      console.error("[Kalpa] Transcript update failed:", response.status);
      return { success: false };
    }

    const data = await response.json();
    console.log("[Kalpa] Transcript update successful:", data);
    return { success: true };
  } catch (error) {
    console.error("[Kalpa] Error updating transcript:", error);
    return { success: false };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle save/lashit action
  if ((message?.action === "save" || message?.action === "lashit") && message.data) {
    saveToKalpa(message.data)
      .then((result) => sendResponse(result)) // Returns { success, linkId }
      .catch(() => sendResponse({ success: false }));
    return true; // keep the message channel open for async response
  }

  // Handle transcript update action (for YouTube videos)
  if (message?.action === "updateTranscript" && message.data) {
    updateTranscript(message.data)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "lashit-shortcut") return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.title) return;

    const result = await saveToKalpa({
      url: tab.url,
      title: tab.title,
      selection: undefined,
      screenshot: undefined,
    });

    // For YouTube videos, also trigger transcript extraction on the page
    if (
      result &&
      result.success &&
      result.linkId &&
      (tab.url.includes("youtube.com/watch") || tab.url.includes("youtu.be/")) &&
      tab.id
    ) {
      try {
        chrome.tabs.sendMessage(tab.id, {
          action: "extractTranscriptForLink",
          linkId: result.linkId,
        });
      } catch (_e) {
        // Non-fatal; the core save already succeeded.
      }
    }
  } catch (error) {
    console.error("Failed to handle save shortcut command:", error);
  }
});
