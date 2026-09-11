"""
Определение свойств матрицы.

Модуль анализирует матрицу и возвращает структуру MatrixProperties
с полным набором характеристик: квадратная, нулевая, единичная,
диагональная, треугольная, симметричная, ортогональная, вырожденная,
положительно определённая, идемпотентная, инволютивная, нильпотентная
и т.д.

Все проверки выполняются в точной арифметике SymPy. Для свойств,
требующих символьных вычислений (положительная определённость,
нильпотентность), используются соответствующие методы SymPy и
аккуратные проверки с ограничениями.

Модуль также предоставляет функцию сравнения двух матриц.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .validators import ValidationError, ensure_square


# =============================================================================
# Результат анализа
# =============================================================================

@dataclass
class MatrixProperties:
    """Полный набор характеристик матрицы.

    Каждое булево поле отвечает на вопрос «является ли матрица ...».
    Строковые поля (positive_definite, negative_definite) принимают
    значения 'yes', 'no', 'n/a' — чтобы явно различать «нет» и
    «не применимо».
    """

    # --- Базовые ---------------------------------------------------------------
    rows: int
    cols: int
    shape_label: str
    is_square: bool

    # --- Классификация по структуре -------------------------------------------
    is_zero: bool
    is_identity: bool
    is_diagonal: bool
    is_scalar: bool
    is_upper_triangular: bool
    is_lower_triangular: bool

    # --- Симметрии -------------------------------------------------------------
    is_symmetric: bool
    is_skew_symmetric: bool
    is_hermitian: bool
    is_orthogonal: bool
    is_unitary: bool

    # --- Вырожденность и спектр -----------------------------------------------
    is_singular: bool
    is_invertible: bool
    determinant: sp.Expr | None
    determinant_latex: str
    rank: int
    rank_label: str
    trace_value: sp.Expr | None
    trace_latex: str

    # --- Особые виды ----------------------------------------------------------
    is_idempotent: bool
    is_involutory: bool
    is_nilpotent: bool
    is_positive_definite: str
    is_negative_definite: str

    # --- Спектр (если есть) ---------------------------------------------------
    eigenvalues: list[tuple[sp.Expr, int]] = field(default_factory=list)
    eigenvalues_latex: list[str] = field(default_factory=list)

    # --- Дополнительно --------------------------------------------------------
    is_numeric: bool = True
    is_triangular: bool = False
    is_nilpotent_index: int | None = None  # минимальная k: A^k = 0

    # --- Готовый список «человеческих» выводов для шаблона --------------------
    summary: list[dict[str, Any]] = field(default_factory=list)


# =============================================================================
# Утилиты внутренние
# =============================================================================

def _all_zero(matrix: sp.Matrix) -> bool:
    return all(el == 0 for el in matrix)


def _is_diagonal(matrix: sp.Matrix) -> bool:
    rows, cols = matrix.shape
    return all(
        matrix[i, j] == 0
        for i in range(rows)
        for j in range(cols)
        if i != j
    )


def _is_upper(matrix: sp.Matrix) -> bool:
    rows, cols = matrix.shape
    return all(
        matrix[i, j] == 0
        for i in range(rows)
        for j in range(cols)
        if i > j
    )


def _is_lower(matrix: sp.Matrix) -> bool:
    rows, cols = matrix.shape
    return all(
        matrix[i, j] == 0
        for i in range(rows)
        for j in range(cols)
        if i < j
    )


def _is_scalar(matrix: sp.Matrix) -> bool:
    if not _is_diagonal(matrix):
        return False
    rows, cols = matrix.shape
    diag_vals = {matrix[i, i] for i in range(min(rows, cols))}
    return len(diag_vals) <= 1


def _is_identity(matrix: sp.Matrix) -> bool:
    rows, cols = matrix.shape
    if rows != cols:
        return False
    return matrix == sp.eye(rows)


def _is_symmetric(matrix: sp.Matrix) -> bool:
    if matrix.rows != matrix.cols:
        return False
    return sp.simplify(matrix - matrix.T) == sp.zeros(matrix.rows)


def _is_skew_symmetric(matrix: sp.Matrix) -> bool:
    if matrix.rows != matrix.cols:
        return False
    return sp.simplify(matrix + matrix.T) == sp.zeros(matrix.rows)


def _is_hermitian(matrix: sp.Matrix) -> bool:
    if matrix.rows != matrix.cols:
        return False
    return sp.simplify(matrix - matrix.H) == sp.zeros(matrix.rows)


def _is_orthogonal(matrix: sp.Matrix) -> bool:
    if matrix.rows != matrix.cols:
        return False
    try:
        product = sp.simplify(matrix.T * matrix)
        return product == sp.eye(matrix.rows)
    except Exception:  # noqa: BLE001
        return False


def _is_unitary(matrix: sp.Matrix) -> bool:
    if matrix.rows != matrix.cols:
        return False
    try:
        product = sp.simplify(matrix.H * matrix)
        return product == sp.eye(matrix.rows)
    except Exception:  # noqa: BLE001
        return False


def _is_idempotent(matrix: sp.Matrix) -> bool:
    if matrix.rows != matrix.cols:
        return False
    try:
        return sp.simplify(matrix * matrix - matrix) == sp.zeros(matrix.rows)
    except Exception:  # noqa: BLE001
        return False


def _is_involutory(matrix: sp.Matrix) -> bool:
    if matrix.rows != matrix.cols:
        return False
    try:
        return sp.simplify(matrix * matrix - sp.eye(matrix.rows)) == sp.zeros(matrix.rows)
    except Exception:  # noqa: BLE001
        return False


def _nilpotent_index(matrix: sp.Matrix) -> int | None:
    """Минимальная k: A^k = 0. None, если матрица не нильпотентна.

    Для нильпотентной матрицы n×n достаточно проверить k = 1..n
    (теорема о нильпотентном индексе).
    """
    if matrix.rows != matrix.cols:
        return None
    n = matrix.rows
    if n == 0:
        return None
    power = sp.eye(n)
    for k in range(1, n + 1):
        power = power * matrix
        if _all_zero(sp.simplify(power)):
            return k
    return None


def _positive_definite_status(matrix: sp.Matrix) -> tuple[str, str]:
    """Проверить положительную и отрицательную определённость.

    Возвращает (positive, negative) — каждая из строк:
        'yes' | 'no' | 'n/a'.

    Применимо только для симметричных вещественных матриц.
    """
    # Только для квадратных симметричных вещественных.
    if matrix.rows != matrix.cols:
        return "n/a", "n/a"
    if not _is_symmetric(matrix):
        return "n/a", "n/a"
    # Все элементы вещественные?
    for el in matrix:
        if el.is_real is False:
            return "n/a", "n/a"

    try:
        eigvals = matrix.eigenvals()
    except Exception:  # noqa: BLE001
        return "n/a", "n/a"

    # Разворачиваем с учётом кратностей.
    values: list[sp.Expr] = []
    for val, mult in eigvals.items():
        # Символьные значения — не можем сравнить точно.
        if val.free_symbols:
            return "n/a", "n/a"
        values.extend([val] * mult)

    if not values:
        return "n/a", "n/a"

    # Все > 0?
    all_pos = True
    all_neg = True
    for v in values:
        try:
            if not (v > 0):
                all_pos = False
        except TypeError:
            all_pos = False
        try:
            if not (v < 0):
                all_neg = False
        except TypeError:
            all_neg = False
        if not all_pos and not all_neg:
            return "no", "no"

    if all_pos:
        return "yes", "no"
    if all_neg:
        return "no", "yes"
    return "no", "no"


def _try_eigenvalues(matrix: sp.Matrix) -> list[tuple[sp.Expr, int]]:
    """Попытка вычислить собственные значения. Возвращает пустой список,
    если что-то не получилось."""
    if matrix.rows != matrix.cols:
        return []
    try:
        return list(matrix.eigenvals().items())
    except Exception:  # noqa: BLE001
        return []


# =============================================================================
# Основная функция анализа
# =============================================================================

def analyze(matrix: sp.Matrix, *, with_eigenvalues: bool = True) -> MatrixProperties:
    """Полный анализ свойств матрицы.

    Параметры:
        matrix           — sympy.Matrix для анализа;
        with_eigenvalues — вычислять ли собственные значения
                           (может быть дорого для больших матриц).
    """
    if matrix is None:
        raise ValidationError("Матрица не задана.", code="empty")

    rows, cols = matrix.shape
    is_square = rows == cols
    shape_label = f"{rows}×{cols}"

    # --- Базовые свойства -----------------------------------------------------
    is_zero = _all_zero(matrix)
    is_identity = _is_identity(matrix)
    is_diagonal = _is_diagonal(matrix)
    is_scalar = _is_scalar(matrix)
    is_upper = _is_upper(matrix)
    is_lower = _is_lower(matrix)

    # --- Симметрии ------------------------------------------------------------
    is_symmetric = _is_symmetric(matrix)
    is_skew = _is_skew_symmetric(matrix)
    is_hermitian = _is_hermitian(matrix)
    is_orthogonal = _is_orthogonal(matrix)
    is_unitary = _is_unitary(matrix)

    # --- Спектральные ---------------------------------------------------------
    determinant: sp.Expr | None = None
    trace_value: sp.Expr | None = None
    rank_value = matrix.rank()
    is_singular = False
    is_invertible = False

    if is_square:
        try:
            determinant = matrix.det()
        except Exception:  # noqa: BLE001
            determinant = None
        try:
            trace_value = matrix.trace()
        except Exception:  # noqa: BLE001
            trace_value = None
        if determinant is not None:
            is_singular = determinant == 0
            is_invertible = not is_singular

    rank_label = f"{rank_value} из {min(rows, cols)}"

    # --- Особые виды ----------------------------------------------------------
    is_idempotent = _is_idempotent(matrix)
    is_involutory = _is_involutory(matrix)
    nilpotent_idx = _nilpotent_index(matrix)
    is_nilpotent = nilpotent_idx is not None

    pos_def, neg_def = _positive_definite_status(matrix)

    # --- Собственные значения -------------------------------------------------
    eigenvalues: list[tuple[sp.Expr, int]] = []
    eigenvalues_latex: list[str] = []
    if with_eigenvalues and is_square:
        eigenvalues = _try_eigenvalues(matrix)
        eigenvalues_latex = [
            f"{sp.latex(val)}\\;(\\text{{кр. {mult}}})"
            for val, mult in eigenvalues
        ]

    # --- Проверка на числовость ----------------------------------------------
    is_numeric = all(not el.free_symbols for el in matrix)

    # --- Сводка для шаблона ---------------------------------------------------
    summary = _build_summary(
        shape_label=shape_label,
        is_square=is_square,
        is_zero=is_zero,
        is_identity=is_identity,
        is_diagonal=is_diagonal,
        is_scalar=is_scalar,
        is_upper=is_upper,
        is_lower=is_lower,
        is_symmetric=is_symmetric,
        is_skew=is_skew,
        is_hermitian=is_hermitian,
        is_orthogonal=is_orthogonal,
        is_unitary=is_unitary,
        is_singular=is_singular,
        is_invertible=is_invertible,
        is_idempotent=is_idempotent,
        is_involutory=is_involutory,
        is_nilpotent=is_nilpotent,
        pos_def=pos_def,
        neg_def=neg_def,
        determinant=determinant,
        rank_value=rank_value,
        trace_value=trace_value,
    )

    return MatrixProperties(
        rows=rows,
        cols=cols,
        shape_label=shape_label,
        is_square=is_square,
        is_zero=is_zero,
        is_identity=is_identity,
        is_diagonal=is_diagonal,
        is_scalar=is_scalar,
        is_upper_triangular=is_upper,
        is_lower_triangular=is_lower,
        is_symmetric=is_symmetric,
        is_skew_symmetric=is_skew,
        is_hermitian=is_hermitian,
        is_orthogonal=is_orthogonal,
        is_unitary=is_unitary,
        is_singular=is_singular,
        is_invertible=is_invertible,
        determinant=determinant,
        determinant_latex=sp.latex(determinant) if determinant is not None else "",
        rank=rank_value,
        rank_label=rank_label,
        trace_value=trace_value,
        trace_latex=sp.latex(trace_value) if trace_value is not None else "",
        is_idempotent=is_idempotent,
        is_involutory=is_involutory,
        is_nilpotent=is_nilpotent,
        is_positive_definite=pos_def,
        is_negative_definite=neg_def,
        eigenvalues=eigenvalues,
        eigenvalues_latex=eigenvalues_latex,
        is_numeric=is_numeric,
        is_triangular=is_upper or is_lower,
        is_nilpotent_index=nilpotent_idx,
        summary=summary,
    )


# =============================================================================
# Построение сводки для шаблона
# =============================================================================

def _build_summary(**kw: Any) -> list[dict[str, Any]]:
    """Сформировать список карточек «Название — Да/Нет/Значение»."""

    def yes_no(value: bool) -> str:
        return "Да" if value else "Нет"

    def yes_no_na(value: str) -> str:
        if value == "yes":
            return "Да"
        if value == "no":
            return "Нет"
        return "Не применимо"

    items: list[dict[str, Any]] = []

    # --- Базовые ---------------------------------------------------------------
    items.append({"label": "Размер", "value": kw["shape_label"], "kind": "info"})
    items.append({"label": "Квадратная", "value": yes_no(kw["is_square"]), "kind": "bool"})

    # --- Классификация ---------------------------------------------------------
    items.append({"label": "Нулевая", "value": yes_no(kw["is_zero"]), "kind": "bool"})
    if kw["is_square"]:
        items.append({"label": "Единичная", "value": yes_no(kw["is_identity"]), "kind": "bool"})

    items.append({"label": "Диагональная", "value": yes_no(kw["is_diagonal"]), "kind": "bool"})
    if kw["is_square"]:
        items.append({"label": "Скалярная", "value": yes_no(kw["is_scalar"]), "kind": "bool"})

    items.append(
        {"label": "Верхняя треугольная", "value": yes_no(kw["is_upper"]), "kind": "bool"}
    )
    items.append(
        {"label": "Нижняя треугольная", "value": yes_no(kw["is_lower"]), "kind": "bool"}
    )

    # --- Симметрии -------------------------------------------------------------
    if kw["is_square"]:
        items.append(
            {"label": "Симметричная", "value": yes_no(kw["is_symmetric"]), "kind": "bool"}
        )
        items.append(
            {"label": "Кососимметричная", "value": yes_no(kw["is_skew"]), "kind": "bool"}
        )
        items.append(
            {"label": "Эрмитова", "value": yes_no(kw["is_hermitian"]), "kind": "bool"}
        )
        items.append(
            {"label": "Ортогональная", "value": yes_no(kw["is_orthogonal"]), "kind": "bool"}
        )
        items.append(
            {"label": "Унитарная", "value": yes_no(kw["is_unitary"]), "kind": "bool"}
        )

    # --- Вырожденность и спектр -----------------------------------------------
    if kw["is_square"]:
        items.append(
            {"label": "Вырожденная", "value": yes_no(kw["is_singular"]), "kind": "bool"}
        )
        items.append(
            {"label": "Невырожденная", "value": yes_no(kw["is_invertible"]), "kind": "bool"}
        )
        items.append(
            {
                "label": "Положительно определённая",
                "value": yes_no_na(kw["pos_def"]),
                "kind": "bool",
            }
        )
        items.append(
            {
                "label": "Отрицательно определённая",
                "value": yes_no_na(kw["neg_def"]),
                "kind": "bool",
            }
        )

    # --- Особые виды ----------------------------------------------------------
    if kw["is_square"]:
        items.append(
            {"label": "Идемпотентная (A² = A)", "value": yes_no(kw["is_idempotent"]), "kind": "bool"}
        )
        items.append(
            {"label": "Инволютивная (A² = I)", "value": yes_no(kw["is_involutory"]), "kind": "bool"}
        )
        items.append(
            {"label": "Нильпотентная", "value": yes_no(kw["is_nilpotent"]), "kind": "bool"}
        )

    # --- Числовые --------------------------------------------------------------
    if kw["determinant"] is not None:
        items.append(
            {
                "label": "Определитель",
                "value": str(kw["determinant"]),
                "value_latex": sp.latex(kw["determinant"]),
                "kind": "number",
            }
        )
    items.append(
        {
            "label": "Ранг",
            "value": str(kw["rank_value"]),
            "kind": "number",
        }
    )
    if kw["trace_value"] is not None:
        items.append(
            {
                "label": "След",
                "value": str(kw["trace_value"]),
                "value_latex": sp.latex(kw["trace_value"]),
                "kind": "number",
            }
        )

    return items


# =============================================================================
# Сравнение двух матриц
# =============================================================================

def compare(a: sp.Matrix, b: sp.Matrix) -> dict[str, Any]:
    """Сравнить две матрицы.

    Возвращает словарь с результатами:
        shape_a, shape_b             — размеры;
        equal                        — A == B (совпадают поэлементно);
        equal_transpose              — A == Bᵀ;
        same_shape                   — размеры совпадают;
        similar                      — подобны (одинаковый характеристический
                                       многочлен, только для квадратных одного
                                       размера);
        properties_a, properties_b   — короткая сводка свойств.
    """
    result: dict[str, Any] = {
        "shape_a": (a.rows, a.cols),
        "shape_b": (b.rows, b.cols),
        "shape_a_label": f"{a.rows}×{a.cols}",
        "shape_b_label": f"{b.rows}×{b.cols}",
        "same_shape": a.shape == b.shape,
        "equal": False,
        "equal_transpose": False,
        "similar": False,
    }

    if a.shape == b.shape:
        try:
            result["equal"] = sp.simplify(a - b) == sp.zeros(*a.shape)
        except Exception:  # noqa: BLE001
            result["equal"] = a == b

    # A == Bᵀ
    try:
        if b.shape == (a.cols, a.rows):
            result["equal_transpose"] = sp.simplify(a - b.T) == sp.zeros(*a.shape)
    except Exception:  # noqa: BLE001
        result["equal_transpose"] = False

    # Подобие (только для квадратных одного размера).
    if a.shape == b.shape and a.rows == a.cols:
        try:
            lam = sp.symbols("lambda")
            char_a = sp.expand((a - lam * sp.eye(a.rows)).det())
            char_b = sp.expand((b - lam * sp.eye(b.rows)).det())
            result["similar"] = sp.simplify(char_a - char_b) == 0
        except Exception:  # noqa: BLE001
            result["similar"] = False

    # Краткие свойства для отображения.
    try:
        props_a = analyze(a, with_eigenvalues=False)
        props_b = analyze(b, with_eigenvalues=False)
        result["summary_a"] = {
            "rank": props_a.rank,
            "det": str(props_a.determinant) if props_a.determinant is not None else None,
            "trace": str(props_a.trace_value) if props_a.trace_value is not None else None,
        }
        result["summary_b"] = {
            "rank": props_b.rank,
            "det": str(props_b.determinant) if props_b.determinant is not None else None,
            "trace": str(props_b.trace_value) if props_b.trace_value is not None else None,
        }
    except Exception:  # noqa: BLE001
        result["summary_a"] = {}
        result["summary_b"] = {}

    return result