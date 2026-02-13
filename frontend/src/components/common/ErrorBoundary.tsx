import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || "Unknown runtime error" };
  }

  componentDidCatch(error: Error) {
    // Keep a console trace for debugging in browser devtools.
    // eslint-disable-next-line no-console
    console.error("UI runtime error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded border border-terminal-neg bg-terminal-panel p-4 text-sm text-terminal-neg">
          <div className="font-semibold">UI crashed while rendering this page.</div>
          <div className="mt-2 break-all">{this.state.message}</div>
          <div className="mt-3 text-terminal-muted">Refresh the page. If this persists, share this message.</div>
        </div>
      );
    }
    return this.props.children;
  }
}
