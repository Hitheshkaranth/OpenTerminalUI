import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth, type AuthRole } from "../contexts/AuthContext";

export function ProtectedRoute({ children, requiredRole }: { children: ReactElement; requiredRole?: AuthRole }) {
  const { isAuthenticated, hasRole, isInitializing } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requiredRole && !hasRole(requiredRole)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
