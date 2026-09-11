"""
Утилиты для вывода матриц и выражений в LaTeX (для MathJax).

Все функции возвращают готовые строки LaTeX без обёртки $$ — обёртку
добавляет шаблон или JavaScript.

Основные функции:
    matrix_to_latex(m, bracket, augment)   — матрица в LaTeX
    matrix_to_plain(m)                     — текстовое представление
    expr_to_latex(e)                       — выражение в LaTeX
    steps_to_latex(steps)                  — список шагов
    vector_to_latex(v)                     — вектор-столбец
    format_scalar(value)                   — аккуратное число
"""
from __future__ import annotations

from typing import Protocol

import sympy as sp
from sympy.printing.latex import LatexPrinter


# =============================================================================
# Настройка принтера
# =============================================================================

class _MatrixLabLatexPrinter(LatexPrinter):
    """Принтер LaTeX с настройками, подходящими для математики.

    Используем только те настройки, которые гарантированно поддерживаются
    SymPy 1.13.x. Список допустимых ключей берётся из класса LatexPrinter
    (см. sympy/printing/latex.py, метод __init__ через Printer).
    """

    def __init__(self) -> None:
        super().__init__(
            settings={
                # Матрицы в квадратных скобках по умолчанию.
                "mat_str": "bmatrix",
                # Разделитель для матриц — круглые скобки.
                "mat_delim": "(",
                # Символ умножения: \cdot вместо пробела.
                "mul_symbol": "dot",
                # ln(x) вместо log(x).
                "ln_notation": True,
                # Не разворачивать короткие дроби в a/b.
                "fold_short_frac": False,
                # Не разворачивать дробные степени в корни.
                "fold_frac_powers": False,
                # Использовать √ для корней.
                "root_notation": True,
                # Мнимая единица — i (не \mathrm{i}).
                "imaginary_unit": "i",
                # Обратные тригонометрические функции: arcsin вместо sin^{-1}.
                "inv_trig_style": "abbreviated",
            }
        )


_LATEX_PRINTER = _MatrixLabLatexPrinter()


def _latex(expr: sp.Basic) -> str:
    return _LATEX_PRINTER.doprint(expr)


# =============================================================================
# Матрицы
# =============================================================================

_BRACKETS: dict[str, tuple[str, str]] = {
    "bmatrix": ("\\begin{bmatrix}", "\\end{bmatrix}"),
    "pmatrix": ("\\begin{pmatrix}", "\\end{pmatrix}"),
    "vmatrix": ("\\begin{vmatrix}", "\\end{vmatrix}"),
    "Vmatrix": ("\\begin{Vmatrix}", "\\end{Vmatrix}"),
    "Bmatrix": ("\\begin{Bmatrix}", "\\end{Bmatrix}"),
    "matrix":  ("\\begin{matrix}",  "\\end{matrix}"),
    "cases":   ("\\begin{cases}",   "\\end{cases}"),
    "array":   ("\\begin{array}",   "\\end{array}"),
}

_DEFAULT_BRACKET = "bmatrix"


def matrix_to_latex(
    matrix: sp.MatrixBase,
    bracket: str = _DEFAULT_BRACKET,
    augment: int | None = None,
) -> str:
    """Преобразовать матрицу в LaTeX.

    Параметры:
        matrix  — sympy.Matrix;
        bracket — тип скобок: bmatrix, pmatrix, vmatrix и т.п.;
        augment — если задано, рисует вертикальную разделительную линию
                  после указанного столбца (для расширенных матриц
                  [A | b] в СЛАУ).
    """
    if matrix is None:
        return ""

    env_open, env_close = _BRACKETS.get(bracket, _BRACKETS[_DEFAULT_BRACKET])

    n_rows = matrix.rows
    n_cols = matrix.cols

    # Специально для array с выравниванием.
    if bracket == "array":
        spec = "c" * n_cols
        if augment is not None and 0 < augment < n_cols:
            spec = "c" * augment + "|" + "c" * (n_cols - augment)
        lines: list[str] = [f"\\begin{{array}}{{{spec}}}"]
        for i in range(n_rows):
            row_cells = [_latex(matrix[i, j]) for j in range(n_cols)]
            lines.append(" & ".join(row_cells) + " \\\\")
        lines.append("\\end{array}")
        return "\n".join(lines)

    # Расширенная матрица — используем array даже если запрошен bmatrix.
    if augment is not None and 0 < augment < n_cols:
        spec = "c" * augment + "|" + "c" * (n_cols - augment)
        lines = [f"\\left[\\begin{{array}}{{{spec}}}"]
        for i in range(n_rows):
            row_cells = [_latex(matrix[i, j]) for j in range(n_cols)]
            lines.append(" & ".join(row_cells) + " \\\\")
        lines.append("\\end{array}\\right]")
        return "\n".join(lines)

    # Обычная матрица.
    rows_latex: list[str] = []
    for i in range(n_rows):
        row_cells = [_latex(matrix[i, j]) for j in range(n_cols)]
        rows_latex.append(" & ".join(row_cells))
    body = " \\\\ ".join(rows_latex)
    return f"{env_open}{body}{env_close}"


def matrix_to_plain(matrix: sp.MatrixBase, separator: str = "  ") -> str:
    """Простое текстовое представление матрицы.

    Используется для экспорта в TXT и для fallback-отображения.
    """
    if matrix is None:
        return ""

    # Вычислим ширину столбцов для выравнивания.
    str_cells: list[list[str]] = []
    for i in range(matrix.rows):
        row = [str(matrix[i, j]) for j in range(matrix.cols)]
        str_cells.append(row)

    col_widths = [
        max(len(str_cells[i][j]) for i in range(matrix.rows))
        for j in range(matrix.cols)
    ]

    lines: list[str] = []
    for row in str_cells:
        line = separator.join(
            cell.ljust(col_widths[j]) for j, cell in enumerate(row)
        )
        lines.append(line)
    return "\n".join(lines)


def matrix_to_latex_with_brackets(
    matrix: sp.MatrixBase,
    left: str = "[",
    right: str = "]",
    variable: str = "",
) -> str:
    """Матрица с указанными скобками и необязательной меткой.

    Например, `A = [1 2; 3 4]` в LaTeX.
    """
    body = matrix_to_latex(matrix, bracket="matrix")
    label = f"{variable} = " if variable else ""
    return f"{label}\\left{left} {body} \\right{right}"


# =============================================================================
# Векторы
# =============================================================================

def vector_to_latex(vector: sp.MatrixBase, as_column: bool = True) -> str:
    """Вектор в LaTeX: столбец (по умолчанию) или строка."""
    if vector is None:
        return ""
    if as_column and vector.rows == 1 and vector.cols > 1:
        vector = vector.T
    return matrix_to_latex(vector, bracket="bmatrix")


# =============================================================================
# Выражения
# =============================================================================

def expr_to_latex(expr: sp.Basic) -> str:
    """Выражение SymPy в LaTeX."""
    if expr is None:
        return ""
    return _latex(expr)


def polynomial_to_latex(poly: sp.Poly | sp.Expr, var: str = "\\lambda") -> str:
    """Многочлен в человекочитаемом виде, убывающие степени.

    Например, для p(λ) = λ³ − 2λ + 5.
    """
    if isinstance(poly, sp.Poly):
        expr = poly.as_expr()
    else:
        expr = poly
    # SymPy сам упорядочит по убыванию, если использовать expanded.
    return _latex(sp.expand(expr))


def equation_to_latex(lhs: sp.Basic, rhs: sp.Basic) -> str:
    """Уравнение lhs = rhs в LaTeX."""
    return f"{_latex(lhs)} = {_latex(rhs)}"


# =============================================================================
# Числа
# =============================================================================

def format_scalar(value: sp.Basic, decimal: bool = False, precision: int = 6) -> str:
    """Аккуратное строковое представление скаляра.

    decimal=True — вывести в виде десятичного числа с заданной точностью,
    что удобно для больших иррациональных результатов.

    Для точных значений (Rational, sqrt) decimal=False даёт точный вывод.
    """
    if value is None:
        return ""

    if decimal and not value.free_symbols:
        try:
            return f"{sp.N(value, precision)}"
        except Exception:  # noqa: BLE001
            return str(value)

    return str(value)


def scalar_to_latex(value: sp.Basic, decimal: bool = False, precision: int = 6) -> str:
    """Скаляр в LaTeX, с опциональным десятичным представлением."""
    if value is None:
        return ""
    if decimal and not value.free_symbols:
        try:
            return _latex(sp.N(value, precision))
        except Exception:  # noqa: BLE001
            return _latex(value)
    return _latex(value)


# =============================================================================
# Пошаговые решения
# =============================================================================

class StepLike(Protocol):
    """Протокол для шага решения (совместим с объектами step_solver)."""
    title: str
    formula: object
    comment: str


def step_to_latex(step: object) -> str:
    """Один шаг в LaTeX.

    Шаг может быть:
        • строкой (обычный текст, выводится как \\text{...});
        • парой (lhs, rhs) — уравнение;
        • sympy-выражением;
        • объектом с атрибутами title, formula, comment.
    """
    if step is None:
        return ""

    if isinstance(step, str):
        # Экранируем LaTeX-спецсимволы и оборачиваем в \text.
        return f"\\text{{{_escape_text(step)}}}"

    if isinstance(step, tuple) and len(step) == 2:
        return equation_to_latex(step[0], step[1])

    if isinstance(step, sp.Basic):
        return _latex(step)

    # Объект с полями title/formula/comment.
    title = getattr(step, "title", "")
    formula = getattr(step, "formula", None)
    comment = getattr(step, "comment", "")

    parts: list[str] = []
    if title:
        parts.append(f"\\text{{{_escape_text(str(title))}}}")
    if formula is not None:
        if isinstance(formula, sp.Basic):
            parts.append(_latex(formula))
        else:
            parts.append(str(formula))
    if comment:
        parts.append(f"\\text{{{_escape_text(str(comment))}}}")

    return " \\quad ".join(parts)


def steps_to_latex(steps: list) -> list[str]:
    """Список шагов в список LaTeX-строк."""
    return [step_to_latex(s) for s in steps]


# =============================================================================
# Служебное
# =============================================================================

_LATEX_ESCAPES = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    "$": "\\$",
    "#": "\\#",
    "_": "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
}


def _escape_text(text: str) -> str:
    """Экранировать спецсимволы LaTeX в текстовых пояснениях."""
    for char, repl in _LATEX_ESCAPES.items():
        text = text.replace(char, repl)
    return text