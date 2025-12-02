// Kalpa Extension Options
// Note: Using local storage for better security (not synced across devices)

const convexInput = document.getElementById("convexUrl");
const webAppInput = document.getElementById("webAppUrl");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("saveBtn");
const clearTokenBtn = document.getElementById("clearTokenBtn");

// Load saved settings
chrome.storage.local.get(
  ["convexUrl", "webAppUrl", "apiToken"],
  ({ convexUrl, webAppUrl, apiToken }) => {
    if (convexUrl) convexInput.value = convexUrl;
    if (webAppUrl) webAppInput.value = webAppUrl;
    // Don't show token in options for security
    if (apiToken) {
      statusEl.textContent = "Token is stored (hidden for security)";
    }
  }
);

// Save settings (URLs only, not token)
saveBtn.addEventListener("click", () => {
  chrome.storage.local.set(
    {
      convexUrl: convexInput.value.trim(),
      webAppUrl: webAppInput.value.trim(),
    },
    () => {
      statusEl.textContent = "Saved.";
      setTimeout(() => (statusEl.textContent = ""), 1500);
    }
  );
});

// Clear stored token
if (clearTokenBtn) {
  clearTokenBtn.addEventListener("click", () => {
    chrome.storage.local.remove(["apiToken", "tokenExpiresAt"], () => {
      statusEl.textContent = "Token cleared. You'll need to sign in again.";
      setTimeout(() => (statusEl.textContent = ""), 3000);
    });
  });
}
