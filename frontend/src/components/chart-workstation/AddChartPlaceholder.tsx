import "./ChartWorkstation.css";

interface Props {
  onClick: () => void;
}

export function AddChartPlaceholder({ onClick }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="add-chart-placeholder"
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      data-testid="add-chart-placeholder"
    >
      <span className="text-2xl font-thin leading-none">+</span>
      <span>Add Chart</span>
    </div>
  );
}
