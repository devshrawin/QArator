"""End-to-end QA of the QArator extension in real Chromium.
Usage: python e2e.py <extension dir> <out dir> [port]"""
import sys, os, json, tempfile, subprocess, time, traceback, base64
from playwright.sync_api import sync_playwright

EXT, OUT = sys.argv[1], sys.argv[2]
PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 8765
HERE = os.path.dirname(os.path.abspath(__file__))
ANSWER = json.load(open(os.path.join(HERE, "answer.json"), encoding="utf-8"))
ANS = json.dumps(ANSWER)
results, logs = [], []
mode = {"v": "ok"}
seen = {"gemini": [], "anthropic": [], "openai": []}


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail else ""), flush=True)


def phase(fn):
    try:
        fn()
    except Exception as e:
        check(fn.__name__ + " crashed", False, f"{type(e).__name__}: {e}")
        traceback.print_exc()


def err_body(provider):
    m = mode["v"]
    if m == "429":
        return 429, {"error": {"code": 429, "message": "Resource has been exhausted (e.g. check quota).", "status": "RESOURCE_EXHAUSTED"}}, {"retry-after": "7"}
    if m == "badkey":
        return 400, {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT"}}, {}
    if m == "401":
        return 401, {"error": {"type": "authentication_error", "message": "invalid x-api-key"}}, {}
    if m == "garbage":
        return 200, None, {}
    return None


def make_route(provider):
    def handler(route):
        req = route.request
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*"})
        hdr = {"access-control-allow-origin": "*", "content-type": "application/json"}
        url = req.url
        if req.method == "GET":  # model lists
            if provider == "gemini":
                body = {"models": [
                    {"name": "models/gemini-2.5-flash", "displayName": "Gemini 2.5 Flash", "supportedGenerationMethods": ["generateContent"]},
                    {"name": "models/gemini-2.5-pro", "displayName": "Gemini 2.5 Pro", "supportedGenerationMethods": ["generateContent"]},
                    {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]}]}
            elif provider == "anthropic":
                body = {"data": [{"id": "claude-sonnet-4-5", "display_name": "Claude Sonnet 4.5"}]}
            else:
                body = {"data": [{"id": "gpt-4.1"}, {"id": "gpt-4o-mini-tts"}, {"id": "text-embedding-3-small"}]}
            return route.fulfill(status=200, headers=hdr, body=json.dumps(body))
        seen[provider].append({"url": url, "headers": req.headers, "body": req.post_data_json})
        e = err_body(provider)
        if e:
            st, b, extra = e
            text = "Sorry, I can't help with that." if b is None else json.dumps(b)
            if b is None:  # model chatter instead of JSON
                b = {"candidates": [{"content": {"parts": [{"text": text}]}}]} if provider == "gemini" else \
                    {"content": [{"type": "text", "text": text}]} if provider == "anthropic" else {"choices": [{"message": {"content": text}}]}
                text = json.dumps(b)
            return route.fulfill(status=st, headers={**hdr, **extra}, body=text)
        if provider == "gemini":
            b = {"candidates": [{"content": {"parts": [{"text": ANS}]}}]}
        elif provider == "anthropic":
            b = {"content": [{"type": "text", "text": "Here is the report:\n" + ANS}]}
        else:
            b = {"choices": [{"message": {"content": ANS}}]}
        route.fulfill(status=200, headers=hdr, body=json.dumps(b))
    return handler


srv = subprocess.Popen([sys.executable, os.path.join(HERE, "server.py"), str(PORT)])
time.sleep(1.2)
BASE = f"http://localhost:{PORT}"
ZBASE = f"http://projects.zoho.localhost:{PORT}"

try:
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel="chromium", headless=True,
            viewport={"width": 1280, "height": 800}, accept_downloads=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        ctx.route("https://generativelanguage.googleapis.com/**", make_route("gemini"))
        ctx.route("https://api.anthropic.com/**", make_route("anthropic"))
        ctx.route("https://api.openai.com/**", make_route("openai"))
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=10000)
        EID = sw.url.split("/")[2]
        PANEL = f"chrome-extension://{EID}/sidepanel/sidepanel.html"

        def set_settings(patch):
            sw.evaluate("""async (patch) => {
              const { settings = {} } = await chrome.storage.local.get('settings');
              const s = JSON.parse(JSON.stringify(settings));
              for (const [k, v] of Object.entries(patch)) s[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(s[k] || {}), ...v } : v;
              await chrome.storage.local.set({ settings: s });
            }""", patch)

        # ---- site under test in window W1
        site = ctx.pages[0] if ctx.pages else ctx.new_page()
        site.on("console", lambda m: None)
        site.goto(f"{BASE}/test.html")
        site.wait_for_timeout(1200)
        tab = sw.evaluate(f"""async () => (await chrome.tabs.query({{url: '{BASE}/test.html'}}))[0]""")
        W1, T1 = tab["windowId"], tab["id"]

        def errors_collected():
            info = sw.evaluate("(id) => chrome.tabs.sendMessage(id, {type: 'qarator:pageInfo'})", T1)
            kinds = sorted({e["kind"] for e in info["errors"]})
            msgs = [f'{e["kind"]}: {e["message"]} · {e["source"]} x{e["count"]}' for e in info["errors"]]
            check("page errors: bridge answers pageInfo", info["url"].endswith("/test.html"), info["title"])
            for k in ["console", "error", "promise", "http", "resource"]:
                check(f"page errors: kind '{k}' captured", k in kinds, "; ".join(m for m in msgs if m.startswith(k)))
            dup = [e for e in info["errors"] if "canvas-bg" in e["message"]]
            check("page errors: duplicate console.error collapsed with count", len(dup) == 1 and dup[0]["count"] == 2, str(dup))
            print("\n  ".join(["collected:"] + msgs))
        phase(errors_collected)

        set_settings({"ai": {"provider": "gemini", "apiKey": "test-gemini-key", "model": "gemini-2.5-flash", "baseUrl": ""}})

        # ---- panel in its own window; it acts on W1 as if docked there
        with ctx.expect_page() as pi:
            sw.evaluate(f"() => chrome.windows.create({{url: '{PANEL}', type: 'normal', width: 420, height: 900}})")
        panel = pi.value
        panel.set_viewport_size({"width": 420, "height": 900})
        panel.on("console", lambda m: logs.append(f"[panel] {m.type}: {m.text}") if m.type in ("error", "warning") else None)
        panel.on("pageerror", lambda e: logs.append(f"[panel] PAGEERROR: {e}"))
        panel.wait_for_load_state()
        panel.wait_for_timeout(800)
        PATCH = f"() => {{ chrome.windows.getCurrent = async () => ({{ id: {W1} }}); }}"
        panel.evaluate(PATCH)
        sw.evaluate(f"() => chrome.tabs.update({T1}, {{active: true}})")

        def to_capture():
            if panel.locator("[data-action=back-capture]").count():
                panel.click("[data-action=back-capture]")
            if panel.locator("[data-action=dismiss-error]").count():
                panel.click("[data-action=dismiss-error]")

        def shot(name):
            panel.screenshot(path=os.path.join(OUT, f"{name}.png"), full_page=True)

        def capture():
            panel.click("#main [data-action=capture]")
            panel.wait_for_selector(".shots img", timeout=8000)
            panel.wait_for_timeout(400)
            txt = panel.inner_text("#main")
            check("capture: screenshot added", panel.locator(".shots img").count() == 1)
            check("capture: page URL shown", "/test.html" in txt)
            check("capture: page errors chip", "page error" in txt and "captured" in txt, [l for l in txt.split("\n") if "error" in l][:3])
            check("capture: env chips (browser/os/viewport)", "Viewport" in txt, txt.split("Viewport")[0][-60:] if "Viewport" in txt else txt[:200])
            shot("01-captured")
        phase(capture)

        def write_gemini():
            panel.fill("#note", "Dark mode leaves the dashboard canvas white")
            panel.click("#dock [data-action=write]")
            panel.wait_for_selector("#title-preview", timeout=15000)
            title = panel.inner_text("#title-preview").replace("\n", "")
            check("write(gemini): review opens", True)
            check("write(gemini): title built + Title Case + no trailing period",
                  title == "UR | Department Portal | SEVI Dashboard | State Overview | Dark Mode Leaves the Dashboard Canvas White", title)
            url = panel.input_value("#sec-url_note")
            check("write: URL line keeps real URL, strips repeat", url == f"{BASE}/test.html (Specifically affects the State Overview workspace)", url)
            steps = panel.input_value("#sec-steps")
            check("write: step numbering/bullets stripped", steps.split("\n") == ["Open the Department Portal and log in", "Click the theme toggle", "Open SEVI Dashboard > State Overview", "Observe the cards"], repr(steps))
            sev, pri, cls = panel.input_value("#fld-severity"), panel.input_value("#fld-priority"), panel.input_value("#fld-classification")
            check("write: AI fields matched loosely", (sev, pri, cls) == ("Minor", "Medium", "Bug"), f"{sev}/{pri}/{cls}")
            check("write: non-AI fields keep defaults", panel.input_value("#fld-test_phase") == "Smoke" and panel.input_value("#fld-device_type") == "Desktop")
            tags = panel.locator(".tagc").all_inner_texts()
            check("write: tags limited to list, deduped", tags == ["UR - Department Portal"], str(tags))
            r = seen["gemini"][-1]
            body = r["body"]
            parts = body["contents"][0]["parts"]
            img = [x for x in parts if "inline_data" in x]
            check("gemini request: screenshot sent as jpeg inline_data", len(img) == 1 and img[0]["inline_data"]["mime_type"] == "image/jpeg")
            check("gemini request: key in header, not URL", r["headers"].get("x-goog-api-key") == "test-gemini-key" and "key=" not in r["url"])
            text = parts[-1]["text"]
            check("gemini request: note + errors + url in prompt", "Dark mode leaves" in text and "Page errors captured" in text and "/test.html" in text)
            check("gemini request: JSON mode + system prompt", body.get("generationConfig", {}).get("responseMimeType") == "application/json" and "senior QA engineer" in body["systemInstruction"]["parts"][0]["text"])
            shot("02-review")
        phase(write_gemini)

        def review_edits():
            panel.fill("#seg-page", "State Overview Tab")
            check("review: title preview updates live", "State Overview Tab" in panel.inner_text("#title-preview"))
            panel.fill("#new-tag", "UR - Department Portal - SEVI Dashboard")
            panel.press("#new-tag", "Enter")
            tags = panel.locator(".tagc").all_inner_texts()
            check("review: manual tag added", len(tags) == 2, str(tags))
            panel.fill("#seg-page", "State Overview")
        phase(review_edits)

        def errors_paths():
            def attempt(m):
                mode["v"] = m
                to_capture()
                panel.click("#dock [data-action=write]")
                panel.wait_for_selector(".alert, #title-preview", timeout=15000)
                panel.wait_for_timeout(300)
                return panel.inner_text("#main")
            t = attempt("429")
            check("error 429: busy banner with countdown", "busy" in t and "Try again in" in t, t[:160].replace("\n", " | "))
            check("error 429: retry button disabled during countdown", panel.get_attribute("#retry", "aria-disabled") == "true")
            shot("03-ratelimit")
            panel.click("[data-action=dismiss-error]")
            t = attempt("badkey")
            check("error gemini bad key (HTTP 400): says key rejected", "key was rejected" in t.lower(), t[:160].replace("\n", " | "))
            panel.click("[data-action=dismiss-error]")
            t = attempt("garbage")
            check("error non-JSON answer: 'not usable' message", "not usable" in t, t[:160].replace("\n", " | "))
            panel.click("[data-action=dismiss-error]")
            mode["v"] = "ok"
            set_settings({"ai": {"apiKey": ""}})
            panel.wait_for_timeout(300)
            panel.click("#dock [data-action=write]")
            panel.wait_for_timeout(500)
            t = panel.inner_text("#main")
            check("no key: setup screen", "Add an AI key" in t, t[:120])
            panel.click("[data-action=blank]")
            panel.wait_for_selector("#title-preview")
            check("no key: 'fill myself' opens blank review", panel.input_value("#sec-summary") == "")
            set_settings({"ai": {"apiKey": "test-gemini-key"}})
            panel.wait_for_timeout(300)
        phase(errors_paths)

        def other_providers():
            for prov, ai in [("anthropic", {"provider": "anthropic", "apiKey": "sk-ant-test", "model": "claude-sonnet-4-5"}),
                             ("openai", {"provider": "openai", "apiKey": "sk-test", "model": "gpt-4.1"}),
                             ("compatible", {"provider": "compatible", "apiKey": "", "model": "local-vision", "baseUrl": f"http://127.0.0.1:{PORT}/v1/"})]:
                set_settings({"ai": ai})
                panel.wait_for_timeout(300)
                to_capture()
                panel.click("#dock [data-action=write]")
                try:
                    panel.wait_for_selector("#title-preview", timeout=15000)
                    ok = "Dark Mode Leaves" in panel.inner_text("#title-preview")
                except Exception:
                    ok = False
                check(f"write({prov}): report produced", ok, "" if ok else panel.inner_text("#main")[:200].replace("\n", " | "))
            a = seen["anthropic"][-1]
            check("anthropic request: browser-access header + image block", a["headers"].get("anthropic-dangerous-direct-browser-access") == "true" and any(c["type"] == "image" for c in a["body"]["messages"][0]["content"]))
            o = seen["openai"][-1]
            check("openai request: json_object + image_url", o["body"].get("response_format", {}).get("type") == "json_object" and any(c["type"] == "image_url" for c in o["body"]["messages"][1]["content"]))
            log = [json.loads(l) for l in open(os.path.join(HERE, "requests.jsonl"), encoding="utf-8")] if os.path.exists(os.path.join(HERE, "requests.jsonl")) else []
            check("compatible request: no auth header without key, trailing slash ok", log and log[-1]["auth"] is None)
            set_settings({"ai": {"provider": "gemini", "apiKey": "test-gemini-key", "model": "gemini-2.5-flash", "baseUrl": ""}})
            panel.wait_for_timeout(300)
        phase(other_providers)

        def markup():
            to_capture()
            panel.click("[data-action=markup]")
            panel.wait_for_selector("#mk-canvas")
            panel.wait_for_timeout(300)
            bb = panel.locator("#mk-canvas").bounding_box()
            x, y, w, h = bb["x"], bb["y"], bb["width"], bb["height"]
            panel.mouse.move(x + w * .55, y + h * .2); panel.mouse.down(); panel.mouse.move(x + w * .9, y + h * .45, steps=5); panel.mouse.up()
            panel.keyboard.press("h")
            panel.mouse.move(x + w * .2, y + h * .6); panel.mouse.down(); panel.mouse.move(x + w * .5, y + h * .75, steps=5); panel.mouse.up()
            shot("04-markup")
            panel.click("[data-mk=apply]")
            panel.wait_for_selector(".badge", timeout=5000)
            check("markup: applied, badge shown", "Marked up" in panel.inner_text(".shots"))
            panel.wait_for_timeout(1000)
            frac = panel.evaluate("""async () => {
              const { draft } = await chrome.storage.local.get('draft');
              const s = draft.shots[0];
              const count = async (u) => { const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let b = 0; for (let k = 0; k < d.length; k += 4) if (d[k] === 0 && d[k+1] === 0 && d[k+2] === 0) b++; let o = 0; for (let k = 0; k < d.length; k += 4) if (d[k] === 255 && d[k+1] === 106 && d[k+2] === 43) o++; return [b / (d.length / 4), o]; };
              return { marked: await count(s.dataUrl), orig: await count(s.original), marks: s.marks.map(m => m.type) };
            }""")
            check("markup: Hide area is real black pixels in saved image", frac["marked"][0] - frac["orig"][0] > 0.03, str(frac))
            check("markup: Box drawn in orange", frac["marked"][1] > 100, str(frac))
        phase(markup)

        def zoho_fill():
            mode["v"] = "ok"
            panel.click("#dock [data-action=write]")
            panel.wait_for_selector("#title-preview", timeout=15000)
            for t in ["UR - Department Portal - SEVI Dashboard", "made-up tag"]:
                panel.fill("#new-tag", t); panel.press("#new-tag", "Enter")
            print("  report tags:", panel.locator(".tagc").all_inner_texts())
            # not on Zoho yet
            panel.click("#dock [data-action=fill]")
            panel.wait_for_timeout(500)
            check("fill: not-Zoho banner when active tab isn't Zoho", "Open the Zoho Submit Issue form first" in panel.inner_text("#dock"))
            site.goto(f"{ZBASE}/zoho.html")
            site.wait_for_timeout(600)
            panel.click("#dock [data-action=fill]")
            panel.wait_for_selector("text=Form filled", timeout=30000)
            shot("05-filled-lyte")
            out = panel.inner_text("#main")
            print("  panel results:\n   " + out.replace("\n", "\n   "))
            v = site.evaluate("""() => ({
              title: document.getElementById('title').value,
              desc: document.getElementById('ed').contentDocument.body.innerHTML,
              picked: window.__picked || {},
              tokens: [...document.querySelectorAll('.ztokenfield__token')].map(t => t.textContent),
              tags: [...document.querySelectorAll('.tagchip')].map(t => t.textContent),
              files: document.getElementById('flist').textContent,
              steps: document.getElementById('steps').value,
              submitted: !!window.__submitted })""")
            print("  zoho DOM:", json.dumps({**v, "desc": v["desc"][:300]}, indent=1))
            check("zoho(lyte): title filled", v["title"].startswith("UR | Department Portal"), v["title"])
            check("zoho(lyte): description HTML in iframe editor", "<b>Summary:</b>" in v["desc"] and "<ol>" in v["desc"])
            want = {"Severity": "Minor", "Priority": "Medium", "Classification": "Bug", "Reproducible": "Always"}
            check("zoho(lyte): dropdowns picked", all(v["picked"].get(k) == x for k, x in want.items() if k != "Test Phase") , str(v["picked"]))
            check("zoho(lyte): Assignee 'Unassigned' left empty", "Assignee" not in v["picked"])
            check("zoho(lyte): Device Type token", v["tokens"] == ["Desktop"], str(v["tokens"]))
            check("zoho(lyte): tags from existing list", v["tags"] == ["UR - Department Portal", "UR - Department Portal - SEVI Dashboard"], str(v["tags"]))
            check("zoho(lyte): screenshot attached", "qarator_" in v["files"] and ".png" in v["files"], v["files"])
            check("zoho(lyte): never submits", not v["submitted"])
            check("fill: unknown tag flagged for manual check", "Needs a manual check" in out and "made-up tag" in out, out[:300])
            # steps box
            set_settings({"zoho": {"stepsField": True}})
            panel.wait_for_timeout(300)
            panel.click("#dock [data-action=fill]")
            try: site.wait_for_function("document.getElementById('steps').value", timeout=30000)
            except Exception: pass
            panel.wait_for_timeout(3000)
            steps = site.evaluate("document.getElementById('steps').value")
            check("zoho(lyte): steps box filled numbered when enabled", steps.startswith("1. Open the Department Portal"), repr(steps[:80]))
            tags2 = site.evaluate("[...document.querySelectorAll('.tagchip')].length")
            check("fill again: tags not duplicated", tags2 == 2, str(tags2))
            set_settings({"zoho": {"stepsField": False}})
        phase(zoho_fill)

        def zoho_generic():
            site.goto(f"{ZBASE}/generic.html")
            site.wait_for_timeout(500)
            panel.click("#dock [data-action=back-review]")
            panel.click("#dock [data-action=fill]")
            panel.wait_for_selector("text=Form filled", timeout=30000)
            out = panel.inner_text("#main")
            shot("06-filled-generic")
            print("  panel results:\n   " + out.replace("\n", "\n   "))
            v = site.evaluate("""() => ({ t: document.getElementById('t').value, d: document.getElementById('d').innerHTML,
              sev: document.getElementById('sev').selectedOptions[0].text, pri: document.getElementById('pri').value, cls: document.getElementById('cls').value,
              rep: document.getElementById('rep').value, chips: [...document.querySelectorAll('.chip')].map(c => c.textContent),
              files: [...document.getElementById('att').files].map(f => f.name) })""")
            print("  generic DOM:", json.dumps({**v, "d": v["d"][:200]}))
            check("generic: title by <label for>", v["t"].startswith("UR | "), v["t"])
            check("generic: contenteditable description", "<b>Summary:</b>" in v["d"])
            check("generic: native selects (Severity/Priority/Classification)", (v["sev"], v["pri"], v["cls"]) == ("Minor", "Medium", "Bug"), str(v))
            check("generic: alt label 'Is it reproducible'", v["rep"] == "Always", v["rep"])
            check("generic: tags typed + Enter, list tag keeps casing", v["chips"] == ["UR - Department Portal", "UR - Department Portal - SEVI Dashboard", "made-up tag"], str(v["chips"]))
            check("generic: single file input gets screenshot", len(v["files"]) == 1, str(v["files"]))
            if panel.locator("[data-action=goto]").count():
                panel.locator("[data-action=goto]").first.click()
                panel.wait_for_timeout(500)
                check("goto field: outlines field in page", site.evaluate("!!document.querySelector('[data-qarator-field][style*=outline]')"))
        phase(zoho_generic)

        def persistence_history():
            panel.reload()
            panel.wait_for_timeout(1200)
            panel.evaluate(PATCH)
            t = panel.inner_text("#main")
            check("draft: survives panel reload", "Form filled" in t or "Title" in t, t[:100])
            panel.click("#btn-history")
            panel.wait_for_timeout(500)
            h = panel.inner_text("#main")
            check("history: filled report listed", "Filled in Zoho" in h, h[:200].replace("\n", " | "))
            panel.click("[data-action=history-open]")
            panel.wait_for_selector("#title-preview")
            check("history: reopen loads report", "Dark Mode" in panel.inner_text("#title-preview"))
            to_capture()
            t = panel.inner_text("#main")
            check("history: reopened report has no screenshots kept", panel.locator(".shots img").count() == 0)
        phase(persistence_history)

        def paste_and_file():
            panel.evaluate("() => chrome.storage.local.remove('draft')")
            panel.reload(); panel.wait_for_timeout(800); panel.evaluate(PATCH)
            png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")
            panel.set_input_files("#file", files=[{"name": "a.png", "mimeType": "image/png", "buffer": png}])
            panel.wait_for_selector(".shots img", timeout=5000)
            check("add image from file", panel.locator(".shots img").count() == 1)
            panel.evaluate("""async () => { const r = await fetch(document.querySelector('.shots img').src); const b = await r.blob();
              const dt = new DataTransfer(); dt.items.add(new File([b], 'p.jpg', {type: 'image/jpeg'}));
              document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true})); }""")
            panel.wait_for_timeout(800)
            check("paste image (Ctrl+V)", panel.locator(".shots img").count() == 2, str(panel.locator(".shots img").count()))
        phase(paste_and_file)

        def options_page():
            op = ctx.new_page()
            op.on("pageerror", lambda e: logs.append(f"[options] PAGEERROR: {e}"))
            op.goto(f"chrome-extension://{EID}/options/options.html")
            op.wait_for_timeout(800)
            op.click("[data-act=check]")
            op.wait_for_timeout(1500)
            opts = op.locator("#model option").all_inner_texts()
            check("options: Check key loads Gemini models (embedding filtered)", len(opts) == 2 and not any("embedding" in o for o in opts), str(opts))
            op.select_option("#prov", "openai")
            op.wait_for_timeout(300)
            op.fill("#key", "sk-test")
            op.click("[data-act=check]")
            op.wait_for_timeout(1500)
            opts = op.locator("#model option").all_inner_texts()
            check("options: OpenAI models filtered to chat/vision", opts == ["gpt-4.1"], str(opts))
            op.fill("#tproj", "UR2")
            op.wait_for_timeout(600)
            with op.expect_download() as dl:
                op.click("[data-act=export]")
            path = dl.value.path()
            data = json.load(open(path, encoding="utf-8"))
            check("export: file name + no API key", dl.value.suggested_filename == "qarator-format-ur2.json" and "apiKey" not in data["ai"] and "sk-test" not in json.dumps(data), dl.value.suggested_filename)
            data["title"]["project"] = "IMPORTED"
            imp = os.path.join(OUT, "import.json"); json.dump(data, open(imp, "w"))
            op.set_input_files("#import-file", imp)
            op.wait_for_timeout(800)
            check("import: applies format, keeps key", op.input_value("#tproj") == "IMPORTED" and op.input_value("#key") == "sk-test")
            check("import: undo button offered", op.locator("[data-act=undo-import]").count() == 1)
            bad = os.path.join(OUT, "bad.json"); open(bad, "w").write("{\"x\":1}")
            op.set_input_files("#import-file", bad)
            op.wait_for_timeout(500)
            check("import: rejects non-QArator file", op.input_value("#tproj") == "IMPORTED")
            op.screenshot(path=os.path.join(OUT, "07-options.png"))
        phase(options_page)

        ctx.close()
finally:
    srv.terminate()

print("\n==== console errors ====")
print("\n".join(logs) or "none")
f = [r for r in results if not r[1]]
print(f"\n==== {len(results) - len(f)}/{len(results)} passed ====")
for n, _, d in f:
    print("FAIL", n, "::", d)
