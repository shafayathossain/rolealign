import React from "react";
import { ClientOnly } from "./ClientOnly";

export function SafeTime() {
  // placeholder renders stable on server; real time only on client
  return (
    <ClientOnly placeholder={<span suppressHydrationWarning>—:—:—</span>}>
      {() => <span>{new Date().toLocaleTimeString()}</span>}
    </ClientOnly>
  );
}
