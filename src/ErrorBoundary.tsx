import React from "react";

type Props = { children: React.ReactNode; fallback?: React.ReactNode };
type State = { error: unknown };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Surface hydration mistakes & other runtime errors
    console.error("[ErrorBoundary] error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {String(this.state.error)}
          </pre>
        )
      );
    }
    return this.props.children;
  }
}
