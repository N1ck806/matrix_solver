"""
Разложения матриц: LU, QR, Холецкого, диагонализация, спектральное.

Каждое разложение представлено функцией, возвращающей
DecompositionResult с полями:
    kind       — 'lu' | 'qr' | 'cholesky' | 'diagonalize' | 'spectral';
    parts      — словарь с частями (L, U, Q, R, ...);
    description— текстовое пояснение;
    latex      — словарь с LaTeX каждой части;
    checks     — проверки (например, восстановление A из частей);
    valid      — флаг, что разложение применимо;
    reason     — если не применимо, почему.

Структура файла:
    1.  Импорты
    2.  Контейнер результата (DecompositionResult)
    3.  LU-разложение
    4.  QR-разложение (Грам-Шмидт)
    5.  Разложение Холецкого
    6.  Диагонализация
    7.  Спектральное разложение симметричной матрицы
    8.  Вспомогательные функции
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from ..json_encoder import _to_jsonable
from .latex_utils import matrix_to_latex
from .validators import (
    ValidationError,
    ensure_square,
    ensure_symbolic_ok,
)


# =============================================================================
# 1. КОНТЕЙНЕР РЕЗУЛЬТАТА
# =============================================================================

@dataclass
class DecompositionResult:
    """Универсальный контейнер для результата разложения."""

    kind: str
    valid: bool = True
    reason: str = ""
    description: str = ""
    parts: dict[str, sp.Matrix] = field(default_factory=dict)
    parts_latex: dict[str, str] = field(default_factory=dict)
    equations: list[str] = field(default_factory=list)
    checks: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    def add_part(
        self,
        name: str,
        matrix: sp.Matrix,
        bracket: str = "bmatrix",
    ) -> None:
        """Добавить матрицу-часть с автоматическим LaTeX."""
        self.parts[name] = matrix
        self.parts_latex[name] = matrix_to_latex(matrix, bracket=bracket)

    def add_equation(self, latex: str) -> None:
        """Добавить уравнение в LaTeX."""
        self.equations.append(latex)

    def set_check(self, name: str, value: Any) -> None:
        """Установить проверку, конвертируя SymPy → примитивы."""
        self.checks[name] = _to_jsonable(value)


# =============================================================================
# 2. LU-РАЗЛОЖЕНИЕ
# =============================================================================

def lu(
    matrix: sp.Matrix,
    *,
    with_pivoting: bool = True,
) -> DecompositionResult:
    """LU-разложение: A = L·U (или P·A = L·U при перестановках).

    Для простоты используем собственный алгоритм Дулиттла, чтобы получить
    именно L с единицами на диагонали и U без перестановок. Если нужны
    перестановки, работаем через P·A = L·U.

    Args:
        matrix: Квадратная матрица SymPy.
        with_pivoting: Использовать ли частичный выбор главного элемента.

    Returns:
        DecompositionResult с полями L, U, (P), checks, equations.

    Raises:
        ValidationError: Если матрица не квадратная, пустая или содержит
            недопустимые символы.
    """
    # --- Валидация ---
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows
    if n == 0:  # pragma: no cover — ensure_square уже это проверяет
        raise ValidationError("Матрица пуста.", code="empty")

    # --- Инициализация ---
    a = matrix.copy()
    p = sp.eye(n)   # матрица перестановок
    l = sp.eye(n)   # нижняя треугольная с единицами на диагонали
    u = sp.zeros(n, n)  # верхняя треугольная

    # --- Прямой ход метода Гаусса ---
    for k in range(n):
        # Пивот: ищем первый ненулевой элемент в столбце k начиная со строки k.
        pivot = k
        if with_pivoting:
            for i in range(k, n):
                if a[i, k] != 0:
                    pivot = i
                    break

        if a[pivot, k] == 0:
            # Столбец полностью нулевой — фиксируем нули.
            # Это допустимо для вырожденных матриц.
            continue

        # Перестановка строк в A, P и L.
        if pivot != k:
            a.row_swap(k, pivot)
            p.row_swap(k, pivot)
            if k > 0:
                l.row_swap(k, pivot)
                # Обнуляем l в столбцах < k в переставленных строках —
                # стандартный приём Дулиттла с частичным пивотингом.
                for j in range(k):
                    l[k, j], l[pivot, j] = l[pivot, j], l[k, j]

        # Исключение элементов ниже диагонали.
        for i in range(k + 1, n):
            factor = sp.simplify(a[i, k] / a[k, k])
            l[i, k] = factor
            a[i, :] = a[i, :] - factor * a[k, :]

    # --- Финализация ---
    u = a.applyfunc(sp.simplify)
    l = l.applyfunc(sp.simplify)
    p = p.applyfunc(sp.simplify)

    # --- Проверки ---
    # P·A = L·U (если перестановки были) или A = L·U (если нет).
    pa = p * matrix
    lu_product = l * u

    check_equal = sp.simplify(pa - lu_product) == sp.zeros(n)

    det_from_lu = sp.prod([u[i, i] for i in range(n)])
    det_actual = matrix.det()
    det_p = sp.simplify(p.det()) if n > 0 else sp.Integer(1)
    det_check = sp.simplify(det_p * det_actual - det_from_lu) == 0

    # --- Результат ---
    result = DecompositionResult(
        kind="lu",
        description=(
            "LU-разложение: A = P⁻¹·L·U (или A = L·U при отсутствии "
            "перестановок). L — нижняя треугольная с единицами на диагонали, "
            "U — верхняя треугольная."
        ),
    )
    result.set_check("reconstruction_ok", check_equal)
    result.set_check("determinant_ok", det_check)
    result.set_check("det_from_lu", det_from_lu)
    result.set_check("det_actual", det_actual)

    result.add_part("L", l)
    result.add_part("U", u)
    if p != sp.eye(n):
        result.add_part("P", p)

    # Уравнения.
    if p == sp.eye(n):
        result.add_equation(r"A = L \cdot U")
    else:
        result.add_equation(r"P \cdot A = L \cdot U")
        result.add_equation(r"A = P^{-1} \cdot L \cdot U")

    return result


# =============================================================================
# 3. QR-РАЗЛОЖЕНИЕ (ГРАМ-ШМИДТ)
# =============================================================================

def qr(matrix: sp.Matrix) -> DecompositionResult:
    """QR-разложение: A = Q·R.

    Q — ортогональная (столбцы ортонормированы), R — верхняя треугольная.
    Реализован процесс Грама-Шмидта. Для точной арифметики SymPy
    он даёт корректные результаты (без численного дрейфа).

    Args:
        matrix: Матрица SymPy размера rows × cols, где rows ≥ cols.

    Returns:
        DecompositionResult с полями Q, R, checks, equations.

    Raises:
        ValidationError: Если rows < cols или матрица содержит
            недопустимые символы.
    """
    ensure_symbolic_ok(matrix)
    rows, cols = matrix.shape

    if rows < cols:
        raise ValidationError(
            "QR-разложение реализовано для матриц с rows ≥ cols. "
            f"Текущий размер: {rows}×{cols}.",
            code="bad_shape",
        )

    # --- Векторы-столбцы A ---
    a_cols = [matrix[:, j] for j in range(cols)]

    # --- Ортонормированные столбцы Q и верхняя треугольная R ---
    q_cols: list[sp.Matrix] = []
    r = sp.zeros(cols, cols)

    for j in range(cols):
        v = a_cols[j]
        for i in range(j):
            # Скалярное произведение (в комплексном случае — сопряжённое).
            r[i, j] = sp.simplify(q_cols[i].H * a_cols[j])
            v = v - r[i, j] * q_cols[i]

        norm_sq = sp.simplify((v.H * v)[0])
        norm = sp.sqrt(norm_sq)

        if norm == 0:
            # Линейная зависимость столбцов — обнуляем.
            r[j, j] = 0
            q_cols.append(sp.zeros(rows, 1))
            continue

        r[j, j] = sp.simplify(norm)
        q_cols.append(v.applyfunc(lambda x: sp.simplify(x / norm)))

    q = sp.Matrix.hstack(*q_cols) if q_cols else sp.zeros(rows, 0)
    q = q.applyfunc(sp.simplify)
    r = r.applyfunc(sp.simplify)

    # --- Проверки ---
    reconstruction = q * r
    check_ok = sp.simplify(reconstruction - matrix) == sp.zeros(rows, cols)

    orth_check: bool | None = None
    if rows == cols:
        orth_check = sp.simplify(q.T * q - sp.eye(rows)) == sp.zeros(rows)

    # --- Результат ---
    result = DecompositionResult(
        kind="qr",
        description=(
            "QR-разложение: A = Q·R. Q — ортонормированные столбцы "
            "(QᵀQ = I для квадратной Q), R — верхняя треугольная."
        ),
    )
    result.set_check("reconstruction_ok", check_ok)
    result.set_check("orthogonality_ok", orth_check)

    result.add_part("Q", q)
    result.add_part("R", r)
    result.add_equation(r"A = Q \cdot R")
    if rows == cols:
        result.add_equation(r"Q^{T} \cdot Q = I")

    return result


# =============================================================================
# 4. РАЗЛОЖЕНИЕ ХОЛЕЦКОГО
# =============================================================================

def cholesky(matrix: sp.Matrix) -> DecompositionResult:
    """Разложение Холецкого: A = L·Lᵀ.

    Применимо только для симметричных положительно определённых матриц.
    Если матрица не подходит — возвращаем DecompositionResult с valid=False
    и понятным reason.

    Args:
        matrix: Квадратная симметричная положительно определённая матрица.

    Returns:
        DecompositionResult с полями L, Lᵀ (если применимо) или
        valid=False с reason.
    """
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows

    # --- Проверка симметричности ---
    if sp.simplify(matrix - matrix.T) != sp.zeros(n):
        return DecompositionResult(
            kind="cholesky",
            valid=False,
            reason=(
                "Разложение Холецкого применимо только к симметричным "
                "матрицам. Матрица A не симметрична (A ≠ Aᵀ)."
            ),
        )

    # --- Проверка положительной определённости (критерий Сильвестра) ---
    try:
        for k in range(1, n + 1):
            minor = matrix[:k, :k].det()
            if minor.free_symbols:
                return DecompositionResult(
                    kind="cholesky",
                    valid=False,
                    reason=(
                        "Матрица содержит символьные элементы — "
                        "проверить положительную определённость "
                        "автоматически нельзя."
                    ),
                )
            if minor <= 0:
                return DecompositionResult(
                    kind="cholesky",
                    valid=False,
                    reason=(
                        f"Матрица не является положительно определённой: "
                        f"главный минор порядка {k} равен {minor} ≤ 0. "
                        f"Разложение Холецкого неприменимо."
                    ),
                )
    except Exception as exc:  # noqa: BLE001
        return DecompositionResult(
            kind="cholesky",
            valid=False,
            reason=f"Ошибка при проверке положительной определённости: {exc}",
        )

    # --- Построение L ---
    l = sp.zeros(n, n)
    for i in range(n):
        for j in range(i + 1):
            if i == j:
                s = sum(l[i, k] ** 2 for k in range(j))
                l[i, j] = sp.sqrt(sp.simplify(matrix[i, i] - s))
            else:
                s = sum(l[i, k] * l[j, k] for k in range(j))
                if l[j, j] == 0:
                    l[i, j] = 0
                else:
                    l[i, j] = sp.simplify((matrix[i, j] - s) / l[j, j])

    l = l.applyfunc(sp.simplify)
    lt = l.T

    # --- Проверка ---
    reconstruction = sp.simplify(l * lt)
    check_ok = reconstruction == sp.simplify(matrix)

    # --- Результат ---
    result = DecompositionResult(
        kind="cholesky",
        description=(
            "Разложение Холецкого: A = L·Lᵀ. L — нижняя треугольная. "
            "Применимо только к симметричным положительно определённым "
            "матрицам."
        ),
    )
    result.set_check("reconstruction_ok", check_ok)

    result.add_part("L", l)
    result.add_part("Lᵀ", lt)
    result.add_equation(r"A = L \cdot L^{T}")

    return result


# =============================================================================
# 5. ДИАГОНАЛИЗАЦИЯ
# =============================================================================

def diagonalize(matrix: sp.Matrix) -> DecompositionResult:
    """Диагонализация A = P·D·P⁻¹.

    Если матрица не диагонализируема — valid=False с указанием причины.

    Args:
        matrix: Квадратная матрица SymPy.

    Returns:
        DecompositionResult с полями P, D, P⁻¹ (если применимо) или
        valid=False с reason.
    """
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows
    eigen_dict = matrix.eigenvals()

    # --- Сборка собственных векторов ---
    p_cols: list[sp.Matrix] = []
    d_vals: list[sp.Expr] = []

    for value, alg_mult in eigen_dict.items():
        basis = (matrix - value * sp.eye(n)).nullspace()
        if len(basis) < alg_mult:
            return DecompositionResult(
                kind="diagonalize",
                valid=False,
                reason=(
                    f"Матрица не диагонализируема. Собственное значение "
                    f"λ = {sp.latex(value)} имеет алгебраическую кратность "
                    f"{alg_mult}, но геометрическую кратность {len(basis)}. "
                    f"Недостаточно линейно независимых собственных векторов."
                ),
            )
        for v in basis:
            p_cols.append(v)
            d_vals.append(value)

    if len(p_cols) != n:
        return DecompositionResult(
            kind="diagonalize",
            valid=False,
            reason="Не удалось собрать полный базис из собственных векторов.",
        )

    p = sp.Matrix.hstack(*p_cols).applyfunc(sp.simplify)
    d = sp.diag(*d_vals)

    # --- Проверка: A = P·D·P⁻¹ ---
    p_inv: sp.Matrix | None
    try:
        p_inv = p.inv()
        reconstruction = sp.simplify(p * d * p_inv)
        check_ok = reconstruction == sp.simplify(matrix)
    except Exception:  # noqa: BLE001
        check_ok = False
        p_inv = None

    # --- Результат ---
    result = DecompositionResult(
        kind="diagonalize",
        description=(
            "Диагонализация: A = P·D·P⁻¹. D — диагональная матрица "
            "собственных значений, P — матрица из собственных векторов "
            "(по столбцам)."
        ),
    )
    result.set_check("reconstruction_ok", check_ok)
    result.set_check("eigenvalues", [(str(v), 1) for v in d_vals])

    result.add_part("P", p)
    result.add_part("D", d)
    if p_inv is not None:
        result.add_part("P⁻¹", p_inv.applyfunc(sp.simplify))

    result.add_equation(r"A = P \cdot D \cdot P^{-1}")
    result.add_equation(r"A^{n} = P \cdot D^{n} \cdot P^{-1}")

    return result


# =============================================================================
# 6. СПЕКТРАЛЬНОЕ РАЗЛОЖЕНИЕ СИММЕТРИЧНОЙ МАТРИЦЫ
# =============================================================================

def spectral(matrix: sp.Matrix) -> DecompositionResult:
    """Спектральное разложение симметричной матрицы: A = Q·D·Qᵀ.

    Требуется симметричность. Для вещественной симметричной матрицы
    всегда существует ортонормированный базис собственных векторов.

    Args:
        matrix: Квадратная симметричная матрица SymPy.

    Returns:
        DecompositionResult с полями Q, D, Qᵀ (если применимо) или
        valid=False с reason.
    """
    ensure_square(matrix)
    ensure_symbolic_ok(matrix)

    n = matrix.rows

    # --- Проверка симметричности ---
    if sp.simplify(matrix - matrix.T) != sp.zeros(n):
        return DecompositionResult(
            kind="spectral",
            valid=False,
            reason=(
                "Спектральное разложение применимо только к симметричным "
                "матрицам. A ≠ Aᵀ."
            ),
        )

    eigen_dict = matrix.eigenvals()

    # --- Сборка всех собственных векторов ---
    all_vectors: list[sp.Matrix] = []
    for value, _alg_mult in eigen_dict.items():
        basis = (matrix - value * sp.eye(n)).nullspace()
        for v in basis:
            all_vectors.append(v)

    if len(all_vectors) != n:
        return DecompositionResult(
            kind="spectral",
            valid=False,
            reason="Не удалось построить полный базис из собственных векторов.",
        )

    # --- Ортонормирование (Грам-Шмидт) ---
    ortho: list[sp.Matrix] = []
    for v in all_vectors:
        w = v
        for u in ortho:
            w = w - (u.H * w)[0] * u
        norm = sp.sqrt(sp.simplify((w.H * w)[0]))
        if norm == 0:
            continue
        ortho.append(w.applyfunc(lambda x: sp.simplify(x / norm)))

    if len(ortho) != n:
        return DecompositionResult(
            kind="spectral",
            valid=False,
            reason="Ортонормирование не дало полного базиса.",
        )

    q = sp.Matrix.hstack(*ortho).applyfunc(sp.simplify)

    # D = Qᵀ·A·Q — должна быть диагональной.
    d = sp.simplify(q.T * matrix * q)

    # --- Проверка ---
    reconstruction = sp.simplify(q * d * q.T)
    check_ok = reconstruction == sp.simplify(matrix)

    # --- Результат ---
    result = DecompositionResult(
        kind="spectral",
        description=(
            "Спектральное разложение симметричной матрицы: A = Q·D·Qᵀ. "
            "Q — ортогональная, D — диагональная с собственными значениями."
        ),
    )
    result.set_check("reconstruction_ok", check_ok)

    result.add_part("Q", q)
    result.add_part("D", d)
    result.add_part("Qᵀ", q.T)

    result.add_equation(r"A = Q \cdot D \cdot Q^{T}")
    result.add_equation(r"Q^{T} \cdot Q = I")

    return result


# =============================================================================
# 7. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# =============================================================================

def is_applicable(kind: str, matrix: sp.Matrix) -> tuple[bool, str]:
    """Быстрая проверка применимости разложения без его выполнения.

    Args:
        kind: 'lu' | 'qr' | 'cholesky' | 'diagonalize' | 'spectral'.
        matrix: Матрица SymPy.

    Returns:
        (применимо, причина_если_нет).
    """
    try:
        ensure_symbolic_ok(matrix)
    except ValidationError as exc:
        return False, str(exc)

    if kind in {"lu", "cholesky", "diagonalize", "spectral"}:
        try:
            ensure_square(matrix)
        except ValidationError as exc:
            return False, str(exc)

    if kind == "qr":
        rows, cols = matrix.shape
        if rows < cols:
            return False, f"QR требует rows ≥ cols, получено {rows}×{cols}."

    if kind in {"cholesky", "spectral"}:
        n = matrix.rows
        if sp.simplify(matrix - matrix.T) != sp.zeros(n):
            return False, "Матрица должна быть симметричной."

    return True, ""