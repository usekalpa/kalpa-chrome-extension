// Content script for keyboard shortcuts and quick actions
// This runs on every webpage

console.log('[Kalpa] Content script loaded on:', window.location.href);

// Allow background / popup to trigger actions on the page
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message && message.action === 'extractTranscriptForLink' && message.linkId) {
      console.log('[Kalpa] Received extractTranscriptForLink for linkId:', message.linkId);
      // Fire and forget; we don't await here to keep things snappy
      extractAndSendTranscript(message.linkId);
      sendResponse({ started: true });
      return true;
    }

    if (message && message.action === 'lashCurrentPageViaCommand') {
      console.log('[Kalpa] lashCurrentPageViaCommand');
      lashCurrentPage();
      sendResponse({ started: true });
      return true;
    }

    if (message && message.action === 'getSelectionText') {
      const selection = window.getSelection()?.toString() || '';
      sendResponse({ selection });
      return true;
    }
  } catch (_e) {
    // Swallow errors here; they will be logged inside the called functions
  }
  return false;
});

// Listen for keyboard shortcut (e.g., Ctrl+Shift+L) inside the page
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'L') {
    e.preventDefault();
    lashCurrentPage();
  }
});

/**
 * Check if current page is a YouTube video page
 */
function isYouTubePage() {
  const url = window.location.href;
  return (
    (url.includes('youtube.com/watch') || url.includes('youtu.be/')) &&
    !url.includes('youtube.com/playlist')
  );
}

/**
 * Extract YouTube transcript from the DOM
 * This leverages the user's authenticated browser session
 */
async function extractYouTubeTranscript() {
  try {
    // Check if we're on a YouTube video page
    if (!isYouTubePage()) return null;

    // Try to find the transcript panel - it might already be open
    let transcriptPanel = document.querySelector(
      'ytd-transcript-renderer, [target-id="engagement-panel-searchable-transcript"]'
    );

    // If transcript panel not visible, try to open it
    if (!transcriptPanel) {
      // Method 1: Look for "Show transcript" button in description area
      const descriptionButtons = document.querySelectorAll(
        'ytd-video-description-transcript-section-renderer button, ' +
        'button[aria-label*="transcript" i], ' +
        'button[aria-label*="Show transcript" i]'
      );

      let transcriptButton = null;
      for (const btn of descriptionButtons) {
        const label = btn.getAttribute('aria-label') || btn.textContent || '';
        if (label.toLowerCase().includes('transcript')) {
          transcriptButton = btn;
          break;
        }
      }

      // Method 2: Check the "..." more actions menu
      if (!transcriptButton) {
        const moreActionsButton = document.querySelector(
          'button[aria-label="More actions"], #button-shape button[aria-label*="more" i]'
        );
        if (moreActionsButton) {
          moreActionsButton.click();
          await sleep(500);

          // Look for transcript option in dropdown
          const menuItems = document.querySelectorAll(
            'ytd-menu-service-item-renderer, tp-yt-paper-item'
          );
          for (const item of menuItems) {
            if (item.textContent?.toLowerCase().includes('transcript')) {
              transcriptButton = item;
              break;
            }
          }
        }
      }

      // Click the transcript button if found
      if (transcriptButton) {
        transcriptButton.click();
        // Wait for panel to render
        await sleep(2000);
        transcriptPanel = document.querySelector(
          'ytd-transcript-renderer, [target-id="engagement-panel-searchable-transcript"]'
        );
      }
    }

    // Extract transcript segments from the panel
    if (!transcriptPanel) {
      console.log('[Kalpa] No transcript panel found');
      return null;
    }

    // Wait a bit more for segments to load
    await sleep(500);

    // Try multiple selectors for transcript segments
    const segmentSelectors = [
      'ytd-transcript-segment-renderer',
      '[class*="segment"]',
      'yt-formatted-string.segment-text',
      '.ytd-transcript-segment-renderer'
    ];

    let segments = [];
    for (const selector of segmentSelectors) {
      const elements = transcriptPanel.querySelectorAll(selector);
      if (elements.length > 0) {
        segments = Array.from(elements).map((el) => {
          // Try to get timestamp
          const timestampEl = el.querySelector(
            '.segment-timestamp, [class*="timestamp"]'
          );
          const textEl = el.querySelector(
            '.segment-text, yt-formatted-string, [class*="text"]'
          ) || el;

          return {
            timestamp: timestampEl?.textContent?.trim() || '',
            text: textEl?.textContent?.trim() || el.textContent?.trim() || ''
          };
        }).filter(s => s.text.length > 0);

        if (segments.length > 0) break;
      }
    }

    // If still no segments, try getting all text content from panel
    if (segments.length === 0) {
      const allText = transcriptPanel.textContent || '';
      // Filter out UI text, keep only substantial content
      const lines = allText.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 5 && !l.match(/^(Show|Hide|Transcript|Search)/i));

      if (lines.length > 5) {
        segments = lines.map(text => ({ timestamp: '', text }));
      }
    }

    if (segments.length === 0) {
      console.log('[Kalpa] No transcript segments found');
      return null;
    }

    // Combine all text
    const fullTranscript = segments.map(s => s.text).join(' ');

    console.log(`[Kalpa] Extracted transcript: ${segments.length} segments, ${fullTranscript.length} chars`);

    return {
      transcript: fullTranscript,
      segments: segments,
      hasTranscript: fullTranscript.length > 100
    };

  } catch (error) {
    console.error('[Kalpa] Error extracting YouTube transcript:', error);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function lashCurrentPage() {
  const selection = window.getSelection().toString();
  const url = window.location.href;
  const title = document.title;
  const isYouTube = isYouTubePage();

  // Show a quick notification
  showNotification('Saving to Kalpa...', 'info');

  try {
    // PHASE 1: Save immediately (fast path for all links)
    const response = await chrome.runtime.sendMessage({
      action: 'lashit',
      data: {
        url: url,
        title: title,
        selection: selection || undefined
      }
    });

    if (!response.success) {
      showNotification('Failed to save', 'error');
      return;
    }

    showNotification('Saved!', 'success');

    // PHASE 2: For YouTube, extract transcript in background and send update
    if (isYouTube && response.linkId) {
      // Don't block - extract async
      extractAndSendTranscript(response.linkId);
    }
  } catch (error) {
    console.error('[Kalpa] Error saving page:', error);
    showNotification('Failed to save', 'error');
  }
}

/**
 * Extract YouTube transcript and send to backend (non-blocking)
 */
async function extractAndSendTranscript(linkId) {
  try {
    showNotification('📝 Extracting transcript...', 'info');

    const transcriptData = await extractYouTubeTranscript();

    if (transcriptData?.hasTranscript) {
      // Send transcript update to backend
      const updateResponse = await chrome.runtime.sendMessage({
        action: 'updateTranscript',
        data: {
          linkId: linkId,
          transcript: transcriptData.transcript
        }
      });

      if (updateResponse?.success) {
        showNotification('✅ Transcript captured!', 'success');
      } else {
        console.log('[Kalpa] Transcript update failed:', updateResponse);
      }
    } else {
      console.log('[Kalpa] No transcript available for this video');
    }
  } catch (error) {
    console.error('[Kalpa] Error extracting/sending transcript:', error);
  }
}

function showNotification(message, type) {
  // Create a temporary notification element
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 8px;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 10000;
    transition: opacity 0.3s ease;
    ${type === 'success' ? 'background: #059669;' : 
      type === 'error' ? 'background: #dc2626;' : 
      'background: #a78bfa;'}
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}
