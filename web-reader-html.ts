export const webReaderHTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; background: #000; color: #fff; font: 16px system-ui; }
  #viewport { position: fixed; inset: 0; overflow-y: auto; overflow-x: hidden; overflow-anchor: none; }
  .page { position: relative; overflow: hidden; min-height: 1px; }
  .page img { display: block; width: 100%; height: auto; position: relative; left: 50%; transform: translateX(-50%); }
  .pending, .failed { min-height: 100vh; display: grid; place-items: center; }
  .pending img, .failed img { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .status { display: none; color: #ccc; }
  .pending .status, .failed .status { display: block; }
  button { min-height: 44px; padding: 0 16px; border: 0; border-radius: 18px; color: #fff; background: #303034; font: inherit; }
</style>
</head>
<body>
<main id="viewport"><div id="pages"></div></main>
<script>
(() => {
  const viewport = document.getElementById("viewport");
  const container = document.getElementById("pages");
  let key = -1, rows = [], pendingFrame = false, lastPosition = "", warm = new Map();
  function send(kind, fields = {}) {
    try {
      const delivery = window.webkit.messageHandlers.reader.postMessage({ key, kind, ...fields });
      delivery?.catch?.(() => {});
    } catch {}
  }

  function reportLater() {
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(() => {
      pendingFrame = false;
      if (!rows.length) return;
      const top = viewport.scrollTop, bottom = top + viewport.clientHeight;
      let lo = 0, hi = rows.length;
      while (lo < hi) {
        const i = (lo + hi) >> 1, el = rows[i].element;
        if (el.offsetTop + el.offsetHeight <= top + 1) lo = i + 1;
        else hi = i;
      }
      const ids = [];
      for (let i = lo; i < rows.length && rows[i].element.offsetTop < bottom - 1; i++) ids.push(rows[i].id);
      for (let i = lo; i < Math.min(rows.length, lo + Math.max(3, ids.length + 2)); i++) {
        rows[i].image.loading = "eager";
      }
      const end = bottom >= viewport.scrollHeight - 2 && ids.includes(rows[rows.length - 1].id);
      const signature = JSON.stringify([ids, end]);
      if (signature === lastPosition) return;
      lastPosition = signature;
      send("position", { ids, end });
    });
  }

  function append({ id, url }, eager) {
    const generation = key;
    const element = document.createElement("section"), image = document.createElement("img");
    const status = document.createElement("div");
    element.className = "page pending";
    status.className = "status";
    status.textContent = "正在加载图片…";
    image.alt = "";
    image.draggable = false;
    image.loading = eager ? "eager" : "lazy";
    image.decoding = "async";
    element.append(image, status);
    container.append(element);
    rows.push({ id, element, image });

    let started = 0, retries = 0;
    const current = () => generation === key && element.isConnected;
    image.onload = () => {
      if (!current()) return;
      const height = element.offsetHeight, top = element.offsetTop, scroll = viewport.scrollTop;
      element.className = "page";
      if (image.naturalWidth > 4) image.style.width = (100 * image.naturalWidth / (image.naturalWidth - 4)) + "%";
      if (top + height <= scroll + 1) viewport.scrollTop = scroll + element.offsetHeight - height;
      send("image", { id, ready: true, elapsed: Math.round(performance.now() - started) });
      reportLater();
    };
    image.onerror = () => {
      if (!current()) return;
      element.className = "page failed";
      const button = document.createElement("button");
      button.textContent = retries ? "用原生加载" : "重试图片";
      button.onclick = () => {
        if (retries) { send("fallback"); return; }
        retries++;
        element.className = "page pending";
        status.textContent = "正在加载图片…";
        load(true);
      };
      status.replaceChildren(button);
      send("image", { id, ready: false, elapsed: Math.round(performance.now() - started) });
      reportLater();
    };
    function load(retry = false) {
      started = performance.now();
      if (!url) { image.onerror(); return; }
      if (retry) {
        image.loading = "eager";
        image.removeAttribute("src");
        requestAnimationFrame(() => { if (current()) image.src = url; });
      } else image.src = url;
    }
    load();
  }

  window.updateReader = ({ pages, key: nextKey, startID, preload }) => {
    const reset = key !== nextKey;
    if (reset) {
      key = nextKey;
      rows = [];
      warm.clear();
      lastPosition = "";
      container.replaceChildren();
    }
    const start = reset ? Math.max(0, pages.findIndex(page => page.id === startID)) : -1;
    for (let i = rows.length; i < pages.length; i++) append(pages[i], reset && i >= start && i < start + 3);
    if (reset && rows[start]) viewport.scrollTop = rows[start].element.offsetTop;
    for (const url of warm.keys()) if (!preload.includes(url)) warm.delete(url);
    for (const url of preload) {
      if (warm.has(url)) continue;
      const image = new Image();
      image.src = url;
      warm.set(url, image);
    }
    reportLater();
    return true;
  };

  viewport.addEventListener("scroll", reportLater, { passive: true });
  window.addEventListener("resize", reportLater);
  viewport.addEventListener("click", event => {
    if (!event.target.closest("button") && !window.getSelection()?.toString()) send("tap");
  });
})();
</script>
</body>
</html>`
