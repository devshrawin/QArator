# Changelog

## 1.1.0 · 2026-10-24
- **Auto model** (new default): picks the best image-capable model your key has and falls back to the next one when a model is rate-limited, out of daily quota or missing. Resting models are skipped until they can answer again. Fixed-model mode can keep or turn off the fallback.
- **Usage** in Settings: requests, failures, tokens, estimated rupee cost, daily limit left (learned from rate-limit replies), quota reset time. Panel warns when a model is near its limit or resting.
- **First-run setup** page: tests the AI key, sets project code and Zoho address (or imports a team format), shows shortcuts. Panel shows a setup card until it is done.
- **Location from the page**: the URL section always has the captured page address, also without a screenshot; Portal, Module and Page come from the host name, breadcrumb, highlighted menu, tab and heading.
- Settings loads models by itself when a key is pasted.
- Fixes: a bad Gemini key (HTTP 400) now says the key was rejected; tags typed in review keep the team list's spelling.

## 1.0.0 · 2026-10-24
- First version: capture, mark up, AI bug report in the team format, Zoho Submit Issue fill.
