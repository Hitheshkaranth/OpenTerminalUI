import { ResponsiveContainer, Tooltip, Treemap } from "recharts";

type SectorTreemapProps = {
  data: Array<Record<string, unknown>>;
};

export function SectorTreemap({ data }: SectorTreemapProps) {
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <Treemap data={data} dataKey="value" nameKey="name" stroke="#2a2f3e" fill="#00e676">
          <Tooltip />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
