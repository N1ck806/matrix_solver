"""
Операции над матрицами. Точные вычисления через SymPy.

Структура:
    1.  Контейнер OperationResult
    2.  Базовые операции (add, subtract, multiply, ...)
    3.  Цепочки N матриц (add_chain, multiply_chain)
    4.  Свойства (determinant, trace, rank, inverse, ...)
    5.  Миноры и кофакторы
    6.  Формы приведения (rref, echelon)
    7.  Утилиты (identity, zero, ones)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .latex_utils import matrix_to_latex, scalar_to_latex
from .validators import (
    ValidationError,
    check_size,
    ensure_chain_addable,
    ensure_chain_multiplicable,
    ensure_multiplicable,
    ensure_nonzero_det,
    ensure_power_range,
    ensure_same_shape,
    ensure_square,
    ensure_symbolic_ok,
)


# =============================================================================
# 1. КОНТЕЙНЕР
# =============================================================================

@dataclass
class OperationResult:
    """Универсальный результат операции над матрицами."""

    kind: str = "matrix"
    result: Any = None
    latex: str = ""
    plain: str = ""
    explanation: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.result is None:
            return

        if not self.latex:
            if self.kind == "matrix" and isinstance(self.result, sp.MatrixBase):
                self.latex = matrix_to_latex(self.result, bracket="bmatrix")
            elif self.kind == "scalar" and isinstance(self.result, sp.Basic):
                self.latex = scalar_to_latex(self.result)

        if not self.plain:
            if self.kind == "matrix" and isinstance(self.result, sp.MatrixBase):
                self.plain = sp.pretty(self.result)
            elif self.kind == "scalar" and isinstance(self.result, sp.Basic):
                self.plain = str(self.result)
            else:
                self.plain = str(self.result)


# =============================================================================
# 2. БАЗОВЫЕ ОПЕРАЦИИ
# =============================================================================

def add(a: sp.Matrix, b: sp.Matrix) -> OperationResult:
    """A + B."""
    check_size(a)
    check_size(b)
    ensure_same_shape(a, b)

    result = a + b
    return OperationResult(
        kind="matrix",
        result=result,
        explanation="Сложение матриц: (A + B)ᵢⱼ = aᵢⱼ + bᵢⱼ.",
        extra={"shape": (result.rows, result.cols)},
    )


def subtract(a: sp.Matrix, b: sp.Matrix) -> OperationResult:
    """A − B."""
    check_size(a)
    check_size(b)
    ensure_same_shape(a, b)

    result = a - b
    return OperationResult(
        kind="matrix",
        result=result,
        explanation="Вычитание матриц: (A − B)ᵢⱼ = aᵢⱼ − bᵢⱼ.",
        extra={"shape": (result.rows, result.cols)},
    )


def multiply(a: sp.Matrix, b: sp.Matrix) -> OperationResult:
    """A × B."""
    check_size(a)
    check_size(b)
    ensure_multiplicable(a, b)

    result = a * b
    return OperationResult(
        kind="matrix",
        result=result,
        explanation=(
            f"Умножение матриц: (A·B)ᵢⱼ = Σₖ aᵢₖ · bₖⱼ. "
            f"Размер результата: {result.rows}×{result.cols}."
        ),
        extra={
            "shape": (result.rows, result.cols),
            "inner_dimension": a.cols,
        },
    )


def scalar_multiply(matrix: sp.Matrix, k: sp.Expr) -> OperationResult:
    """kA."""
    check_size(matrix)
    if not isinstance(k, sp.Basic):
        k = sp.sympify(k)

    result = matrix * k
    return OperationResult(
        kind="matrix",
        result=result,
        explanation=f"Умножение матрицы на скаляр k = {k}: (kA)ᵢⱼ = k · aᵢⱼ.",
        extra={"scalar": k, "shape": (result.rows, result.cols)},
    )


def transpose(matrix: sp.Matrix) -> OperationResult:
    """Aᵀ."""
    check_size(matrix)
    result = matrix.T
    return OperationResult(
        kind="matrix",
        result=result,
        explanation=(
            f"Транспонирование: строки становятся столбцами. "
            f"Размер изменился с {matrix.rows}×{matrix.cols} "
            f"на {result.rows}×{result.cols}."
        ),
        extra={
            "original_shape": (matrix.rows, matrix.cols),
            "shape": (result.rows, result.cols),
        },
    )


def conjugate_transpose(matrix: sp.Matrix) -> OperationResult:
    """A* — эрмитово сопряжение."""
    check_size(matrix)
    result = matrix.H
    return OperationResult(
        kind="matrix",
        result=result,
        explanation=(
            "Сопряжённое транспонирование: (A*)ᵢⱼ = conj(aⱼᵢ). "
            "Для вещественных матриц совпадает с обычным транспонированием."
        ),
        extra={
            "original_shape": (matrix.rows, matrix.cols),
            "shape": (result.rows, result.cols),
        },
    )


def power(matrix: sp.Matrix, k: int) -> OperationResult:
    """A^k."""
    check_size(matrix)
    ensure_square(matrix)
    ensure_power_range(k)

    if k == 0:
        result = sp.eye(matrix.rows)
        explanation = "A⁰ = I — единичная матрица того же порядка."
    elif k > 0:
        result = matrix ** k
        explanation = f"Матрица A возведена в степень {k}."
    else:
        ensure_nonzero_det(matrix)
        result = matrix.inv() ** (-k)
        explanation = (
            f"A^({k}) = (A⁻¹)^{abs(k)} — "
            f"отрицательная степень через обратную матрицу."
        )

    return OperationResult(
        kind="matrix",
        result=result,
        explanation=explanation,
        extra={"power": k, "shape": (result.rows, result.cols)},
    )


# =============================================================================
# 3. ЦЕПОЧКИ N МАТРИЦ
# =============================================================================

def add_chain(matrices: list[sp.Matrix]) -> OperationResult:
    """A₁ + A₂ + ... + Aₙ — сумма N матриц одного размера."""
    ensure_chain_addable(matrices)

    result = matrices[0].copy()
    for m in matrices[1:]:
        result = result + m

    n = len(matrices)
    return OperationResult(
        kind="matrix",
        result=result,
        explanation=(
            f"Сложение {n} матриц одного размера: "
            f"результат получается поэлементным суммированием."
        ),
        extra={
            "count": n,
            "shape": (result.rows, result.cols),
        },
    )


def multiply_chain(matrices: list[sp.Matrix]) -> OperationResult:
    """A₁ · A₂ · ... · Aₙ — произведение N матриц.

    Внутренние размеры должны быть согласованы:
        A₁ (m×n) · A₂ (n×p) · A₃ (p×q) · ...
    """
    ensure_chain_multiplicable(matrices)

    result = matrices[0].copy()
    for m in matrices[1:]:
        result = result * m

    n = len(matrices)
    return OperationResult(
        kind="matrix",
        result=result,
        explanation=(
            f"Произведение {n} матриц с согласованными размерами. "
            f"Итоговый размер: {result.rows}×{result.cols}."
        ),
        extra={
            "count": n,
            "shape": (result.rows, result.cols),
            "shapes": [(m.rows, m.cols) for m in matrices],
        },
    )


# =============================================================================
# 4. СВОЙСТВА
# =============================================================================

def determinant(matrix: sp.Matrix) -> OperationResult:
    """det(A)."""
    check_size(matrix)
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)

    det = matrix.det()
    return OperationResult(
        kind="scalar",
        result=det,
        explanation="Определитель квадратной матрицы.",
        extra={
            "shape": (matrix.rows, matrix.cols),
            "is_zero": det == 0,
            "is_singular": det == 0,
        },
    )


def trace(matrix: sp.Matrix) -> OperationResult:
    """tr(A)."""
    check_size(matrix)
    ensure_square(matrix)

    diag = [matrix[i, i] for i in range(matrix.rows)]
    tr = matrix.trace()

    return OperationResult(
        kind="scalar",
        result=tr,
        explanation="След — сумма элементов главной диагонали: tr(A) = Σ aᵢᵢ.",
        extra={
            "diagonal": diag,
            "diagonal_latex": [scalar_to_latex(d) for d in diag],
            "n": matrix.rows,
        },
    )


def rank(matrix: sp.Matrix) -> OperationResult:
    """rank(A)."""
    check_size(matrix)
    ensure_symbolic_ok(matrix)

    r = matrix.rank()
    return OperationResult(
        kind="scalar",
        result=sp.Integer(r),
        explanation=(
            f"Ранг — максимальное число линейно независимых строк "
            f"(или столбцов). Ранг не превосходит min({matrix.rows}, "
            f"{matrix.cols}) = {min(matrix.rows, matrix.cols)}."
        ),
        extra={
            "shape": (matrix.rows, matrix.cols),
            "max_possible": min(matrix.rows, matrix.cols),
            "is_full_rank": r == min(matrix.rows, matrix.cols),
        },
    )


def inverse(matrix: sp.Matrix) -> OperationResult:
    """A⁻¹ через присоединённую."""
    check_size(matrix)
    ensure_square(matrix)
    ensure_nonzero_det(matrix)
    ensure_symbolic_ok(matrix)

    det = matrix.det()
    adj = matrix.adjugate()
    inv = matrix.inv()

    check = (matrix * inv).applyfunc(sp.simplify)
    identity = sp.eye(matrix.rows)
    check_ok = check == identity

    return OperationResult(
        kind="matrix",
        result=inv,
        explanation=(
            "Обратная матрица: A⁻¹ = (1/det(A)) · adj(A). "
            "Проверка A·A⁻¹ = I выполнена."
        ),
        extra={
            "determinant": det,
            "determinant_latex": scalar_to_latex(det),
            "adjugate": adj,
            "adjugate_latex": matrix_to_latex(adj),
            "check": check,
            "check_latex": matrix_to_latex(check),
            "check_ok": check_ok,
            "shape": (matrix.rows, matrix.cols),
        },
    )


def inverse_gauss_jordan(matrix: sp.Matrix) -> OperationResult:
    """A⁻¹ методом Гаусса-Жордана."""
    check_size(matrix)
    ensure_square(matrix)
    ensure_nonzero_det(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows
    identity = sp.eye(n)
    aug = matrix.row_join(identity)
    aug_rref, pivots = aug.rref()

    inv = aug_rref[:, n:]
    check = (matrix * inv).applyfunc(sp.simplify)
    check_ok = check == sp.eye(n)

    return OperationResult(
        kind="matrix",
        result=inv,
        explanation=(
            "Обратная матрица методом Гаусса-Жордана. "
            "Расширенная матрица [A | I] приведена к [I | A⁻¹]."
        ),
        extra={
            "augmented": aug,
            "augmented_latex": matrix_to_latex(aug, augment=n),
            "rref": aug_rref,
            "rref_latex": matrix_to_latex(aug_rref, augment=n),
            "pivots": [p + 1 for p in pivots],
            "check": check,
            "check_ok": check_ok,
            "shape": (n, n),
        },
    )


# =============================================================================
# 5. МИНОРЫ И КОФАКТОРЫ
# =============================================================================

def minors(matrix: sp.Matrix, i: int, j: int) -> OperationResult:
    """Минор Mᵢⱼ и алгебраическое дополнение Aᵢⱼ (индексы 1-based)."""
    check_size(matrix)
    ensure_square(matrix)

    n = matrix.rows
    if not (1 <= i <= n and 1 <= j <= n):
        raise ValidationError(
            f"Индексы должны быть в диапазоне от 1 до {n}. "
            f"Получено: i = {i}, j = {j}.",
            code="bad_index",
        )

    i0, j0 = i - 1, j - 1

    if n == 1:
        minor_matrix = sp.Matrix([[sp.Integer(1)]])
        minor_value = sp.Integer(1)
    else:
        minor_matrix = matrix.minor_submatrix(i0, j0)
        minor_value = minor_matrix.det()

    sign = (-1) ** (i + j)
    cofactor = sign * minor_value

    return OperationResult(
        kind="scalar",
        result=cofactor,
        explanation=(
            f"Минор M{i}{j} — определитель матрицы, полученной удалением "
            f"строки {i} и столбца {j}. "
            f"Алгебраическое дополнение A{i}{j} = (−1)^({i}+{j}) · M{i}{j}."
        ),
        extra={
            "row": i,
            "col": j,
            "minor_matrix": minor_matrix,
            "minor_matrix_latex": matrix_to_latex(minor_matrix, bracket="vmatrix"),
            "minor_value": minor_value,
            "minor_value_latex": scalar_to_latex(minor_value),
            "sign": sign,
            "cofactor": cofactor,
            "cofactor_latex": scalar_to_latex(cofactor),
        },
    )


def cofactor_matrix(matrix: sp.Matrix) -> OperationResult:
    """Матрица алгебраических дополнений C(A)."""
    check_size(matrix)
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows
    cof = sp.Matrix(n, n, lambda i, j: ((-1) ** (i + j)) * matrix.minor(i, j))

    return OperationResult(
        kind="matrix",
        result=cof,
        explanation="Матрица алгебраических дополнений: Cᵢⱼ = (−1)^(i+j) · Mᵢⱼ.",
        extra={"shape": (n, n)},
    )


def adjugate(matrix: sp.Matrix) -> OperationResult:
    """Присоединённая матрица adj(A) = C(A)ᵀ."""
    check_size(matrix)
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)

    adj = matrix.adjugate()
    det = matrix.det()
    check = (matrix * adj).applyfunc(sp.simplify)

    return OperationResult(
        kind="matrix",
        result=adj,
        explanation=(
            "Присоединённая матрица: adj(A) = C(A)ᵀ. "
            "Удовлетворяет тождеству A · adj(A) = det(A) · I."
        ),
        extra={
            "determinant": det,
            "determinant_latex": scalar_to_latex(det),
            "check": check,
            "check_latex": matrix_to_latex(check),
            "shape": (matrix.rows, matrix.cols),
        },
    )


# =============================================================================
# 6. ФОРМЫ ПРИВЕДЕНИЯ
# =============================================================================

def rref(matrix: sp.Matrix) -> OperationResult:
    """RREF."""
    check_size(matrix)
    ensure_symbolic_ok(matrix)

    result, pivots = matrix.rref()
    pivot_cols = [p + 1 for p in pivots]

    return OperationResult(
        kind="matrix",
        result=result,
        explanation=(
            f"Приведённая ступенчатая форма (RREF). "
            f"Ведущие столбцы: {pivot_cols}."
        ),
        extra={
            "pivots": pivot_cols,
            "rank": len(pivots),
            "shape": (result.rows, result.cols),
        },
    )


def echelon(matrix: sp.Matrix) -> OperationResult:
    """Ступенчатая форма (REF)."""
    check_size(matrix)

    m = matrix.copy()
    rows, cols = m.shape
    pivot_row = 0
    pivot_positions: list[tuple[int, int]] = []

    for col in range(cols):
        if pivot_row >= rows:
            break

        pivot = None
        for r in range(pivot_row, rows):
            if m[r, col] != 0:
                pivot = r
                break

        if pivot is None:
            continue

        if pivot != pivot_row:
            m.row_swap(pivot_row, pivot)

        pivot_value = m[pivot_row, col]
        m[pivot_row, :] = m[pivot_row, :] / pivot_value

        for r in range(pivot_row + 1, rows):
            if m[r, col] != 0:
                factor = m[r, col]
                m[r, :] = m[r, :] - factor * m[pivot_row, :]

        pivot_positions.append((pivot_row + 1, col + 1))
        pivot_row += 1

    m = m.applyfunc(sp.simplify)

    return OperationResult(
        kind="matrix",
        result=m,
        explanation=(
            "Ступенчатая форма (row echelon form): "
            "нули под ведущими элементами, ведущие равны 1."
        ),
        extra={
            "pivots": pivot_positions,
            "rank": len(pivot_positions),
            "shape": (m.rows, m.cols),
        },
    )


# =============================================================================
# 7. УТИЛИТЫ
# =============================================================================

def identity(n: int) -> sp.Matrix:
    """Единичная матрица n×n."""
    return sp.eye(n)


def zero(rows: int, cols: int) -> sp.Matrix:
    """Нулевая матрица rows×cols."""
    return sp.zeros(rows, cols)


def ones(rows: int, cols: int) -> sp.Matrix:
    """Матрица из единиц rows×cols."""
    return sp.ones(rows, cols)


__all__ = [
    "OperationResult",
    "add",
    "subtract",
    "multiply",
    "scalar_multiply",
    "transpose",
    "conjugate_transpose",
    "power",
    "add_chain",
    "multiply_chain",
    "determinant",
    "trace",
    "rank",
    "inverse",
    "inverse_gauss_jordan",
    "minors",
    "cofactor_matrix",
    "adjugate",
    "rref",
    "echelon",
    "identity",
    "zero",
    "ones",
]