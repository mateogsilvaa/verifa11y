// Progressive enhancement only. Without this file every panel, number and command is on the page, still.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = !reduce;
  if (motion) document.documentElement.classList.add("motion");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const status = document.createElement("p");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  document.body.append(status);
  const announce = (text) => {
    status.textContent = "";
    setTimeout(() => (status.textContent = text), 50);
  };

  /* Copy buttons ---------------------------------------------------------- */
  const addCopy = (host, getText, label) => {
    if (!navigator.clipboard) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.textContent = "Copy";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(getText());
        b.textContent = "Copied";
        b.classList.add("done");
        announce("Copied to the clipboard.");
      } catch {
        b.textContent = "Select it";
        announce("Could not copy. Select the text and copy it instead.");
      }
      setTimeout(() => {
        b.textContent = "Copy";
        b.classList.remove("done");
      }, 1800);
    });
    host.append(b);
  };
  for (const c of document.querySelectorAll(".cmd[data-copy]")) addCopy(c, () => c.dataset.copy, `Copy the command: ${c.dataset.copy}`);
  for (const c of document.querySelectorAll(".code[data-copy-block]")) {
    const title = c.closest(".ca-panel")?.querySelector(".ca-title")?.textContent ?? "code";
    addCopy(c, () => c.querySelector("pre").innerText.trim(), `Copy, ${title}`);
  }

  /* Tabs (WAI-ARIA tabs pattern) ------------------------------------------ */
  function setupTabs(list, onSelect) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
    list.hidden = false;
    const select = (i, focus) => {
      tabs.forEach((t, j) => {
        const on = i === j;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
      onSelect?.(panels[i]);
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(i, false));
      t.addEventListener("keydown", (e) => {
        const k = { ArrowRight: 1, ArrowLeft: -1, Home: "home", End: "end" }[e.key];
        if (k === undefined) return;
        e.preventDefault();
        select(k === "home" ? 0 : k === "end" ? tabs.length - 1 : (i + k + tabs.length) % tabs.length, true);
      });
    });
    select(0, false);
    return { selectById: (id) => { const i = tabs.findIndex((t) => t.id === id); if (i >= 0) select(i, false); } };
  }

  /* The demo: type the command, then run the checks one by one ------------ */
  const typed = document.querySelector(".typed");
  const command = typed?.textContent ?? "";
  let runId = 0;
  async function run(panel) {
    const id = ++runId;
    const items = [...panel.querySelectorAll(".va-checks li")];
    const verdict = panel.querySelector(".va-verdict strong")?.textContent ?? "";
    if (!motion) return;
    panel.classList.remove("done");
    panel.classList.add("running");
    items.forEach((li) => li.classList.remove("shown", "active"));
    if (typed) {
      for (let n = 0; n <= command.length; n += 2) {
        if (id !== runId) return;
        typed.textContent = command.slice(0, n);
        await wait(18);
      }
      typed.textContent = command;
    }
    for (const li of items) {
      if (id !== runId) return;
      li.classList.add("active");
      await wait(380);
      li.classList.remove("active");
      li.classList.add("shown");
    }
    await wait(150);
    if (id !== runId) return;
    panel.classList.add("done");
    announce(verdict);
  }
  const vaTabs = document.querySelector(".va-tabs");
  if (vaTabs) {
    let seen = false;
    setupTabs(vaTabs, (panel) => seen && run(panel));
    const replay = document.querySelector(".replay");
    if (motion) {
      replay.hidden = false;
      replay.addEventListener("click", () => run(document.querySelector(".va-panel:not([hidden])")));
    }
    const io = new IntersectionObserver((entries) => {
      if (!seen && entries.some((e) => e.isIntersecting)) {
        seen = true;
        run(document.querySelector(".va-panel:not([hidden])"));
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(document.querySelector(".va-window"));
  }

  /* The hero button opens the install guide on the tool it is showing ------ */
  const pickTool = (id) => {
    const radio = document.getElementById(`tool-${id}`);
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  const tryBtn = document.querySelector("[data-try]");
  const rot = tryBtn?.querySelector(".try-rot");
  let current = rot?.firstElementChild ?? null;
  if (tryBtn) tryBtn.addEventListener("click", () => current && pickTool(current.dataset.tab.replace(/^t-/, "")));
  if (rot && motion) {
    const items = [...rot.children];
    let i = 0;
    rot.classList.add("js");
    items[0].classList.add("on");
    setInterval(() => {
      const prev = items[i];
      i = (i + 1) % items.length;
      prev.classList.remove("on");
      items[i].classList.add("on");
      current = items[i];
    }, 2200);
  }

  /* Header: denser once the page scrolls; the current section is marked ---- */
  const header = document.querySelector(".site-header");
  const onScrollHeader = () => header?.classList.toggle("scrolled", scrollY > 24);
  addEventListener("scroll", onScrollHeader, { passive: true });
  onScrollHeader();
  const navLinks = new Map([...document.querySelectorAll(".nav-links a")].map((a) => [a.getAttribute("href").slice(1), a]));
  const navSpy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      navLinks.forEach((a, id) => (id === e.target.id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  navLinks.forEach((_, id) => { const s = document.getElementById(id); if (s) navSpy.observe(s); });

  /* Install, on phones: picking a tool scrolls to its steps (pointer only, never while arrowing through the list) */
  const docs = document.querySelector(".docs");
  const narrow = matchMedia("(max-width: 760px)");
  docs?.addEventListener("click", (e) => {
    const label = e.target.closest(".tool");
    if (!label || e.detail === 0 || !narrow.matches) return;
    const panel = document.getElementById(`p-${label.querySelector("input").value}`);
    setTimeout(() => panel?.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" }), 60);
  });

  /* Install: search the list of tools ------------------------------------- */
  const search = document.getElementById("tool-search");
  const docsSearch = document.querySelector(".docs-search");
  const noMatch = document.querySelector(".docs .no-match");
  if (search && docsSearch) {
    docsSearch.hidden = false;
    const tools = [...document.querySelectorAll(".docs .tool")];
    const groups = [...document.querySelectorAll(".docs .tool-group")];
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const t of tools) t.hidden = !!q && !t.textContent.toLowerCase().includes(q);
      for (const g of groups) g.hidden = !g.querySelector(".tool:not([hidden])");
      const visible = tools.filter((t) => !t.hidden);
      noMatch.textContent = visible.length ? "" : "Not listed? Anything that speaks MCP works: see Other MCP hosts.";
      if (visible.length === 1) visible[0].querySelector("input").click();
    });
  }

  /* The verifier: two real fixes go through the six gates ------------------- */
  const gates = document.querySelector(".gates");
  if (gates) {
    const list = [...gates.querySelectorAll(".gate")];
    const paint = (a, b) => {
      gates.style.setProperty("--a", String(a));
      gates.style.setProperty("--b", String(b));
      list.forEach((g, i) => { g.classList.toggle("lit", i < a); g.classList.toggle("stop", i === 2 && b >= 3); });
      gates.classList.toggle("g-end", a >= 6);
      gates.classList.toggle("g-stop", b >= 3);
    };
    if (!motion) paint(6, 3);
    else {
      paint(0.6, 0.6);
      let started = false;
      const run = async () => {
        for (let k = 1; k <= 6; k++) { paint(k, Math.min(k, 3)); await wait(650); }
        await wait(2600);
        paint(0.6, 0.6);
        await wait(900);
        run();
      };
      new IntersectionObserver((entries, o) => {
        if (!started && entries.some((e) => e.isIntersecting)) { started = true; o.disconnect(); setTimeout(run, 400); }
      }, { threshold: 0.4 }).observe(gates);
    }
  }

  /* Background: three soft glows drift, split and join as you scroll, and end up lighting the footer word */
  const ambient = document.querySelector(".ambient");
  if (ambient && motion) {
    const blobs = [...ambient.children];
    const dots = document.querySelector(".dotlight");
    // On a mouse, the first light leans toward the pointer; on touch it only follows the scroll.
    const fine = matchMedia("(pointer: fine)");
    let px = innerWidth * 0.3, py = innerHeight * 0.3, pull = 0, lastMove = -1e9;
    addEventListener("pointermove", (e) => { if (fine.matches) { px = e.clientX; py = e.clientY; lastMove = performance.now(); } }, { passive: true });
    const word = document.querySelector(".foot-word");
    const lerp = (a, b, k) => a + (b - a) * k;
    let sp = 0;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      sp = max > 0 ? scrollY / max : 0;
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    onScroll();
    let lastGlow = -1;
    const frame = (ms) => {
      const t = ms / 1000;
      const W = innerWidth, H = innerHeight;
      // Where the glows wander: side to side with the scroll, up and down slowly with time
      const cx = 0.5 + 0.3 * Math.sin(sp * Math.PI * 3 + t * 0.06);
      const cy = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(sp * Math.PI * 2.4 + 0.8 + t * 0.045));
      // How far apart the two main glows are: 0 is one merged glow
      const split = 0.22 * (0.5 + 0.5 * Math.sin(t * 0.19 + sp * 10));
      const pts = [
        [cx - split, cy - split * 0.45],
        [cx + split, cy + split * 0.45],
        [cx + 0.18 * Math.cos(t * 0.15 + 1), cy + 0.14 * Math.sin(t * 0.12)],
      ];
      // Near the end of the page they gather behind the footer word
      let f = 0, r = null;
      if (word) {
        r = word.getBoundingClientRect();
        // 0 until the word is a third of a screen away, 1 once it is in view
        f = Math.min(1, Math.max(0, (H * 1.3 - r.top) / (H * 0.3 + r.height * 0.8)));
        f = f * f * (3 - 2 * f);
      }
      const xs = [], ys = [];
      // Ease toward the pointer while it moves, and back to the drift when it rests
      pull = lerp(pull, ms - lastMove < 2500 ? 0.55 : 0, 0.03);
      pts.forEach(([x, y], i) => {
        let X = x * W, Y = y * H;
        if (i === 0 && pull > 0.001) { X = lerp(X, px, pull); Y = lerp(Y, py, pull); }
        if (r && f > 0) {
          const spread = [-0.26, 0.26, 0][i] * r.width + Math.sin(t * 0.4 + i * 2) * r.width * 0.12;
          X = lerp(X, r.left + r.width / 2 + spread, f * 0.9);
          Y = lerp(Y, r.top + r.height * 0.55, f * 0.9);
        }
        xs.push(X); ys.push(Y);
        blobs[i].style.transform = `translate3d(${X.toFixed(1)}px, ${Y.toFixed(1)}px, 0)`;
      });
      if (dots) {
        dots.style.setProperty("--x1", `${xs[0].toFixed(0)}px`); dots.style.setProperty("--y1", `${ys[0].toFixed(0)}px`);
        dots.style.setProperty("--x2", `${xs[1].toFixed(0)}px`); dots.style.setProperty("--y2", `${ys[1].toFixed(0)}px`);
      }
      if (r && (f > 0 || lastGlow !== 0)) {
        word.style.setProperty("--glow", f.toFixed(3));
        word.style.setProperty("--ga", `${(((xs[0] - r.left) / r.width) * 100).toFixed(1)}%`);
        word.style.setProperty("--gb", `${(((xs[1] - r.left) / r.width) * 100).toFixed(1)}%`);
        lastGlow = f;
      }
      requestAnimationFrame(frame);
    };
    ambient.classList.add("live");
    requestAnimationFrame(frame);
  }

  /* How it works: a scan line runs down the demo page and the report fills in.
     Wide screens: driven by your scroll while the frame is pinned. Narrow screens: it plays once when it comes into view. */
  const scan = document.querySelector(".scan");
  if (scan && motion) {
    const track = scan.querySelector(".scan-track");
    const site = scan.querySelector(".site");
    const els = [...scan.querySelectorAll(".sp-el[data-n]")];
    const items = els.map((el) => scan.querySelector(`.finding[data-n="${el.dataset.n}"]`));
    const hud = Object.fromEntries([...scan.querySelectorAll("[data-hud]")].map((el) => [el.dataset.hud, el]));
    const wide = matchMedia("(min-width: 861px)");
    let at = [];
    const measure = () => {
      const sr = site.getBoundingClientRect();
      at = els.map((el) => { const r = el.getBoundingClientRect(); return (r.top + r.height / 2 - sr.top) / (sr.height || 1); });
    };
    const apply = (p) => {
      scan.style.setProperty("--sp", p.toFixed(4));
      scan.classList.toggle("end", p >= 0.995);
      let ok = 0, no = 0;
      els.forEach((el, i) => {
        // flagged when the line reaches it, patched, then judged (the last one is judged as the line ends)
        const phase = p < at[i] ? 0 : p < Math.min(at[i] + 0.05, 0.96) ? 1 : p < Math.min(at[i] + 0.1, 0.99) ? 2 : 3;
        for (const n of [el, items[i]]) { if (phase) n.dataset.phase = String(phase); else delete n.dataset.phase; }
        if (phase === 3) el.dataset.ok === "1" ? ok++ : no++;
      });
      hud.ok.textContent = ok; hud.no.textContent = no;
    };
    const fromScroll = () => {
      if (!scan.classList.contains("pinned")) return;
      const r = track.getBoundingClientRect();
      apply(Math.min(1, Math.max(0, (-r.top + innerHeight * 0.1) / Math.max(1, r.height - innerHeight * 0.9))));
    };
    let played = false;
    const play = () => {
      if (played) return;
      played = true;
      measure();
      const start = performance.now();
      const step = (now) => {
        if (scan.classList.contains("pinned")) return;
        const k = Math.min(1, (now - start) / 5200);
        apply(k);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((entries) => {
      if (!scan.classList.contains("pinned") && entries.some((e) => e.isIntersecting)) play();
    }, { threshold: 0.55 });
    io.observe(site);
    const mode = () => {
      const on = wide.matches;
      scan.classList.toggle("pinned", on);
      scan.classList.add("live");
      scan.classList.remove("done");
      measure();
      if (on) fromScroll();
      else apply(played ? 1 : 0);
    };
    addEventListener("scroll", fromScroll, { passive: true });
    addEventListener("resize", () => { measure(); fromScroll(); });
    addEventListener("load", () => { measure(); fromScroll(); });
    wide.addEventListener("change", mode);
    mode();
  }

  if (!motion) return;



  /* Hero tour: a focus ring tabs through the mock page, verdicts pop up ----- */
  const tour = document.querySelector(".tour");
  if (tour) {
    const page = tour.querySelector(".tour-page");
    const ring = tour.querySelector(".t-ring");
    const stops = [...tour.querySelectorAll("[data-tour]")].sort((a, b) => a.dataset.tour - b.dataset.tour);
    tour.classList.add("js");
    let k = 0;
    const place = (el) => {
      const pr = page.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      Object.assign(ring.style, { left: `${r.left - pr.left - 5}px`, top: `${r.top - pr.top - 5}px`, width: `${r.width + 10}px`, height: `${r.height + 10}px` });
    };
    const tick = () => {
      if (k === stops.length) {
        k = 0;
        tour.querySelectorAll(".t-chip.on").forEach((c) => c.classList.remove("on"));
        setTimeout(tick, 700);
        return;
      }
      const el = stops[k++];
      place(el);
      setTimeout(() => el.querySelector(".t-chip")?.classList.add("on"), 450);
      setTimeout(tick, k === stops.length ? 3200 : 1300);
    };
    addEventListener("resize", () => stops[Math.max(0, k - 1)] && place(stops[Math.max(0, k - 1)]));
    setTimeout(tick, 500);
  }

  /* Logo strip: duplicate it once so the loop has no seam (the copy is hidden from assistive tech) */
  const mq = document.querySelector(".mq-list");
  if (mq) for (const li of [...mq.children]) { const c = li.cloneNode(true); c.setAttribute("aria-hidden", "true"); mq.append(c); }

  /* Reveal on scroll, with a small stagger between siblings ---------------- */
  const groups = new Map();
  for (const el of document.querySelectorAll("[data-reveal]")) {
    const i = groups.get(el.parentElement) ?? 0;
    groups.set(el.parentElement, i + 1);
    el.style.setProperty("--d", `${Math.min(i, 5) * 70}ms`);
  }
  const countUp = (el) => {
    const target = Number(el.textContent.replace(/[^\d]/g, ""));
    if (!target) return;
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 1100);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = String(target);
    };
    requestAnimationFrame(step);
  };
  const reveal = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      for (const n of e.target.querySelectorAll("[data-count]")) countUp(n);
      if (e.target.matches("[data-count]")) countUp(e.target);
      reveal.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -12% 0px" });
  document.querySelectorAll("[data-reveal]").forEach((el) => reveal.observe(el));

  /* The pipeline line fills as the section scrolls through ---------------- */
  const track = document.querySelector(".track");
  if (track) {
    const section = track.closest("section");
    const update = () => {
      const r = section.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height * 0.9)));
      track.style.setProperty("--p", p.toFixed(3));
    };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();
  }
})();
