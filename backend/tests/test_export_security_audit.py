import csv
import io

import pytest
from openpyxl import load_workbook

from backend.core.export_engine import export_csv, export_excel
from backend.api.routes.export import _download_filename
from backend.screener.export import to_csv_bytes, to_xlsx_bytes


@pytest.mark.parametrize("payload", ["=1+1", "+SUM(1,1)", "-2+3", "@SUM(1)", "  =1", "\t=1", "\r=1", "\n=1"])
def test_spreadsheet_export_neutralizes_string_formulas(payload):
    csv_rows = list(csv.reader(io.StringIO(export_csv([{"note": payload, "amount": -12.5}]))))
    assert csv_rows[1][0] == "'" + payload
    assert csv_rows[1][1] == "-12.5"
    workbook = load_workbook(io.BytesIO(export_excel({"Research": [{"note": payload, "amount": -12.5}]})))
    assert workbook["Research"]["A2"].data_type == "s"
    assert workbook["Research"]["A2"].value == "'" + payload
    assert workbook["Research"]["B2"].value == -12.5


def test_export_keeps_regular_values_and_neutralizes_header_formulas():
    rows = list(csv.reader(io.StringIO(export_csv([{"=bad": "AAPL", "value": None}]))))
    assert rows == [["'=bad", "value"], ["AAPL", ""]]
    workbook = load_workbook(io.BytesIO(export_excel({"Data": [{"=bad": "AAPL"}]})))
    assert workbook["Data"]["A1"].data_type == "s"


def test_screener_exports_use_the_same_formula_boundary():
    rows = [{"label": "=1+1", "return": -2.5}]
    assert list(csv.reader(io.StringIO(to_csv_bytes(rows).decode())))[1] == ["'=1+1", "-2.5"]
    workbook = load_workbook(io.BytesIO(to_xlsx_bytes(rows)))
    assert workbook["Screener"]["A2"].data_type == "s"


def test_download_filename_cannot_inject_headers_or_change_content_type():
    filename = _download_filename('report.csv"\r\nX-Evil: yes.html', ".csv")
    assert all(character not in filename for character in ['"', "\r", "\n", ":", "/", "\\"])
    assert filename.endswith(".csv")
    assert len(filename) <= 124
