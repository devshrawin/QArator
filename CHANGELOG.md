# Changelog

## 1.6.0 · 2026-10-31
- **Marks can be edited after you draw them.** Pick a mark (click it or choose it in the list), then drag its corner squares to resize it, drag either end of an arrow to aim it, or change its **colour** (orange, red, blue, green, yellow, black) and **thickness** (thin, medium, thick). Hidden areas can be resized too. Reopen *Mark up* any time to change them again.
- **Image editor settings** (Settings › Image editor): the default colour and thickness for new marks, with a preview.
- Fixed: the screenshot jumped while you drew, because the marks list grew under it. The list now has a fixed height.
## 1.5.2 · 2026-10-31
- Fixed: the Fill button in the review footer read "undefinedFill in Zoho" (a missing icon). A test now fails if any button shows the word undefined.
- **Settings rows**: AI and key, Writing length, Appearance and Zoho labels now show each setting as a row with its name and hint on the left and the control on the right, under one card per page.
- The Bug list text says *Save and capture next*, like the button.
- Store images are made from the real extension with neutral Acme data (`python tests/e2e/store.py . <out dir>`), so they never show client names.
## 1.5.1 · 2026-10-31
- **Settings is one page at a time**, with an icon on every menu item, a *Format of this project* group you can fold, and a **search box** that lists matching settings and opens them. The Writing length options now sit on the AI and key page.
- **Panel header**: the project is a button that opens a menu (switch project, manage projects), and a new meter button shows requests used today per model, with the reset time.
- **Screenshots can be reordered** by dragging, or with Alt + arrow keys, and are numbered.
- **Region**: captures the tab, then opens straight in a new **Crop** tool so only the part that matters is kept. Crop is also in the markup toolbar (key C).
- **Project wizard** shows a step list on the left; finished steps are ticked and can be reopened.
- **Confirmations and name prompts happen in the page** instead of browser pop-ups: delete section, field or project, reset, update-or-copy on import, and the new project name.
- **Fonts are bundled** (Inter and JetBrains Mono, Latin; both SIL Open Font License, see THIRD_PARTY_NOTICES.md). Other scripts use the system font.
- Checked in dark theme on every settings page and the panel at 360 and 600 px: nothing scrolls sideways.
## 1.5.0 · 2026-10-31
- **New look across the side panel, Settings, setup, the project wizard and the AI Studio helper card**, from the redesign: one orange accent, warmer greys, light and dark that follow the same tokens, a 3-step bar with a line between the steps, banners for notices, cards for sections and a clearer Draft badge in the review footer.
- **Fields show who set them**: each dropdown says *AI* (orange tint), *You* (after you change it), *Default* or *Empty* (dashed). Picking Leave empty marks it Empty.
- **Plainer wording**: Save and capture next, Export to Word, Fill in Zoho, Draft instead of Ready, Zoho does not take tags from forms, Filled in Zoho with a note that QArator never submits.
- **Tag picker works from the keyboard**: Arrow keys move through the list, Enter ticks the highlighted tag, Esc clears the search, and it is announced as a list of options to screen readers.
- **Start over and Remove bug ask in the panel** instead of a browser pop-up (Esc or Cancel keeps your work).
- Under the hood: shared design tokens (`lib/tokens.css`) and components (`lib/components.css`); the old button and icon class names are replaced by the new ones.
## 1.4.0 · 2026-10-29
- **Guided project setup** (Settings › Projects, the Format group, and the setup page): pick one of three ways in. Import a file or pasted text (a code fence from a chat is fine); let an AI agent write it (download the guide, a checklist of what to give the agent, a ready message to copy, then paste the reply); or answer a few questions: name and sites, title parts and order with a live example, description sections, dropdowns and their choices, tags, a style example, then review and create. Errors are listed in plain words with what to send back to the agent.
- Fixed: the *Format of this project* heading in Settings showed a broken symbol; it now has a proper arrow. The title example in Settings no longer uses client names.
- Fixed: a test that failed depending on the time of day (daily quota reset).
- **Easier first key**: the setup page now says what to do in plain words (a free access code from Google, three numbered steps, a note for work accounts that Google blocks, and that Export to Word works with no key). Settings shows the same **Get my free key** button while the key box is empty.
- **Key helper on Google AI Studio**: when QArator itself opens the key page, a small card there says what to click, and once a key is on the page, **Use this key in QArator** sends it back and returns you to the setup tab. It only appears for 30 minutes after you press Get my free key, reads the page only for text shaped like a Gemini key, and only the AI Studio page can hand a key over.
- **Pasted keys are cleaned and recognised**: spaces, quotes and "Bearer" are removed, and a Gemini, Anthropic or OpenAI key switches the provider by itself (no more "key rejected" for the wrong provider). A pasted key is tested on its own.
- Fixed: the setup tab, if left open, could overwrite the project code and Zoho address with its old copy.
- **Projects**: a project is a saved setup (title format, sections, fields, tags, Zoho labels, portals). Keep one per team or product; switch in the panel header or in Settings › Projects. Import adds a project (a file with an id you already have is added as a copy, or updates it if you say so); Export saves one; AI key, usage and look stay per person.
- **Portals and areas** inside a project: each has an address match and overrides only what differs (tags, title code, sections, fields, page names, style). Every matching portal applies, the longer match last. Editable in Settings › Format of this project › Sites and portals. A page on a project's site switches to that project.
- **Neutral built-in setup**: a new install has no client names, tags or URL rules (project APP; Severity, Priority, Classification). Import a project file to get a team's setup. Existing installs keep what they have.
- **Setup guide** (Settings › Projects, and the setup page): a Markdown file to hand, with a description of any bug tracker, to an AI agent that writes the project file (Zoho, Jira, Confluence, anything; QArator fills Zoho forms and offers Copy for the rest).
- **Plain import errors**: a file that cannot be read says which key is wrong; things repaired on import are listed so they can be fixed or sent back to the agent.
- **Tag picker**: tick as many team tags as fit from a searchable list (grouped Citizen / Department / Other); ticked tags show as chips with a cross. Enter ticks the top match. Only tags from the team list can be chosen; the free-text tag box is gone.
- **The AI suggests tags from the team list only**, judged by the page URL and the bug (usually the portal tag and the module tag), and returns none when nothing fits.
- **The team tag list ships complete** (41 tags from the exported issue list; spelling variants merged). A saved copy of the old 2-tag list is upgraded automatically.
- **Leave empty** is the first choice in every Issue field; Fill skips those fields in Zoho. Device Type and Reproducible start empty on new installs; Test Phase gains System.

## 1.3.0 · 2026-10-26
- **One-step setup**: paste an AI key and you are ready. The key is tested as it is pasted; project code and Zoho address steps are gone (the team defaults are already in place) and a team format file can still be imported from the same screen.
- **Settings are shorter**: AI key, writing length, usage and appearance stay in view; title format, sections, fields, tags, style example, Zoho labels and export/import sit in a collapsed *Team format and Zoho* group.
- **Auto model** starts with the newest Flash model and rolls back to the next older Flash, then Flash-Lite and Pro, as each one runs out of quota or stalls.
- **A model that stops answering no longer hangs the report**: each try waits 40 seconds (was 120), then the next model or the backup key is tried; after two silent models the error names them.
- **Reports are always written in English**, also for pages shown in Malayalam or another language; non-English text is only quoted when the bug is about that text. Non-English parts of the tab title are no longer sent.

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
- **Ready for the Chrome Web Store** (private, Amnex only): a privacy policy (`PRIVACY.md`) and store assets; the Amnex defaults stay.
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
