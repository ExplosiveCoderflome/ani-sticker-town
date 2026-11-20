"""Load the published sticker media in a real Chromium browser and check both puzzles."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parents[1]
PAGE = """<!doctype html><meta charset="utf-8"><script type="module">
const assert = (condition, message) => { if (!condition) throw Error(message); };
const makeCanvas = (w,h) => { const c=document.createElement("canvas"); c.width=w; c.height=h; return c; };
async function image(path) {
  const im = new Image();
  im.src = "media/" + path;
  await im.decode();
  return im;
}
function difference(a,b) {
  const sample = im => {
    const c=makeCanvas(216,225), ctx=c.getContext("2d");
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(im,0,0,c.width,c.height);
    return ctx.getImageData(0,0,c.width,c.height).data;
  };
  const x=sample(a), y=sample(b);
  let sum=0;
  for (let i=0;i<x.length;i++) if(i%4!==3) sum+=Math.abs(x[i]-y[i]);
  return sum/(x.length*0.75);
}
async function check() {
  const response=await fetch("media/levels.json");
  assert(response.ok,"Missing levels.json");
  const config=await response.json(), [w,h]=config.canvas;
  const ground=await image("ground.webp"), expected=["weekend-town-v1","afternoon-v1"];
  assert(config.levels.length===expected.length && ground.width===w && ground.height===h,"Board dimensions or box count changed");
  const report=[];
  let lastPreview;
  for(const [index,box] of config.levels.entries()) {
    assert(box.id===expected[index],"Unexpected box ID "+box.id);
    const ordered=box.slots.slice().sort((a,b)=>a.z-b.z);
    assert(ordered.length===14 && new Set(ordered.map(s=>s.asset)).size===14 && new Set(ordered.map(s=>s.id)).size===14,"A piece is duplicated or missing");
    const scene=makeCanvas(w,h), ctx=scene.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(ground,0,0);
    const items=[];
    for (const slot of ordered) {
      const [sprite,thumb]=await Promise.all([image("stickers/"+slot.asset+".webp"),image("thumbs/"+slot.asset+".webp")]);
      assert(thumb.width>0 && thumb.height>0 && Math.max(thumb.width,thumb.height)<=160,slot.asset+" thumbnail missing or oversized");
      const [width,height]=slot.size.map(Math.round);
      const x=Math.round(slot.anchor[0]-width/2), y=Math.round(slot.anchor[1]-height);
      assert(x>=0 && y>=0 && x+width<=w && y+height<=h,slot.asset+" clipped by board");
      const mask=makeCanvas(width,height), mx=mask.getContext("2d",{willReadFrequently:true});
      mx.imageSmoothingQuality="high";
      mx.drawImage(sprite,0,0,width,height);
      const opacity=slot.opacity??1;
      ctx.globalAlpha=opacity;
      ctx.drawImage(mask,x,y);
      items.push({x,y,width,height,id:slot.asset,opacity,rgba:mx.getImageData(0,0,width,height).data});
    }
    const covered=new Float32Array(w*h), visibility={};
    for(const obj of items.reverse()) {
      let total=0,visible=0;
      for(let ly=0;ly<obj.height;ly++) for(let lx=0;lx<obj.width;lx++) {
        const a=obj.rgba[(ly*obj.width+lx)*4+3]*obj.opacity/255;
        const j=(obj.y+ly)*w+obj.x+lx;
        total+=a;
        visible+=a*(1-covered[j]);
        covered[j]+=a*(1-covered[j]);
      }
      assert(total>0,"Invisible asset "+obj.id);
      visibility[obj.id]=Math.round(1000*visible/total)/10;
      const floor=["child","dog","florist","musician"].includes(obj.id)?98:83;
      assert(visibility[obj.id]>=floor,box.id+" "+obj.id+" retained "+visibility[obj.id]+"%");
    }
    const preview=await image("preview-"+(index+1)+".webp");
    const error=difference(scene,preview);
    assert(preview.width===w && preview.height===h && error<3.5,box.id+" preview does not match placed pieces, error "+error);
    assert(difference(ground,preview)>4,box.id+" board already contains solution");
    if(lastPreview) assert(difference(lastPreview,preview)>4,"Both boxes share the same preview");
    lastPreview=preview;
    report.push({box:box.id,pieces:items.length,minimumVisiblePercent:Math.min(...Object.values(visibility)),childVisiblePercent:visibility.child,dogVisiblePercent:visibility.dog,previewMeanRgbError:+error.toFixed(2)});
  }
  return report;
}
let result;
try { result={ok:true,report:await check()}; }
catch(error){ result={ok:false,error:String(error)}; }
await fetch("/__result",{method:"POST",body:JSON.stringify(result)});
document.body.textContent=JSON.stringify(result);
</script><body></body>"""


def detect_browser():
    for name in ("chrome", "chromium", "chromium-browser", "google-chrome", "msedge"):
        path = shutil.which(name)
        if path:
            return path
    for env, relative in [
        ("ProgramFiles", "Google/Chrome/Application/chrome.exe"),
        ("ProgramFiles(x86)", "Microsoft/Edge/Application/msedge.exe"),
        ("LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"),
    ]:
        if os.environ.get(env):
            path = Path(os.environ[env]) / relative
            if path.is_file():
                return str(path)
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", help="Path to a Chromium-compatible browser.")
    args = parser.parse_args()
    browser = args.browser or detect_browser()
    if not browser:
        parser.error("Pass --browser with the path to Chrome, Chromium, or Edge.")
    reply = []
    completed = threading.Event()

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/__check":
                return super().do_GET()
            body = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path != "/__result":
                return self.send_error(404)
            size = int(self.headers.get("Content-Length", "0"))
            reply.append(json.loads(self.rfile.read(size)))
            self.send_response(204)
            self.end_headers()
            completed.set()

        def log_message(self, *args):
            pass

    serve = partial(Handler, directory=str(ROOT/"play"))
    with ThreadingHTTPServer(("127.0.0.1", 0), serve) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix="town-media-check-", ignore_cleanup_errors=True) as profile:
                url = f"http://127.0.0.1:{server.server_port}/__check"
                process = subprocess.Popen([browser, "--headless", "--disable-gpu", "--disable-extensions", "--force-color-profile=srgb",
                                            "--no-first-run", "--disable-background-networking", "--no-default-browser-check",
                                            f"--user-data-dir={profile}", "--remote-debugging-port=0", url],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    deadline = time.monotonic() + 45
                    while not completed.wait(0.1) and process.poll() is None and time.monotonic() < deadline:
                        pass
                finally:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=8)
        finally:
            server.shutdown()
            thread.join()
    if not reply or not reply[0]["ok"]:
        raise SystemExit(reply[0]["error"] if reply else "Browser did not return a result.")
    print(json.dumps(reply[0]["report"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

