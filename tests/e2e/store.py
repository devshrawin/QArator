"""Chrome Web Store screenshots from the real extension, with neutral Acme data.
Usage: python store.py <extension dir> <out dir> [port]
Writes five 1280x800 images (screenshot-1..5) and the raw panel shots."""
import sys, os, json, tempfile, subprocess, time, base64
from playwright.sync_api import sync_playwright

EXT, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 8790
FORMAT = json.load(open(os.path.join(HERE, "store-format.json"), encoding="utf-8"))
ANSWERS = json.load(open(os.path.join(HERE, "store-answers.json"), encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8")
calls = {"n": 0}


def gemini(route):
    req = route.request
    hdr = {"access-control-allow-origin": "*", "content-type": "application/json"}
    if req.method == "OPTIONS":
        return route.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*"})
    if req.method == "GET":
        body = {"models": [{"name": "models/gemini-3.6-flash", "displayName": "Gemini 3.6 Flash", "supportedGenerationMethods": ["generateContent"]}]}
        return route.fulfill(status=200, headers=hdr, body=json.dumps(body))
    a = ANSWERS[calls["n"] % len(ANSWERS)]; calls["n"] += 1
    route.fulfill(status=200, headers=hdr, body=json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(a)}]}}], "usageMetadata": {"promptTokenCount": 1200, "candidatesTokenCount": 300}}))


srv = subprocess.Popen([sys.executable, os.path.join(HERE, "server.py"), str(PORT)])
time.sleep(1.2)
BASE = f"http://localhost:{PORT}"
ZBASE = f"http://projects.zoho.localhost:{PORT}"
try:
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel="chromium", headless=True,
            viewport={"width": 1280, "height": 800}, device_scale_factor=2,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        ctx.route("https://generativelanguage.googleapis.com/**", gemini)
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=10000)
        EID = sw.url.split("/")[2]
        PANEL = f"chrome-extension://{EID}/sidepanel/sidepanel.html"
        set_s = lambda patch: sw.evaluate("""async (patch) => { const { settings = {} } = await chrome.storage.local.get('settings'); const s = JSON.parse(JSON.stringify(settings));
            for (const [k, v] of Object.entries(patch)) s[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(s[k] || {}), ...v } : v; await chrome.storage.local.set({ settings: s }); }""", patch)
        fmt = {k: v for k, v in FORMAT.items() if k not in ("qarator", "formatVersion")}
        sw.evaluate("async () => { await chrome.storage.local.set({ onboarded: true }); }")
        sw.evaluate("""async (f) => { const { settings = {} } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, ...f, pageErrors: true } }); }""", fmt)
        set_s({"ai": {"provider": "gemini", "apiKey": "store-demo-key-000000000000", "model": "auto", "baseUrl": "", "apiKey2": ""}})
        time.sleep(0.3)
        for pg in list(ctx.pages):
            if "welcome.html" in pg.url:
                pg.close()
        site = ctx.new_page()
        site.goto(f"{BASE}/orders.html"); site.wait_for_timeout(1200)
        tab = sw.evaluate(f"async () => (await chrome.tabs.query({{url: '{BASE}/orders.html'}}))[0]")
        W1, T1 = tab["windowId"], tab["id"]
        with ctx.expect_page() as pi:
            sw.evaluate(f"() => chrome.windows.create({{url: '{PANEL}', type: 'normal', width: 420, height: 900}})")
        panel = pi.value
        panel.set_viewport_size({"width": 420, "height": 900})
        panel.wait_for_load_state(); panel.wait_for_timeout(800)
        panel.evaluate(f"() => {{ chrome.windows.getCurrent = async () => ({{ id: {W1} }}); }}")
        sw.evaluate(f"() => chrome.tabs.update({T1}, {{active: true}})")
        shot = lambda name: panel.screenshot(path=os.path.join(OUT, f"raw-{name}.png"))

        # 1 capture
        panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
        panel.click("#main [data-action=capture]"); panel.locator(".shots .shot-item").nth(1).wait_for(timeout=8000)
        panel.fill("#note", "Export CSV does nothing when I filter orders by Shipped")
        panel.wait_for_timeout(500)
        panel.evaluate("() => document.querySelector('#main').scrollTo(0, 0)")
        shot("1-capture")
        # 2 review
        panel.click("#dock [data-action=write]"); panel.wait_for_selector("#title-preview", timeout=20000); panel.wait_for_timeout(600)
        panel.evaluate("() => document.querySelector('#main').scrollTo(0, 0)")
        shot("2-review")
        # 3 tags, dark
        set_s({"appearance": {"theme": "dark"}}); panel.wait_for_timeout(600)
        panel.evaluate("() => document.querySelector('#tp-q').scrollIntoView({ block: 'center' })")
        panel.fill("#tp-q", "or"); panel.wait_for_timeout(400)
        panel.evaluate("() => document.querySelector('#tp-q').scrollIntoView({ block: 'start' })")
        shot("3-tags-dark")
        panel.fill("#tp-q", ""); set_s({"appearance": {"theme": "system"}}); panel.wait_for_timeout(500)
        # 4 filled
        site.goto(f"{ZBASE}/zoho.html"); site.wait_for_timeout(600)
        panel.click("#dock [data-action=fill]"); panel.wait_for_selector("text=Filled in Zoho", timeout=30000); panel.wait_for_timeout(500)
        panel.evaluate("() => document.querySelector('#main').scrollTo(0, 0)")
        shot("4-filled")
        # 5 queue: two more bugs saved in a row
        site.goto(f"{BASE}/orders.html"); site.wait_for_timeout(900)
        panel.click("#dock [data-action=next]"); panel.wait_for_timeout(500)
        for note in ["Date filter resets after I change page", "Order details take nine seconds to open"]:
            panel.click("#main [data-action=capture]"); panel.wait_for_selector(".shots img", timeout=8000)
            panel.fill("#note", note); panel.wait_for_timeout(300)
            panel.click("#dock [data-action=generate-later]"); panel.wait_for_timeout(1500)
        panel.click("#btn-bugs"); panel.wait_for_selector(".bug", timeout=8000); panel.wait_for_timeout(2500)
        shot("5-queue")
        ctx.close()
finally:
    srv.terminate()

# ---- compose the 1280x800 store images
CARDS = [
 ("1-capture", "light", "Capture the bug. Write one line.", "Take a screenshot, crop a region, or record the screen, right from Chrome’s side panel.", ["Page address, browser and errors added for you", "Mark up, crop and blur personal data", "Works next to the app you are testing"]),
 ("2-review", "light", "The AI writes the report in your team’s format.", "Title, steps, expected and actual result, dropdowns and tags, all ready to check.", ["Every value the AI chose is marked", "Edit anything in place", "Uses your own free Google AI key"]),
 ("3-tags-dark", "dark", "Only your team’s tags. Ticked in seconds.", "Search your team’s list and press Enter to tick the top match. Light and dark themes.", ["Grouped, searchable tag list", "Full keyboard path", "Text size you can change"]),
 ("4-filled", "light", "Fills the Zoho form. You press Submit.", "QArator fills the Zoho Projects “Submit Issue” form for you. It never submits on its own.", ["Title, description, fields and files filled", "Tags copied for you to paste", "You stay in control"]),
 ("5-queue", "light", "Log several bugs in one go.", "Save and capture the next one. Reports are written in the background.", ["See what is draft, filled or exported", "Export many bugs to one Word file", "No AI key? Capture and export still work"]),
]
font = os.path.join(os.path.dirname(HERE), "..", "fonts", "inter.woff2")
font = os.path.abspath(font).replace("\\", "/")
b64 = lambda f: base64.b64encode(open(f, "rb").read()).decode()
with sync_playwright() as p:
    br = p.chromium.launch()
    for i, (raw, theme, head, sub, pts) in enumerate(CARDS, 1):
        dark = theme == "dark"
        bg, ink, ink2 = ("#18181A", "#ECECE8", "#B6B5AF") if dark else ("#EEEDE9", "#1B1B19", "#4A4944")
        img = b64(os.path.join(OUT, f"raw-{raw}.png"))
        li = "".join(f'<li><span class="tk"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span>{x}</li>' for x in pts)
        html = f"""<!doctype html><meta charset=utf-8><style>
@font-face{{font-family:Inter;src:url("file:///{font}");font-weight:100 900}}
*{{box-sizing:border-box;margin:0}}body{{width:1280px;height:800px;background:{bg};font-family:Inter,system-ui,sans-serif;color:{ink};display:flex;align-items:center;padding:0 84px;gap:72px;overflow:hidden}}
.t{{flex:1}}.mark{{width:44px;height:44px;border-radius:11px;background:#FF7A3D;display:flex;align-items:center;justify-content:center;margin-bottom:32px}}.mark svg{{width:70%;height:70%;fill:none;stroke:#16181B;stroke-width:2.2}}
h1{{font-size:46px;line-height:1.1;font-weight:700;letter-spacing:-.02em}}p{{font-size:20px;line-height:1.5;color:{ink2};margin-top:18px}}
ul{{list-style:none;padding:0;margin-top:30px;display:flex;flex-direction:column;gap:12px}}li{{display:flex;gap:12px;align-items:center;font-size:18px;font-weight:500}}
.tk{{width:22px;height:22px;border-radius:50%;background:#C2410C;display:flex;align-items:center;justify-content:center;flex:none}}.tk svg{{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:2.4}}
.f{{height:704px;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,{.5 if dark else .2}),0 0 0 1px rgba(0,0,0,.08);flex:none}}.f img{{height:704px;display:block}}</style>
<div class=t><div class=mark><svg viewBox="0 0 16 16"><path d="M2.5 7V2.5H7 M9 2.5h4.5V7 M2.5 9v4.5H7 M9 9l4.5 4.5"/></svg></div><h1>{head}</h1><p>{sub}</p><ul>{li}</ul></div>
<div class=f><img src="data:image/png;base64,{img}"></div>"""
        pg = br.new_page(viewport={"width": 1280, "height": 800}); pg.set_content(html); pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(OUT, f"screenshot-{i}.png")); pg.close()
    br.close()
print("done", sorted(os.listdir(OUT)))
