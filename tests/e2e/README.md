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
plain labelled form, steps box, tags, attachments, history, draft restore, settings model lists, export and import.

Not covered: the real Zoho Projects page (the mock follows the selectors in `content/zoho-fill.js`), real AI
answers, and the Alt+Shift keyboard commands (browser-level, not reachable from Playwright).
