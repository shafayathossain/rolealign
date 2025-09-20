/* src/messaging/bus.ts
   A small, production-grade message bus over chrome.runtime messaging:
   - request/response with timeouts and AbortSignal
   - typed contracts (see types.ts)
   - target content scripts by tabId
   - stream events (partial updates/progress)
   - handler registry with safe error mapping
*/

import { Logger } from "../util/logger";
import {
  AnyReq,
  AnyRes,
  BaseReq,
  ErrorRes,
  Kind,
  PROTOCOL_VERSION,
  ResFor,
} from "./types";

const log = new Logger({ namespace: "bus", level: "info", persist: false });

/* ================ Utilities ================ */

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isErrorRes<K extends Kind>(x: AnyRes, k: K): x is ErrorRes<K> {
  return x.type === `${k}:RES` && (x as any).ok === false;
}

function okRes<K extends Kind>(req: BaseReq<K, any>, result: ResFor<K>["result"]): ResFor<K> {
  return {
    v: req.v,
    id: req.id,
    from: "background",
    to: req.from,
    type: `${req.type}:RES`,
    ok: true,
    result,
    tabId: req.tabId,
  } as ResFor<K>;
}

function errRes<K extends Kind>(
  req: BaseReq<K, any>,
  code: ErrorRes<K>["error"]["code"],
  message: string,
  details?: unknown,
): ErrorRes<K> {
  return {
    v: req.v,
    id: req.id,
    from: "background",
    to: req.from,
    type: `${req.type}:RES`,
    ok: false,
    error: { code, message, details },
    tabId: req.tabId,
  };
}

/* ================ Sender API ================ */

export interface SendOptions {
  /** Target a content script in a specific tab. If omitted, message goes to background. */
  tabId?: number;
  /** Overall timeout (ms) for the round trip. */
  timeoutMs?: number;
  /** Abort the send early. */
  signal?: AbortSignal;
  /** Allow streaming intermediate events. */
  onStream?: (piece: AnyRes) => void;
}

/**
 * Send a typed request and await a typed response.
 * If tabId is set, uses chrome.tabs.sendMessage; otherwise chrome.runtime.sendMessage.
 */
export function send<K extends Kind>(
  from: "popup" | "content" | "background",
  type: K,
  payload: BaseReq<K, any>["payload"],
  opts: SendOptions = {},
): Promise<ResFor<K>["result"]> {
  const id = uid();
  const base = {
    v: PROTOCOL_VERSION,
    id,
    from,
    to: opts.tabId ? "content" : "background",
    type,
    payload,
    tabId: opts.tabId,
  } as AnyReq;

  const timeoutMs = opts.timeoutMs ?? 15_000;

  return new Promise<ResFor<K>["result"]>((resolve, reject) => {
    let finished = false;
    const finish = (fn: () => void) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        fn();
      }
    };

    const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          Object.assign(new Error(`${type} timed out after ${timeoutMs}ms`), { name: "TimeoutError" }),
        ),
      );
    }, timeoutMs);

    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const respond = (res: AnyRes) => {
      // Stream piece?
      if ((res as any).stream && opts.onStream) {
        opts.onStream(res);
        return; // keep waiting for the terminal piece
      }
      // Terminal piece:
      if (isErrorRes(res, type)) {
        finish(() => reject(Object.assign(new Error(res.error.message), { code: res.error.code, details: res.error.details })));
      } else {
        const ok = res as ResFor<K>;
        finish(() => resolve(ok.result));
      }
    };

    try {
      if (opts.tabId && typeof chrome?.tabs?.sendMessage === "function") {
        chrome.tabs.sendMessage(opts.tabId, base, (resp: AnyRes) => {
          const err = chrome.runtime.lastError;
          if (err) {
            finish(() => reject(Object.assign(new Error(err.message), { code: "Internal" })));
            return;
          }
          respond(resp);
        });
      } else if (typeof chrome?.runtime?.sendMessage === "function") {
        chrome.runtime.sendMessage(base, (resp: AnyRes) => {
          const err = chrome.runtime.lastError;
          if (err) {
            finish(() => reject(Object.assign(new Error(err.message), { code: "Internal" })));
            return;
          }
          respond(resp);
        });
      } else {
        finish(() => reject(Object.assign(new Error("Messaging API unavailable"), { code: "Unavailable" })));
      }
    } catch (e) {
      finish(() => reject(e));
    }
  });
}

/* ================ Handler API (background & content) ================ */

/**
 * Register request handlers. Typically called in:
 *  - background: once (global router)
 *  - content: once per page (subset if needed)
 */
type Handler<K extends Kind> = (req: Extract<AnyReq, { type: K }>) => Promise<ResFor<K> | ErrorRes<K>>;

const handlers = new Map<Kind, Handler<any>>();

export function addHandler<K extends Kind>(type: K, fn: Handler<K>) {
  handlers.set(type, fn as Handler<any>);
}

export function removeHandler(type: Kind) {
  handlers.delete(type);
}

/**
 * Start listening on chrome.runtime.onMessage.
 * Safe to call multiple times (idempotent).
 */
let listening = false;
export function listen() {
  if (listening) return;
  listening = true;

  chrome.runtime.onMessage.addListener((msg: AnyReq, sender, sendResponse) => {
    // Only handle our protocol
    if (!msg || msg.v !== PROTOCOL_VERSION || !msg.type) return;

    const handler = handlers.get(msg.type as Kind);
    if (!handler) {
      sendResponse(
        errRes(msg as any, "NotFound", `No handler for ${msg.type as string}`),
      );
      return true;
    }

    // Attach inferred tabId if not provided
    if (!msg.tabId && sender.tab?.id) {
      (msg as any).tabId = sender.tab.id;
    }

    // Execute handler safely
    (async () => {
      try {
        const res = await handler(msg as any);
        sendResponse(res);
      } catch (e: any) {
        log.error(`Handler ${msg.type} threw`, e);
        sendResponse(
          errRes(msg as any, e?.code ?? "Internal", e?.message ?? "Internal error", e?.details),
        );
      }
    })();

    return true; // keep channel open for async sendResponse
  });

  log.info("Message bus listening");
}

/* ================ Convenience background senders ================ */

/** Broadcast to all tabs that have the content script. */
export async function broadcastToTabs<K extends Kind>(
  type: K,
  payload: BaseReq<K, any>["payload"],
  filter?: (tab: chrome.tabs.Tab) => boolean,
  timeoutMs = 10_000,
) {
  const tabs = await chrome.tabs.query({});
  const targets = tabs.filter((t) => t.id !== undefined && (!filter || filter(t)));

  const results = await Promise.allSettled(
    targets.map((t) =>
      send("background", type, payload, { tabId: t.id!, timeoutMs }),
    ),
  );

  return { targets: targets.length, results };
}
