# QArator privacy policy

_Last updated: 24 October 2026_

QArator is a Chrome extension that turns a screenshot or screen recording and a short note into a bug report, and fills that report into the Zoho Projects "Submit Issue" form. This policy explains what it handles and where that goes.

**In short:** QArator has no server of its own. Nothing is sent to the developer. What you capture goes only to the AI provider you choose, and only when you ask for a report.

## What QArator handles

- **Screenshots and screen recordings** you take with QArator, including anything visible in them.
- **Your note** ("What's wrong?") and any steps you type.
- **Page details** of the tab you capture: its address, title, and headings or menu labels used to name the module and page.
- **Page errors** (console errors and failed requests on the page you test), only if you turn on "Collect page errors" in Settings. This is off by default.
- **Your AI API key** (and an optional backup key), entered by you in Settings.
- **The reports** the AI writes, your edits to them, and the fields you choose.
- **Usage counts**: how many requests went to which model, for the Usage page in Settings.

## Where it goes

- **Your AI provider.** When you press Generate report, Generate & next bug or Rewrite, QArator sends the screenshots (shrunk), a few still frames from your recordings, your note, the page details and, if enabled, page errors to the provider you selected: Google (Gemini API), Anthropic (Claude API), OpenAI, or an OpenAI-compatible address you enter. Your API key is sent to that provider to authenticate the request. The provider's own terms and privacy policy apply to that request. Video files themselves are not sent to the AI.
- **Zoho Projects, in your own browser tab.** When you press Fill Zoho form, QArator types the report into the Submit Issue form in your open Zoho tab and attaches your screenshots and recordings there. It never presses Submit; you do.
- **Files you export.** Word exports and saved files go to your own Downloads folder.
- **Nowhere else.** No analytics, no tracking, no advertising, and no data is sent to the developer or sold to anyone.

## Where it is stored

Everything stays in your browser on your computer, in the extension's own storage (`chrome.storage.local` and IndexedDB): your settings and API keys, the current draft, the Bug list, recent reports with their screenshots, recordings, and usage counts. Keys are never included when you export your team format.

## Your control

- Remove any screenshot, recording, bug or report in the panel; **Clear list** in Recent reports deletes the saved reports and their screenshots; **Reset counters** clears usage counts.
- Uninstalling QArator deletes all of its stored data from your browser.
- Personal data you don't want in a report can be blacked out with **Mark up › Hide** before anything is sent; the area is removed from the image pixels, not just covered.

## Permissions

QArator asks for access to the sites you open so it can capture the tab you are testing (on any domain), read that page's address and headings, fill the Zoho form on whichever Zoho domain your team uses, and reach your AI provider. It records your screen only when you press Record screen and choose what to share.

## Children

QArator is a work tool for software testers and is not directed at children.

## Changes and contact

Changes to this policy are published in this file with a new date. Questions or requests: open an issue at <https://github.com/devshrawin/QArator/issues>.

QArator is not affiliated with or endorsed by Zoho, Google, Anthropic or OpenAI.
