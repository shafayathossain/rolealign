/* src/util/dom.ts
   RoleAlign — DOM utilities for content scripts / injected UIs.

   Highlights:
   - Query: qs/qsa, waitFor, waitForAll, waitForRemoved
   - Observation: observeSelector, observeAttributes, observeText, onVisible
   - SPA routing: installSpaLocationChangeEmitter (robust)
   - Shadow UI: createShadowHost with adoptedStyleSheets fallback, css() helper
   - IFrame UI: createIsolatedIframeUi (auto-resize, postMessage channel)
   - Style: injectStyleUrl, injectStyleText (CSP-friendly), scopeStyles
   - UX: toast(), createBadge() with dynamic updates, clickOutside(), draggable()
   - Perf: debounce(), throttle(), scheduleMicrotask(), nextFrame()
   - Safety: sanitizeHtml() minimal, safeParseHTML()
   - Layout: measure(), getOffset(), lockBodyScroll()

   All helpers avoid mutating global page styles (except where explicitly requested),
   and return disposers for cleanup where applicable.
*/

export type Maybe<T> = T | null | undefined;

/* ─────────────────────────── Id/Perf helpers ─────────────────────────── */

export function uid(prefix = "ra"): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function debounce<T extends (...args: any[]) => any>(fn: T, ms = 150) {
  let t: any;
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  (debounced as any).flush = () => {
    clearTimeout(t);
    fn();
  };
  (debounced as any).cancel = () => clearTimeout(t);
  return debounced as T & { flush: () => void; cancel: () => void };
}

export function throttle<T extends (...args: any[]) => any>(fn: T, ms = 120) {
  let last = 0;
  let pending: any = null;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const diff = now - last;
    if (diff >= ms) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(pending);
      pending = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, ms - diff);
    }
  };
}

export const scheduleMicrotask = (cb: () => void) =>
  Promise.resolve().then(cb).catch(() => { /* swallow */ });

export const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => r()));

/* ─────────────────────────── Query helpers ─────────────────────────── */

export function qs<T extends Element = Element>(
  sel: string,
  root: ParentNode | Document = document,
): T | null {
  return root.querySelector(sel) as T | null;
}

export function qsa<T extends Element = Element>(
  sel: string,
  root: ParentNode | Document = document,
): T[] {
  return Array.from(root.querySelectorAll(sel)) as T[];
}

/** Resolve once the selector appears (MutationObserver + timeout + cancel). */
export function waitFor<T extends Element = Element>(
  sel: string,
  opts: {
    root?: ParentNode | Document;
    timeoutMs?: number;
    stopIf?: () => boolean;
  } = {},
): Promise<T> {
  const root = opts.root ?? document;
  const existing = root.querySelector(sel) as T | null;
  if (existing) return Promise.resolve(existing);

  return new Promise<T>((resolve, reject) => {
    const target = root instanceof Document ? root.documentElement : (root as Element);
    const obs = new MutationObserver(() => {
      const el = root.querySelector(sel) as T | null;
      if (el) {
        cleanup();
        resolve(el);
      }
    });

    const to = opts.timeoutMs
      ? setTimeout(() => {
          cleanup();
          reject(new Error(`waitFor("${sel}") timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    let raf = 0;
    const tick = () => {
      if (opts.stopIf?.()) {
        cleanup();
        reject(new Error(`waitFor("${sel}") stopped`));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const cleanup = () => {
      try { obs.disconnect(); } catch {}
      if (to) clearTimeout(to);
      if (raf) cancelAnimationFrame(raf);
    };

    obs.observe(target, { childList: true, subtree: true });
  });
}

export function waitForAll<T extends Element = Element>(
  sel: string,
  opts: { root?: ParentNode | Document; min?: number; timeoutMs?: number } = {},
): Promise<T[]> {
  const root = opts.root ?? document;
  const min = Math.max(1, opts.min ?? 1);
  const initial = qsa<T>(sel, root);
  if (initial.length >= min) return Promise.resolve(initial);

  return new Promise<T[]>((resolve, reject) => {
    const target = root instanceof Document ? root.documentElement : (root as Element);
    const obs = new MutationObserver(() => {
      const els = qsa<T>(sel, root);
      if (els.length >= min) {
        cleanup();
        resolve(els);
      }
    });
    const to = opts.timeoutMs
      ? setTimeout(() => {
          cleanup();
          reject(new Error(`waitForAll("${sel}", min=${min}) timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    const cleanup = () => {
      try { obs.disconnect(); } catch {}
      if (to) clearTimeout(to);
    };
    obs.observe(target, { childList: true, subtree: true });
  });
}

export function waitForRemoved(
  el: Element,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  if (!el.isConnected) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const obs = new MutationObserver(() => {
      if (!el.isConnected) {
        cleanup();
        resolve();
      }
    });
    const to = opts.timeoutMs
      ? setTimeout(() => {
          cleanup();
          reject(new Error("waitForRemoved timed out"));
        }, opts.timeoutMs)
      : null;
    const cleanup = () => {
      try { obs.disconnect(); } catch {}
      if (to) clearTimeout(to);
    };
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/* ─────────────────────────── Observation ─────────────────────────── */

export function observeSelector(
  sel: string,
  cb: (els: Element[], mutation: MutationRecord[]) => void,
  opts: { root?: ParentNode | Document; once?: boolean } = {},
): () => void {
  const root = opts.root ?? document;
  const target = root instanceof Document ? root.documentElement : (root as Element);

  const fire = (records: MutationRecord[]) => {
    const els = qsa(sel, root);
    if (els.length > 0) {
      cb(els, records);
      if (opts.once) stop();
    }
  };

  const obs = new MutationObserver(fire);
  obs.observe(target, { childList: true, subtree: true });
  // initial
  scheduleMicrotask(() => fire([]));

  const stop = () => {
    try { obs.disconnect(); } catch {}
  };
  return stop;
}

export function observeAttributes(
  el: Element,
  cb: (records: MutationRecord[]) => void,
  opts: MutationObserverInit = { attributes: true, attributeFilter: undefined },
): () => void {
  const obs = new MutationObserver((recs) => cb(recs));
  obs.observe(el, { attributes: true, attributeFilter: opts.attributeFilter });
  return () => { try { obs.disconnect(); } catch {} };
}

export function observeText(
  el: Node,
  cb: (records: MutationRecord[]) => void,
): () => void {
  const obs = new MutationObserver((recs) => cb(recs));
  obs.observe(el, { characterData: true, subtree: true, childList: true });
  return () => { try { obs.disconnect(); } catch {} };
}

/** Visibility via IntersectionObserver, returns disposer. */
export function onVisible(
  el: Element,
  cb: (visible: boolean, entry: IntersectionObserverEntry) => void,
  opts: IntersectionObserverInit = { root: null, threshold: [0, 0.25, 0.5, 0.75, 1] },
): () => void {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) cb(e.isIntersecting, e);
  }, opts);
  io.observe(el);
  return () => io.disconnect();
}

/* ─────────────────────────── Shadow UI host ─────────────────────────── */

export interface ShadowHost {
  host: HTMLDivElement;
  root: ShadowRoot;
  mount: (child: Node) => void;
  css: (text: string) => HTMLStyleElement | CSSStyleSheet;
  adopt: (sheets: (CSSStyleSheet | HTMLStyleElement)[]) => void;
  destroy: () => void;
}

export function createShadowHost(
  id = uid("rolealign-shadow"),
  attachTo: Element | Document = document,
  opts: {
    className?: string;
    zIndex?: number | string;
    mode?: "open" | "closed";
    isolatedEvents?: boolean; // capture pointer events in shadow
  } = {},
): ShadowHost {
  const doc = attachTo instanceof Document ? attachTo : attachTo.ownerDocument!;
  const host = doc.createElement("div");
  host.id = id;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.zIndex = String(opts.zIndex ?? 2147483646);
  host.style.pointerEvents = opts.isolatedEvents ? "auto" : "none";
  if (opts.className) host.className = opts.className;

  const containerParent = attachTo instanceof Document ? doc.documentElement : attachTo;
  containerParent.appendChild(host);

  const root = host.attachShadow({ mode: opts.mode ?? "open" });
  const mount = (child: Node) => {
    // Ensure interactive children can receive pointer events
    (child as HTMLElement).style.pointerEvents = "auto";
    root.appendChild(child);
  };

  // Adopted stylesheets when available for perf
  const css = (text: string): HTMLStyleElement | CSSStyleSheet => {
    if ("adoptedStyleSheets" in root && "replaceSync" in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      (sheet as any).replaceSync(text);
      (root as any).adoptedStyleSheets = [...(root as any).adoptedStyleSheets, sheet];
      return sheet;
    } else {
      const style = doc.createElement("style");
      style.textContent = text;
      root.appendChild(style);
      return style;
    }
  };

  const adopt = (sheets: (CSSStyleSheet | HTMLStyleElement)[]) => {
    if ("adoptedStyleSheets" in root) {
      const current = (root as any).adoptedStyleSheets ?? [];
      (root as any).adoptedStyleSheets = [...current, ...sheets.filter((s): s is CSSStyleSheet => s instanceof CSSStyleSheet)];
    } else {
      sheets.forEach((s) => {
        if (s instanceof HTMLStyleElement) root.appendChild(s);
      });
    }
  };

  const destroy = () => {
    try { host.remove(); } catch {}
  };

  return { host, root, mount, css, adopt, destroy };
}

/* ─────────────────────────── IFrame UI (isolated) ─────────────────────────── */

export interface IsolatedIframe {
  wrapper: HTMLDivElement;
  iframe: HTMLIFrameElement;
  post: (msg: any, targetOrigin?: string) => void;
  destroy: () => void;
}

/**
 * Creates an overlay iframe that can host a full page (e.g., /ui.html),
 * supports auto-resize (postMessage from inside), and a message channel.
 *
 * Use manifest.web_accessible_resources to allow the path.
 */
export function createIsolatedIframeUi(
  pagePath: string,              // e.g. "/rolealign-ui.html"
  opts: {
    position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "center";
    width?: number;              // px
    height?: number;             // px (can be resized from inside)
    initialShown?: boolean;
    className?: string;
    allow?: string;              // sandbox/allow attr
    style?: Partial<CSSStyleDeclaration>;
  } = {},
): IsolatedIframe {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.zIndex = String(2147483647);
  wrapper.style.pointerEvents = "auto";

  const pos = opts.position ?? "top-right";
  const pad = 12;
  const w = Math.max(280, opts.width ?? 360);
  const h = Math.max(160, opts.height ?? 480);

  Object.assign(wrapper.style, {
    width: `${w}px`,
    height: `${h}px`,
  });

  if (pos.includes("top")) wrapper.style.top = `${pad}px`;
  if (pos.includes("bottom")) wrapper.style.bottom = `${pad}px`;
  if (pos.includes("left")) wrapper.style.left = `${pad}px`;
  if (pos.includes("right")) wrapper.style.right = `${pad}px`;
  if (pos === "center") {
    Object.assign(wrapper.style, {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    });
  }
  if (opts.className) wrapper.className = opts.className;
  if (opts.style) Object.assign(wrapper.style, opts.style);

  const iframe = document.createElement("iframe");
  iframe.src = pagePath;
  iframe.width = "100%";
  iframe.height = "100%";
  iframe.style.border = "0";
  iframe.style.borderRadius = "12px";
  iframe.style.boxShadow = "0 10px 40px rgba(0,0,0,.25)";
  iframe.allow = opts.allow ?? "";
  wrapper.appendChild(iframe);

  if (opts.initialShown !== false) {
    document.documentElement.appendChild(wrapper);
  }

  const onMessage = (ev: MessageEvent) => {
    // Auto-resize protocol: { type: 'ra:resize', width?: number, height?: number }
    const d = ev.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "ra:resize") {
      if (typeof d.width === "number") wrapper.style.width = `${Math.max(240, d.width)}px`;
      if (typeof d.height === "number") wrapper.style.height = `${Math.max(160, d.height)}px`;
    }
  };
  window.addEventListener("message", onMessage);

  const post = (msg: any, targetOrigin = "*") => {
    iframe.contentWindow?.postMessage(msg, targetOrigin);
  };

  const destroy = () => {
    window.removeEventListener("message", onMessage);
    try { wrapper.remove(); } catch {}
  };

  return { wrapper, iframe, post, destroy };
}

/* ─────────────────────────── Style helpers ─────────────────────────── */

export function injectStyleUrl(href: string, root: Document | ShadowRoot = document): HTMLLinkElement {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  if (root instanceof ShadowRoot) {
    (root as any).host.shadowRoot?.appendChild(link);
  } else {
    root.head.appendChild(link);
  }
  return link;
}

export function injectStyleText(cssText: string, root: Document | ShadowRoot = document): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = cssText;
  (root instanceof ShadowRoot ? root : root.head).appendChild(style);
  return style;
}

/** Naive scoping: wraps selectors with a scope id. (Does not parse complex CSS.) */
export function scopeStyles(cssText: string, scope: string): string {
  return cssText
    .split("}")
    .map((block) => {
      const [sel, decl] = block.split("{");
      if (!decl || !sel) return "";
      const scopedSel = sel
        .split(",")
        .map((s) => `${scope} ${s.trim()}`)
        .join(", ");
      return `${scopedSel}{${decl}}`;
    })
    .join("}");
}

/* ─────────────────────────── UX Widgets ─────────────────────────── */

export function toast(message: string, opts: { ms?: number; theme?: "light" | "dark" } = {}) {
  const ms = opts.ms ?? 2400;
  const el = document.createElement("div");
  el.textContent = message;
  el.style.position = "fixed";
  el.style.bottom = "16px";
  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";
  el.style.padding = "10px 14px";
  el.style.borderRadius = "10px";
  el.style.font = "600 12px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
  el.style.zIndex = "2147483647";
  el.style.pointerEvents = "none";
  if ((opts.theme ?? "dark") === "dark") {
    el.style.background = "rgba(0,0,0,.85)";
    el.style.color = "#fff";
  } else {
    el.style.background = "rgba(255,255,255,.9)";
    el.style.color = "#111";
    el.style.border = "1px solid #ddd";
    el.style.boxShadow = "0 4px 20px rgba(0,0,0,.1)";
  }
  document.documentElement.appendChild(el);
  const t = setTimeout(() => { try { el.remove(); } catch {} }, ms);
  return () => { clearTimeout(t); try { el.remove(); } catch {} };
}

export interface Badge {
  update: (score: number, label?: string) => void;
  remove: () => void;
}

export function createBadge(
  target: HTMLElement,
  score: number,
  opts: {
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    label?: string;
    onClick?: () => void;
  } = {},
): Badge {
  const pos = opts.position ?? "top-right";

  // Ensure target can host absolutely positioned children
  if (getComputedStyle(target).position === "static") {
    target.style.position = "relative";
  }

  const wrap = document.createElement("div");
  wrap.style.position = "absolute";
  wrap.style.zIndex = "2147483647";
  wrap.style.pointerEvents = "auto";
  wrap.style.userSelect = "none";

  if (pos.includes("top")) wrap.style.top = "8px";
  if (pos.includes("bottom")) wrap.style.bottom = "8px";
  if (pos.includes("left")) wrap.style.left = "8px";
  if (pos.includes("right")) wrap.style.right = "8px";

  const pill = document.createElement("div");
  Object.assign(pill.style, {
    font: "700 12px/1.15 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
    color: "#fff",
    padding: "6px 8px",
    borderRadius: "999px",
    boxShadow: "0 6px 20px rgba(0,0,0,.25)",
    cursor: opts.onClick ? "pointer" : "default",
    letterSpacing: "0.2px",
    whiteSpace: "nowrap",
  } as CSSStyleDeclaration);

  const format = (n: number, label?: string) =>
    `${Math.max(0, Math.min(100, Math.round(n)))}%${label ? ` ${label}` : ""}`;

  const setColor = (n: number) => {
    // map 0..100 to red->amber->green
    const c = gradient(n);
    pill.style.background = `rgb(${c[0]} ${c[1]} ${c[2]})`;
  };

  pill.textContent = format(score, opts.label);
  setColor(score);
  if (opts.onClick) pill.addEventListener("click", opts.onClick);

  wrap.appendChild(pill);
  target.appendChild(wrap);

  return {
    update(n: number, label?: string) {
      pill.textContent = format(n, label ?? opts.label);
      setColor(n);
    },
    remove() { try { wrap.remove(); } catch {} },
  };
}

function gradient(score: number): [number, number, number] {
  // 0 -> #e11d48 (red), 50 -> #f59e0b (amber), 100 -> #16a34a (green)
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const s = clamp(score, 0, 100) / 100;
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const red: [number, number, number] = [225, 29, 72];
  const amb: [number, number, number] = [245, 158, 11];
  const grn: [number, number, number] = [22, 163, 74];
  if (s <= 0.5) {
    const t = s / 0.5;
    return [lerp(red[0], amb[0], t), lerp(red[1], amb[1], t), lerp(red[2], amb[2], t)];
  }
  const t = (s - 0.5) / 0.5;
  return [lerp(amb[0], grn[0], t), lerp(amb[1], grn[1], t), lerp(amb[2], grn[2], t)];
}

export function clickOutside(
  root: HTMLElement,
  onOutside: (ev: MouseEvent) => void,
  opts: { capture?: boolean } = {},
): () => void {
  const handler = (ev: MouseEvent) => {
    if (!root.contains(ev.target as Node)) onOutside(ev);
  };
  document.addEventListener("mousedown", handler, opts.capture ?? true);
  return () => document.removeEventListener("mousedown", handler, opts.capture ?? true);
}

export function draggable(
  el: HTMLElement,
  opts: { handle?: HTMLElement; bounds?: HTMLElement | Window } = {},
): () => void {
  const handle = opts.handle ?? el;
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

  const down = (e: MouseEvent) => {
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const rect = el.getBoundingClientRect();
    ox = rect.left; oy = rect.top;
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up, { once: true });
    e.preventDefault();
  };
  const move = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    el.style.position = "fixed";
    el.style.left = `${ox + dx}px`;
    el.style.top = `${oy + dy}px`;
  };
  const up = () => {
    dragging = false;
    document.removeEventListener("mousemove", move);
  };

  handle.addEventListener("mousedown", down);
  return () => handle.removeEventListener("mousedown", down);
}

/* ─────────────────────────── Layout / Metrics ─────────────────────────── */

export function measure(el: Element) {
  const rect = el.getBoundingClientRect();
  return {
    rect,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
  };
}

export function getOffset(el: Element) {
  const rect = el.getBoundingClientRect();
  return { top: rect.top + window.scrollY, left: rect.left + window.scrollX };
}

export function lockBodyScroll(): () => void {
  const origOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  return () => {
    document.documentElement.style.overflow = origOverflow;
  };
}

/* ─────────────────────────── Safety / Parsing ─────────────────────────── */

/** Very small sanitizer for our controlled HTML (no event handlers, no scripts). */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const disallowed = ["script", "style", "iframe", "object", "embed", "link"];
  disallowed.forEach((tag) => doc.querySelectorAll(tag).forEach((n) => n.remove()));
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(attr.name); // strip handlers
      if (n === "srcdoc") el.removeAttribute(attr.name);
      if (n === "style") {
        // clamp inline styles (optional: drop entirely)
        const v = (attr.value || "").toLowerCase();
        if (v.includes("expression(") || v.includes("javascript:")) {
          el.removeAttribute("style");
        }
      }
    }
  });
  return doc.body.innerHTML;
}

export function safeParseHTML(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = sanitizeHtml(html);
  return tpl.content;
}

/* ──────────────────────── SPA Location Change ──────────────────────── */

/**
 * Robustly dispatches "wxt:locationchange" on window whenever URL changes via
 * pushState / replaceState / popstate. Dedupes identical URLs and handles
 * history back/forward.
 */
export function installSpaLocationChangeEmitter(win: Window = window) {
  const flag = "__rolealign_locchange_installed";
  if ((win as any)[flag]) return;
  (win as any)[flag] = true;

  let last = String(win.location.href);
  const dispatch = (newUrl: string, oldUrl: string) =>
    win.dispatchEvent(new CustomEvent("wxt:locationchange", { detail: { newUrl, oldUrl } }));

  const wrap = (name: "pushState" | "replaceState") => {
    const orig = (win.history as any)[name];
    (win.history as any)[name] = function (...args: any[]) {
      const ret = orig.apply(this, args);
      const now = String(win.location.href);
      if (now !== last) {
        dispatch(now, last);
        last = now;
      }
      return ret;
    };
  };
  wrap("pushState");
  wrap("replaceState");

  win.addEventListener("popstate", () => {
    const now = String(win.location.href);
    if (now !== last) {
      dispatch(now, last);
      last = now;
    }
  });

  // Some apps mutate hash only:
  win.addEventListener("hashchange", () => {
    const now = String(win.location.href);
    if (now !== last) {
      dispatch(now, last);
      last = now;
    }
  });
}

/* ─────────────────────────── Utilities (misc) ─────────────────────────── */

export function ensureRelPosition(el: HTMLElement) {
  const cs = getComputedStyle(el);
  if (cs.position === "static") el.style.position = "relative";
}

/** Set multiple attributes in one go. */
export function setAttrs(el: Element, attrs: Record<string, string | number | boolean | null | undefined>) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) {
      el.removeAttribute(k);
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

/** Add multiple classes defensively. */
export function addClasses(el: Element, ...classes: (string | undefined | null | false)[]) {
  classes.filter(Boolean).forEach((c) => el.classList.add(c as string));
}

/** Remove multiple classes. */
export function removeClasses(el: Element, ...classes: (string | undefined | null | false)[]) {
  classes.filter(Boolean).forEach((c) => el.classList.remove(c as string));
}
