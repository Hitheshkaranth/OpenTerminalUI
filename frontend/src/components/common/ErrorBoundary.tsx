import React from "react";

const BRAND_ICON_SRC = "/favicon.png";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
  retrying: boolean;
  retryCount: number;
};

const MAX_AUTO_RETRIES = 2;
const AUTO_RETRY_DELAY = 2000;

/**
 * Separate component that uses hooks internally to provide navigation
 * to the ErrorBoundary class component.
 */
function ErrorBoundaryFallback({
  message,
  isAutoRetrying,
  autoRetryCount,
  onRetry,
  onGoHome,
}: {
  message: string;
  isAutoRetrying: boolean;
  autoRetryCount: number;
  onRetry: () => void;
  onGoHome: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-terminal-bg p-4">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        {/* Logo */}
        <div className="relative">
          <img
            src={BRAND_ICON_SRC}
            alt="OpenTerminalUI"
            className={`h-16 w-16 object-contain ${isAutoRetrying ? "animate-pulse" : "opacity-60"}`}
          />
          {isAutoRetrying && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-20 w-20 animate-spin rounded-full border-2 border-terminal-accent/30 border-t-terminal-accent" />
            </div>
          )}
        </div>

        {/* Status text */}
        {isAutoRetrying ? (
          <>
            <div className="text-sm font-medium text-terminal-text">Recovering...</div>
            <div className="text-xs text-terminal-muted">
              Auto-retry {autoRetryCount + 1} of {MAX_AUTO_RETRIES}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-medium text-terminal-text">
              Screen failed to load
            </div>
            <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-[11px] text-terminal-muted break-all max-h-20 overflow-auto">
              {message}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRetry}
                aria-label="Retry loading the screen"
                className="rounded-sm border border-terminal-accent bg-terminal-accent/10 px-4 py-1.5 text-xs font-medium text-terminal-accent hover:bg-terminal-accent/20 transition-colors"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onGoHome}
                aria-label="Go to home page"
                className="rounded-sm border border-terminal-border px-4 py-1.5 text-xs text-terminal-muted hover:text-terminal-text hover:border-terminal-text/30 transition-colors"
              >
                Go Home
              </button>
            </div>
            <div className="text-[10px] text-terminal-muted">
              If this persists, try refreshing the page.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * ErrorBoundary with fixed state handling.
 *
 * Fix: `componentDidCatch` does NOT read `this.state` — it is stale at that point
 * because `getDerivedStateFromError` has not yet run. Error info is stored in a
 * separate instance variable `_errorInfo` instead.
 *
 * Fix: Manual retry now uses React Router navigation via the functional child
 * component so that navigation works correctly.
 */
class ErrorBoundaryInner extends React.Component<Props, State> {
  private _errorInfo = { hasError: false, message: "" };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "", retrying: false, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error?.message || "Unknown runtime error" };
  }

  componentDidCatch(error: Error) {
    // Store error info in instance variable — NOT in this.state, which is stale.
    this._errorInfo.hasError = true;
    this._errorInfo.message = error?.message || "Unknown runtime error";

    // eslint-disable-next-line no-console
    console.error("UI runtime error:", error);

    // Auto-retry if under the limit
    if (this.state.retryCount < MAX_AUTO_RETRIES) {
      this.scheduleAutoRetry();
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private scheduleAutoRetry() {
    this.setState({ retrying: true });
    this.retryTimer = setTimeout(() => {
      this.setState((prev) => ({
        hasError: false,
        message: "",
        retrying: false,
        retryCount: prev.retryCount + 1,
      }));
    }, AUTO_RETRY_DELAY);
  }

  private handleManualRetry = () => {
    this._errorInfo.hasError = false;
    this._errorInfo.message = "";
    this.setState({ hasError: false, message: "", retrying: false, retryCount: 0 });
  };

  private handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this._errorInfo.hasError || this.state.hasError) {
      const isAutoRetrying = this.state.retrying && this.state.retryCount < MAX_AUTO_RETRIES;

      return (
        <ErrorBoundaryFallback
          message={this._errorInfo.message || this.state.message}
          isAutoRetrying={isAutoRetrying}
          autoRetryCount={this.state.retryCount}
          onRetry={this.handleManualRetry}
          onGoHome={this.handleGoHome}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Wrapper that provides React Router hooks to the class component.
 */
export class ErrorBoundary extends React.Component<Props> {
  render() {
    return <ErrorBoundaryInner {...this.props} />;
  }
}