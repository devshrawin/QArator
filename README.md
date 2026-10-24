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

A setup page opens when QArator is installed (it can be run again from Settings › **Run setup again**):

1. **Connect an AI provider**: Google Gemini is selected by default (free key from Google AI Studio); Anthropic, OpenAI or an OpenAI-compatible endpoint also work. **Test key** checks it and shows which models Auto will use.
2. **Your team's format**: import a teammate's format file, or set the project code (default `UR`) and your Zoho Projects address (**Find it from an open Zoho tab** fills it in).
3. **Try it**: shortcuts and pinning.

Everything else (sections, fields, tags, Zoho labels, style example) is in Settings. **Export format** shares the setup with the team; the API key is never exported.

## Models: Auto

The model is **Auto** by default. Auto loads your key's model list and tries the everyday image-capable model first (for Gemini: the Flash models, then Flash-Lite, then Pro). When a model is rate-limited, out of daily quota or not found, QArator lets it rest (until midnight Pacific for daily quotas) and writes with the next one; the review screen says which model wrote the report. You can still pick one model, with or without falling back to the others.

## Usage

Settings › **Usage** counts every request per model for today, 7 or 30 days: requests, failures (rate limits), tokens in and out, an estimated cost in rupees if it were paid, and how much of a daily limit is left when the provider has reported one. The panel shows a one-line warning when a model is near its limit or resting. Counts stay in this browser.

## Where the bug is

The **URL** section always carries the address of the page you captured (or the tab you're on when there's no screenshot). Portal, Module and Page for the title are read from that page: the host name (for example `...-department-portal.` gives *Department Portal*), the breadcrumb, the highlighted menu item, the selected tab and the heading. URL rules in Settings still win when one matches, and the AI fills anything left empty. All of it is editable in review.

## Videos, Word export and tags

- **Record tab** (Alt+Shift+R) records the page you're testing; **Record screen** opens Chrome's picker for a screen or window and shows the mouse pointer. Recordings are MP4, up to 5 minutes, attached to Zoho with the screenshots, and the AI reads a few frames of each.
- **Export to Word** makes a .docx with the URL, location, environment, your note and steps, page errors and the screenshots; after Write it also holds the full report. No AI is needed for the export.
- **Tags**: after filling, QArator lists the tags from your team list that fit this bug, each with a Copy button, so you add them in Zoho yourself (or turn on *Also add ticked tags in Zoho* in settings).
- When a Zoho dropdown doesn't have QArator's value, the result shows Zoho's real options and **Use Zoho's list** updates your settings.

## Daily use

| Step | What to do |
| --- | --- |
| Capture | **Alt+Shift+S**, the orange capture button, **Ctrl+V** to paste, or drop an image file |
| Mark up | **Mark up** on a thumbnail: Box (B), Arrow (A), Hide (H) to black out personal data, Ctrl+Z to undo, Enter to apply |
| Describe | Type one line in **What's wrong?**; optionally add your own steps |
| Write | **Ctrl+Enter** or **Write bug report** |
| Review | Edit title segments, sections, fields and tags. **Rewrite** asks the AI for one section again |
| Fill | Switch to the Zoho Submit Issue form, then **Ctrl+Enter** or **Fill Zoho form** |
| Change | **Edit report**, change anything, then **Fill Zoho form** again; the steps bar at the top goes back to any step |
| Check | The results list shows what was filled and what needs a manual check, with the reason. **Go to field** jumps to it |

Page errors (console errors, uncaught exceptions, failed requests and resources) are **off by default**. Turn on Settings › Writing length › **Collect page errors** to have them collected on the sites you test and offered for the report; tabs that were already open need one reload. When it is off, QArator does not hook into the pages at all.

## Privacy

- Settings and the API key are stored only in this browser (`chrome.storage.local`).
- Screenshots and your note go only to the AI provider you chose, and only when you press Write or Rewrite. Areas covered with **Hide** are blacked out in the pixels before anything is sent or attached.
- Recent reports keep titles and text only, never screenshots.

## Permissions and why

- `<all_urls>` host access: capture the visible tab, read page errors on the site under test, fill the Zoho form, and call your AI provider's API.
- `sidePanel`, `tabs`, `scripting`, `activeTab`: open the panel, find the Zoho tab, inject the form filler.
- `tabCapture`, `desktopCapture`: record the tab, or a screen or window you pick.
- `storage`, `unlimitedStorage`: settings, the current draft (with screenshots) and recent reports.

## Zoho form matching

QArator first looks for Zoho Projects' own field components (`ruc-field` with its label), which covers the title, the description editor, regular dropdowns, token fields such as Device Type, the Steps to Reproduce box and the tag box. On other layouts it falls back to finding each field by the label shown next to it (configurable, alternatives separated with `|`). Tags are only picked from tags that already exist in Zoho; QArator never creates new ones. It handles normal inputs, native and custom dropdowns, rich-text description editors (including iframe editors), tag inputs and file inputs. Anything it can't fill is listed under **Needs a manual check** with the reason, and the screenshots can always be saved with **Save screenshots**.

## Files

```
manifest.json          MV3 manifest
background.js          opens the panel, keyboard commands
sidepanel/             the panel UI and markup editor
options/               the settings page and first-run setup (welcome.html)
content/errors-*.js    page error collection (page world + isolated bridge)
content/page-hints.js  breadcrumb / menu / tab / heading for Module and Page
content/zoho-fill.js   Zoho Submit Issue form filler (injected on demand)
lib/                   settings, AI providers and Auto model, usage tally, report builder, shared styles
tests/e2e/             end-to-end tests (Playwright, mocked AI and Zoho form)
lib/thinking-orbs.js   loading animation (MIT, Jakub Antalik)
lib/border-beam.css    focus glow on type boxes (MIT, Jakub Antalik)
```

See THIRD_PARTY_NOTICES.md for licences.
