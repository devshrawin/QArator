"""Exploratory runtime audit of QArator: edge cases the main e2e suite does not cover.
Usage: python audit.py <extension dir> <out dir>"""
import sys, os, json, tempfile, time, threading, zipfile, io, subprocess, traceback
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8")

EXT, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8811
FFPROBE = r"C:\Users\shrawin.sisodiya\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffprobe.exe"
results, logs = [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" :: {detail}" if detail else ""), flush=True)


def phase(fn):
    try:
        fn()
    except Exception as e:
        check(fn.__name__ + " crashed", False, f"{type(e).__name__}: {str(e)[:300]}")
        traceback.print_exc()


# ---------- pages ----------
PAGES = {
    "hostile.html": """<!doctype html><html><head><title>"><img src=x onerror="window.__xss=1">Evil &amp; title</title></head><body>
<nav aria-label="breadcrumb"><ol><li>Home</li><li><img src=x onerror="window.__xss=2">Schemes</li><li>&lt;b&gt;List&lt;/b&gt;</li></ol></nav>
<h1>Scheme List "quoted" & 'single'</h1><p>content</p>
<script>console.error('<img src=x onerror="parent.__xss=3">');</script></body></html>""",
    "big.html": """<!doctype html><html><head><title>Big page</title></head><body style="margin:0">
<div style="height:3000px;background:linear-gradient(#fff,#c33)"><h1>Big dashboard</h1>""" + "".join(f"<p>Row {i} " + "lorem ipsum " * 20 + "</p>" for i in range(80)) + """</div></body></html>""",
    "ml.html": """<!doctype html><html lang="ml"><head><title>ഹോം - Citizen</title></head><body><aside><a class="active">ഹോം</a></aside><h1>ഹോം</h1></body></html>""",
}


class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        for k, v in {"content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*"}.items():
            self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)

    def do_OPTIONS(self):
        self._json(204, {})

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length") or 0))
        if self.path == "/v1/chat/completions":
            COMPAT["calls"] += 1
            time.sleep(COMPAT["delay"])
            if COMPAT["mode"] == "429":
                return self._json(429, {"error": {"message": "rate limited", "type": "rate_limit"}})
            text = json.dumps(answer["v"] or GOOD) if not isinstance(answer["v"], str) else answer["v"]
            return self._json(200, {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
        self._json(404, {})

    def do_GET(self):
        if self.path == "/v1/models":
            return self._json(200, {"data": [{"id": "local-vision"}]})
        name = self.path.lstrip("/").split("?")[0]
        body = PAGES.get(name)
        if body is None:
            self.send_response(404); self.end_headers(); return
        b = body.encode("utf-8")
        self.send_response(200); self.send_header("content-type", "text/html; charset=utf-8"); self.end_headers(); self.wfile.write(b)


srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://localhost:{PORT}"

# ---------- AI mock ----------
answer = {"v": None, "delay": 0}
COMPAT = {"delay": 0, "mode": "ok", "calls": 0}
GOOD = {
    "summary_title": "scheme list shows <script>alert(1)</script> & stale data",
    "portal": "Department Portal", "module": "Schemes", "page": "List",
    "sections": {"url_note": "Affects the list", "summary": "Line with <b>html</b> & \"quotes\" and മലയാളം text.",
                 "issue_details": "Label: value with \u0007 control char\n\nSecond: para", "steps": "1. Open\n2. Click <a href=x>link</a>",
                 "expected": "It works.", "actual": "It does not."},
    "fields": {"severity": "Major", "priority": "High", "classification": "Functional"},
    "tags": ["UR - Department Portal"]}


def route_gemini(route):
    req = route.request
    hdr = {"access-control-allow-origin": "*", "content-type": "application/json"}
    if req.method == "GET":
        return route.fulfill(status=200, headers=hdr, body=json.dumps({"models": [
            {"name": "models/gemini-2.5-flash", "displayName": "Flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-2.5-pro", "displayName": "Pro", "supportedGenerationMethods": ["generateContent"]}]}))
    if answer["delay"]:
        time.sleep(answer["delay"])
    text = answer["v"] if isinstance(answer["v"], str) else json.dumps(answer["v"] or GOOD)
    try:
        route.fulfill(status=200, headers=hdr, body=json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}], "usageMetadata": {"promptTokenCount": 1000, "candidatesTokenCount": 200}}))
    except Exception:
        pass


def word_open(path):
    """Open in real Word: returns (ok, inline shapes, pages) or (False, error)."""
    import win32com.client as w
    app = w.DispatchEx("Word.Application"); app.Visible = False; app.DisplayAlerts = 0
    try:
        doc = app.Documents.Open(os.path.abspath(path), ReadOnly=True, AddToRecentFiles=False, OpenAndRepair=False, NoEncodingDialog=True)
        n, pages = doc.InlineShapes.Count, doc.ComputeStatistics(2)
        doc.Close(False)
        return True, n, pages
    except Exception as e:
        return False, str(e)[:200], 0
    finally:
        app.Quit()


with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel="chromium", headless=True, accept_downloads=True,
        viewport={"width": 1280, "height": 800}, args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
    ctx.route("https://generativelanguage.googleapis.com/**", route_gemini)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
    EID = sw.url.split("/")[2]
    PANEL = f"chrome-extension://{EID}/sidepanel/sidepanel.html"

    # ---- 1. upgrade from 1.0 / 1.1 data
    sw.evaluate("""async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
      await chrome.storage.local.set({
        settings: { formatVersion: 1, ai: { provider: 'gemini', apiKey: 'old-key-0000000000000000', model: 'gemini-2.5-flash', baseUrl: '', models: [] },
          title: { project: 'UR' }, fields: [{ id: 'device_type', name: 'Device Type', zohoLabel: 'Device Type', options: ['Desktop', 'Mobile'], default: 'Desktop', ai: false }],
          zoho: { domain: 'projects.zoho.in' } },
        draft: { view: 'review', shots: [], page: { url: 'https://x.example/a', title: 'old', errors: [{ kind: 'console', message: 'old err', count: 1 }], errorsIncluded: true },
          note: 'old note', steps: '', report: { segments: { project: 'UR', portal: 'P', module: 'M', page: 'Pg', summary: 'Old Report' },
          sections: [{ id: 'summary', name: 'Summary', layout: 'inline', text: 'old' }], fields: { device_type: 'Desktop' }, aiChosen: {}, tags: [{ name: 'UR - P', on: true }], createdAt: 1 } },
        history: [{ id: 1, title: 'UR | P | Old Report', status: 'Filled in Zoho', at: Date.now() - 86400000,
          report: { segments: { project: 'UR', portal: 'P', module: 'M', page: 'Pg', summary: 'Old Report' }, sections: [{ id: 'summary', name: 'Summary', layout: 'inline', text: 'old' }], fields: {}, aiChosen: {}, tags: [], createdAt: 1 }, page: { url: 'https://x.example/a' } }],
        usage: { [today]: { 'gemini|gemini-2.5-flash|write': { req: 5, fail: 1, rl: 1, tin: 100, tout: 50 } } },
        onboarded: 1
      });
    }""")
    site = ctx.new_page(); site.goto(f"{BASE}/hostile.html"); site.wait_for_timeout(500)
    tab = sw.evaluate(f"async () => (await chrome.tabs.query({{url: '{BASE}/hostile.html'}}))[0]")
    W1 = tab["windowId"]
    with ctx.expect_page() as pi:
        sw.evaluate(f"() => chrome.windows.create({{url: '{PANEL}', width: 420, height: 900}})")
    panel = pi.value
    panel.on("pageerror", lambda e: logs.append(f"[panel] PAGEERROR: {e}"))
    panel.on("console", lambda m: logs.append(f"[panel] {m.type}: {m.text}") if m.type in ("error", "warning") else None)
    panel.set_viewport_size({"width": 420, "height": 900}); panel.wait_for_timeout(1200)
    PATCH = f"""() => {{ chrome.windows.getCurrent = async () => ({{ id: {W1} }});
      chrome.desktopCapture.chooseDesktopMedia = (s, cb) => setTimeout(() => cb('fake'), 30);
      navigator.mediaDevices.getUserMedia = async () => {{ const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); let i = 0;
        setInterval(() => {{ x.fillStyle = `hsl(${{(i * 9) % 360}},60%,50%)`; x.fillRect(0, 0, 1920, 1080); x.fillStyle = '#000'; x.font = '80px sans-serif'; x.fillText('t=' + i++, 100, 500); }}, 66); return c.captureStream(15); }}; }}"""
    panel.evaluate(PATCH)
    sw.evaluate(f"() => chrome.tabs.update({tab['id']}, {{active: true}})")

    def upgrade():
        t = panel.inner_text("body")
        check("upgrade: old draft opens in review", panel.locator("#title-preview").count() == 1 and "Old Report" in panel.inner_text("#title-preview"), t[:120])
        check("upgrade: old draft errors hidden (page errors off)", "old err" not in t)
        panel.click("#btn-history"); panel.wait_for_timeout(500)
        check("upgrade: old history listed", "Old Report" in panel.inner_text("#main"))
        panel.check("[data-hsel]")
        with panel.expect_download() as dl:
            panel.click("#hist-export")
        path = os.path.join(OUT, "a1-old-history.docx"); dl.value.save_as(path)
        ok = word_open(path)
        check("upgrade: old history exports and opens in Word", ok[0], str(ok))
        panel.click("[data-action=history-open]"); panel.wait_for_selector("#title-preview")
        check("upgrade: old history entry reopens without media", panel.locator(".shots img").count() == 0)
        op = ctx.new_page(); op.on("pageerror", lambda e: logs.append(f"[options] PAGEERROR: {e}"))
        op.goto(f"chrome-extension://{EID}/options/options.html"); op.wait_for_timeout(1000)
        op.click(".nav a[href='#usage']"); op.wait_for_timeout(250)
        ut = op.inner_text("#usage")
        check("upgrade: 1.1-style usage rows (3-part keys) still shown", "gemini-2.5-flash" in ut and " 5" in ut.replace("\t", " "), ut[:300].replace(chr(10), " | "))
        check("upgrade: settings page renders all sections", all(op.locator(f"#{s}").count() == 1 for s in ["ai", "title", "fields", "zoho", "usage", "projects", "scopes"]))
        op.close()
        panel.click("[data-action=back-capture]") if panel.locator("[data-action=back-capture]").count() else None
        panel.click("[data-action=reset]") if panel.locator("[data-action=reset]").count() else None
        panel.click(".modal [data-yes]") if panel.locator(".modal [data-yes]").count() else None
    phase(upgrade)

    def hostile():
        panel.on("dialog", lambda d: d.accept())
        panel.evaluate("() => chrome.storage.local.remove('draft')"); panel.reload(); panel.wait_for_timeout(900); panel.evaluate(PATCH)
        sw.evaluate("() => chrome.storage.local.set({ settings: { ai: { provider: 'gemini', apiKey: 'test-key-000000000000000', model: 'auto', models: [] }, pageErrors: true } })")
        panel.wait_for_timeout(400)
        site.reload(); site.wait_for_timeout(600)
        t = panel.inner_text("#main") if panel.locator("#main").count() else ""
        check("hostile: empty view shows tab title as text", panel.evaluate("() => !document.querySelector('#main img[src=x]') && !window.__xss"))
        panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
        panel.fill("#note", "<img src=x onerror=window.__xss=9> note")
        panel.click("#dock [data-action=write]"); panel.wait_for_selector("#title-preview", timeout=20000)
        xss = panel.evaluate("() => ({ win: window.__xss || 0, imgs: document.querySelectorAll('img[src=x], #main script, #dock script').length, preview: document.getElementById('title-preview').innerHTML })")
        check("hostile: no HTML injection from page title/breadcrumb/AI output", xss["win"] == 0 and xss["imgs"] == 0, str(xss)[:300])
        sec = panel.input_value("#sec-summary")
        check("hostile: AI text kept as text in review", "<b>html</b>" in sec and "മലയാളം" in sec)
        for v in ["capture", "history", "bugs"]:
            panel.evaluate(f"() => document.querySelector('[data-action={v if v != 'capture' else 'back-capture'}]')?.click()")
            panel.wait_for_timeout(300)
            check(f"hostile: no injection in {v} view", panel.evaluate("() => !window.__xss && !document.querySelector('img[src=x]')"))
            if v != "capture":
                panel.click(f"[data-action={'history-back' if v == 'history' else 'bugs-back'}]")
        # Word export with control chars, html, Malayalam
        panel.click("#flow [data-id=review]") if not panel.locator("#title-preview").count() else None
        with panel.expect_download() as dl:
            panel.click("#dock [data-action=export-word]")
        path = os.path.join(OUT, "a2-hostile.docx"); dl.value.save_as(path)
        ok = word_open(path)
        check("hostile: export with control chars / html / Malayalam opens in Word", ok[0], str(ok))
    phase(hostile)

    def ai_odd_answers():
        cases = {
            "steps as string, missing sections": {"summary_title": "x", "sections": {"steps": "Open it\nClick it"}, "fields": {}},
            "empty object": {},
            "arrays where strings expected": {"summary_title": ["a", "b"], "sections": {"summary": ["one", "two"], "expected": None}, "fields": {"severity": 3}, "tags": "not-a-list"},
            "fenced with chatter": "Sure! ```json\n" + json.dumps(GOOD) + "\n``` hope that helps",
        }
        for name, val in cases.items():
            answer["v"] = val
            panel.evaluate("() => document.querySelector('[data-action=back-capture]')?.click()"); panel.wait_for_timeout(300)
            panel.click("#dock [data-action=write]")
            panel.wait_for_selector("#title-preview, .alert", timeout=20000); panel.wait_for_timeout(300)
            ok = panel.locator("#title-preview").count() == 1
            check(f"odd AI answer handled: {name}", ok or "not usable" in panel.inner_text("#main"), panel.inner_text("#main")[:150].replace(chr(10), " | "))
            if panel.locator("[data-action=dismiss-error]").count(): panel.click("[data-action=dismiss-error]")
        answer["v"] = None
    phase(ai_odd_answers)

    def use_compat():
        sw.evaluate(f"async () => {{ const {{ settings }} = await chrome.storage.local.get('settings'); settings.ai = {{ ...settings.ai, provider: 'compatible', baseUrl: 'http://127.0.0.1:{PORT}/v1', model: 'auto', models: [] }}; await chrome.storage.local.set({{ settings }}); }}")
        panel.wait_for_timeout(400)

    def fresh_panel(page=None):
        panel.wait_for_timeout(500)
        panel.evaluate("() => chrome.storage.local.remove('draft')"); panel.reload(); panel.wait_for_timeout(900); panel.evaluate(PATCH)
        if page:
            site.goto(f"{BASE}/{page}"); site.wait_for_timeout(400)

    def double_clicks_and_cancel():
        use_compat()
        fresh_panel("big.html")
        panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
        panel.fill("#note", "double click test")
        COMPAT["delay"] = 1.5; COMPAT["calls"] = 0
        panel.evaluate("() => { const b = document.querySelector('#dock [data-action=write]'); b.click(); b.click(); }")
        panel.keyboard.press("Control+Enter")
        panel.wait_for_selector("#title-preview", timeout=20000)
        check("double Generate click sends one request", COMPAT["calls"] == 1, f"{COMPAT['calls']} requests")
        panel.click("[data-action=back-capture]"); panel.wait_for_timeout(300)
        COMPAT["delay"] = 3
        panel.click("#dock [data-action=write]"); panel.wait_for_timeout(500)
        panel.keyboard.press("Escape"); panel.wait_for_timeout(600)
        check("Esc cancels writing, screenshots kept", panel.locator(".shots img").count() >= 1 and panel.locator("#title-preview").count() == 0, panel.inner_text("#main")[:120])
        COMPAT["delay"] = 0
        sw.evaluate("() => chrome.storage.local.remove('bugs')")
        panel.wait_for_timeout(3200)
        print("  probe after Esc:", panel.evaluate("() => ({ view: document.querySelector('#flow [aria-current=step]')?.dataset.id, dock: document.getElementById('dock').innerText.slice(0, 200), main: document.getElementById('main').innerText.slice(0, 120) })"))
        panel.evaluate("() => { const b = document.querySelector('#dock [data-action=generate-later]'); b.click(); b.click(); }")
        panel.wait_for_timeout(2500)
        bugs = sw.evaluate("async () => ((await chrome.storage.local.get('bugs')).bugs || []).length")
        check("double Generate & next bug saves one bug", bugs == 1, f"{bugs} bugs")

    def report_not_lost_when_moving_on():
        # Generate, then open Recent reports and another report while it is still writing
        fresh_panel("big.html")
        panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
        panel.fill("#note", "moved on while writing")
        COMPAT["delay"] = 2.5
        sw.evaluate("async () => { const { bugs = [] } = await chrome.storage.local.get('bugs'); await chrome.storage.local.set({ bugs: [...bugs, { id: 'other', at: Date.now(), status: 'failed', snap: { shots: [], videos: [], page: null, note: 'another bug', steps: '' } }] }); }")
        before = sw.evaluate("async () => ((await chrome.storage.local.get('bugs')).bugs || []).length")
        panel.click("#dock [data-action=write]"); panel.wait_for_timeout(400)
        panel.click("#btn-bugs"); panel.wait_for_selector(".bug")
        panel.locator("[data-action=bug-open][data-id=other]").click(); panel.wait_for_timeout(3500)
        after = sw.evaluate("async () => ((await chrome.storage.local.get('bugs')).bugs || []).map((b) => [b.status, !!b.report])")
        check("report written while the tester moved on lands in the Bug list", len(after) == before + 1 and after[-1] == ["ready", True], str(after))
        COMPAT["delay"] = 0

    def back_loop():
        panel.click("#btn-bugs"); panel.wait_for_timeout(300)
        panel.click("#btn-history"); panel.wait_for_timeout(300)
        panel.click("[data-action=history-back]"); panel.wait_for_timeout(300)
        if panel.locator("[data-action=bugs-back]").count():
            panel.click("[data-action=bugs-back]"); panel.wait_for_timeout(300)
        check("Bug list -> Recent reports -> Back -> Back leaves the lists", panel.locator("[data-action=bugs-back]").count() == 0 and panel.locator("[data-action=history-back]").count() == 0)

    def opened_waiting_bug_keeps_report():
        sw.evaluate("() => chrome.storage.local.remove('bugs')")
        fresh_panel("big.html")
        panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
        panel.fill("#note", "first bug")
        COMPAT["delay"] = 3
        panel.click("#dock [data-action=generate-later]"); panel.wait_for_timeout(300)
        panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
        panel.fill("#note", "waiting bug")
        panel.click("#dock [data-action=generate-later]"); panel.wait_for_timeout(300)
        panel.click("#btn-bugs"); panel.wait_for_selector(".bug")
        # the second bug is still waiting while the first is written: open it and edit it
        panel.locator("[data-action=bug-open]").nth(1).click()
        panel.wait_for_selector("#note", timeout=5000)
        panel.fill("#note", "waiting bug, edited")
        panel.wait_for_timeout(600)
        panel.click("#dock [data-action=generate-later]"); panel.wait_for_timeout(300)
        for _ in range(80):
            b = sw.evaluate("async () => (await chrome.storage.local.get('bugs')).bugs[1]")
            if b["status"] == "ready" and b.get("report"): break
            panel.wait_for_timeout(250)
        panel.wait_for_timeout(800)
        b = sw.evaluate("async () => (await chrome.storage.local.get('bugs')).bugs[1]")
        check("opened bug: written report survives edits, edits are written", b["status"] == "ready" and b.get("report") and b["snap"]["note"] == "waiting bug, edited", f"{b['status']} report={bool(b.get('report'))} note={b['snap']['note']}")
        COMPAT["delay"] = 0

    def queue_backs_off():
        sw.evaluate("() => chrome.storage.local.remove(['bugs', 'modelCooldown'])")
        fresh_panel("big.html")
        COMPAT["mode"] = "429"
        for i in range(3):
            panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
            panel.fill("#note", f"busy {i}"); panel.click("#dock [data-action=generate-later]"); panel.wait_for_timeout(300)
        panel.wait_for_timeout(2500)
        st_ = sw.evaluate("async () => (await chrome.storage.local.get('bugs')).bugs.map((b) => [b.status, !!b.retryAt])")
        check("provider busy: bugs wait and retry later instead of all failing", all(x[0] == "waiting" for x in st_) and any(x[1] for x in st_), str(st_))
        COMPAT["mode"] = "ok"
        sw.evaluate("async () => { const { bugs } = await chrome.storage.local.get('bugs'); await chrome.storage.local.set({ bugs: bugs.map((b) => ({ ...b, retryAt: 0 })), modelCooldown: {} }); }")
        panel.click("#btn-bugs"); panel.wait_for_timeout(300); panel.click("[data-action=bugs-back]")
        panel.evaluate("() => document.querySelector('[data-action=generate-later]')")

    def import_cannot_redirect_key():
        op = ctx.new_page(); op.goto(f"chrome-extension://{EID}/options/options.html"); op.wait_for_timeout(800)
        evil = os.path.join(OUT, "evil-format.json")
        json.dump({"qarator": "format", "ai": {"provider": "compatible", "baseUrl": "https://attacker.example/v1"}, "title": {"project": "EVIL"},
                   "sections": [{"id": "x\"><img src=x onerror=window.__xss=5>", "name": "S", "layout": "inline", "include": True}],
                   "fields": [{"id": "f\"", "name": "F"}]}, open(evil, "w"))
        op.set_input_files("#import-file", evil); op.wait_for_timeout(800)
        ai = sw.evaluate("async () => (await chrome.storage.local.get('settings')).settings.ai")
        check("import cannot change provider / endpoint (key never redirected)", ai["baseUrl"] != "https://attacker.example/v1", str({k: ai.get(k) for k in ("provider", "baseUrl")}))
        ids = sw.evaluate("async () => { const s = (await chrome.storage.local.get('settings')).settings; return [s.sections.map((x) => x.id), s.fields.map((x) => x.id)]; }")
        check("imported ids are sanitised", all('"' not in i and "<" not in i for i in ids[0] + ids[1]), str(ids))
        op.close()

    def webp_paste_exports():
        fresh_panel("big.html")
        panel.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#3a7'; x.fillRect(0, 0, 400, 300);
          const b = await new Promise((r) => c.toBlob(r, 'image/webp')); const dt = new DataTransfer(); dt.items.add(new File([b], 'w.webp', { type: 'image/webp' }));
          document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }""")
        panel.wait_for_selector(".shots img", timeout=5000)
        kind = panel.evaluate("async () => (await chrome.storage.local.get('draft')).draft?.shots?.[0]?.dataUrl.slice(0, 15) || (document.querySelector('.shots img') ? 'pending' : '')")
        panel.fill("#note", "webp")
        with panel.expect_download() as dl:
            panel.click("#dock [data-action=export-word]")
        path = os.path.join(OUT, "a5-webp.docx"); dl.value.save_as(path)
        ok = word_open(path)
        check("pasted WebP becomes PNG and shows in Word", ok[0] and ok[1] == 1, f"{kind} {ok}")
    phase(import_cannot_redirect_key)
    phase(double_clicks_and_cancel)
    phase(report_not_lost_when_moving_on)
    phase(back_loop)
    phase(opened_waiting_bug_keeps_report)
    phase(queue_backs_off)
    phase(webp_paste_exports)

    def queue_survives_close():
        sw.evaluate("() => chrome.storage.local.remove('bugs')")
        COMPAT["delay"] = 3
        fresh_panel("big.html")
        for i in range(3):
            panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
            panel.fill("#note", f"queued bug {i}")
            panel.click("#dock [data-action=generate-later]"); panel.wait_for_timeout(400)
        panel.wait_for_timeout(1000)
        mid = sw.evaluate("async () => (await chrome.storage.local.get('bugs')).bugs.map((b) => b.status)")
        panel.reload(); panel.wait_for_timeout(900); panel.evaluate(PATCH)
        COMPAT["delay"] = 0.3
        for _ in range(320):
            st_ = sw.evaluate("async () => (await chrome.storage.local.get('bugs')).bugs.map((b) => b.status)")
            if all(x == "ready" for x in st_): break
            panel.wait_for_timeout(250)
        check("queue: panel closed mid-write resumes and finishes", all(x == "ready" for x in st_) and len(st_) == 3, f"before reload {mid} -> {st_}")
        COMPAT["delay"] = 0
    phase(queue_survives_close)

    def big_exports():
        # record a 6 s 1080p video into the current bug, 3 big screenshots, export, open in Word, probe the video
        fresh_panel()
        site.set_viewport_size({"width": 1920, "height": 1080}); site.wait_for_timeout(300)
        for _ in range(3):
            panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000); panel.wait_for_timeout(300)
        panel.locator("#main [data-action=record-screen]").first.click(); panel.wait_for_selector(".rec"); panel.wait_for_timeout(6500)
        panel.click("[data-action=stop-rec]"); panel.wait_for_selector(".vid", timeout=10000)
        panel.fill("#note", "big export")
        t0 = time.time()
        with panel.expect_download(timeout=60000) as dl:
            panel.click("#dock [data-action=export-word]")
        path = os.path.join(OUT, "a3-big.zip"); dl.value.save_as(path)
        secs = time.time() - t0
        z = zipfile.ZipFile(path); names = z.namelist()
        docx = next(n for n in names if n.endswith(".docx")); vid = next(n for n in names if n.startswith("videos/"))
        open(os.path.join(OUT, "a3-big.docx"), "wb").write(z.read(docx)); open(os.path.join(OUT, "a3-video.mp4"), "wb").write(z.read(vid))
        ok = word_open(os.path.join(OUT, "a3-big.docx"))
        check("big export: zip with docx + video, opens in Word with 4 pictures", ok[0] and ok[1] == 4, f"{ok}, {os.path.getsize(path)//1024} KB, {secs:.1f}s")
        pr = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", os.path.join(OUT, "a3-video.mp4")], capture_output=True, text=True)
        info = json.loads(pr.stdout or "{}")
        dur = float(info.get("format", {}).get("duration", 0) or 0)
        st0 = (info.get("streams") or [{}])[0]
        check("recorded video is a playable file of the right length", pr.returncode == 0 and 5 <= dur <= 8 and st0.get("width") == 1920, f"{st0} {dur:.1f}s {pr.stderr[:150]}")
        size = panel.evaluate("async () => JSON.stringify((await chrome.storage.local.get('draft')).draft || {}).length")
        check("draft size with 3 x 1080p shots stays reasonable (< 15 MB)", size < 15e6, f"{size/1e6:.1f} MB")
        # bug list export of the 3 queued bugs in Word
        panel.click("#btn-bugs"); panel.wait_for_selector(".bug"); panel.check("#bsel-all")
        with panel.expect_download() as dl:
            panel.click("[data-action=bugs-export-full]")
        p2 = os.path.join(OUT, "a4-bugs." + dl.value.suggested_filename.split(".")[-1]); dl.value.save_as(p2)
        ok = word_open(p2)
        check("bug list export opens in Word (3 bugs, 3 pages+)", ok[0] and ok[2] >= 3, str(ok))
        panel.click("[data-action=bugs-back]")
    phase(big_exports)

    def malayalam_page():
        site.set_viewport_size({"width": 1280, "height": 800}); site.goto(f"{BASE}/ml.html"); site.wait_for_timeout(400)
        fresh_panel()
        panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
        w = panel.inner_text("#where") if panel.locator("#where").count() else ""
        check("Malayalam-only page: no Malayalam in title location", "ഹോം" not in w, w)
    phase(malayalam_page)

    def recording_edges():
        panel.locator("#main [data-action=record-screen]").first.click(); panel.wait_for_selector(".rec")
        panel.wait_for_timeout(1200)
        panel.evaluate("() => { const b = document.querySelector('[data-action=stop-rec]'); b.click(); b.click(); }")
        panel.wait_for_timeout(1500)
        n = panel.evaluate("async () => (await chrome.storage.local.get('draft')).draft.videos.length")
        check("double Stop saves one video", n == 1, str(n))
        panel.evaluate("() => { chrome.desktopCapture.chooseDesktopMedia = (s, cb) => setTimeout(() => cb(''), 30); }")
        panel.locator("#main [data-action=record-screen]").first.click(); panel.wait_for_timeout(800)
        check("cancelled picker leaves no recording bar", panel.locator(".rec").count() == 0)
    phase(recording_edges)

    ctx.close()
srv.shutdown()
print("\n==== console/page errors ====")
print("\n".join(x for x in logs if "Failed to load resource" not in x) or "none")
f = [r for r in results if not r[1]]
print(f"\n==== {len(results) - len(f)}/{len(results)} passed ====")
for n, _, d in f:
    print("FAIL", n, "::", d)
