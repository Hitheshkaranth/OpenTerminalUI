import { useEffect } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../contexts/AuthContext";

/**
 * Root path policy: the public marketing landing (served statically from
 * `public/landing/`, outside the SPA) is the default page for guests, while
 * authenticated users are taken straight into the app at `/home`.
 */
export function RootRedirect() {
  const { isAuthenticated, isInitializing } = useAuth();

  useEffect(() => {
    if (!isInitializing && !isAuthenticated) {
      // Full-page navigation out of the SPA to the static landing site.
      window.location.replace("/landing/");
    }
  }, [isInitializing, isAuthenticated]);

  if (isInitializing) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <div className="rounded-sm border border-terminal-border bg-terminal-panel px-4 py-3 text-xs text-terminal-muted">
          Restoring workspace...
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }

  // Guests: the effect kicks off the redirect to the static landing; render
  // nothing in the brief interim.
  return null;
}
