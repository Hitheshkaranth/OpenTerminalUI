# TASK: Build CSV/Excel Export Engine

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind frontend, FastAPI + SQLAlchemy backend. Various pages display data tables (screener, portfolio, watchlist, journal, alerts). API client in `frontend/src/api/client.ts`. Terminal dark theme. Tests: pytest + Playwright.

## What to Build

### Backend: `backend/core/export_engine.py`

```python
import csv
import io
from typing import Any

def export_csv(data: list[dict], columns: list[str] = None) -> str:
    """Export list of dicts to CSV string."""
    if not data:
        return ""
    columns = columns or list(data[0].keys())
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(data)
    return output.getvalue()

def export_excel(sheets: dict[str, list[dict]], filename: str = "export.xlsx") -> bytes:
    """Export multiple sheets to Excel bytes.
    sheets: {"Sheet Name": [rows]}
    Requires openpyxl.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    wb = Workbook()
    wb.remove(wb.active)

    for sheet_name, rows in sheets.items():
        ws = wb.create_sheet(title=sheet_name[:31])  # Excel 31 char limit
        if not rows:
            continue

        headers = list(rows[0].keys())

        # Header row
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1a1a2e", end_color="1a1a2e", fill_type="solid")
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col, value=header.replace("_", " ").title())
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

        # Data rows
        for row_idx, row_data in enumerate(rows, 2):
            for col_idx, header in enumerate(headers, 1):
                value = row_data.get(header)
                cell = ws.cell(row=row_idx, column=col_idx, value=value)
                # Format numbers
                if isinstance(value, float):
                    cell.number_format = '#,##0.00'

        # Auto-width columns
        for col in ws.columns:
            max_length = max(len(str(cell.value or "")) for cell in col)
            ws.column_dimensions[col[0].column_letter].width = min(max_length + 2, 40)

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()
```

Add `openpyxl` to `backend/requirements.txt`.

### Backend Routes: `backend/api/routes/export.py`

```
POST /api/export/csv
  Body: {source: "screener"|"portfolio"|"watchlist"|"journal"|"alerts", params: {...}}
  Returns: CSV file download (Content-Type: text/csv)

POST /api/export/excel
  Body: {source, params, sheets: ["holdings", "performance"]}  // optional multi-sheet
  Returns: Excel file download (Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
```

Source handling:
- `screener`: Re-run screener query with params, export results
- `portfolio`: Export holdings, optionally with performance and risk sheets
- `watchlist`: Export watchlist with current quotes
- `journal`: Export trade journal entries
- `alerts`: Export alert history

Register in `backend/main.py`.

### Frontend: `frontend/src/components/common/ExportButton.tsx`

Reusable export dropdown button:

```typescript
interface ExportButtonProps {
  source: "screener" | "portfolio" | "watchlist" | "journal" | "alerts";
  params?: Record<string, any>;
  filename?: string;
  disabled?: boolean;
}
```

- Dropdown button with icon (ArrowDownTrayIcon from Heroicons)
- Options: "CSV" | "Excel" | "Copy to Clipboard"
- CSV: calls `/api/export/csv`, triggers file download
- Excel: calls `/api/export/excel`, triggers file download
- Clipboard: fetches data as JSON, converts to tab-separated string, copies to clipboard
- Loading state while export processes
- Small/compact variant for toolbars

### Frontend: File Download Helper

```typescript
// frontend/src/utils/download.ts
export async function downloadFile(url: string, body: any, filename: string) {
  const response = await api.post(url, body, { responseType: "blob" });
  const blob = new Blob([response.data]);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
```

### Integration: Add ExportButton to Existing Pages

Add `<ExportButton>` to these pages (in their toolbar/action area):

1. `frontend/src/pages/Screener.tsx` — export screener results
2. `frontend/src/pages/Portfolio.tsx` — export holdings
3. `frontend/src/pages/Watchlist.tsx` — export watchlist
4. `frontend/src/pages/Alerts.tsx` — export alert history
5. `frontend/src/pages/TradeJournalPage.tsx` (if exists from Wave 1) — export journal

### Tests

**Backend** (`backend/tests/test_export.py`):
```python
# Test CSV export produces valid CSV with headers
# Test Excel export produces valid .xlsx bytes
# Test POST /api/export/csv?source=watchlist returns CSV file
# Test POST /api/export/excel?source=portfolio returns Excel file
# Test empty data exports without error
# Test multi-sheet Excel has correct sheet names
```

**E2E** (`frontend/tests/export.spec.ts`):
```typescript
// Navigate to /equity/screener
// Run a basic screen
// Click Export button, select CSV
// Verify file download initiated (check downloads folder or mock)
// Click Export button, select "Copy to Clipboard"
// Verify clipboard contains data
```
