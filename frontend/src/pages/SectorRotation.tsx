import { SectorRotationMap } from "../components/analysis/SectorRotationMap";

export function SectorRotationPage() {
  return (
    <div className="h-full w-full p-4 overflow-hidden">
      <SectorRotationMap width="100%" height="100%" defaultBenchmark="SPY" />
    </div>
  );
}
