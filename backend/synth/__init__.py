"""Synthetic academic-paper generator used by tests and evaluation.

It typesets papers with known structure (two-column, equations, figures, tables, footnotes,
references) via reportlab and records ground truth next to the PDF. Real papers are not
available in the development environment; this is how parser quality is measured.
"""
