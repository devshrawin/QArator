// QArator service worker: opens the side panel and relays keyboard commands.

function enablePanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(async (d) => {
  enablePanelOnClick();
  if (d.reason !== 'install') return;
  const { onboarded } = await chrome.storage.local.get('onboarded');
  if (!onboarded) chrome.tabs.create({ url: chrome.runtime.getURL('options/welcome.html') });
});
chrome.runtime.onStartup.addListener(enablePanelOnClick);
enablePanelOnClick();

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-panel' && command !== 'capture') return;
  // sidePanel.open must run synchronously inside the user gesture.
  if (tab && tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  if (command === 'capture') {
    // If the panel is already open it captures right away; if it is still
    // loading it picks this flag up on start.
    chrome.storage.session.set({ pendingCapture: Date.now() }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'qarator:capture' }).catch(() => {});
  }
});
