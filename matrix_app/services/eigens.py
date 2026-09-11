"""
Собственные значения, собственные векторы, характеристический многочлен.

Модуль работает с квадратными матрицами и вычисляет:
    • характеристический многочлен det(A − λI);
    • собственные значения с алгебраическими кратностями;
    • для каждого собственного значения — базис собственного
      подпространства (собственные векторы) и геометрическую кратность;
    • информацию о диагонализируемости.

Все результаты — точные (SymPy), с LaTeX-представлением.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .latex_utils import matrix_to_latex, scalar_to_latex
from .validators import ValidationError, ensure_square, ensure_symbolic_ok


# =============================================================================
# Результат
# =============================================================================

@dataclass
class EigenItem:
    """Информация об одном собственном значении."""
    value: sp.Expr
    value_latex: str
    algebraic_multiplicity: int
    geometric_multiplicity: int
    eigenvectors: list[sp.Matrix] = field(default_factory=list)
    eigenvectors_latex: list[str] = field(default_factory=list)
    nullspace_equations: list[str] = field(default_factory=list)
    is_diagonalizable_for_this: bool = False


@dataclass
class EigenResult:
    """Полный результат спектрального анализа."""
    matrix: sp.Matrix
    char_poly: sp.Expr
    char_poly_latex: str
    char_poly_factored: sp.Expr
    char_poly_factored_latex: str
    char_poly_var: sp.Symbol
    eigenvalues: list[EigenItem] = field(default_factory=list)
    trace_check: sp.Expr = sp.Integer(0)
    det_check: sp.Expr = sp.Integer(0)
    is_diagonalizable: bool = False
    diagonalization_reason: str = ""
    can_compute_numeric: bool = False


# =============================================================================
# Основная функция
# =============================================================================

def compute(matrix: sp.Matrix, var_name: str = "lambda") -> EigenResult:
    """Полный спектральный анализ квадратной матрицы.

    Параметры:
        matrix   — sp.Matrix (квадратная);
        var_name — имя переменной характеристического многочлена
                   (по умолчанию 'lambda').
    """
    if matrix is None:
        raise ValidationError("Матрица не задана.", code="empty")
    check_size_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows
    lam = sp.symbols(var_name, real=False)

    # --- Характеристический многочлен ----------------------------------------
    char_poly_raw = (matrix - lam * sp.eye(n)).det()
    char_poly = sp.expand(char_poly_raw)
    char_poly_factored = sp.factor(char_poly)

    char_latex = sp.latex(char_poly)
    char_latex_factored = sp.latex(char_poly_factored)

    # --- Собственные значения с кратностями ----------------------------------
    # SymPy eigenvals возвращает dict {значение: алгебраическая кратность}.
    eigen_dict = matrix.eigenvals()

    eigenvalues: list[EigenItem] = []
    is_diag_possible = True

    for value, alg_mult in eigen_dict.items():
        # Базис собственного подпространства: ядро (A - λI).
        try:
            null_basis = (matrix - value * sp.eye(n)).nullspace()
        except Exception:  # noqa: BLE001
            null_basis = []

        geom_mult = len(null_basis)
        eigenvectors_latex = [matrix_to_latex(v, bracket="bmatrix") for v in null_basis]

        # Уравнения системы (A − λI)v = 0 для отображения.
        nullspace_equations = _build_nullspace_equations(matrix, value, n, var_name)

        this_diag = geom_mult == alg_mult
        if not this_diag:
            is_diag_possible = False

        eigenvalues.append(
            EigenItem(
                value=value,
                value_latex=sp.latex(value),
                algebraic_multiplicity=alg_mult,
                geometric_multiplicity=geom_mult,
                eigenvectors=null_basis,
                eigenvectors_latex=eigenvectors_latex,
                nullspace_equations=nullspace_equations,
                is_diagonalizable_for_this=this_diag,
            )
        )

    # --- Инварианты для проверки ---------------------------------------------
    trace_check = matrix.trace()
    det_check = matrix.det()

    # --- Диагонализируемость --------------------------------------------------
    is_diagonalizable = is_diag_possible and n > 0

    if is_diagonalizable:
        reason = (
            "Матрица диагонализируема: для каждого собственного значения "
            "геометрическая кратность совпадает с алгебраической."
        )
    else:
        reason = (
            "Матрица **не диагонализируема**: хотя бы для одного собственного "
            "значения геометрическая кратность меньше алгебраической "
            "(дефект собственного подпространства)."
        )

    can_compute_numeric = all(not v.free_symbols for v in eigen_dict)

    return EigenResult(
        matrix=matrix,
        char_poly=char_poly,
        char_poly_latex=char_latex,
        char_poly_factored=char_poly_factored,
        char_poly_factored_latex=char_latex_factored,
        char_poly_var=lam,
        eigenvalues=eigenvalues,
        trace_check=trace_check,
        det_check=det_check,
        is_diagonalizable=is_diagonalizable,
        diagonalization_reason=reason,
        can_compute_numeric=can_compute_numeric,
    )


# =============================================================================
# Вспомогательные
# =============================================================================

def _build_nullspace_equations(
    matrix: sp.Matrix,
    eigen_value: sp.Expr,
    n: int,
    var_name: str,
) -> list[str]:
    """Уравнения системы (A − λI)v = 0 для конкретного λ.

    Возвращаем список LaTeX-строк — каждая строка это одно уравнение,
    например: (a11 − λ)v₁ + a12·v₂ + ... = 0.
    """
    equations: list[str] = []
    # Символы для компонент вектора v.
    v_syms = sp.symbols(f"v1:{n + 1}")

    shifted = matrix - eigen_value * sp.eye(n)

    for i in range(n):
        terms: list[str] = []
        for j in range(n):
            coef = sp.simplify(shifted[i, j])
            if coef == 0:
                continue
            if coef == 1:
                terms.append(f"{sp.latex(v_syms[j])}")
            elif coef == -1:
                terms.append(f"-{sp.latex(v_syms[j])}")
            else:
                terms.append(f"{sp.latex(coef)} \\cdot {sp.latex(v_syms[j])}")
        if not terms:
            equations.append("0 = 0")
        else:
            equations.append(" + ".join(terms).replace("+ -", "- ") + " = 0")

    return equations


def check_size_square(matrix: sp.Matrix) -> None:
    """Проверка квадратности с понятным сообщением."""
    if matrix.rows != matrix.cols:
        raise ValidationError(
            f"Для спектрального анализа матрица должна быть квадратной. "
            f"Текущий размер: {matrix.rows}×{matrix.cols}.",
            code="not_square",
        )


# =============================================================================
# Отдельные удобные функции для API
# =============================================================================

def eigenvalues_only(matrix: sp.Matrix) -> list[tuple[sp.Expr, int]]:
    """Только собственные значения с кратностями."""
    ensure_square(matrix)
    try:
        return list(matrix.eigenvals().items())
    except Exception as exc:  # noqa: BLE001
        raise ValidationError(
            f"Не удалось вычислить собственные значения: {exc}",
            code="eigen_error",
        ) from exc


def characteristic_polynomial(
    matrix: sp.Matrix, var_name: str = "lambda"
) -> tuple[sp.Expr, sp.Symbol]:
    """Характеристический многочлен det(A − λI)."""
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)
    n = matrix.rows
    lam = sp.symbols(var_name)
    poly = sp.expand((matrix - lam * sp.eye(n)).det())
    return poly, lam


def eigenvectors_for(
    matrix: sp.Matrix, eigen_value: sp.Expr
) -> list[sp.Matrix]:
    """Базис собственного подпространства для конкретного λ."""
    ensure_square(matrix)
    n = matrix.rows
    try:
        return (matrix - eigen_value * sp.eye(n)).nullspace()
    except Exception as exc:  # noqa: BLE001
        raise ValidationError(
            f"Не удалось найти собственные векторы: {exc}",
            code="eigenvector_error",
        ) from exc