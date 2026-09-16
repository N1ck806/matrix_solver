"""
Проверки и ограничения для матричных операций.

Правила:
    1. Все проверки бросают ValidationError с человекочитаемым текстом.
    2. Никаких общих Exception — только ValidationError.
    3. Функции чистые, без side effects.
    4. Сообщения объясняют, ЧТО не так и ПОЧЕМУ.

Структура:
    1.  Исключение ValidationError
    2.  Константы из settings
    3.  Основные проверки (check_size, ensure_*)
    4.  Проверки для N матриц (chain)
    5.  Утилиты без исключений
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from django.conf import settings

if TYPE_CHECKING:
    import sympy as sp


# =============================================================================
# 1. ИСКЛЮЧЕНИЕ
# =============================================================================

class ValidationError(Exception):
    """Пользовательская ошибка. Отображается пользователю как есть."""

    def __init__(self, message: str, *, code: str = "invalid") -> None:
        super().__init__(message)
        self.message = message
        self.code = code

    def __str__(self) -> str:
        return self.message


# =============================================================================
# 2. КОНСТАНТЫ
# =============================================================================

def _get_limit(name: str, default: int) -> int:
    return int(getattr(settings, name, default))


# =============================================================================
# 3. ОСНОВНЫЕ ПРОВЕРКИ
# =============================================================================

def check_size(
    matrix: "sp.Matrix",
    max_rows: int | None = None,
    max_cols: int | None = None,
) -> None:
    """Проверить размеры матрицы."""
    if matrix is None:
        raise ValidationError("Матрица не задана.", code="empty")

    rows = matrix.rows
    cols = matrix.cols

    if rows == 0 or cols == 0:
        raise ValidationError("Матрица пуста.", code="empty")

    mr = max_rows if max_rows is not None else _get_limit("MAX_MATRIX_ROWS", 10)
    mc = max_cols if max_cols is not None else _get_limit("MAX_MATRIX_COLS", 10)

    if rows > mr or cols > mc:
        raise ValidationError(
            f"Размер матрицы {rows}×{cols} превышает допустимый предел "
            f"{mr}×{mc}. Уменьшите размер матрицы.",
            code="too_big",
        )


def ensure_square(matrix: "sp.Matrix") -> None:
    """Проверить, что матрица квадратная."""
    if matrix is None:
        raise ValidationError("Матрица не задана.", code="empty")
    if matrix.rows != matrix.cols:
        raise ValidationError(
            f"Матрица должна быть квадратной. "
            f"Текущий размер: {matrix.rows}×{matrix.cols}.",
            code="not_square",
        )


def ensure_same_shape(a: "sp.Matrix", b: "sp.Matrix") -> None:
    """Проверить, что матрицы одинакового размера."""
    if a.shape != b.shape:
        raise ValidationError(
            f"Размеры матриц не совпадают: "
            f"A имеет размер {a.rows}×{a.cols}, "
            f"B имеет размер {b.rows}×{b.cols}.",
            code="shape_mismatch",
        )


def ensure_multiplicable(a: "sp.Matrix", b: "sp.Matrix") -> None:
    """Проверить, что A и B можно умножить: A.cols == B.rows."""
    if a.cols != b.rows:
        raise ValidationError(
            f"Умножение невозможно: A имеет размер {a.rows}×{a.cols}, "
            f"B имеет размер {b.rows}×{b.cols}. "
            f"Для умножения количество столбцов A должно совпадать "
            f"с количеством строк B.",
            code="not_multiplicable",
        )


def ensure_nonzero_det(matrix: "sp.Matrix") -> None:
    """Проверить, что матрица квадратная и её определитель не ноль."""
    ensure_square(matrix)
    det = matrix.det()
    if det == 0:
        raise ValidationError(
            "Обратной матрицы не существует, поскольку матрица вырожденная "
            "(det(A) = 0).",
            code="singular",
        )


def ensure_symbolic_ok(matrix: "sp.Matrix") -> None:
    """Проверка размера символической матрицы."""
    limit = _get_limit("MAX_SYMBOLIC_SIZE", 5)
    if matrix.rows <= limit and matrix.cols <= limit:
        return
    has_symbols = any(bool(el.free_symbols) for el in matrix)
    if has_symbols:
        raise ValidationError(
            f"Символическая матрица размером {matrix.rows}×{matrix.cols} "
            f"превышает безопасный предел {limit}×{limit}. "
            f"Вычисления могут занять слишком много времени. "
            f"Уменьшите размер матрицы или замените символы числами.",
            code="symbolic_too_big",
        )


def ensure_numeric(matrix: "sp.Matrix") -> None:
    """Проверить, что матрица полностью числовая."""
    for i in range(matrix.rows):
        for j in range(matrix.cols):
            el = matrix[i, j]
            if el.free_symbols:
                raise ValidationError(
                    f"Элемент a[{i + 1},{j + 1}] = {el} содержит переменные. "
                    f"Для этой операции нужна полностью числовая матрица.",
                    code="not_numeric",
                )


def ensure_vector_dimensions(matrix: "sp.Matrix") -> None:
    """Проверить, что матрица — вектор (строка или столбец)."""
    if matrix.rows != 1 and matrix.cols != 1:
        raise ValidationError(
            f"Ожидается вектор (1×n или n×1), получена матрица "
            f"{matrix.rows}×{matrix.cols}.",
            code="not_vector",
        )


def ensure_power_range(k: int) -> None:
    """Проверить степень матрицы."""
    limit = _get_limit("MAX_MATRIX_POWER", 100)
    if not isinstance(k, int):
        raise ValidationError("Степень должна быть целым числом.", code="bad_power")
    if abs(k) > limit:
        raise ValidationError(
            f"Степень {k} превышает допустимый предел ±{limit}.",
            code="power_too_big",
        )


# =============================================================================
# 4. ПРОВЕРКИ ДЛЯ N МАТРИЦ (CHAIN)
# =============================================================================

def ensure_chain_addable(matrices: list["sp.Matrix"]) -> None:
    """Проверить, что все матрицы в цепочке одного размера (для add/subtract)."""
    if not matrices:
        raise ValidationError("Список матриц пуст.", code="empty")
    if len(matrices) < 2:
        raise ValidationError(
            "Для цепочки нужно минимум 2 матрицы.", code="too_few"
        )

    first_shape = matrices[0].shape
    for i, m in enumerate(matrices[1:], start=2):
        if m.shape != first_shape:
            raise ValidationError(
                f"Матрица №{i} имеет размер {m.rows}×{m.cols}, "
                f"а матрица №1 — {first_shape[0]}×{first_shape[1]}. "
                f"Для сложения/вычитания все матрицы должны быть "
                f"одного размера.",
                code="chain_shape_mismatch",
            )


def ensure_chain_multiplicable(matrices: list["sp.Matrix"]) -> None:
    """Проверить, что цепочка матриц согласована для умножения.

    A₁ (m×n) · A₂ (n×p) · A₃ (p×q) · ... — внутренние размеры совпадают.
    """
    if not matrices:
        raise ValidationError("Список матриц пуст.", code="empty")
    if len(matrices) < 2:
        raise ValidationError(
            "Для цепочки нужно минимум 2 матрицы.", code="too_few"
        )

    for i in range(len(matrices) - 1):
        a = matrices[i]
        b = matrices[i + 1]
        if a.cols != b.rows:
            raise ValidationError(
                f"Умножение невозможно: матрица №{i + 1} имеет размер "
                f"{a.rows}×{a.cols}, матрица №{i + 2} — {b.rows}×{b.cols}. "
                f"Количество столбцов матрицы №{i + 1} "
                f"({a.cols}) должно совпадать с количеством строк "
                f"матрицы №{i + 2} ({b.rows}).",
                code="chain_not_multiplicable",
            )


# =============================================================================
# 5. УТИЛИТЫ БЕЗ ИСКЛЮЧЕНИЙ
# =============================================================================

def is_numeric_matrix(matrix: "sp.Matrix") -> bool:
    """True, если в матрице нет свободных символов."""
    return all(not el.free_symbols for el in matrix)


def is_square(matrix: "sp.Matrix") -> bool:
    """True, если матрица квадратная."""
    return matrix.rows == matrix.cols


def safe_shape(shape: tuple[int, int]) -> str:
    """Строковое представление размера '3×4'."""
    rows, cols = shape
    return f"{rows}×{cols}"


def describe_shape(matrix: "sp.Matrix") -> str:
    """Готовое описание размера матрицы для сообщений."""
    return f"{matrix.rows}×{matrix.cols}"


def count_nonzero(matrix: "sp.Matrix") -> int:
    """Сколько ненулевых элементов в матрице."""
    return sum(1 for el in matrix if el != 0)