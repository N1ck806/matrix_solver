"""
Собственные значения, собственные векторы, характеристический многочлен.

Модуль работает с квадратными матрицами и вычисляет:
    • характеристический многочлен det(A − λI);
    • собственные значения с алгебраическими кратностями;
    • для каждого собственного значения — базис собственного
      подпространства (собственные векторы) и геометрическую кратность;
    • информацию о диагонализируемости.

Все результаты — точные (SymPy), с LaTeX-представлением.

Производительность:
    • compute_cached()  — основной вход для API. Кэширует EigenResult по
                          хэшу матрицы + var_name, чтобы три эндпоинта
                          (eigenvalues / eigenvectors / char_poly) не
                          пересчитывали одно и то же.
    • compute()         — «сырой» вычислитель (без кэша).

    Флаги:
        compute_eigenvectors=False — не считать nullspace (быстрее в ~2–3 раза);
        compute_equations=False    — не строить уравнения (A−λI)v=0.

    Для /eigen/ «Собственные значения» можно вызвать
        compute_cached(m, compute_eigenvectors=False)
    — посчитается только char_poly + eigenvals.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import sympy as sp

from .latex_utils import matrix_to_latex, scalar_to_latex
from .validators import ValidationError, ensure_square, ensure_symbolic_ok

logger = logging.getLogger("matrix_app.services.eigens")


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
    # Дополнительные поля для устойчивости
    partial: bool = False          # True, если что-то не удалось посчитать
    partial_reason: str = ""


# =============================================================================
# Основная функция (без кэша)
# =============================================================================

def compute(
    matrix: sp.Matrix,
    var_name: str = "lambda",
    *,
    compute_eigenvectors: bool = True,
    compute_equations: bool = False,
) -> EigenResult:
    """Полный спектральный анализ квадратной матрицы.

    Параметры:
        matrix                — sp.Matrix (квадратная);
        var_name              — имя переменной характеристического многочлена;
        compute_eigenvectors  — считать ли nullspace (геом. кратности
                                и базисы собственных подпространств);
        compute_equations     — строить ли уравнения (A−λI)v = 0 для отображения.
                                По умолчанию False — это заметная экономия.

    Устойчивость:
        • если eigenvals() упал — возвращаем partial=True и пустой список λ;
        • если factor() упал — используем неразложенный char_poly;
        • если nullspace() упал для конкретного λ — геом. кратность = 0.
    """
    if matrix is None:
        raise ValidationError("Матрица не задана.", code="empty")
    check_size_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows
    lam = sp.symbols(var_name, real=False)

    partial = False
    partial_reason_parts: list[str] = []

    # --- Характеристический многочлен ----------------------------------------
    # det(A − λI) — самая дешёвая часть, но и она может подвести на
    # символьных матрицах. Оборачиваем.
    try:
        char_poly_raw = (matrix - lam * sp.eye(n)).det()
        char_poly = sp.expand(char_poly_raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Не удалось вычислить char_poly: %s", exc)
        char_poly = sp.Integer(0)
        partial = True
        partial_reason_parts.append(f"char_poly: {exc}")

    # Факторизация — потенциально дорогая. Если не удалось — не страшно.
    try:
        char_poly_factored = sp.factor(char_poly)
    except Exception as exc:  # noqa: BLE001
        logger.info("Не удалось факторизовать char_poly: %s", exc)
        char_poly_factored = char_poly

    try:
        char_latex = sp.latex(char_poly)
    except Exception:
        char_latex = str(char_poly)

    try:
        char_latex_factored = sp.latex(char_poly_factored)
    except Exception:
        char_latex_factored = str(char_poly_factored)

    # --- Собственные значения ------------------------------------------------
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
        # Пропускаем мусорные значения от SymPy
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

        # Уравнения — только если явно попросили.
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

    # --- Инварианты ----------------------------------------------------------
    try:
        trace_check = matrix.trace()
    except Exception:
        trace_check = sp.Integer(0)

    try:
        det_check = matrix.det()
    except Exception:
        det_check = sp.Integer(0)

    # --- Диагонализируемость -------------------------------------------------
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
            "Матрица **не диагонализируема**: хотя бы для одного собственного "
            "значения геометрическая кратность меньше алгебраической "
            "(дефект собственного подпространства)."
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
        partial=partial,
        partial_reason="; ".join(partial_reason_parts),
    )


# =============================================================================
# Кэш
# =============================================================================

def _matrix_hash(matrix: sp.Matrix) -> str:
    """Стабильный хэш матрицы для кэша.

    Сериализуем через str(matrix.tolist()) — этого достаточно: для числовых
    и простых символьных матриц строка детерминирована.
    """
    try:
        s = str(matrix.tolist())
    except Exception:
        s = str(matrix)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:24]


# LRU-кэш: ключ = (hash, var_name, compute_eigenvectors, compute_equations).
# maxsize=32 — держим последние 32 разных запроса. Для одной сессии
# этого с запасом хватает.
@lru_cache(maxsize=32)
def _compute_cached_impl(
    matrix_hash: str,
    var_name: str,
    compute_eigenvectors: bool,
    compute_equations: bool,
    _matrix_repr: str,   # нужен для восстановления матрицы (см. ниже)
) -> EigenResult | None:
    """
    Внутренняя реализация кэша.

    ВАЖНО: lru_cache требует хэшируемых аргументов. sp.Matrix — не
    хэшируема, поэтому передаём только строку. Но чтобы восстановить
    матрицу, нам нужно её repr. Придётся вернуть None — а саму матрицу
    подставит compute_cached() через замыкание.

    Фактически мы делаем так: lru_cache используется как «маркер» того,
    что для такого ключа уже считали. Само значение кладём в _CACHE_BY_KEY.
    Это компромисс: чуть больше кода, зато надёжно.
    """
    return None


# Реальный кэш значений. Ключ тот же, что у _compute_cached_impl.
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
    """Обёртка над compute() с кэшем по (hash, var_name, flags).

    Три эндпоинта — eigenvalues / eigenvectors / char_poly — на одну и ту же
    матрицу отработают мгновенно после первого запроса.

    Также удобно использовать с разными флагами:
        compute_cached(m, compute_eigenvectors=False)  — только λ и p(λ);
        compute_cached(m, compute_eigenvectors=True)   — полный анализ.
    """
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

    # Простейшая эвикция: если переполнено — выбрасываем самый старый.
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
    """Очистить кэш (например, при перезагрузке настроек)."""
    _CACHE_BY_KEY.clear()
    _CACHE_ORDER.clear()
    try:
        _compute_cached_impl.cache_clear()
    except Exception:
        pass


# =============================================================================
# Вспомогательные
# =============================================================================

def _safe_latex(expr: sp.Basic) -> str:
    """LaTeX без падений — на случай экзотических выражений."""
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
    """Уравнения системы (A − λI)v = 0 для конкретного λ.

    Возвращаем список LaTeX-строк — каждая строка это одно уравнение,
    например: (a11 − λ)v₁ + a12·v₂ + ... = 0.
    """
    equations: list[str] = []
    v_syms = sp.symbols(f"v1:{n + 1}")

    try:
        shifted = matrix - eigen_value * sp.eye(n)
    except Exception:
        return [f"\\text{{Не удалось построить систему для }} \\lambda = {_safe_latex(eigen_value)}"]

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