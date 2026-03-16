import "./ChartWorkstation.css";

interface Props {
  onClick: () => void;
}

export function AddChartPlaceholder({ onClick }: Props) {
  return (
    <button
      type="button"
      className="add-chart-placeholder"
      onClick={onClick}
      data-testid="add-chart-btn"
      aria-label="Add Chart"
    >
      <span className="flex flex-col items-center justify-center gap-1" data-testid="add-chart-placeholder">
        <span className="text-2xl font-thin leading-none">+</span>
        <span>Add Chart</span>
      </span>
    </button>
  );
}
