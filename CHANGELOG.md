# Changelog

## 1.2.0 · 2026-10-24
- **Record screen** (or Alt+Shift+R): Chrome's picker for a screen, window or tab, mouse pointer shows. Saved as MP4, attached to Zoho with the screenshots, a few frames go to the AI so it can describe what happens. Up to 5 minutes.
- **Export to Word**: works without AI (URL, location, environment, note, steps, page errors, screenshots, video names) and with a report (title, sections, fields, suggested tags). Videos are saved next to it.
- **Generate & next bug**: saves the bug to the new **Bug list** and writes it in the background while you capture the next one. Each bug shows Waiting / Writing / Ready / Not written / Filled in Zoho; open a ready bug to review and fill, try again on failures. Tick bugs to export **full bugs** (report and screenshots) or **notes only** (page address, screenshots, what's wrong), one Word file with a page per bug. After filling, the panel offers the next ready bug.
- **What's wrong is required** before generating or exporting.
- **Backup AI key**: when the main key runs out or is rejected, the same model is tried on the backup key before other models. Quota and usage are tracked per key.
- **Running-low alert**: the panel warns at 80% of a model's daily limit and when a key runs out (Google's free-tier limits are assumed until Google reports the real one; limits can be typed in Settings › Usage).
- **Recent reports → Word**: tick reports (or Select all) and export them as one Word file, one report per page with screenshots.
- **Word exports carry the media**: screenshots are embedded; each video shows a still with its name and length, and the download is one zip with the Word file and a videos folder.
- **Page errors are off by default** (Settings › Collect page errors). When off, the page hook is not injected and nothing about errors shows in the panel, the AI prompt or exports.
- **Ready for the Chrome Web Store**: neutral defaults, a privacy policy (`PRIVACY.md`), and nothing team-specific in the package.
- **Audit fixes** (three independent code reviews and a runtime edge-case audit): importing a format file can no longer change the AI provider or address (it could send the key and screenshots elsewhere) and imported ids are sanitised; reports finish into the right bug when the tester moves on during writing, rewriting or filling; an opened bug's edits and its written report no longer overwrite each other; the Bug list waits and retries when the provider is busy instead of failing every bug, resumes bugs from a closed panel, and restarts when a key is added; per-minute rate limits are no longer taken as daily limits; cooldowns belong to the key, so a new key starts fresh; an expired Gemini key falls to the backup key; provider server errors fall back to the next model; Back no longer loops between Bug list and Recent reports; the panel cannot reopen stuck on "Writing"; Zoho fill fills only the frame with the form, sends videos only when uploading and skips ones over 25 MB, reads whole option lists before "Use Zoho's list" (keeps Unassigned), matches tags and tokens exactly, never clicks unrelated page items, types into plain text fields; learned URL rules are for one page (hash routes included) and never for a whole site; pasted WebP/GIF/SVG become PNG so Word shows them; exports report errors instead of failing silently; the setup page no longer overwrites settings changed elsewhere.
- **Steps bar** (Capture · Review · Fill in Zoho) at the top of the panel; the filled screen explains how to change something: *Edit report*, then fill again.
- **Tags**: QArator no longer types tags into Zoho by default; after filling it lists the matching tags from your team list with a Copy button each. *Also add ticked tags in Zoho* in settings turns filling back on.
- **Learned URL rules**: portal, module and page from a report you fill, copy or export are saved for that page.
- **Zoho dropdowns**: lists that load more options as they scroll (Classification) are read to the end; a value Zoho lacks now shows Zoho's real options and a *Use Zoho's list* button that updates settings. Defaults are now neutral (project APP, no URL rules or tags, a made-up style example); a team's own setup comes from its format file (Settings › Import format).
- Page names in another script (e.g. Malayalam headings) are not used in the English title.
- The draft is saved the moment the panel closes.
- **Appearance** in Settings: theme (System / Light / Dark), text size, field glow (Off / Subtle / Strong), animations, side panel spacing. Per person, not exported. The field glow is much more visible.
- New permission: `desktopCapture` (recording).

## 1.1.0 · 2026-10-24
- **Auto model** (new default): picks the best image-capable model your key has and falls back to the next one when a model is rate-limited, out of daily quota or missing. Resting models are skipped until they can answer again. Fixed-model mode can keep or turn off the fallback.
- **Usage** in Settings: requests, failures, tokens, estimated rupee cost, daily limit left (learned from rate-limit replies), quota reset time. Panel warns when a model is near its limit or resting.
- **First-run setup** page: tests the AI key, sets project code and Zoho address (or imports a team format), shows shortcuts. Panel shows a setup card until it is done.
- **Location from the page**: the URL section always has the captured page address, also without a screenshot; Portal, Module and Page come from the host name, breadcrumb, highlighted menu, tab and heading.
- Settings loads models by itself when a key is pasted.
- Fixes: a bad Gemini key (HTTP 400) now says the key was rejected; tags typed in review keep the team list's spelling.

## 1.0.0 · 2026-10-24
- First version: capture, mark up, AI bug report in the team format, Zoho Submit Issue fill.
