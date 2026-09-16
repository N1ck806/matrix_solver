"""
Собственные значения, собственные векторы, характеристический многочлен.

Модуль работает с квадратными матрицами и вычисляет:
    • характеристический многочлен det(A − λI);
    • собственные значения с алгебраическими кратностями;
    • для каждого собственного значения — базис собственного
      подпространства (собственные векторы) и геометрическую кратность;
    • информацию о диагонализируемости.

Производительность:
    • compute_cached()  — основной вход для API. Кэширует EigenResult по
                          хэшу матрицы + var_name, чтобы три эндпоинта
                          (eigenvalues / eigenvectors / char_poly) не
                          пересчитывали одно и то же.
    • compute()         — «сырой» вычислитель (без кэша).

    Флаги:
        compute_eigenvectors=False — не считать nullspace (быстрее в ~2–3 раза);
        compute_equations=False    — не строить уравнения (A−λI)v=0.

Численный fallback:
    Если матрица больше SYMBOLIC_LIMIT (5×5) и не содержит символов —
    используется numpy.linalg.eig. Это даёт результат за доли секунды
    вместо минут. Точность — 6–8 знаков, помечается флагом numeric=True.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .latex_utils import matrix_to_latex, scalar_to_latex
from .validators import ValidationError, ensure_square, ensure_symbolic_ok

logger = logging.getLogger("matrix_app.services.eigens")


# =============================================================================
# Лимиты
# =============================================================================

SYMBOLIC_LIMIT = 5     # до этого размера — точный SymPy
NUMERIC_LIMIT = 20     # до этого размера — численный NumPy


# =============================================================================
# Результат
# =============================================================================

@dataclass
class EigenItem:
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
    numeric: bool = False
    partial: bool = False
    partial_reason: str = ""


# =============================================================================
# Главная точка входа
# =============================================================================

def compute(
    matrix: sp.Matrix,
    var_name: str = "lambda",
    *,
    compute_eigenvectors: bool = True,
    compute_equations: bool = False,
) -> EigenResult:
    if matrix is None:
        raise ValidationError("Матрица не задана.", code="empty")

    check_size_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows
    has_symbols = _has_free_symbols(matrix)

    if n <= SYMBOLIC_LIMIT:
        return _compute_symbolic(
            matrix, var_name,
            compute_eigenvectors=compute_eigenvectors,
            compute_equations=compute_equations,
        )

    if has_symbols:
        raise ValidationError(
            f"Матрица {n}×{n} содержит символы — точный символьный расчёт "
            f"поддерживается только до {SYMBOLIC_LIMIT}×{SYMBOLIC_LIMIT}. "
            f"Уберите символы или уменьшите размер.",
            code="too_large_symbolic",
        )

    if n > NUMERIC_LIMIT:
        raise ValidationError(
            f"Максимальный размер для численного расчёта — "
            f"{NUMERIC_LIMIT}×{NUMERIC_LIMIT}.",
            code="too_large",
        )

    return _compute_numeric(
        matrix, var_name,
        compute_eigenvectors=compute_eigenvectors,
    )


# =============================================================================
# Символьный путь (SymPy)
# =============================================================================

def _compute_symbolic(
    matrix: sp.Matrix,
    var_name: str,
    *,
    compute_eigenvectors: bool,
    compute_equations: bool,
) -> EigenResult:
    n = matrix.rows
    lam = sp.symbols(var_name, real=False)

    partial = False
    partial_reason_parts: list[str] = []

    # --- char_poly -----------------------------------------------------------
    try:
        char_poly_raw = (matrix - lam * sp.eye(n)).det()
        char_poly = sp.expand(char_poly_raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Не удалось вычислить char_poly: %s", exc)
        char_poly = sp.Integer(0)
        partial = True
        partial_reason_parts.append(f"char_poly: {exc}")

    try:
        char_poly_factored = sp.factor(char_poly)
    except Exception as exc:  # noqa: BLE001
        logger.info("Не удалось факторизовать char_poly: %s", exc)
        char_poly_factored = char_poly

    char_latex = _safe_latex(char_poly)
    char_latex_factored = _safe_latex(char_poly_factored)

    # --- eigenvals -----------------------------------------------------------
    eigen_dict: dict[sp.Expr, int] = {}
    try:
        eigen_dict = matrix.eigenvals()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Не удалось вычислить eigenvals: %s", exc)
        partial = True
        partial_reason_parts.append(f"eigenvals: {exc}")

    eigenvalues: list[EigenItem] = []
    is_diag_possible = True

    for value, alg_mult in eigen_dict.items():
        if value is sp.zoo or value is sp.nan or value is sp.oo:
            partial = True
            partial_reason_parts.append(f"λ={value} пропущено")
            continue

        null_basis: list[sp.Matrix] = []
        geom_mult = 0

        if compute_eigenvectors:
            try:
                null_basis = (matrix - value * sp.eye(n)).nullspace()
                geom_mult = len(null_basis)
            except Exception as exc:  # noqa: BLE001
                logger.info("nullspace для λ=%s упал: %s", value, exc)
                partial = True
                partial_reason_parts.append(f"nullspace(λ={value}): {exc}")
                null_basis = []
                geom_mult = 0

        try:
            eigenvectors_latex = [
                matrix_to_latex(v, bracket="bmatrix") for v in null_basis
            ]
        except Exception:
            eigenvectors_latex = []

        if compute_equations:
            try:
                nullspace_equations = _build_nullspace_equations(
                    matrix, value, n, var_name
                )
            except Exception:
                nullspace_equations = []
        else:
            nullspace_equations = []

        this_diag = (geom_mult == alg_mult) if compute_eigenvectors else True
        if compute_eigenvectors and not this_diag:
            is_diag_possible = False

        eigenvalues.append(
            EigenItem(
                value=value,
                value_latex=_safe_latex(value),
                algebraic_multiplicity=int(alg_mult),
                geometric_multiplicity=int(geom_mult),
                eigenvectors=null_basis,
                eigenvectors_latex=eigenvectors_latex,
                nullspace_equations=nullspace_equations,
                is_diagonalizable_for_this=this_diag,
            )
        )

    try:
        trace_check = matrix.trace()
    except Exception:
        trace_check = sp.Integer(0)

    try:
        det_check = matrix.det()
    except Exception:
        det_check = sp.Integer(0)

    is_diagonalizable = is_diag_possible and n > 0 and compute_eigenvectors

    if not compute_eigenvectors:
        reason = (
            "Диагонализируемость не проверялась: собственные векторы "
            "не вычислялись."
        )
    elif is_diagonalizable:
        reason = (
            "Матрица диагонализируема: для каждого собственного значения "
            "геометрическая кратность совпадает с алгебраической."
        )
    else:
        reason = (
            "Матрица не диагонализируема: хотя бы для одного собственного "
            "значения геометрическая кратность меньше алгебраической."
        )

    can_compute_numeric = all(
        not getattr(v, "free_symbols", set()) for v in eigen_dict
    )

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
        numeric=False,
        partial=partial,
        partial_reason="; ".join(partial_reason_parts),
    )


# =============================================================================
# Численный путь (NumPy)
# =============================================================================

def _compute_numeric(
    matrix: sp.Matrix,
    var_name: str,
    *,
    compute_eigenvectors: bool,
) -> EigenResult:
    import numpy as np

    n = matrix.rows
    lam = sp.symbols(var_name, real=False)

    arr = _to_numpy(matrix)

    if compute_eigenvectors:
        raw_vals, raw_vecs = np.linalg.eig(arr)
    else:
        raw_vals = np.linalg.eigvals(arr)
        raw_vecs = None

    # Группируем λ, отличающиеся меньше чем на 1e-8.
    used = [False] * len(raw_vals)
    groups: list[tuple[complex, list[int]]] = []
    for i in range(len(raw_vals)):
        if used[i]:
            continue
        cluster = [i]
        used[i] = True
        for j in range(i + 1, len(raw_vals)):
            if used[j]:
                continue
            if abs(raw_vals[j] - raw_vals[i]) < 1e-8:
                cluster.append(j)
                used[j] = True
        groups.append((raw_vals[i], cluster))

    eigenvalues: list[EigenItem] = []
    is_diag_possible = True

    for lam_val, indices in groups:
        value = _complex_to_sympy(lam_val)
        value_latex = _safe_latex(value)

        vecs_sympy: list[sp.Matrix] = []
        vecs_latex: list[str] = []

        if compute_eigenvectors and raw_vecs is not None:
            for idx in indices:
                v = raw_vecs[:, idx]
                pivot = next(
                    (k for k, x in enumerate(v) if abs(x) > 1e-10),
                    0,
                )
                if abs(v[pivot]) > 1e-12:
                    v = v / v[pivot]
                v = np.round(v.real, 8) + 1j * np.round(v.imag, 8)
                col = sp.Matrix([_complex_to_sympy(x) for x in v])
                vecs_sympy.append(col)
                try:
                    vecs_latex.append(matrix_to_latex(col, bracket="bmatrix"))
                except Exception:
                    vecs_latex.append("")

        geom = len(vecs_sympy) if compute_eigenvectors else len(indices)
        alg = len(indices)
        this_diag = (geom == alg) if compute_eigenvectors else True
        if compute_eigenvectors and not this_diag:
            is_diag_possible = False

        eigenvalues.append(
            EigenItem(
                value=value,
                value_latex=value_latex,
                algebraic_multiplicity=alg,
                geometric_multiplicity=geom,
                eigenvectors=vecs_sympy,
                eigenvectors_latex=vecs_latex,
                nullspace_equations=[],
                is_diagonalizable_for_this=this_diag,
            )
        )

    # --- char_poly через np.poly --------------------------------------------
    # np.poly(arr) возвращает коэффициенты (возможно, комплексные).
    # Приводим каждый к SymPy-выражению через _complex_to_sympy — так
    # не теряется мнимая часть и не возникает ComplexWarning.
    coeffs = np.poly(arr)
    poly = sp.Integer(0)
    for i, c in enumerate(coeffs):
        power = len(coeffs) - 1 - i
        try:
            poly += _complex_to_sympy(c) * lam ** power
        except Exception:
            poly += sp.Float(0.0) * lam ** power
    poly = sp.expand(poly)

    # --- след и определитель -------------------------------------------------
    try:
        trace_check = _complex_to_sympy(np.trace(arr))
    except Exception:
        trace_check = sp.Integer(0)

    try:
        det_check = _complex_to_sympy(np.linalg.det(arr))
    except Exception:
        det_check = sp.Integer(0)

    is_diagonalizable = is_diag_possible and n > 0 and compute_eigenvectors

    if not compute_eigenvectors:
        reason = (
            "Диагонализируемость не проверялась: собственные векторы "
            "не вычислялись."
        )
    elif is_diagonalizable:
        reason = (
            "Матрица диагонализируема (численный расчёт): для каждого λ "
            "геометрическая кратность совпадает с алгебраической."
        )
    else:
        reason = (
            "Матрица не диагонализируема (численный расчёт): есть λ, "
            "для которого геометрическая кратность меньше алгебраической."
        )

    return EigenResult(
        matrix=matrix,
        char_poly=poly,
        char_poly_latex=_safe_latex(poly),
        char_poly_factored=poly,
        char_poly_factored_latex=_safe_latex(poly),
        char_poly_var=lam,
        eigenvalues=eigenvalues,
        trace_check=trace_check,
        det_check=det_check,
        is_diagonalizable=is_diagonalizable,
        diagonalization_reason=reason,
        can_compute_numeric=True,
        numeric=True,
        partial=False,
        partial_reason="",
    )


# =============================================================================
# Утилиты
# =============================================================================

def _has_free_symbols(matrix: sp.Matrix) -> bool:
    for i in range(matrix.rows):
        for j in range(matrix.cols):
            if getattr(matrix[i, j], "free_symbols", set()):
                return True
    return False


def _to_numpy(matrix: sp.Matrix):
    import numpy as np

    rows, cols = matrix.shape
    arr = np.zeros((rows, cols), dtype=np.complex128)
    for i in range(rows):
        for j in range(cols):
            v = matrix[i, j]
            try:
                arr[i, j] = complex(v.evalf())
            except Exception as exc:
                raise ValidationError(
                    f"Не удалось преобразовать элемент ({i+1},{j+1}) "
                    f"в число: {exc}",
                    code="bad_number",
                ) from exc
    return arr


def _complex_to_sympy(z: complex) -> sp.Expr:
    """Комплексное число → SymPy-выражение.

    Если мнимая часть ~0, возвращаем действительное Float.
    Если действительная часть ~0, возвращаем чисто мнимое.
    Иначе — полное a + bi.
    """
    try:
        re = float(z.real)
        im = float(z.imag)
    except (AttributeError, TypeError, ValueError):
        # На случай, если пришло не complex, а обычное число.
        try:
            return sp.Float(round(float(z), 8))
        except Exception:
            return sp.Integer(0)

    if abs(im) < 1e-10:
        return sp.Float(round(re, 8))
    if abs(re) < 1e-10:
        return sp.Float(round(im, 8)) * sp.I
    return sp.Float(round(re, 8)) + sp.Float(round(im, 8)) * sp.I


def _safe_latex(expr: Any) -> str:
    try:
        return sp.latex(expr)
    except Exception:
        return str(expr)


def _build_nullspace_equations(
    matrix: sp.Matrix,
    eigen_value: sp.Expr,
    n: int,
    var_name: str,
) -> list[str]:
    equations: list[str] = []
    v_syms = sp.symbols(f"v1:{n + 1}")

    try:
        shifted = matrix - eigen_value * sp.eye(n)
    except Exception:
        return [
            f"\\text{{Не удалось построить систему для }} "
            f"\\lambda = {_safe_latex(eigen_value)}"
        ]

    for i in range(n):
        terms: list[str] = []
        for j in range(n):
            try:
                coef = sp.simplify(shifted[i, j])
            except Exception:
                coef = shifted[i, j]

            if coef == 0:
                continue
            if coef == 1:
                terms.append(f"{_safe_latex(v_syms[j])}")
            elif coef == -1:
                terms.append(f"-{_safe_latex(v_syms[j])}")
            else:
                terms.append(
                    f"{_safe_latex(coef)} \\cdot {_safe_latex(v_syms[j])}"
                )
        if not terms:
            equations.append("0 = 0")
        else:
            eq = " + ".join(terms).replace("+ -", "- ")
            equations.append(eq + " = 0")

    return equations


def check_size_square(matrix: sp.Matrix) -> None:
    if matrix.rows != matrix.cols:
        raise ValidationError(
            f"Для спектрального анализа матрица должна быть квадратной. "
            f"Текущий размер: {matrix.rows}×{matrix.cols}.",
            code="not_square",
        )


# =============================================================================
# Кэш
# =============================================================================

def _matrix_hash(matrix: sp.Matrix) -> str:
    try:
        s = str(matrix.tolist())
    except Exception:
        s = str(matrix)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:24]


_CACHE_BY_KEY: dict[tuple, EigenResult] = {}
_CACHE_MAX = 32
_CACHE_ORDER: list[tuple] = []


def _cache_key(
    matrix: sp.Matrix,
    var_name: str,
    compute_eigenvectors: bool,
    compute_equations: bool,
) -> tuple:
    return (
        _matrix_hash(matrix),
        var_name,
        bool(compute_eigenvectors),
        bool(compute_equations),
    )


def compute_cached(
    matrix: sp.Matrix,
    var_name: str = "lambda",
    *,
    compute_eigenvectors: bool = True,
    compute_equations: bool = False,
) -> EigenResult:
    key = _cache_key(matrix, var_name, compute_eigenvectors, compute_equations)

    cached = _CACHE_BY_KEY.get(key)
    if cached is not None:
        return cached

    result = compute(
        matrix,
        var_name=var_name,
        compute_eigenvectors=compute_eigenvectors,
        compute_equations=compute_equations,
    )

    if len(_CACHE_BY_KEY) >= _CACHE_MAX:
        try:
            oldest = _CACHE_ORDER.pop(0)
            _CACHE_BY_KEY.pop(oldest, None)
        except IndexError:
            pass

    _CACHE_BY_KEY[key] = result
    _CACHE_ORDER.append(key)
    return result


def clear_cache() -> None:
    _CACHE_BY_KEY.clear()
    _CACHE_ORDER.clear()


# =============================================================================
# Отдельные удобные функции для API
# =============================================================================

def eigenvalues_only(matrix: sp.Matrix) -> list[tuple[sp.Expr, int]]:
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
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)
    n = matrix.rows
    lam = sp.symbols(var_name)
    poly = sp.expand((matrix - lam * sp.eye(n)).det())
    return poly, lam


def eigenvectors_for(
    matrix: sp.Matrix, eigen_value: sp.Expr
) -> list[sp.Matrix]:
    ensure_square(matrix)
    n = matrix.rows
    try:
        return (matrix - eigen_value * sp.eye(n)).nullspace()
    except Exception as exc:  # noqa: BLE001
        raise ValidationError(
            f"Не удалось найти собственные векторы: {exc}",
            code="eigenvector_error",
        ) from exc