import { LaunchpadProvider } from "../components/layout/LaunchpadContext";
import { LaunchpadWorkspace } from "../components/layout/LaunchpadWorkspace";

export function LaunchpadPage() {
  return (
    <LaunchpadProvider>
      <div className="h-full min-h-0">
        <LaunchpadWorkspace />
      </div>
    </LaunchpadProvider>
  );
}
