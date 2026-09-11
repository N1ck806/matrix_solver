"""
Безопасный парсер пользовательского ввода.

Преобразует строки вида "1/2", "-3.14", "sqrt(2)", "2+3i", "2*pi" в
sympy.Expr. НЕ использует eval() напрямую для произвольного Python-кода.

Многоуровневая защита:
    1. Тип: принимаем только str, int, float или уже готовый sympy.Expr.
    2. Regex: строка проверяется на допустимые символы.
    3. SymPy parse_expr с ограниченным global_dict (только встроенные
       имена SymPy — Integer, Float, Rational, Symbol) и local_dict
       (пользовательские функции: sqrt, sin, pi...).
    4. После парсинга проверяем, что выражение не содержит свободных
       символов (переменных).
    5. Проверяем отсутствие zoo и nan.

Поддерживаемые обозначения:
    Целые:            42, -7, 0
    Десятичные:       3.14, -0.5, .25
    Дроби:            1/2, -3/4, 22/7
    Корни:            sqrt(2), sqrt(3)/2
    Иррациональные:   pi, E, 2*pi
    Комплексные:      2+3i, 1-i, i (как мнимая единица)
    Функции:          sin, cos, tan, exp, log, ln, sinh, cosh, tanh,
                      asin, acos, atan, abs, re, im, conjugate
    Рациональные:     Rational(1, 3)
"""
from __future__ import annotations

import re
from typing import Any

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    rationalize,
    standard_transformations,
)

from .validators import ValidationError


# =============================================================================
# Разрешённый словарь имён и функций (local_dict)
# =============================================================================

_ALLOWED_NAMES: dict[str, Any] = {
    # --- Константы ---
    "pi": sp.pi,
    "E": sp.E,
    "I": sp.I,
    "i": sp.I,          # привычная запись мнимой единицы
    "oo": sp.oo,
    "inf": sp.oo,

    # --- Степени и корни ---
    "sqrt": sp.sqrt,
    "cbrt": sp.cbrt,
    "root": sp.root,

    # --- Экспонента и логарифм ---
    "exp": sp.exp,
    "log": sp.log,
    "ln": sp.log,
    "log10": lambda x: sp.log(x, 10),
    "log2": lambda x: sp.log(x, 2),

    # --- Тригонометрия ---
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
    "cot": sp.cot,
    "sec": sp.sec,
    "csc": sp.csc,
    "asin": sp.asin,
    "acos": sp.acos,
    "atan": sp.atan,
    "acot": sp.acot,

    # --- Гиперболические ---
    "sinh": sp.sinh,
    "cosh": sp.cosh,
    "tanh": sp.tanh,
    "coth": sp.coth,
    "asinh": sp.asinh,
    "acosh": sp.acosh,
    "atanh": sp.atanh,

    # --- Модуль и комплексная арифметика ---
    "abs": sp.Abs,
    "Abs": sp.Abs,
    "re": sp.re,
    "im": sp.im,
    "arg": sp.arg,
    "conjugate": sp.conjugate,
    "conj": sp.conjugate,

    # --- Разное ---
    "factorial": sp.factorial,
    "gamma": sp.gamma,
    "sign": sp.sign,
    "floor": sp.floor,
    "ceiling": sp.ceiling,
    "min": sp.Min,
    "max": sp.Max,
}


# =============================================================================
# Ограниченный global_dict — только встроенные имена SymPy
# =============================================================================
#
# Это критично: sympy_parser сам вставляет в код имена Integer, Float,
# Rational, Symbol во время трансформации. Если их не предоставить
# в global_dict, eval падает с NameError.
#
# Мы даём МИНИМУМ — то, что SymPy вставляет автоматически. Никакого
# доступа к __builtins__ или импортам.

_SYMPY_GLOBAL_NAMES: dict[str, Any] = {
    "Integer": sp.Integer,
    "Float": sp.Float,
    "Rational": sp.Rational,
    "Symbol": sp.Symbol,
    "Mul": sp.Mul,
    "Add": sp.Add,
    "Pow": sp.Pow,
    "Abs": sp.Abs,
    "S": sp.S,
}


# =============================================================================
# Преобразования
# =============================================================================
#
# standard_transformations — базовые (auto_symbol, auto_number, repeated_decimals)
# convert_xor              — "^" → "**"
# implicit_multiplication_application — "2pi" → "2*pi", "2(3)" → "2*(3)"
# rationalize              — "0.5" → Rational(1, 2), ".25" → Rational(1, 4)
#
# ВАЖНО: rationalize идёт последней, чтобы 0.5 → 1/2, а не Float(0.5).

_TRANSFORMS = (
    standard_transformations
    + (convert_xor, implicit_multiplication_application)
    + (rationalize,)
)

# Разрешённые символы в исходной строке (быстрая первичная защита).
_SAFE_CHARS = re.compile(r"^[0-9a-zA-Z_+\-*/^().,\s]+$")

# Максимальная длина входной строки.
_MAX_INPUT_LENGTH = 500


# =============================================================================
# Публичные функции
# =============================================================================

def parse_scalar(value: Any) -> sp.Expr:
    """Преобразовать значение в sympy.Expr.

    Принимает:
        • sympy.Expr — возвращает как есть;
        • int — оборачивает в sp.Integer;
        • float — переводит в рациональное через nsimplify;
        • str — парсит через SymPy.
    """
    # Уже SymPy — доверяем.
    if isinstance(value, sp.Basic):
        return value

    # None или пустая строка.
    if value is None:
        raise ValidationError("Пустое значение в ячейке матрицы.", code="empty")
    if isinstance(value, str) and not value.strip():
        raise ValidationError("Пустое значение в ячейке матрицы.", code="empty")

    # Целые и bool.
    if isinstance(value, bool):
        return sp.Integer(int(value))
    if isinstance(value, int):
        return sp.Integer(value)

    # Float — перевод в рациональное с сохранением значения.
    if isinstance(value, float):
        if value != value:  # NaN
            raise ValidationError("Значение NaN недопустимо.", code="nan")
        if value in (float("inf"), float("-inf")):
            raise ValidationError(
                "Бесконечное значение недопустимо.", code="inf"
            )
        return sp.nsimplify(value, rational=True)

    # Строка — основной путь.
    if isinstance(value, str):
        return _parse_string(value)

    raise ValidationError(
        f"Недопустимый тип значения: {type(value).__name__}.",
        code="bad_type",
    )


def parse_matrix(raw: Any) -> sp.Matrix:
    """Преобразовать двумерный список в точную матрицу SymPy."""
    if isinstance(raw, sp.MatrixBase):
        return sp.Matrix(raw)

    if raw is None:
        raise ValidationError("Матрица не задана.", code="empty")

    if not isinstance(raw, (list, tuple)):
        raise ValidationError(
            "Матрица должна быть двумерным массивом.", code="bad_type"
        )

    if len(raw) == 0:
        raise ValidationError("Матрица пуста.", code="empty")

    rows: list[list[sp.Expr]] = []
    expected_cols: int | None = None

    for i, row in enumerate(raw):
        if not isinstance(row, (list, tuple)):
            raise ValidationError(
                f"Строка {i + 1} не является списком.",
                code="bad_row",
            )
        if len(row) == 0:
            raise ValidationError(f"Строка {i + 1} пуста.", code="empty_row")
        if expected_cols is None:
            expected_cols = len(row)
        elif len(row) != expected_cols:
            raise ValidationError(
                f"Строка {i + 1} содержит {len(row)} элементов, "
                f"а предыдущие — {expected_cols}. "
                f"Все строки матрицы должны быть одинаковой длины.",
                code="ragged",
            )
        parsed_row = [parse_scalar(cell) for cell in row]
        rows.append(parsed_row)

    try:
        return sp.Matrix(rows)
    except Exception as exc:  # noqa: BLE001
        raise ValidationError(
            f"Не удалось собрать матрицу: {exc}", code="matrix_error"
        ) from exc


def parse_vector(raw: Any) -> sp.Matrix:
    """Преобразовать плоский или вложенный список в вектор-столбец."""
    if isinstance(raw, sp.MatrixBase):
        if raw.rows == 1 and raw.cols > 1:
            return raw.T
        return sp.Matrix(raw)

    if raw is None:
        raise ValidationError("Вектор не задан.", code="empty")

    if not isinstance(raw, (list, tuple)):
        raise ValidationError("Вектор должен быть списком.", code="bad_type")

    if len(raw) == 0:
        raise ValidationError("Вектор пуст.", code="empty")

    if all(not isinstance(item, (list, tuple)) for item in raw):
        values = [parse_scalar(item) for item in raw]
        return sp.Matrix(values)

    inner = raw[0]
    if isinstance(inner, (list, tuple)):
        if len(raw) == 1 and len(inner) > 1:
            return sp.Matrix([parse_scalar(x) for x in inner])
        if all(len(row) == 1 for row in raw):
            return sp.Matrix([parse_scalar(row[0]) for row in raw])
        flat: list[sp.Expr] = []
        for row in raw:
            for cell in row:
                flat.append(parse_scalar(cell))
        return sp.Matrix(flat)

    raise ValidationError("Не удалось распознать вектор.", code="bad_vector")


# =============================================================================
# Внутренняя логика парсинга строки
# =============================================================================

def _parse_string(text: str) -> sp.Expr:
    s = text.strip()

    if len(s) > _MAX_INPUT_LENGTH:
        raise ValidationError(
            f"Выражение слишком длинное (>{_MAX_INPUT_LENGTH} символов).",
            code="too_long",
        )

    # Юникодные минусы → обычный.
    s = s.replace("−", "-").replace("–", "-").replace("\u00a0", "")

    if not _SAFE_CHARS.match(s):
        raise ValidationError(
            f"Недопустимые символы в выражении: «{text}».",
            code="bad_chars",
        )

    try:
        expr = parse_expr(
            s,
            local_dict=_ALLOWED_NAMES,
            global_dict=_SYMPY_GLOBAL_NAMES,  # ← не пустой!
            transformations=_TRANSFORMS,
            evaluate=True,
        )
    except Exception as exc:  # noqa: BLE001
        raise ValidationError(
            f"Не удалось разобрать выражение «{text}»: {exc}",
            code="parse_error",
        ) from exc

    # Свободные символы запрещены.
    if expr.free_symbols:
        raise ValidationError(
            f"Выражение «{text}» содержит переменные. "
            f"Ввод должен быть числом или числовым выражением.",
            code="has_symbols",
        )

    # Комплексная бесконечность или NaN.
    if expr.has(sp.zoo):
        raise ValidationError(f"Выражение «{text}» не определено.", code="zoo")
    if expr.has(sp.nan):
        raise ValidationError(f"Выражение «{text}» содержит NaN.", code="nan")

    return expr