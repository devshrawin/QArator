// The setup guide: a Markdown file a person downloads and hands, with notes about their own platform,
// to any AI agent. The agent writes one JSON project file; QArator imports it. Everything the agent
// needs is here, so keep it in step with settings.js (the test imports EXAMPLE and expects no warnings).
import { LAYOUTS, SEGMENTS, FORMAT_VERSION } from './settings.js';

export const EXAMPLE = {
  qarator: 'format',
  formatVersion: FORMAT_VERSION,
  meta: {
    id: 'acme_shop',
    name: 'Acme Shop',
    version: 1,
    sites: ['shop.acme.example', 'admin.acme.example'],
    scopes: [
      {
        name: 'Admin site',
        match: 'admin.acme.example',
        override: {
          title: { project: 'ACME' },
          tags: { list: ['Admin', 'Admin - Orders', 'Admin - Products'] },
          urlRules: [
            { match: '/orders', portal: 'Admin', module: 'Orders', page: '' },
            { match: '/products', portal: 'Admin', module: 'Products', page: '' }
          ]
        }
      },
      {
        name: 'Customer shop',
        match: 'shop.acme.example',
        override: {
          tags: { list: ['Shop', 'Shop - Checkout', 'Shop - Search'] },
          fields: [{ id: 'device', name: 'Device', options: ['Desktop', 'Mobile'], default: 'Desktop' }],
          urlRules: [
            { match: '/checkout', portal: 'Shop', module: 'Checkout', page: '' },
            { match: '/search', portal: 'Shop', module: 'Search', page: '' }
          ]
        }
      }
    ]
  },
  writingLength: 'standard',
  title: { segments: ['project', 'portal', 'module', 'page', 'summary'], project: 'ACME', separator: ' | ', maxLength: 150, summaryCase: 'title' },
  urlRules: [],
  sections: [
    { id: 'url_note', name: 'URL', layout: 'inline', include: true, guide: 'A short note on which part of the app on this URL is affected. Do not repeat the URL.' },
    { id: 'summary', name: 'Summary', layout: 'inline', include: true, guide: 'Two or three plain sentences: what the user did, what went wrong, where.' },
    { id: 'steps', name: 'Steps to Reproduce', layout: 'numbered', include: true, guide: 'One action per step, using on-screen labels. The last step is the observation.' },
    { id: 'expected', name: 'Expected Result', layout: 'paragraph', include: true, guide: 'What should happen, as a requirement.' },
    { id: 'actual', name: 'Actual Result', layout: 'paragraph', include: true, guide: 'What happens instead, matching the screenshot.' }
  ],
  fields: [
    { id: 'severity', name: 'Severity', zohoLabel: 'Severity', options: ['Critical', 'Major', 'Minor', 'Trivial'], default: 'Minor', ai: true },
    { id: 'priority', name: 'Priority', zohoLabel: 'Priority', options: ['High', 'Medium', 'Low'], default: 'Medium', ai: true },
    { id: 'environment', name: 'Environment', zohoLabel: 'Environment', options: ['Staging', 'UAT', 'Production'], default: '', ai: false }
  ],
  tags: { list: [], max: 5, onlyFromList: true },
  styleExample: 'ACME | Admin | Orders | Order List | Export Button Does Nothing\n\nURL: https://admin.acme.example/orders (Specifically affects the order export)\n\nSummary: On the Order List, pressing Export shows no file and no message.\n\nSteps to Reproduce\n1. Log in to the admin site.\n2. Open Orders > Order List.\n3. Press Export.\n4. Observe that nothing is downloaded.\n\nExpected Result\nPressing Export downloads the orders as a file.\n\nActual Result\nNothing is downloaded and no message appears.',
  zoho: { domain: 'projects.zoho.com', submitUrl: '', titleLabel: 'Issue Title|Bug Title|Title', descriptionLabel: 'Description|Issue Description', tagsLabel: 'Tags', attachLabel: 'Attachment|Attachments|Attach', fillTags: false }
};

export function buildGuide() {
  return `# QArator setup guide

This file is for an AI agent. A tester downloaded it from QArator, and will give you this guide plus notes about their own bug tracker (screenshots of its "new issue" form, a field list, a sample bug report, an export). Your job: write **one JSON file** that sets QArator up for their project. They import it in QArator (Settings › Team format and Zoho › Import format).

You do not need to run anything. Answer with the JSON in a single code block, nothing else in that block.

## 1. Ask first (only what you cannot see in their notes)

1. Which tracker is it (Zoho Projects, Jira, Confluence, Azure DevOps, GitHub, something else) and what is the project called?
2. What fields does a new bug have, with every choice each dropdown offers? Which ones should the AI pick (Severity, Priority, Classification, Type) and which stay as the tester's own choice?
3. What does a good bug title look like? Give two real titles. (QArator joins parts like \`Project | Portal | Module | Page | Summary\`.)
4. What sections does the description have, in order, and what belongs in each? Ask for one real report to copy the tone and layout from.
5. Which tags or labels exist? Does the team use a fixed list? (QArator only ever suggests from the list; it never invents tags.)
6. Is it one app, or several portals / sites / areas with different tags, fields or titles? Which web address tells them apart?
7. Does the team write in another language? (QArator always writes the report in English, and only quotes other-language text when the bug is about that text.)

## 2. What QArator does with the file

- Capture a screenshot and one line → the AI writes the title, each section, picks the **fields** you list, and suggests **tags** from your list → the tester reviews it → QArator fills it into the tracker, or lets them copy it.
- **Today QArator fills Zoho Projects forms** (the \`zoho\` block holds the labels it looks for). For any other tracker, still write the file: QArator writes the whole report in that format and the tester uses **Copy title** and **Copy description** and chooses the fields there. Put the tracker's own field names in \`zohoLabel\` anyway; they are used for matching later.

## 3. The file

Top level (all keys optional except \`qarator\`; leave out what you do not know; QArator keeps its neutral defaults for anything missing):

| key | what it is |
|---|---|
| \`qarator\` | must be \`"format"\` |
| \`formatVersion\` | \`${FORMAT_VERSION}\` |
| \`meta\` | the project: \`id\` (letters, digits, _), \`name\`, \`version\` (number, raise it when you change the file), \`sites\` (web addresses where this project applies), \`scopes\` (portals / areas, section 4) |
| \`writingLength\` | \`brief\`, \`standard\` or \`detailed\` |
| \`title\` | \`segments\` (order of title parts; allowed: ${Object.keys(SEGMENTS).map((k) => `\`${k}\``).join(', ')}), \`project\` (the code shown first), \`separator\`, \`maxLength\`, \`summaryCase\` (\`title\` or \`sentence\`) |
| \`urlRules\` | list of \`{ "match", "portal", "module", "page" }\`: when the page address contains \`match\`, those names go into the title. Leave a value empty to let QArator read it from the page |
| \`sections\` | the description, in order (below) |
| \`fields\` | the dropdowns (below) |
| \`tags\` | \`{ "list": [...], "max": 5, "onlyFromList": true }\` |
| \`styleExample\` | one real, finished bug report in the team's style (plain text). The AI copies its tone and layout, not its facts |
| \`zoho\` | \`domain\`, \`titleLabel\`, \`descriptionLabel\`, \`tagsLabel\`, \`attachLabel\` (several accepted labels joined with \`|\`), \`fillTags\` (false by default) |

**sections[]** each: \`id\` (lowercase letters, digits, _; use \`url_note\` for a short note next to the page URL and \`steps\` for steps to reproduce), \`name\` (heading shown), \`layout\` (one of ${Object.keys(LAYOUTS).map((k) => `\`${k}\``).join(', ')}), \`include\` (true/false), \`guide\` (one or two sentences telling the AI what belongs there; this is the most important text in the file, so be specific).

**fields[]** each: \`id\` (lowercase letters, digits, _), \`name\` (as the tester sees it), \`zohoLabel\` (the label in the tracker; \`A|B\` for alternatives), \`options\` (every choice, spelled exactly as in the tracker, at least one), \`default\` (one of the options, or \`""\` to leave the field empty), \`ai\` (true when the AI should choose it).

## 4. Portals and areas (\`meta.scopes\`)

When one project has several sites or areas with their own rules, add a scope for each. A scope is \`{ "name", "match", "override" }\`. \`match\` is part of the page address (for example \`admin.acme.example\` or \`/orders\`). When the tester's page contains it, QArator applies the scope's \`override\` on top of the project. A longer match wins over a shorter one, so a scope for a whole site and another for one area of it can both apply.

\`override\` may contain only: \`title\`, \`tags\`, \`sections\`, \`fields\`, \`styleExample\`, \`urlRules\`, \`zoho\`, \`writingLength\`. Objects (\`title\`, \`tags\`, \`zoho\`) merge key by key; \`sections\` replaces the project's sections; \`fields\` changes the fields with the same \`id\` and adds new ones; \`urlRules\` go first. Put in a scope only what is different.

## 5. Rules for what you write

- JSON only: double quotes, no comments, no trailing commas.
- Never put keys, passwords, tokens or personal data in the file. QArator ignores AI settings in a file anyway.
- Spell option values and tag names exactly as the tracker does (capital letters, spaces, punctuation). A mismatch means the field cannot be filled.
- Do not invent fields, options or tags the team did not give you. If you are unsure, ask or leave it out.
- Keep \`guide\` texts short and concrete. Do not paste client secrets or real customer data into \`styleExample\`.

## 6. Complete example

\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\`

## 7. Before you answer

- [ ] \`"qarator": "format"\` is the first key.
- [ ] Every field has at least one option, and \`default\` is one of them or \`""\`.
- [ ] Every section has an \`id\`, a \`name\`, a valid \`layout\` and a useful \`guide\`.
- [ ] Tag names match the tracker exactly; none were made up.
- [ ] Every scope has a \`name\` and a \`match\`.
- [ ] The reply is one JSON block.

If QArator shows errors when the tester imports the file, they will paste them back to you. Fix exactly what they list and send the whole file again.
`;
}
