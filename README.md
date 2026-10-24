# QArator

A Chrome extension for QA testers who log bugs in Zoho Projects. Capture a screenshot, type one line about what's wrong, and AI writes the full bug report in your team's house format. One click then fills the Zoho **Submit Issue** form. QArator never presses Submit for you.

## Install (unpacked)

1. Unzip `qarator-extension.zip` somewhere permanent, for example `C:\Tools\qarator`.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped `qarator` folder.
4. Pin QArator from the puzzle-piece menu so the icon stays in the toolbar.
5. Click the icon (or press **Alt+Shift+Q**). The settings page opens from the panel's settings button.

Edge works the same way at `edge://extensions`.

## First-time setup

1. Settings › **AI provider and key**: Google Gemini is selected by default (use your Google AI Studio key); Anthropic, OpenAI or an OpenAI-compatible endpoint also work. Paste your key, press **Check key and load models**, and pick a model that can read images.
2. Settings › **Title format** and **URL rules**: set the project code (default `UR`) and map URL fragments to portal, module and page names.
3. Settings › **Zoho fill options**: set your Zoho Projects address (default `projects.zoho.in`) and check that the field labels match the text in your Submit Issue form.
4. Settings › **Export format** to share the setup with the team; teammates use **Import format**. The API key is never exported.

## Daily use

| Step | What to do |
| --- | --- |
| Capture | **Alt+Shift+S**, the orange capture button, **Ctrl+V** to paste, or drop an image file |
| Mark up | **Mark up** on a thumbnail: Box (B), Arrow (A), Hide (H) to black out personal data, Ctrl+Z to undo, Enter to apply |
| Describe | Type one line in **What's wrong?**; optionally add your own steps |
| Write | **Ctrl+Enter** or **Write bug report** |
| Review | Edit title segments, sections, fields and tags. **Rewrite** asks the AI for one section again |
| Fill | Switch to the Zoho Submit Issue form, then **Ctrl+Enter** or **Fill Zoho form** |
| Check | The results list shows what was filled and what needs a manual check, with the reason. **Go to field** jumps to it |

Page errors (console errors, uncaught exceptions, failed requests and resources) are collected on every site from the moment a tab loads. Tabs that were open before QArator was installed need one reload.

## Privacy

- Settings and the API key are stored only in this browser (`chrome.storage.local`).
- Screenshots and your note go only to the AI provider you chose, and only when you press Write or Rewrite. Areas covered with **Hide** are blacked out in the pixels before anything is sent or attached.
- Recent reports keep titles and text only, never screenshots.

## Permissions and why

- `<all_urls>` host access: capture the visible tab, read page errors on the site under test, fill the Zoho form, and call your AI provider's API.
- `sidePanel`, `tabs`, `scripting`, `activeTab`: open the panel, find the Zoho tab, inject the form filler.
- `storage`, `unlimitedStorage`: settings, the current draft (with screenshots) and recent reports.

## Zoho form matching

QArator first looks for Zoho Projects' own field components (`ruc-field` with its label), which covers the title, the description editor, regular dropdowns, token fields such as Device Type, the Steps to Reproduce box and the tag box. On other layouts it falls back to finding each field by the label shown next to it (configurable, alternatives separated with `|`). Tags are only picked from tags that already exist in Zoho; QArator never creates new ones. It handles normal inputs, native and custom dropdowns, rich-text description editors (including iframe editors), tag inputs and file inputs. Anything it can't fill is listed under **Needs a manual check** with the reason, and the screenshots can always be saved with **Save screenshots**.

## Files

```
manifest.json          MV3 manifest
background.js          opens the panel, keyboard commands
sidepanel/             the panel UI and markup editor
options/               the settings page
content/errors-*.js    page error collection (page world + isolated bridge)
content/zoho-fill.js   Zoho Submit Issue form filler (injected on demand)
lib/                   settings, AI providers, report builder, shared styles
lib/thinking-orbs.js   loading animation (MIT, Jakub Antalik)
lib/border-beam.css    focus glow on type boxes (MIT, Jakub Antalik)
```

See THIRD_PARTY_NOTICES.md for licences.
