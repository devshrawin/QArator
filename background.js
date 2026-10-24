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

// Page errors are off unless the tester turns them on in settings: only then does the page-world
// hook that watches console errors and failed requests get injected into sites.
const ERR_ID = 'qarator-page-errors';
async function syncErrorHook() {
  const { settings } = await chrome.storage.local.get('settings');
  const want = !!(settings && settings.pageErrors);
  const have = (await chrome.scripting.getRegisteredContentScripts({ ids: [ERR_ID] })).length > 0;
  if (want && !have) {
    await chrome.scripting.registerContentScripts([{ id: ERR_ID, js: ['content/errors-main.js'], matches: ['http://*/*', 'https://*/*'], runAt: 'document_start', world: 'MAIN', allFrames: false }]);
  } else if (!want && have) {
    await chrome.scripting.unregisterContentScripts({ ids: [ERR_ID] });
  }
}
// settings autosave often: run one sync at a time so a quick on/off cannot leave the hook registered
let hookChain = Promise.resolve();
const queueHookSync = () => { hookChain = hookChain.then(syncErrorHook).catch(() => {}); };
queueHookSync();
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.settings) queueHookSync(); });
enablePanelOnClick();

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-panel' && command !== 'capture' && command !== 'record') return;
  // sidePanel.open must run synchronously inside the user gesture.
  if (tab && tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  if (command === 'record') {
    // like capture: a panel that is still opening picks this up on start
    chrome.storage.session.set({ pendingRecord: Date.now() }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'qarator:record' }).catch(() => {});
  }
  if (command === 'capture') {
    // If the panel is already open it captures right away; if it is still
    // loading it picks this flag up on start.
    chrome.storage.session.set({ pendingCapture: Date.now() }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'qarator:capture' }).catch(() => {});
  }
});
