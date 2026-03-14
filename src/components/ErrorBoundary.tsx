"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Dashboard tab error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-xl p-6 border border-red-500/30 bg-red-500/10 text-sm">
          <p className="font-medium text-red-400 mb-2">
            Something went wrong rendering this section.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            {this.state.error?.message || "Unknown error"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
