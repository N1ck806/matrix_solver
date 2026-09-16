"""
Решение систем линейных уравнений (СЛАУ).

Поддерживаются:
    • решение методом Гаусса (прямой + обратный ход);
    • решение методом Гаусса-Жордана (через RREF);
    • правило Крамера (для квадратных систем);
    • решение через обратную матрицу;
    • анализ по теореме Кронекера-Капелли (совместность);
    • вывод единственного / бесконечного / отсутствующего решения.

Все вычисления — точные. Для параметрических решений свободные
переменные получают осмысленные имена t₁, t₂, ..., tₖ.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .latex_utils import matrix_to_latex, scalar_to_latex
from .validators import ValidationError


# =============================================================================
# Результат решения
# =============================================================================

@dataclass
class SystemSolution:
    """Результат решения СЛАУ Ax = b."""

    kind: str  # 'unique' | 'infinite' | 'none'
    solution: dict[sp.Symbol, sp.Expr] = field(default_factory=dict)
    parametric: dict[sp.Symbol, sp.Expr] = field(default_factory=dict)
    free_variables: list[sp.Symbol] = field(default_factory=list)
    particular_solution: dict[sp.Symbol, sp.Expr] = field(default_factory=dict)

    rank_a: int = 0
    rank_aug: int = 0
    n_vars: int = 0

    augmented: sp.Matrix | None = None
    rref_matrix: sp.Matrix | None = None
    pivots: list[int] = field(default_factory=list)

    method: str = "gauss"

    check_ok: bool | None = None
    check_matrix: sp.Matrix | None = None

    explanation: str = ""


# =============================================================================
# Основная функция решения
# =============================================================================

def solve_system(
    a: sp.Matrix,
    b: sp.Matrix,
    *,
    method: str = "auto",
) -> SystemSolution:
    """Решить систему Ax = b.

    Параметры:
        a      — матрица коэффициентов m×n;
        b      — вектор правой части m×1 (или m);
        method — 'auto' | 'gauss' | 'gauss_jordan' | 'cramer' | 'inverse'.

    Логика выбора метода при 'auto':
        • если A квадратная и det(A) ≠ 0 — 'gauss_jordan';
        • если A квадратная и det(A) = 0 — 'gauss';
        • в остальных случаях — 'gauss'.
    """
    if a is None or b is None:
        raise ValidationError("Матрица A и вектор b должны быть заданы.")

    # Приведение b к столбцу.
    b = _as_column(b)

    if a.rows != b.rows:
        raise ValidationError(
            f"Размер матрицы A ({a.rows}×{a.cols}) не совпадает "
            f"с размером вектора b ({b.rows}). "
            f"Число строк A должно равняться числу элементов b.",
            code="shape_mismatch",
        )

    # Определяем фактический метод.
    if method == "auto":
        if a.rows == a.cols:
            try:
                det = a.det()
                method = "gauss_jordan" if det != 0 else "gauss"
            except Exception:  # noqa: BLE001
                method = "gauss"
        else:
            method = "gauss"

    # Собираем расширенную матрицу для анализа.
    aug = a.row_join(b)
    aug_rref, pivots = aug.rref()
    pivots = list(pivots)

    rank_a = a.rank()
    rank_aug = aug.rank()
    n_vars = a.cols

    base_solution = SystemSolution(
        kind="none",
        rank_a=rank_a,
        rank_aug=rank_aug,
        n_vars=n_vars,
        augmented=aug,
        rref_matrix=aug_rref,
        pivots=pivots,
        method=method,
    )

    # Классификация по Кронекеру-Капелли.
    if rank_a != rank_aug:
        base_solution.kind = "none"
        base_solution.explanation = (
            f"rank(A) = {rank_a}, rank([A|b]) = {rank_aug}. "
            f"Ранги не совпадают — система несовместна."
        )
        return base_solution

    if rank_a == n_vars:
        # Единственное решение.
        solution = _extract_unique_solution(aug_rref, n_vars)
        base_solution.kind = "unique"
        base_solution.solution = solution
        base_solution.explanation = (
            f"rank(A) = rank([A|b]) = {rank_a} = n. "
            f"Система имеет единственное решение."
        )
        # Проверка A·x = b.
        base_solution.check_ok, base_solution.check_matrix = _check_solution(a, b, solution)
        return base_solution

    # Бесконечное множество решений: rank_a < n_vars.
    parametric, free_vars, particular = _extract_parametric_solution(
        aug_rref, n_vars, pivots
    )
    base_solution.kind = "infinite"
    base_solution.parametric = parametric
    base_solution.free_variables = free_vars
    base_solution.particular_solution = particular
    base_solution.explanation = (
        f"rank(A) = rank([A|b]) = {rank_a} < n = {n_vars}. "
        f"Система имеет бесконечно много решений; "
        f"свободных переменных: {n_vars - rank_a}."
    )
    # Проверка: подставляем частное решение.
    if particular:
        base_solution.check_ok, base_solution.check_matrix = _check_solution(
            a, b, particular
        )
    return base_solution


# =============================================================================
# Анализ по Кронекеру-Капелли
# =============================================================================

def kronecker_capelli(a: sp.Matrix, b: sp.Matrix) -> dict[str, Any]:
    """Анализ совместности системы Ax = b по теореме Кронекера-Капелли.

    Возвращает словарь:
        rank_a         — ранг A;
        rank_aug       — ранг [A | b];
        n_vars         — число неизвестных;
        consistent     — совместна ли система;
        kind           — 'unique' | 'infinite' | 'none';
        conclusion     — человекочитаемый вывод;
        augmented      — расширенная матрица;
        augmented_latex;
        rref           — RREF расширенной матрицы;
        rref_latex.
    """
    b_col = _as_column(b)
    if a.rows != b_col.rows:
        raise ValidationError(
            "Размер матрицы A не совпадает с размером вектора b.",
            code="shape_mismatch",
        )

    aug = a.row_join(b_col)
    aug_rref, pivots = aug.rref()
    pivots = [p + 1 for p in pivots]

    rank_a = a.rank()
    rank_aug = aug.rank()
    n_vars = a.cols

    if rank_a != rank_aug:
        kind = "none"
        conclusion = (
            f"rank(A) = {rank_a}, rank([A|b]) = {rank_aug}. "
            f"Ранги не совпадают — система несовместна, решений нет."
        )
        consistent = False
    elif rank_a == n_vars:
        kind = "unique"
        conclusion = (
            f"rank(A) = rank([A|b]) = {rank_a} = n = {n_vars}. "
            f"Система совместна и имеет единственное решение."
        )
        consistent = True
    else:
        kind = "infinite"
        conclusion = (
            f"rank(A) = rank([A|b]) = {rank_a} < n = {n_vars}. "
            f"Система совместна и имеет бесконечно много решений "
            f"(свободных переменных: {n_vars - rank_a})."
        )
        consistent = True

    return {
        "rank_a": rank_a,
        "rank_aug": rank_aug,
        "n_vars": n_vars,
        "consistent": consistent,
        "kind": kind,
        "conclusion": conclusion,
        "augmented": aug,
        "augmented_latex": matrix_to_latex(aug, augment=n_vars),
        "rref": aug_rref,
        "rref_latex": matrix_to_latex(aug_rref, augment=n_vars),
        "pivots": pivots,
    }


# =============================================================================
# Метод Гаусса (для явного пошагового решения, отдельная функция)
# =============================================================================

def gauss_solve(a: sp.Matrix, b: sp.Matrix) -> SystemSolution:
    """Решение СЛАУ методом Гаусса (прямой + обратный ход)."""
    return solve_system(a, b, method="gauss")


def gauss_jordan_solve(a: sp.Matrix, b: sp.Matrix) -> SystemSolution:
    """Решение СЛАУ методом Гаусса-Жордана."""
    return solve_system(a, b, method="gauss_jordan")


# =============================================================================
# Правило Крамера
# =============================================================================

def cramer_solve(a: sp.Matrix, b: sp.Matrix) -> SystemSolution:
    """Решение СЛАУ по правилу Крамера. Требуется квадратная A с det(A) ≠ 0."""
    if a.rows != a.cols:
        raise ValidationError(
            "Правило Крамера применимо только к квадратным системам. "
            f"A имеет размер {a.rows}×{a.cols}.",
            code="not_square",
        )

    b_col = _as_column(b)
    n = a.rows
    det_a = a.det()

    if det_a == 0:
        return solve_system(a, b_col, method="gauss")

    # Символы для переменных.
    x_syms = sp.symbols(f"x1:{n + 1}")

    solution: dict[sp.Symbol, sp.Expr] = {}
    for i in range(n):
        a_i = a.copy()
        a_i[:, i] = b_col
        det_i = a_i.det()
        solution[x_syms[i]] = sp.simplify(det_i / det_a)

    result = SystemSolution(
        kind="unique",
        solution=solution,
        rank_a=n,
        rank_aug=n,
        n_vars=n,
        method="cramer",
        explanation=(
            f"По правилу Крамера xᵢ = det(Aᵢ) / det(A), где Aᵢ — матрица A "
            f"с заменённым i-м столбцом на вектор b. "
            f"det(A) = {sp.latex(det_a)} ≠ 0."
        ),
    )
    result.check_ok, result.check_matrix = _check_solution(a, b_col, solution)
    return result


# =============================================================================
# Решение через обратную матрицу
# =============================================================================

def inverse_solve(a: sp.Matrix, b: sp.Matrix) -> SystemSolution:
    """Решение через x = A⁻¹·b. Только для квадратной A с det(A) ≠ 0."""
    if a.rows != a.cols:
        raise ValidationError(
            "Решение через обратную матрицу применимо только к квадратным A.",
            code="not_square",
        )
    det_a = a.det()
    if det_a == 0:
        raise ValidationError(
            "Обратной матрицы не существует: det(A) = 0.",
            code="singular",
        )
    b_col = _as_column(b)
    inv = a.inv()
    x = inv * b_col

    n = a.rows
    x_syms = sp.symbols(f"x1:{n + 1}")
    solution = {x_syms[i]: sp.simplify(x[i, 0]) for i in range(n)}

    result = SystemSolution(
        kind="unique",
        solution=solution,
        rank_a=n,
        rank_aug=n,
        n_vars=n,
        method="inverse",
        explanation=(
            f"x = A⁻¹·b. det(A) = {sp.latex(det_a)} ≠ 0, "
            f"обратная матрица существует."
        ),
    )
    result.check_ok, result.check_matrix = _check_solution(a, b_col, solution)
    return result


# =============================================================================
# Вспомогательные
# =============================================================================

def _as_column(b: Any) -> sp.Matrix:
    """Преобразовать b к вектору-столбцу."""
    if isinstance(b, sp.MatrixBase):
        if b.rows == 1 and b.cols > 1:
            return sp.Matrix(b.T)
        if b.cols == 1:
            return sp.Matrix(b)
        # Обычная матрица → берём первый столбец? Нет — ошибка.
        if b.rows > 1 and b.cols > 1:
            raise ValidationError(
                "Вектор b должен быть строкой или столбцом, "
                "не матрицей.",
                code="bad_vector",
            )
        return sp.Matrix(b)

    if isinstance(b, (list, tuple)):
        # Плоский список или вложенный.
        if b and isinstance(b[0], (list, tuple)):
            # Вложенный.
            if len(b[0]) == 1:
                return sp.Matrix([row[0] for row in b])
            if len(b) == 1:
                return sp.Matrix([b[0]]).T
        return sp.Matrix(list(b))

    raise ValidationError(
        f"Не удалось преобразовать b к вектору: тип {type(b).__name__}.",
        code="bad_vector",
    )


def _extract_unique_solution(rref_aug: sp.Matrix, n: int) -> dict[sp.Symbol, sp.Expr]:
    """Извлечь единственное решение из RREF расширенной матрицы."""
    x_syms = sp.symbols(f"x1:{n + 1}")
    solution: dict[sp.Symbol, sp.Expr] = {}
    for i in range(n):
        # В RREF с единственным решением в i-й строке: x_i = rref[i, n].
        value = sp.simplify(rref_aug[i, n])
        solution[x_syms[i]] = value
    return solution


def _extract_parametric_solution(
    rref_aug: sp.Matrix,
    n: int,
    pivots: list[int],
) -> tuple[dict[sp.Symbol, sp.Expr], list[sp.Symbol], dict[sp.Symbol, sp.Expr]]:
    """Извлечь параметрическое решение.

    Возвращает:
        parametric       — общее решение в виде {x_i: выражение через параметры};
        free_vars        — список свободных переменных;
        particular       — частное решение при всех параметрах = 0.
    """
    x_syms = sp.symbols(f"x1:{n + 1}")

    # Столбцы-пивоты — базисные переменные.
    pivot_cols = set(pivots)
    free_cols = [j for j in range(n) if j not in pivot_cols]

    # Параметры для свободных переменных.
    n_free = len(free_cols)
    if n_free > 0:
        t_syms = sp.symbols(f"t1:{n_free + 1}")
    else:
        t_syms = ()

    # Карта: индекс столбца → символ переменной.
    free_map: dict[int, sp.Symbol] = {col: t_syms[k] for k, col in enumerate(free_cols)}

    # Свободные переменные выражаем через параметры.
    free_vars: list[sp.Symbol] = []
    for col in free_cols:
        free_vars.append(t_syms[free_cols.index(col)])

    # Общее решение.
    parametric: dict[sp.Symbol, sp.Expr] = {}
    for i, col in enumerate(pivots):
        # В строке i ведущая переменная x_{col+1}.
        # Выражение: x_{col+1} = rref[i, n] - Σ rref[i, j] * x_{j+1}, j ∈ free_cols.
        expr: sp.Expr = sp.Integer(0)
        for j in free_cols:
            coef = rref_aug[i, j]
            if coef != 0:
                expr -= coef * free_map[j]
        expr += rref_aug[i, n]
        parametric[x_syms[col]] = sp.simplify(expr)

    # Свободные переменные: x_j = t_k.
    for k, col in enumerate(free_cols):
        parametric[x_syms[col]] = t_syms[k]

    # Частное решение — при всех t = 0.
    particular: dict[sp.Symbol, sp.Expr] = {}
    for var, expr in parametric.items():
        val = expr
        for t in t_syms:
            val = val.subs(t, 0)
        particular[var] = sp.simplify(val)

    return parametric, free_vars, particular


def _check_solution(
    a: sp.Matrix,
    b: sp.Matrix,
    solution: dict[sp.Symbol, sp.Expr],
) -> tuple[bool, sp.Matrix]:
    """Проверить A·x ≈ b для найденного решения."""
    n = a.cols
    x_syms = sp.symbols(f"x1:{n + 1}")
    x_vec = sp.Matrix([solution.get(x_syms[i], sp.Integer(0)) for i in range(n)])
    check = (a * x_vec).applyfunc(sp.simplify)
    ok = sp.simplify(check - b) == sp.zeros(a.rows, 1)
    return ok, check