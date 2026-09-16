"""
Пошаговые решения для основных операций.

Модуль строит человекочитаемые шаги решения: объяснения, формулы,
преобразования. Каждый шаг — StepData с полями:
    title     — короткий заголовок («Шаг 1. Находим определитель»);
    text      — пояснение (что делаем и почему);
    latex     — формула/матрица в LaTeX;
    matrices  — словарь именованных матриц для отображения;
    notes     — дополнительные пояснения/замечания.

Шаги возвращаются в StepList — упорядоченная коллекция с финальным
результатом.

Модуль намеренно не дублирует вычисления: использует matrix_operations
и matrix_solver для получения промежуточных данных, а сам занимается
только компоновкой пошагового нарратива.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .latex_utils import matrix_to_latex, scalar_to_latex
from .validators import ensure_square


# =============================================================================
# Данные
# =============================================================================

@dataclass
class StepData:
    """Один шаг решения."""
    title: str = ""
    text: str = ""
    latex: str = ""
    matrices: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class StepList:
    """Список шагов + финальный результат."""
    operation: str
    title: str = ""
    task_latex: str = ""           # задание
    task_text: str = ""
    steps: list[StepData] = field(default_factory=list)
    result_latex: str = ""         # результат
    result_text: str = ""
    result_kind: str = "scalar"    # scalar | matrix | text
    checks: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# =============================================================================
# Определитель
# =============================================================================

def steps_for_determinant(matrix: sp.Matrix, *, method: str = "auto") -> StepList:
    """Пошаговое вычисление определителя.

    Методы:
        'auto'        — выбирается по размеру: ≤3 — разложение по строке,
                        >3 — метод Гаусса;
        'cofactor'    — разложение по первой строке (метод миноров);
        'gauss'       — приведение к треугольной форме.
    """
    ensure_square(matrix)
    n = matrix.rows

    result = StepList(
        operation="determinant",
        title="Вычисление определителя",
    )
    result.task_latex = matrix_to_latex(matrix, bracket="vmatrix")
    result.task_text = f"Найти определитель матрицы A размера {n}×{n}."

    if n == 1:
        det_val = matrix[0, 0]
        result.steps.append(
            StepData(
                title="Шаг 1. Определитель матрицы 1×1",
                text="Определитель матрицы 1×1 равен её единственному элементу.",
                latex=f"\\det(A) = a_{{11}} = {sp.latex(det_val)}",
            )
        )
        result.result_latex = sp.latex(det_val)
        result.result_text = str(det_val)
        return result

    if n == 2:
        a, b = matrix[0, 0], matrix[0, 1]
        c, d = matrix[1, 0], matrix[1, 1]
        det_val = sp.simplify(a * d - b * c)
        result.steps.append(
            StepData(
                title="Шаг 1. Формула для матрицы 2×2",
                text="Для матрицы 2×2 определитель вычисляется по формуле ad − bc.",
                latex="\\det\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc",
            )
        )
        result.steps.append(
            StepData(
                title="Шаг 2. Подставляем значения",
                text="Подставляем элементы матрицы A.",
                latex=f"\\det(A) = ({sp.latex(a)})({sp.latex(d)}) - ({sp.latex(b)})({sp.latex(c)})",
            )
        )
        result.steps.append(
            StepData(
                title="Шаг 3. Вычисляем",
                text="",
                latex=f"\\det(A) = {sp.latex(det_val)}",
            )
        )
        result.result_latex = sp.latex(det_val)
        result.result_text = str(det_val)
        return result

    if n == 3 and method in ("auto", "cofactor"):
        return _determinant_3x3_cofactor(matrix, result)

    if method == "cofactor" or (method == "auto" and n <= 3):
        return _determinant_cofactor(matrix, result)

    return _determinant_gauss(matrix, result)


def _determinant_3x3_cofactor(matrix: sp.Matrix, result: StepList) -> StepList:
    """Разложение по первой строке для 3×3 (правило треугольников)."""
    a, b, c = matrix[0, 0], matrix[0, 1], matrix[0, 2]
    d, e, f = matrix[1, 0], matrix[1, 1], matrix[1, 2]
    g, h, k = matrix[2, 0], matrix[2, 1], matrix[2, 2]

    m11 = sp.simplify(e * k - f * h)
    m12 = sp.simplify(d * k - f * g)
    m13 = sp.simplify(d * h - e * g)

    det_val = sp.simplify(a * m11 - b * m12 + c * m13)

    result.steps.append(
        StepData(
            title="Шаг 1. Разложение по первой строке",
            text=(
                "Определитель можно разложить по первой строке через "
                "алгебраические дополнения: det(A) = a₁₁·A₁₁ + a₁₂·A₁₂ + a₁₃·A₁₃."
            ),
            latex="\\det(A) = \\sum_{j=1}^{3} (-1)^{1+j} a_{1j} M_{1j}",
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 2. Миноры первой строки",
            text="Находим миноры — определители матриц 2×2, полученных удалением первой строки и соответствующего столбца.",
            latex=(
                f"M_{{11}} = \\begin{{vmatrix}} {sp.latex(e)} & {sp.latex(f)} \\\\ "
                f"{sp.latex(h)} & {sp.latex(k)} \\end{{vmatrix}} = {sp.latex(m11)}, "
                f"\\quad M_{{12}} = \\begin{{vmatrix}} {sp.latex(d)} & {sp.latex(f)} \\\\ "
                f"{sp.latex(g)} & {sp.latex(k)} \\end{{vmatrix}} = {sp.latex(m12)}, "
                f"\\quad M_{{13}} = \\begin{{vmatrix}} {sp.latex(d)} & {sp.latex(e)} \\\\ "
                f"{sp.latex(g)} & {sp.latex(h)} \\end{{vmatrix}} = {sp.latex(m13)}"
            ),
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 3. Алгебраические дополнения",
            text="Учитываем знаки (−1)^(1+j).",
            latex=(
                f"A_{{11}} = +M_{{11}} = {sp.latex(m11)}, \\quad "
                f"A_{{12}} = -M_{{12}} = {sp.latex(-m12)}, \\quad "
                f"A_{{13}} = +M_{{13}} = {sp.latex(m13)}"
            ),
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 4. Собираем результат",
            text="",
            latex=(
                f"\\det(A) = {sp.latex(a)}\\cdot({sp.latex(m11)}) "
                f"- {sp.latex(b)}\\cdot({sp.latex(m12)}) "
                f"+ {sp.latex(c)}\\cdot({sp.latex(m13)}) = {sp.latex(det_val)}"
            ),
        )
    )
    result.result_latex = sp.latex(det_val)
    result.result_text = str(det_val)
    return result


def _determinant_cofactor(matrix: sp.Matrix, result: StepList) -> StepList:
    """Разложение по первой строке (общий случай)."""
    n = matrix.rows
    result.steps.append(
        StepData(
            title="Шаг 1. Разложение по первой строке",
            text=(
                "Используем разложение определителя по первой строке: "
                "det(A) = Σⱼ (−1)^(1+j) a₁ⱼ M₁ⱼ."
            ),
            latex="\\det(A) = \\sum_{j=1}^{n} (-1)^{1+j} a_{1j} M_{1j}",
        )
    )

    total = sp.Integer(0)
    detail_parts: list[str] = []
    for j in range(n):
        a1j = matrix[0, j]
        if a1j == 0:
            continue
        minor = matrix.minor_submatrix(0, j)
        m_val = minor.det()
        sign = (-1) ** (1 + (j + 1))
        term = sign * a1j * m_val
        total += term
        detail_parts.append(
            f"({sign:+d})\\cdot({sp.latex(a1j)})\\cdot({sp.latex(m_val)})"
        )

    total = sp.simplify(total)

    result.steps.append(
        StepData(
            title="Шаг 2. Миноры и знаки",
            text="Для каждого ненулевого элемента первой строки находим минор и умножаем на соответствующий знак.",
            latex="\\det(A) = " + " + ".join(detail_parts) if detail_parts else "\\det(A) = 0",
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 3. Итог",
            text="",
            latex=f"\\det(A) = {sp.latex(total)}",
        )
    )
    result.result_latex = sp.latex(total)
    result.result_text = str(total)
    return result


def _determinant_gauss(matrix: sp.Matrix, result: StepList) -> StepList:
    """Определитель методом Гаусса (приведение к треугольной форме)."""
    n = matrix.rows
    a = matrix.copy()
    sign = 1
    multipliers_note: list[str] = []

    result.steps.append(
        StepData(
            title="Шаг 1. Приведение к треугольной форме",
            text=(
                "Метод Гаусса: элементарными преобразованиями строк приводим "
                "матрицу к треугольной. Определитель треугольной матрицы равен "
                "произведению диагональных элементов. Перестановка строк меняет "
                "знак определителя."
            ),
        )
    )

    for k in range(n - 1):
        if a[k, k] == 0:
            # Ищем ненулевой элемент в столбце k ниже диагонали.
            found = None
            for i in range(k + 1, n):
                if a[i, k] != 0:
                    found = i
                    break
            if found is None:
                # Столбец нулевой — определитель 0.
                result.steps.append(
                    StepData(
                        title=f"Столбец {k + 1} обнулён",
                        text=(
                            f"Все элементы в столбце {k + 1} ниже строки {k + 1} "
                            f"равны нулю. Определитель равен 0."
                        ),
                        latex="\\det(A) = 0",
                    )
                )
                result.result_latex = "0"
                result.result_text = "0"
                return result
            a.row_swap(k, found)
            sign *= -1
            multipliers_note.append(
                f"R_{k + 1} \\leftrightarrow R_{found + 1} \\; (\\text{{знак}} \\times -1)"
            )

        pivot = a[k, k]
        for i in range(k + 1, n):
            if a[i, k] == 0:
                continue
            factor = sp.simplify(a[i, k] / pivot)
            a[i, :] = a[i, :] - factor * a[k, :]
            multipliers_note.append(
                f"R_{i + 1} \\to R_{i + 1} - ({sp.latex(factor)}) R_{k + 1}"
            )

    a = a.applyfunc(sp.simplify)

    # Определитель — произведение диагоналей, умноженное на знак.
    diag_product = sp.prod([a[i, i] for i in range(n)])
    det_val = sp.simplify(sign * diag_product)

    result.steps.append(
        StepData(
            title="Шаг 2. Преобразования",
            text="Выполненные операции:",
            latex=" \\\\ ".join(multipliers_note) if multipliers_note else "\\text{(преобразования не требовались)}",
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 3. Треугольная форма",
            text="Получена верхняя треугольная матрица.",
            latex=matrix_to_latex(a, bracket="bmatrix"),
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 4. Определитель треугольной матрицы",
            text="Определитель равен произведению диагональных элементов с учётом знака перестановок.",
            latex=(
                f"\\det(A) = ({sign:+d}) \\cdot \\prod_{{i=1}}^{{{n}}} a_{{ii}} "
                f"= {sp.latex(det_val)}"
            ),
        )
    )

    result.result_latex = sp.latex(det_val)
    result.result_text = str(det_val)
    return result


# =============================================================================
# Ранг
# =============================================================================

def steps_for_rank(matrix: sp.Matrix) -> StepList:
    """Пошаговое вычисление ранга."""
    result = StepList(operation="rank", title="Вычисление ранга матрицы")
    result.task_latex = matrix_to_latex(matrix)
    result.task_text = (
        f"Найти ранг матрицы A размера {matrix.rows}×{matrix.cols}. "
        f"Ранг — максимальное число линейно независимых строк (столбцов)."
    )

    # Приведение к ступенчатой форме с показом промежуточных состояний.
    m = matrix.copy()
    rows, cols = m.shape
    pivot_positions: list[tuple[int, int]] = []
    pivot_row = 0

    intermediate: list[sp.Matrix] = [m.copy()]
    transformations: list[str] = []

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
            transformations.append(
                f"R_{{{pivot_row + 1}}} \\leftrightarrow R_{{{pivot + 1}}}"
            )
            intermediate.append(m.copy())

        pivot_value = m[pivot_row, col]
        if pivot_value != 1:
            m[pivot_row, :] = m[pivot_row, :] / pivot_value
            transformations.append(
                f"R_{{{pivot_row + 1}}} \\to \\frac{{1}}{{{sp.latex(pivot_value)}}} \\cdot R_{{{pivot_row + 1}}}"
            )
            intermediate.append(m.copy())

        for r in range(pivot_row + 1, rows):
            if m[r, col] != 0:
                factor = m[r, col]
                m[r, :] = m[r, :] - factor * m[pivot_row, :]
                transformations.append(
                    f"R_{{{r + 1}}} \\to R_{{{r + 1}}} - ({sp.latex(factor)}) R_{{{pivot_row + 1}}}"
                )
                intermediate.append(m.copy())

        pivot_positions.append((pivot_row + 1, col + 1))
        pivot_row += 1

    m = m.applyfunc(sp.simplify)

    # Шаги.
    result.steps.append(
        StepData(
            title="Шаг 1. Исходная матрица",
            text="Приводим матрицу к ступенчатой форме методом Гаусса.",
            latex=matrix_to_latex(matrix),
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 2. Элементарные преобразования строк",
            text="Выполненные операции:",
            latex=" \\\\ ".join(transformations) if transformations else "\\text{(преобразования не требовались)}",
        )
    )
    result.steps.append(
        StepData(
            title="Шаг 3. Ступенчатая форма",
            text="",
            latex=matrix_to_latex(m),
        )
    )

    rank_value = len(pivot_positions)

    result.steps.append(
        StepData(
            title="Шаг 4. Подсчёт ненулевых строк",
            text=(
                f"В ступенчатой форме {rank_value} ненулевых строк. "
                f"Столбцы, где стоят ведущие элементы: "
                f"{[c for _, c in pivot_positions]}."
            ),
            latex=f"\\operatorname{{rank}}(A) = {rank_value}",
        )
    )

    result.result_latex = str(rank_value)
    result.result_text = str(rank_value)
    result.result_kind = "scalar"
    result.notes.append(
        f"Максимально возможный ранг для матрицы {rows}×{cols}: "
        f"min({rows}, {cols}) = {min(rows, cols)}."
    )

    return result


# =============================================================================
# Обратная матрица
# =============================================================================

def steps_for_inverse(matrix: sp.Matrix, *, method: str = "adjugate") -> StepList:
    """Пошаговое нахождение обратной матрицы.

    method:
        'adjugate'      — через присоединённую: A⁻¹ = adj(A)/det(A);
        'gauss_jordan'  — через расширенную матрицу [A | I].
    """
    ensure_square(matrix)
    n = matrix.rows
    det = matrix.det()

    result = StepList(operation="inverse", title="Нахождение обратной матрицы")
    result.task_latex = matrix_to_latex(matrix)
    result.task_text = f"Найти обратную матрицу A⁻¹ для A размера {n}×{n}."

    if det == 0:
        result.steps.append(
            StepData(
                title="Проверка обратимости",
                text="Определитель равен 0, матрица вырожденная — обратной не существует.",
                latex="\\det(A) = 0",
            )
        )
        result.result_latex = "\\text{не существует}"
        result.result_text = "не существует"
        result.result_kind = "text"
        return result

    result.steps.append(
        StepData(
            title="Шаг 1. Проверка обратимости",
            text=f"Определитель det(A) = {sp.latex(det)} ≠ 0. Обратная матрица существует.",
            latex=f"\\det(A) = {sp.latex(det)} \\neq 0",
        )
    )

    if method == "gauss_jordan":
        return _steps_inverse_gauss_jordan(matrix, result, det)

    # Через присоединённую.
    return _steps_inverse_adjugate(matrix, result, det)


def _steps_inverse_adjugate(matrix: sp.Matrix, result: StepList, det: sp.Expr) -> StepList:
    n = matrix.rows

    result.steps.append(
        StepData(
            title="Шаг 2. Формула через присоединённую матрицу",
            text=(
                "A⁻¹ = (1/det(A)) · adj(A), где adj(A) — присоединённая "
                "матрица: транспонированная матрица алгебраических дополнений."
            ),
            latex="A^{-1} = \\frac{1}{\\det(A)} \\cdot \\operatorname{adj}(A)",
        )
    )

    # Матрица кофакторов.
    cof = sp.Matrix(n, n, lambda i, j: ((-1) ** (i + j)) * matrix.minor(i, j))
    cof = cof.applyfunc(sp.simplify)

    result.steps.append(
        StepData(
            title="Шаг 3. Матрица алгебраических дополнений",
            text="Для каждого элемента вычисляем минор и учитываем знак (−1)^(i+j).",
            latex=matrix_to_latex(cof),
        )
    )

    adj = cof.T

    result.steps.append(
        StepData(
            title="Шаг 4. Присоединённая матрица",
            text="adj(A) = C(A)ᵀ — транспонируем матрицу алгебраических дополнений.",
            latex=matrix_to_latex(adj),
        )
    )

    inv = (adj / det).applyfunc(sp.simplify)

    result.steps.append(
        StepData(
            title="Шаг 5. Делим на определитель",
            text="",
            latex=(
                f"A^{{-1}} = \\frac{{1}}{{{sp.latex(det)}}} \\cdot "
                + matrix_to_latex(adj)
            ),
        )
    )

    # Проверка.
    check = (matrix * inv).applyfunc(sp.simplify)
    check_ok = check == sp.eye(n)

    result.steps.append(
        StepData(
            title="Шаг 6. Проверка",
            text="Умножаем A на A⁻¹. Должны получить единичную матрицу.",
            latex=matrix_to_latex(check),
        )
    )

    result.result_latex = matrix_to_latex(inv)
    result.result_text = sp.pretty(inv)
    result.result_kind = "matrix"
    result.checks.append({
        "name": "A · A⁻¹ = I",
        "ok": check_ok,
        "latex": matrix_to_latex(check),
    })

    return result


def _steps_inverse_gauss_jordan(matrix: sp.Matrix, result: StepList, det: sp.Expr) -> StepList:
    n = matrix.rows
    identity = sp.eye(n)
    aug = matrix.row_join(identity)

    result.steps.append(
        StepData(
            title="Шаг 2. Расширенная матрица",
            text="Составляем [A | I].",
            latex=matrix_to_latex(aug, augment=n),
        )
    )

    aug_rref, pivots = aug.rref()

    result.steps.append(
        StepData(
            title="Шаг 3. Приведение методом Гаусса-Жордана",
            text="Элементарными преобразованиями строк приводим левую часть к единичной матрице.",
            latex=matrix_to_latex(aug_rref, augment=n),
        )
    )

    inv = aug_rref[:, n:].applyfunc(sp.simplify)
    check = (matrix * inv).applyfunc(sp.simplify)
    check_ok = check == sp.eye(n)

    result.steps.append(
        StepData(
            title="Шаг 4. Извлекаем A⁻¹",
            text="Правая часть расширенной матрицы — это A⁻¹.",
            latex=matrix_to_latex(inv),
        )
    )

    result.steps.append(
        StepData(
            title="Шаг 5. Проверка",
            text="",
            latex=matrix_to_latex(check),
        )
    )

    result.result_latex = matrix_to_latex(inv)
    result.result_text = sp.pretty(inv)
    result.result_kind = "matrix"
    result.checks.append({
        "name": "A · A⁻¹ = I",
        "ok": check_ok,
        "latex": matrix_to_latex(check),
    })

    return result


# =============================================================================
# RREF
# =============================================================================

def steps_for_rref(matrix: sp.Matrix) -> StepList:
    """Пошаговое приведение к приведённой ступенчатой форме."""
    result = StepList(operation="rref", title="Приведение к RREF")
    result.task_latex = matrix_to_latex(matrix)
    result.task_text = (
        f"Привести матрицу A размера {matrix.rows}×{matrix.cols} "
        f"к приведённой ступенчатой форме."
    )

    result.steps.append(
        StepData(
            title="Шаг 1. Исходная матрица",
            text="Применяем метод Гаусса-Жордана: прямые и обратные ходы.",
            latex=matrix_to_latex(matrix),
        )
    )

    r, pivots = matrix.rref()

    result.steps.append(
        StepData(
            title="Шаг 2. Приведённая ступенчатая форма",
            text=(
                f"Получена RREF. Ведущие столбцы: "
                f"{[p + 1 for p in pivots]}. Ранг матрицы = {len(pivots)}."
            ),
            latex=matrix_to_latex(r),
        )
    )

    result.result_latex = matrix_to_latex(r)
    result.result_text = sp.pretty(r)
    result.result_kind = "matrix"
    result.notes.append(
        f"Ранг = {len(pivots)}. Ведущих столбцов: {len(pivots)}."
    )

    return result


# =============================================================================
# СЛАУ
# =============================================================================

def steps_for_slau(
    a: sp.Matrix,
    b: sp.Matrix,
    *,
    method: str = "gauss",
) -> StepList:
    """Пошаговое решение СЛАУ Ax = b.

    Не выполняет финальных проверок, но формирует полный нарратив:
    расширенная матрица → ступенчатая форма → обратный ход или вывод.
    """
    from .matrix_solver import solve_system  # локальный импорт во избежание цикла

    n = a.rows
    m = a.cols

    result = StepList(operation="solve_slau", title="Решение СЛАУ Ax = b")
    result.task_text = (
        f"Решить систему {n} уравнений с {m} неизвестными методом "
        f"«{'Гаусса' if method == 'gauss' else 'Гаусса-Жордана'}»."
    )

    aug = a.row_join(b)
    result.task_latex = matrix_to_latex(aug, augment=m)

    result.steps.append(
        StepData(
            title="Шаг 1. Расширенная матрица системы",
            text="Составляем расширенную матрицу [A | b].",
            latex=matrix_to_latex(aug, augment=m),
        )
    )

    if method == "gauss_jordan":
        r, pivots = aug.rref()
        result.steps.append(
            StepData(
                title="Шаг 2. Приведённая ступенчатая форма",
                text="Приводим к RREF методом Гаусса-Жордана.",
                latex=matrix_to_latex(r, augment=m),
            )
        )
    else:
        # Ступенчатая (без обратного хода) — используем echelon из matrix_operations.
        from .matrix_operations import echelon as _echelon

        ech_result = _echelon(aug)
        r = ech_result.result
        pivots = tuple(p[1] - 1 for p in ech_result.extra.get("pivots", []))
        result.steps.append(
            StepData(
                title="Шаг 2. Ступенчатая форма",
                text="Приводим к ступенчатой форме прямым ходом метода Гаусса.",
                latex=matrix_to_latex(r, augment=m),
            )
        )

    # Анализ решения.
    sol = solve_system(a, b)

    kind_map = {
        "unique": "Система имеет единственное решение.",
        "infinite": "Система имеет бесконечно много решений.",
        "none": "Система несовместна — решений нет.",
    }
    result.steps.append(
        StepData(
            title="Шаг 3. Анализ",
            text=kind_map.get(sol.kind, ""),
            latex=(
                f"\\operatorname{{rank}}(A) = {sol.rank_a}, \\quad "
                f"\\operatorname{{rank}}([A|b]) = {sol.rank_aug}"
            ),
        )
    )

    if sol.kind == "unique" and sol.solution:
        rows_sol = " \\\\ ".join(
            f"{sp.latex(var)} &= {sp.latex(val)}"
            for var, val in sol.solution.items()
        )
        result.steps.append(
            StepData(
                title="Шаг 4. Решение",
                text="Выражаем переменные.",
                latex=f"\\begin{{aligned}} {rows_sol} \\end{{aligned}}",
            )
        )
    elif sol.kind == "infinite" and sol.parametric:
        rows_sol = " \\\\ ".join(
            f"{sp.latex(var)} &= {sp.latex(val)}"
            for var, val in sol.parametric.items()
        )
        result.steps.append(
            StepData(
                title="Шаг 4. Параметрическое решение",
                text=(
                    "Свободные переменные обозначены параметрами. "
                    "Общее решение зависит от них."
                ),
                latex=f"\\begin{{aligned}} {rows_sol} \\end{{aligned}}",
            )
        )
    elif sol.kind == "none":
        result.steps.append(
            StepData(
                title="Шаг 4. Несовместность",
                text=(
                    "В приведённой системе появилось противоречивое уравнение "
                    "вида 0 = c, где c ≠ 0."
                ),
            )
        )

    # Итог.
    if sol.kind == "unique" and sol.solution:
        result.result_latex = " \\quad ".join(
            f"{sp.latex(var)} = {sp.latex(val)}"
            for var, val in sol.solution.items()
        )
        result.result_text = ", ".join(
            f"{var} = {val}" for var, val in sol.solution.items()
        )
        result.result_kind = "text"
    elif sol.kind == "infinite" and sol.parametric:
        result.result_latex = " \\quad ".join(
            f"{sp.latex(var)} = {sp.latex(val)}"
            for var, val in sol.parametric.items()
        )
        result.result_text = "; ".join(
            f"{var} = {val}" for var, val in sol.parametric.items()
        )
        result.result_kind = "text"
    else:
        result.result_latex = "\\text{Решений нет}"
        result.result_text = "Решений нет"
        result.result_kind = "text"

    return result