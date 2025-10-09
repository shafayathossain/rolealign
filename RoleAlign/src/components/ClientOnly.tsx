import React from "react";

/**
 * Use to render values that depend on browser-only state (Date.now, localStorage, UA, etc.)
 * During SSR/first paint, it renders a stable placeholder to avoid hydration mismatches.
 */
export function ClientOnly({
  placeholder = null,
  children,
}: {
  placeholder?: React.ReactNode;
  children: React.ReactNode | (() => React.ReactNode);
}) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  if (!ready) return <>{placeholder}</>;
  return <>{typeof children === "function" ? (children as any)() : children}</>;
}
