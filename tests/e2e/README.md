# End-to-end QA

Loads the unpacked extension into Playwright's Chromium and drives the real side panel and settings page.
AI providers are mocked (Gemini, Anthropic and OpenAI by request interception, the OpenAI-compatible
endpoint by `server.py`), and the Zoho Submit Issue form is a local mock served on `projects.zoho.localhost`.

```
pip install playwright && python -m playwright install chromium
python tests/e2e/e2e.py . tests/e2e/out
```

Covers: page error collection, capture, file add and paste, markup (Hide gives black pixels), report writing
for all four providers, rate-limit / bad-key / non-JSON / no-key paths, Zoho fill on a Lyte-style form and a
plain labelled form, steps box, tags, attachments, history, draft restore, settings model lists, export and import,
Appearance (theme, text size, glow on focus and hover, animations off, compact panel, not exported).

Not covered: the real Zoho Projects page (the mock follows the selectors in `content/zoho-fill.js`), real AI
answers, and the Alt+Shift keyboard commands (browser-level, not reachable from Playwright).

## Edge-case audit

`python tests/e2e/audit.py . tests/e2e/out-audit` runs the harder cases: upgrading from 1.0/1.1 saved data, hostile page titles and AI answers (HTML injection), odd AI answers, double clicks, Esc during writing, moving on while a report is written, the Bug list with a busy provider and a panel closed mid-write, a malicious format import, pasted WebP, 1080p screenshots and a recorded video. Exports are opened in real Microsoft Word (needs Word and `pywin32` on Windows) and the video is checked with `ffprobe` (path set at the top of the script).
