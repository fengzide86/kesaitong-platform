"""Encode untrusted CSV text without creating spreadsheet formulas."""

import csv
import io
from collections.abc import Iterable


def csv_text(value: object) -> object:
    # Keep actual numbers (including negative Decimal values) numeric. Only
    # text is escaped; quoting alone does not prevent Excel formula execution.
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def csv_row(values: Iterable[object]) -> str:
    output = io.StringIO(newline="")
    csv.writer(output).writerow(csv_text(value) for value in values)
    return output.getvalue()
