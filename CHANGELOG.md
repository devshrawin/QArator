# Changelog

## 1.2.0 · 2026-10-24
- **Record video**: *Record tab* (one click, or Alt+Shift+R) or *Record screen* (Chrome's picker, mouse pointer shows). Saved as MP4, attached to Zoho with the screenshots, a few frames go to the AI so it can describe what happens. Up to 5 minutes.
- **Export to Word**: works without AI (URL, location, environment, note, steps, page errors, screenshots, video names) and with a report (title, sections, fields, suggested tags). Videos are saved next to it.
- **Recent reports → Word**: tick reports (or Select all) and export them as one Word file, one report per page (text only; history keeps no screenshots).
- **Page errors are off by default** (Settings › Collect page errors). When off, the page hook is not injected and nothing about errors shows in the panel, the AI prompt or exports.
- **Steps bar** (Capture · Review · Fill in Zoho) at the top of the panel; the filled screen explains how to change something: *Edit report*, then fill again.
- **Tags**: QArator no longer types tags into Zoho by default; after filling it lists the matching tags from your team list with a Copy button each. *Also add ticked tags in Zoho* in settings turns filling back on.
- **Learned URL rules**: portal, module and page from a report you fill, copy or export are saved for that page.
- **Zoho dropdowns**: lists that load more options as they scroll (Classification) are read to the end; a value Zoho lacks now shows Zoho's real options and a *Use Zoho's list* button that updates settings. Default Classification and Device Type lists match the Amnex Zoho portal.
- Page names in another script (e.g. Malayalam headings) are not used in the English title.
- The draft is saved the moment the panel closes.
- **Appearance** in Settings: theme (System / Light / Dark), text size, field glow (Off / Subtle / Strong), animations, side panel spacing. Per person, not exported. The field glow is much more visible.
- New permissions: `tabCapture`, `desktopCapture` (recording).

## 1.1.0 · 2026-10-24
- **Auto model** (new default): picks the best image-capable model your key has and falls back to the next one when a model is rate-limited, out of daily quota or missing. Resting models are skipped until they can answer again. Fixed-model mode can keep or turn off the fallback.
- **Usage** in Settings: requests, failures, tokens, estimated rupee cost, daily limit left (learned from rate-limit replies), quota reset time. Panel warns when a model is near its limit or resting.
- **First-run setup** page: tests the AI key, sets project code and Zoho address (or imports a team format), shows shortcuts. Panel shows a setup card until it is done.
- **Location from the page**: the URL section always has the captured page address, also without a screenshot; Portal, Module and Page come from the host name, breadcrumb, highlighted menu, tab and heading.
- Settings loads models by itself when a key is pasted.
- Fixes: a bad Gemini key (HTTP 400) now says the key was rejected; tags typed in review keep the team list's spelling.

## 1.0.0 · 2026-10-24
- First version: capture, mark up, AI bug report in the team format, Zoho Submit Issue fill.
