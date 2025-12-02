# Kalpa Chrome Extension

This is the official Chrome extension for saving pages to your Kalpa knowledge manager.

> Note: The Firefox version lives in a separate repo (`kalpa-firefox-extension`) but shares the same behavior and UI.

## Features

- **One-click saving**: Click the extension icon to save the current page
- **Keyboard shortcut**: Press `Alt+Shift+L` to quickly save any page to Kalpa
- **Selected text**: Automatically captures any selected text when saving
- **Screenshots**: Optional screenshot capture for visual bookmarks

## Setup (Chrome)

1. **Clone or download this repo** to your machine.
2. **Load the extension** in Chrome:
   - Open `chrome://extensions/`.
   - Enable **Developer mode**.
   - Click **"Load unpacked"** and select this folder.
3. **Sign in to Kalpa** at `https://usekalpa.com`.

The extension is configured to talk to the hosted Kalpa backend at `https://convex.usekalpa.com` and uses your Kalpa session on `https://usekalpa.com`.

## API Integration

Under the hood, the extension sends the current page URL, title and optional selection/transcript to the Kalpa backend via Convex HTTP actions (see `background.js` and `popup.js` for details).

## Authentication

The extension uses session-based authentication with your Kalpa web app:

1. **Sign in**: Click the "Sign in to Kalpa" button in the extension popup
2. **Automatic sync**: Once signed in to usekalpa.com, the extension detects your session automatically
3. **Token refresh**: Tokens are refreshed automatically in the background
4. **Sign out**: Click "Sign out" in the extension to clear your session

When signed in, you'll see:

- Your email address displayed
- Access to your universes for organization
- Full AI features (summaries, tagging)

When not signed in:

- You can still save pages (saved to default/anonymous account)
- AI features will be limited

## Permissions

The extension requests:

- `activeTab`: To access the current page's URL and title
- `storage`: To store user preferences and auth tokens
- `alarms`: For background token refresh
- `cookies`: To detect authentication state

## Keyboard Shortcuts

- `Alt+Shift+L`: Quick save current page to Kalpa

## Future Enhancements

- Right-click context menu for selected text
- Bulk import from bookmarks
- Offline queue for when network is unavailable
- Custom tags and categories
- Reading progress sync
