import { Outlet } from "react-router-dom";

import { TerminalShell } from "../components/layout/TerminalShell";

export function AccountLayout() {
  return (
    <TerminalShell
      hideTickerLoader
      statusBarTickerOverride="ACCOUNT"
      contentClassName="pb-16 md:pb-0"
      showInstallPrompt
      showMobileBottomNav
      hideSidebarOnMobile
      workspacePresetStorageKey="ot:shell:account:preset"
    >
      <Outlet />
    </TerminalShell>
  );
}
