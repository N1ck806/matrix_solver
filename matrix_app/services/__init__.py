"""
Математический движок MatrixLab.

Пакет services/ содержит всю математическую логику проекта и НЕ зависит
от Django. Это позволяет:
    • запускать вычисления из скриптов и Jupyter без Django;
    • тестировать модули независимо;
    • переиспользовать код в CLI или API-сервере.

Все вычисления выполняются в точной арифметике SymPy: дроби, корни,
символы и комплексные числа сохраняются в аналитическом виде без потерь.

Публичный API пакета:

    Из parser:
        parse_scalar(text)         -> sp.Expr
        parse_matrix(raw)          -> sp.Matrix

    Из validators:
        ValidationError            — исключение для пользовательских ошибок
        ensure_square, ensure_same_shape, ensure_multiplicable,
        ensure_nonzero_det, check_size, ensure_symbolic_ok

    Из latex_utils:
        matrix_to_latex(m)         -> str
        matrix_to_plain(m)         -> str
        expr_to_latex(e)           -> str

    Из matrix_operations:
        add, subtract, multiply, scalar_multiply, transpose,
        conjugate_transpose, power, determinant, trace, rank,
        inverse, inverse_gauss_jordan, minors, cofactor_matrix,
        adjugate, rref, echelon,
        add_chain, multiply_chain  — цепочки N матриц

    Из matrix_properties:
        analyze(m)                 -> MatrixProperties
        compare(a, b)              -> dict

    Из eigens:
        compute(m)                 -> EigenResult

    Из decompositions:
        lu, qr, cholesky, diagonalize, spectral

    Из step_solver:
        steps_for_determinant, steps_for_rank, steps_for_inverse,
        steps_for_rref, steps_for_slau

    Из matrix_solver:
        solve_system, kronecker_capelli

    Из explanations:
        explain(operation, payload) -> str

Типы данных:
    Все матрицы — sympy.Matrix.
    Все скаляры — sympy.Expr (Integer, Rational, Symbol, Add, Mul, ...).
"""
from __future__ import annotations

# --- parser ---------------------------------------------------------------
from .parser import parse_matrix, parse_scalar

# --- validators -----------------------------------------------------------
from .validators import (
    ValidationError,
    check_size,
    ensure_chain_addable,
    ensure_chain_multiplicable,
    ensure_multiplicable,
    ensure_nonzero_det,
    ensure_same_shape,
    ensure_square,
    ensure_symbolic_ok,
    is_numeric_matrix,
    safe_shape,
)

# --- latex ----------------------------------------------------------------
from .latex_utils import expr_to_latex, matrix_to_latex, matrix_to_plain

# --- operations -----------------------------------------------------------
from .matrix_operations import (
    OperationResult,
    add,
    add_chain,
    adjugate,
    cofactor_matrix,
    conjugate_transpose,
    determinant,
    echelon,
    inverse,
    inverse_gauss_jordan,
    minors,
    multiply,
    multiply_chain,
    power,
    rank,
    rref,
    scalar_multiply,
    subtract,
    trace,
    transpose,
)

# --- properties -----------------------------------------------------------
from .matrix_properties import (
    MatrixProperties,
    analyze,
    compare,
)

# --- eigens ---------------------------------------------------------------
from .eigens import EigenResult, compute as compute_eigen

# --- decompositions -------------------------------------------------------
from .decompositions import (
    DecompositionResult,
    cholesky,
    diagonalize,
    lu,
    qr,
    spectral,
)

# --- step solver ----------------------------------------------------------
from .step_solver import (
    StepList,
    steps_for_determinant,
    steps_for_inverse,
    steps_for_rank,
    steps_for_rref,
    steps_for_slau,
)

# --- system solver --------------------------------------------------------
from .matrix_solver import (
    SystemSolution,
    kronecker_capelli,
    solve_system,
)

# --- explanations ---------------------------------------------------------
from .explanations import explain


# =============================================================================
# Публичный список экспорта
# =============================================================================

__all__ = [
    # parser
    "parse_scalar",
    "parse_matrix",
    # validators
    "ValidationError",
    "check_size",
    "ensure_multiplicable",
    "ensure_nonzero_det",
    "ensure_same_shape",
    "ensure_square",
    "ensure_symbolic_ok",
    "ensure_chain_addable",
    "ensure_chain_multiplicable",
    "is_numeric_matrix",
    "safe_shape",
    # latex
    "matrix_to_latex",
    "matrix_to_plain",
    "expr_to_latex",
    # operations
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
    # properties
    "MatrixProperties",
    "analyze",
    "compare",
    # eigens
    "EigenResult",
    "compute_eigen",
    # decompositions
    "DecompositionResult",
    "lu",
    "qr",
    "cholesky",
    "diagonalize",
    "spectral",
    # step solver
    "StepList",
    "steps_for_determinant",
    "steps_for_rank",
    "steps_for_inverse",
    "steps_for_rref",
    "steps_for_slau",
    # system solver
    "SystemSolution",
    "solve_system",
    "kronecker_capelli",
    # explanations
    "explain",
]


# =============================================================================
# Метаданные пакета
# =============================================================================

__version__: str = "1.0.0"
__author__: str = "MatrixLab"