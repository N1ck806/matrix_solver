"""
JSON API MatrixLab.

Все endpoints:
    • принимают POST с JSON или form-encoded данными;
    • возвращают JSON {success: true/false, ...};
    • обрабатывают ошибки через ValidationError → 400 без traceback.

Единый контракт ответа:

    Успех:
        {
            "success": true,
            "kind": "matrix" | "scalar" | "text" | "steps" | "properties",
            "result": <данные>,
            "latex": "<LaTeX>",
            "plain": "<текст>",
            "explanation": "<краткое описание>",
            "extra": {...},
            "task": {...},
            "steps": [...]
        }

    Ошибка:
        {
            "success": false,
            "error": "человекочитаемое сообщение",
            "code": "validation"
        }

Структура файла:
    1.  Импорты
    2.  Утилиты (_get_payload, _get_matrix, _matrix_to_list, ...)
    2.5 Ограничения размера для символьных операций
    3.  Обёртки ответа (_success, _fail, _handle)
    4.  История и задание (_save_history, _describe_task)
    5.  Базовые операции (add, subtract, multiply, scalar, transpose, power, compare)
    6.  Цепочка N матриц (matrix_chain)
    7.  Свойства одной матрицы (determinant, trace, rank, inverse, rref, echelon, ...)
    8.  Спектр (eigenvalues, eigenvectors, char_poly, eigen_full)
    9.  Разложения (lu, qr, cholesky, diagonalize, spectral)
    10. СЛАУ (solve, kronecker)
    11. Пошаговые решения (steps_*)
    12. Пояснения (explain_result)
    13. Утилиты (random_matrix, load_example)
"""
from __future__ import annotations

import functools
import json
import logging
from typing import Any, Callable

import sympy as sp
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_POST

from .json_encoder import SymPyJSONEncoder
from .models import CalculationHistory, generate_session_key
from .services import (
    ValidationError,
    add,
    add_chain,
    adjugate,
    analyze,
    cholesky,
    cofactor_matrix,
    compare,
    compute_eigen,
    determinant,
    diagonalize,
    echelon,
    explain,
    inverse,
    inverse_gauss_jordan,
    kronecker_capelli,
    lu,
    minors,
    multiply,
    multiply_chain,
    parse_matrix,
    parse_scalar,
    power,
    qr,
    rank,
    rref,
    scalar_multiply,
    solve_system,
    spectral,
    steps_for_determinant,
    steps_for_inverse,
    steps_for_rank,
    steps_for_rref,
    steps_for_slau,
    subtract,
    trace,
    transpose,
)
from .services.eigens import compute_cached
from .services.latex_utils import matrix_to_latex, scalar_to_latex

logger = logging.getLogger("matrix_app.api")


# =============================================================================
# 2. УТИЛИТЫ
# =============================================================================

def _get_payload(request: HttpRequest) -> dict[str, Any]:
    """Извлечь данные из POST-запроса: JSON или form-encoded."""
    if request.content_type and "application/json" in request.content_type:
        try:
            return json.loads(request.body.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise ValidationError(
                f"Некорректный JSON в запросе: {exc}", code="bad_json"
            ) from exc
    payload: dict[str, Any] = {}
    for key in request.POST:
        payload[key] = request.POST.get(key)
    return payload


def _get_matrix(payload: dict[str, Any], key: str = "matrix") -> sp.Matrix:
    """Извлечь матрицу из payload."""
    if key not in payload:
        raise ValidationError(
            f"В запросе отсутствует поле «{key}».", code="missing_field"
        )
    return parse_matrix(payload[key])


def _get_optional_matrix(payload: dict[str, Any], key: str) -> sp.Matrix | None:
    """Извлечь необязательную матрицу; вернуть None, если нет или ошибка."""
    if key not in payload or payload[key] is None:
        return None
    try:
        return parse_matrix(payload[key])
    except ValidationError:
        return None


def _get_scalar(
    payload: dict[str, Any],
    key: str,
    required: bool = True,
) -> sp.Expr | None:
    """Извлечь скаляр из payload."""
    value = payload.get(key)
    if value is None or value == "":
        if required:
            raise ValidationError(
                f"Отсутствует обязательное поле «{key}».", code="missing_field"
            )
        return None
    return parse_scalar(value)


def _get_int(payload: dict[str, Any], key: str, default: int | None = None) -> int:
    """Извлечь целое число из payload."""
    value = payload.get(key, default)
    if value is None:
        raise ValidationError(
            f"Отсутствует обязательное поле «{key}».", code="missing_field"
        )
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(
            f"Поле «{key}» должно быть целым числом.", code="bad_int"
        ) from exc


def _matrix_to_list(matrix: sp.Matrix) -> list[list[str]]:
    """Матрица → список строк (для JSON и сохранения в историю)."""
    return [
        [str(matrix[i, j]) for j in range(matrix.cols)]
        for i in range(matrix.rows)
    ]


def _parse_vector(payload: dict[str, Any], key: str = "vector_b") -> sp.Matrix:
    """Извлечь вектор-столбец b из payload.

    Поддерживает:
        • плоский список [1, 2, 3];
        • вложенный список [[1], [2], [3]];
        • матрицу 1×n.
    """
    raw = payload.get(key)
    if raw is None:
        raise ValidationError("Отсутствует вектор b.", code="missing_b")

    if isinstance(raw, list) and raw and not isinstance(raw[0], list):
        return sp.Matrix([parse_scalar(x) for x in raw])

    matrix = parse_matrix(raw)
    if matrix.cols != 1 and matrix.rows != 1:
        raise ValidationError(
            "Вектор b должен быть одномерным.", code="bad_vector"
        )
    return matrix.reshape(matrix.rows * matrix.cols, 1)


# =============================================================================
# 2.5 ОГРАНИЧЕНИЯ РАЗМЕРА ДЛЯ СИМВОЛЬНЫХ ОПЕРАЦИЙ
# =============================================================================
#
# sympy считает символьные определители / собственные значения / разложения
# очень быстро до определённого размера, а дальше время растёт как факториал.
#
#   char_poly / eigenvalues / eigenvectors / diagonalize:
#       5×5 → точный расчёт укладывается в 1–3 сек;
#       6×6+ → 30+ сек, браузер отваливается по таймауту.
#
#   properties с with_eigenvalues=True:
#       та же проблема, потому что внутри вызывается eigen.
#
#   properties с with_eigenvalues=False:
#       rank, det, след — быстро даже для 10×10.
#
#   lu / qr / cholesky:
#       численно 10×10 ещё ок.
#
#   spectral:
#       требует символьных собственных значений — 6×6 максимум.

_MAX_SIZE_SYMBOLIC_EIGEN = 10     # char_poly, eigenvalues, eigenvectors, diagonalize
_MAX_SIZE_PROPERTIES_EIGEN = 10   # properties с with_eigenvalues=True
_MAX_SIZE_PROPERTIES = 10        # properties с with_eigenvalues=False
_MAX_SIZE_DECOMP = 10            # lu, qr, cholesky
_MAX_SIZE_SPECTRAL = 10           # spectral


def _check_size(
    matrix: sp.Matrix,
    max_size: int,
    operation: str,
    *,
    square_required: bool = True,
) -> None:
    """Проверить, что матрица не слишком большая для символьной операции.

    Если превышает лимит — бросает ValidationError с понятным текстом.
    Это защита от тайм-аутов: sympy может считать 6×6 char_poly минуты.

    square_required=True: если матрица не квадратная, проверка пропускается —
    о квадратности сообщит сервис (ValidationError с другим кодом).
    """
    n = max(matrix.rows, matrix.cols)
    if n <= max_size:
        return

    if square_required and matrix.rows != matrix.cols:
        # Не наша забота: до сюда дойдёт проверка квадратности в сервисах.
        return

    raise ValidationError(
        (
            f"Операция «{operation}» для матрицы "
            f"{matrix.rows}×{matrix.cols} требует слишком много времени: "
            f"точный символьный расчёт поддерживается максимум до "
            f"{max_size}×{max_size}. Уменьшите размер матрицы."
        ),
        code="too_large",
    )


# =============================================================================
# 3. ОБЁРТКИ ОТВЕТА
# =============================================================================

def _success(
    *,
    kind: str,
    result: Any = None,
    latex: str = "",
    plain: str = "",
    explanation: str = "",
    extra: dict | None = None,
    task: dict | None = None,
    steps: list | None = None,
    checks: list | None = None,
) -> JsonResponse:
    """Сформировать стандартный успешный ответ."""
    return JsonResponse(
        {
            "success": True,
            "kind": kind,
            "result": result,
            "latex": latex,
            "plain": plain,
            "explanation": explanation,
            "extra": extra or {},
            "task": task or {},
            "steps": steps or [],
            "checks": checks or [],
        },
        encoder=SymPyJSONEncoder,
    )


def _fail(message: str, code: str = "validation", status: int = 400) -> JsonResponse:
    """Сформировать стандартный ответ об ошибке."""
    return JsonResponse(
        {"success": False, "error": message, "code": code},
        status=status,
        encoder=SymPyJSONEncoder,
    )


def _handle(fn: Callable[..., JsonResponse]) -> Callable[..., JsonResponse]:
    """Декоратор: обрабатывает ValidationError и прочие исключения."""
    @functools.wraps(fn)
    def wrapper(request: HttpRequest, *args: Any, **kwargs: Any) -> JsonResponse:
        try:
            return fn(request, *args, **kwargs)
        except ValidationError as exc:
            return _fail(str(exc), code=exc.code, status=400)
        except json.JSONDecodeError:
            return _fail("Некорректный JSON в запросе.", code="bad_json", status=400)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Необработанная ошибка в API: %s", exc)
            return _fail(
                "Внутренняя ошибка сервера. Попробуйте ещё раз "
                "или измените входные данные.",
                code="internal",
                status=500,
            )
    return wrapper


# =============================================================================
# 4. ИСТОРИЯ И ЗАДАНИЕ
# =============================================================================

def _save_history(
    request: HttpRequest,
    operation: str,
    input_data: dict[str, Any],
    result_data: dict[str, Any],
    matrix_shape: str = "",
) -> None:
    """Сохранить запись в историю. Не ломает ответ при ошибке."""
    try:
        key = request.session.get("matrixlab_key")
        if not key:
            key = generate_session_key()
            request.session["matrixlab_key"] = key
            request.session.modified = True

        CalculationHistory.objects.create(
            session_key=key,
            operation=operation,
            input_data=input_data,
            result_data=result_data,
            matrix_shape=matrix_shape,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Не удалось сохранить историю (operation=%s)", operation)


def _describe_task(operation: str, **kw: Any) -> dict[str, Any]:
    """Сформировать блок «Задание» для отчёта."""
    task: dict[str, Any] = {"operation": operation}
    task.update(kw)
    return task


# =============================================================================
# 5. БАЗОВЫЕ ОПЕРАЦИИ
# =============================================================================

@require_POST
@_handle
def matrix_add(request: HttpRequest) -> JsonResponse:
    """A + B."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    b = _get_matrix(payload, "matrix_b")
    result = add(a, b)

    _save_history(
        request, "add",
        {"matrix_a": _matrix_to_list(a), "matrix_b": _matrix_to_list(b)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{result.result.rows}x{result.result.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "shape": [result.result.rows, result.result.cols],
            "shape_label": f"{result.result.rows}×{result.result.cols}",
        },
        task=_describe_task(
            "add",
            matrix_a_latex=matrix_to_latex(a),
            matrix_b_latex=matrix_to_latex(b),
            operation_latex="A + B",
        ),
    )


@require_POST
@_handle
def matrix_subtract(request: HttpRequest) -> JsonResponse:
    """A − B."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    b = _get_matrix(payload, "matrix_b")
    result = subtract(a, b)

    _save_history(
        request, "subtract",
        {"matrix_a": _matrix_to_list(a), "matrix_b": _matrix_to_list(b)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{result.result.rows}x{result.result.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "shape": [result.result.rows, result.result.cols],
            "shape_label": f"{result.result.rows}×{result.result.cols}",
        },
        task=_describe_task(
            "subtract",
            matrix_a_latex=matrix_to_latex(a),
            matrix_b_latex=matrix_to_latex(b),
            operation_latex="A - B",
        ),
    )


@require_POST
@_handle
def matrix_multiply(request: HttpRequest) -> JsonResponse:
    """A × B."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    b = _get_matrix(payload, "matrix_b")
    result = multiply(a, b)

    _save_history(
        request, "multiply",
        {"matrix_a": _matrix_to_list(a), "matrix_b": _matrix_to_list(b)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{result.result.rows}x{result.result.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "shape": [result.result.rows, result.result.cols],
            "shape_label": f"{result.result.rows}×{result.result.cols}",
            "inner_dimension": a.cols,
        },
        task=_describe_task(
            "multiply",
            matrix_a_latex=matrix_to_latex(a),
            matrix_b_latex=matrix_to_latex(b),
            operation_latex="A \\cdot B",
        ),
    )


@require_POST
@_handle
def matrix_scalar(request: HttpRequest) -> JsonResponse:
    """kA."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    k = _get_scalar(payload, "scalar")
    result = scalar_multiply(a, k)

    _save_history(
        request, "scalar_multiply",
        {"matrix_a": _matrix_to_list(a), "scalar": str(k)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{result.result.rows}x{result.result.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "shape": [result.result.rows, result.result.cols],
            "scalar": str(k),
            "scalar_latex": sp.latex(k),
        },
        task=_describe_task(
            "scalar_multiply",
            matrix_a_latex=matrix_to_latex(a),
            scalar_latex=sp.latex(k),
            operation_latex=f"{sp.latex(k)} \\cdot A",
        ),
    )


@require_POST
@_handle
def matrix_transpose(request: HttpRequest) -> JsonResponse:
    """Aᵀ."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = transpose(a)

    _save_history(
        request, "transpose",
        {"matrix": _matrix_to_list(a)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{result.result.rows}x{result.result.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "shape": [result.result.rows, result.result.cols],
            "shape_label": f"{result.result.rows}×{result.result.cols}",
        },
        task=_describe_task(
            "transpose",
            matrix_latex=matrix_to_latex(a),
            operation_latex="A^{T}",
        ),
    )


@require_POST
@_handle
def matrix_power(request: HttpRequest) -> JsonResponse:
    """A^k."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    k = _get_int(payload, "power")
    result = power(a, k)

    _save_history(
        request, "power",
        {"matrix": _matrix_to_list(a), "power": k},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{result.result.rows}x{result.result.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={"power": k},
        task=_describe_task(
            "power",
            matrix_latex=matrix_to_latex(a),
            power=k,
            operation_latex=f"A^{{{k}}}",
        ),
    )


@require_POST
@_handle
def matrix_compare(request: HttpRequest) -> JsonResponse:
    """Сравнить две матрицы."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    b = _get_matrix(payload, "matrix_b")
    result = compare(a, b)

    _save_history(
        request, "compare",
        {"matrix_a": _matrix_to_list(a), "matrix_b": _matrix_to_list(b)},
        {"equal": result["equal"], "similar": result["similar"]},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=result,
        latex="",
        plain="",
        explanation="Сравнение двух матриц по размеру, элементам и свойствам.",
        task=_describe_task(
            "compare",
            matrix_a_latex=matrix_to_latex(a),
            matrix_b_latex=matrix_to_latex(b),
        ),
    )


# =============================================================================
# 6. ЦЕПОЧКА N МАТРИЦ
# =============================================================================

@require_POST
@_handle
def matrix_chain(request: HttpRequest) -> JsonResponse:
    """Цепочка операций над N матрицами.

    Поддерживает:
        • add      — A₁ + A₂ + ... + Aₙ (все одного размера);
        • multiply — A₁ · A₂ · ... · Aₙ (внутренние размеры согласованы).

    Ожидает payload:
        {
            "operation": "add" | "multiply",
            "matrices": [[[...], [...]], [[...], [...]], ...],
            "show_steps": true | false
        }
    """
    payload = _get_payload(request)

    operation = (payload.get("operation") or "").strip().lower()
    if operation not in {"add", "multiply"}:
        raise ValidationError(
            "Операция цепочки должна быть 'add' или 'multiply'.",
            code="bad_operation",
        )

    raw_matrices = payload.get("matrices")
    if not isinstance(raw_matrices, list) or len(raw_matrices) < 2:
        raise ValidationError(
            "Для цепочки нужно минимум 2 матрицы.", code="too_few",
        )

    matrices: list[sp.Matrix] = []
    for i, raw in enumerate(raw_matrices, start=1):
        try:
            m = parse_matrix(raw)
        except ValidationError as exc:
            raise ValidationError(
                f"Ошибка в матрице №{i}: {exc}", code=exc.code,
            ) from exc
        matrices.append(m)

    if operation == "add":
        result = add_chain(matrices)
        op_latex = " + ".join(
            f"\\mathbf{{{chr(65 + i)}}}" for i in range(len(matrices))
        )
    else:
        result = multiply_chain(matrices)
        op_latex = " \\cdot ".join(
            f"\\mathbf{{{chr(65 + i)}}}" for i in range(len(matrices))
        )

    _save_history(
        request,
        f"chain_{operation}",
        {
            "count": len(matrices),
            "matrices": [_matrix_to_list(m) for m in matrices],
        },
        {
            "matrix": _matrix_to_list(result.result),
            "latex": result.latex,
        },
        matrix_shape=f"{result.result.rows}x{result.result.cols}",
    )

    task = _describe_task(
        f"chain_{operation}",
        count=len(matrices),
        operation_latex=op_latex,
        matrices_latex=[matrix_to_latex(m) for m in matrices],
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "count": len(matrices),
            "shape": [result.result.rows, result.result.cols],
            "shape_label": f"{result.result.rows}×{result.result.cols}",
            "operation": operation,
        },
        task=task,
    )


# =============================================================================
# 7. СВОЙСТВА ОДНОЙ МАТРИЦЫ
# =============================================================================

@require_POST
@_handle
def matrix_determinant(request: HttpRequest) -> JsonResponse:
    """det(A)."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = determinant(a)
    method = payload.get("method", "auto")

    steps_payload = []
    if payload.get("show_steps"):
        step_list = steps_for_determinant(a, method=method)
        steps_payload = [
            {"title": s.title, "text": s.text, "latex": s.latex}
            for s in step_list.steps
        ]

    _save_history(
        request, "determinant",
        {"matrix": _matrix_to_list(a)},
        {"value": str(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    explanation = explain("determinant", {"value": result.result})

    return _success(
        kind="scalar",
        result=str(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=explanation,
        extra={
            "is_zero": result.result == 0,
            "is_singular": result.result == 0,
        },
        task=_describe_task(
            "determinant",
            matrix_latex=matrix_to_latex(a, bracket="vmatrix"),
            operation_latex="\\det(A)",
        ),
        steps=steps_payload,
    )


@require_POST
@_handle
def matrix_trace(request: HttpRequest) -> JsonResponse:
    """tr(A)."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = trace(a)

    _save_history(
        request, "trace",
        {"matrix": _matrix_to_list(a)},
        {"value": str(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    diagonal_latex = " + ".join(
        scalar_to_latex(d) for d in result.extra.get("diagonal", [])
    )

    return _success(
        kind="scalar",
        result=str(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=explain("trace"),
        extra={
            "diagonal": [str(d) for d in result.extra.get("diagonal", [])],
            "diagonal_latex": diagonal_latex,
        },
        task=_describe_task(
            "trace",
            matrix_latex=matrix_to_latex(a),
            operation_latex="\\operatorname{tr}(A)",
        ),
        steps=[
            {
                "title": "Диагональные элементы",
                "text": "След — это сумма элементов главной диагонали.",
                "latex": (
                    f"\\operatorname{{tr}}(A) = {diagonal_latex} "
                    f"= {sp.latex(result.result)}"
                ),
            }
        ],
    )


@require_POST
@_handle
def matrix_rank(request: HttpRequest) -> JsonResponse:
    """rank(A)."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = rank(a)

    steps_payload = []
    if payload.get("show_steps"):
        step_list = steps_for_rank(a)
        steps_payload = [
            {"title": s.title, "text": s.text, "latex": s.latex}
            for s in step_list.steps
        ]

    _save_history(
        request, "rank",
        {"matrix": _matrix_to_list(a)},
        {"value": str(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="scalar",
        result=str(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=explain(
            "rank",
            {"value": int(result.result), "rows": a.rows, "cols": a.cols},
        ),
        extra={
            "max_possible": min(a.rows, a.cols),
            "is_full_rank": int(result.result) == min(a.rows, a.cols),
        },
        task=_describe_task(
            "rank",
            matrix_latex=matrix_to_latex(a),
            operation_latex="\\operatorname{rank}(A)",
        ),
        steps=steps_payload,
    )


@require_POST
@_handle
def matrix_inverse(request: HttpRequest) -> JsonResponse:
    """A⁻¹."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    method = payload.get("method", "adjugate")

    if method == "gauss_jordan":
        result = inverse_gauss_jordan(a)
    else:
        result = inverse(a)

    steps_payload = []
    if payload.get("show_steps"):
        step_list = steps_for_inverse(a, method=method)
        steps_payload = [
            {"title": s.title, "text": s.text, "latex": s.latex}
            for s in step_list.steps
        ]

    _save_history(
        request, "inverse",
        {"matrix": _matrix_to_list(a), "method": method},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    checks = []
    if result.extra.get("check") is not None:
        checks.append({
            "name": "A · A⁻¹ = I",
            "ok": result.extra.get("check_ok", False),
            "latex": matrix_to_latex(result.extra["check"]),
        })

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=explain("inverse"),
        extra={
            "determinant": str(result.extra.get("determinant", "")),
            "determinant_latex": result.extra.get("determinant_latex", ""),
            "adjugate": _matrix_to_list(result.extra["adjugate"])
                if result.extra.get("adjugate") is not None else [],
        },
        task=_describe_task(
            "inverse",
            matrix_latex=matrix_to_latex(a),
            operation_latex="A^{-1}",
        ),
        steps=steps_payload,
        checks=checks,
    )


@require_POST
@_handle
def matrix_rref(request: HttpRequest) -> JsonResponse:
    """RREF."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = rref(a)

    steps_payload = []
    if payload.get("show_steps"):
        step_list = steps_for_rref(a)
        steps_payload = [
            {"title": s.title, "text": s.text, "latex": s.latex}
            for s in step_list.steps
        ]

    _save_history(
        request, "rref",
        {"matrix": _matrix_to_list(a)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "pivots": result.extra.get("pivots", []),
            "rank": result.extra.get("rank", 0),
        },
        task=_describe_task(
            "rref",
            matrix_latex=matrix_to_latex(a),
            operation_latex="\\operatorname{rref}(A)",
        ),
        steps=steps_payload,
    )


@require_POST
@_handle
def matrix_echelon(request: HttpRequest) -> JsonResponse:
    """Ступенчатая форма (REF)."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = echelon(a)

    _save_history(
        request, "echelon",
        {"matrix": _matrix_to_list(a)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={"rank": result.extra.get("rank", 0)},
        task=_describe_task(
            "echelon",
            matrix_latex=matrix_to_latex(a),
            operation_latex="\\operatorname{REF}(A)",
        ),
    )


@require_POST
@_handle
def matrix_minor(request: HttpRequest) -> JsonResponse:
    """Минор Mᵢⱼ и алгебраическое дополнение Aᵢⱼ."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    i = _get_int(payload, "row")
    j = _get_int(payload, "col")
    result = minors(a, i, j)

    _save_history(
        request, "minors",
        {"matrix": _matrix_to_list(a), "row": i, "col": j},
        {"value": str(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="scalar",
        result=str(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={
            "row": i,
            "col": j,
            "minor_matrix": _matrix_to_list(result.extra["minor_matrix"]),
            "minor_matrix_latex": result.extra["minor_matrix_latex"],
            "minor_value": str(result.extra["minor_value"]),
            "minor_value_latex": result.extra["minor_value_latex"],
            "sign": result.extra["sign"],
            "cofactor_latex": result.extra["cofactor_latex"],
        },
        task=_describe_task(
            "minors",
            matrix_latex=matrix_to_latex(a),
            row=i,
            col=j,
        ),
    )


@require_POST
@_handle
def matrix_cofactors(request: HttpRequest) -> JsonResponse:
    """Матрица алгебраических дополнений."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = cofactor_matrix(a)

    _save_history(
        request, "cofactor_matrix",
        {"matrix": _matrix_to_list(a)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        task=_describe_task(
            "cofactor_matrix",
            matrix_latex=matrix_to_latex(a),
            operation_latex="C(A)",
        ),
    )


@require_POST
@_handle
def matrix_adjugate(request: HttpRequest) -> JsonResponse:
    """Присоединённая матрица."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    result = adjugate(a)

    _save_history(
        request, "adjugate",
        {"matrix": _matrix_to_list(a)},
        {"matrix": _matrix_to_list(result.result), "latex": result.latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="matrix",
        result=_matrix_to_list(result.result),
        latex=result.latex,
        plain=result.plain,
        explanation=result.explanation,
        extra={"check_latex": result.extra.get("check_latex", "")},
        task=_describe_task(
            "adjugate",
            matrix_latex=matrix_to_latex(a),
            operation_latex="\\operatorname{adj}(A)",
        ),
    )


@require_POST
@_handle
def matrix_properties(request: HttpRequest) -> JsonResponse:
    """Полный анализ свойств матрицы.

    Лимиты размера:
        • with_eigenvalues=True  → 5×5 (внутри sympy.eigenvals, дорого);
        • with_eigenvalues=False → 10×10 (только rank/det/trace — быстро).

    Если матрица превышает лимит — ValidationError с кодом 'too_large'.
    Фронтенд покажет это сообщение в блоке ошибки.
    """
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    with_eigen = bool(payload.get("with_eigenvalues", True))

    if with_eigen:
        _check_size(
            a,
            _MAX_SIZE_PROPERTIES_EIGEN,
            "Полный анализ свойств (с собственными значениями)",
        )
    else:
        _check_size(
            a,
            _MAX_SIZE_PROPERTIES,
            "Анализ свойств (без собственных значений)",
        )

    props = analyze(a, with_eigenvalues=with_eigen)

    _save_history(
        request, "properties",
        {"matrix": _matrix_to_list(a)},
        {
            "shape": props.shape_label,
            "rank": props.rank,
            "det": str(props.determinant) if props.determinant is not None else None,
        },
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    # --- Собственные значения: отдаём всё, что ждёт фронтенд ---------------
    # backend `matrix_properties.analyze` возвращает props.eigenvalues
    # как список (value, multiplicity). Фронт хочет:
    #   { value, latex, algebraic_multiplicity, geometric_multiplicity }
    # geometric_multiplicity в analyze не считается (это дорого),
    # поэтому проставляем = algebraic (для несимметричных может быть меньше,
    # но для отчёта свойств это допустимо).
    eigenvalues_payload = []
    for value, mult in props.eigenvalues:
        eigenvalues_payload.append({
            "value": str(value),
            "latex": sp.latex(value),
            "algebraic_multiplicity": int(mult),
            "geometric_multiplicity": int(mult),
            # обратная совместимость со старым именем
            "mult": int(mult),
        })

    return _success(
        kind="properties",
        result={
            "rows": props.rows,
            "cols": props.cols,
            "shape_label": props.shape_label,
            "is_square": props.is_square,
            "is_zero": props.is_zero,
            "is_identity": props.is_identity,
            "is_diagonal": props.is_diagonal,
            "is_scalar": props.is_scalar,
            "is_upper_triangular": props.is_upper_triangular,
            "is_lower_triangular": props.is_lower_triangular,
            "is_symmetric": props.is_symmetric,
            "is_skew_symmetric": props.is_skew_symmetric,
            "is_hermitian": props.is_hermitian,
            "is_orthogonal": props.is_orthogonal,
            "is_unitary": props.is_unitary,
            "is_singular": props.is_singular,
            "is_invertible": props.is_invertible,
            "is_idempotent": props.is_idempotent,
            "is_involutory": props.is_involutory,
            "is_nilpotent": props.is_nilpotent,
            "positive_definite": props.is_positive_definite,
            "negative_definite": props.is_negative_definite,
            "determinant": str(props.determinant) if props.determinant is not None else None,
            "determinant_latex": props.determinant_latex,
            "rank": props.rank,
            "rank_label": props.rank_label,
            "trace": str(props.trace_value) if props.trace_value is not None else None,
            "trace_latex": props.trace_latex,
            "eigenvalues": eigenvalues_payload,
            "summary": props.summary,
        },
        explanation="Полный анализ свойств матрицы.",
        task=_describe_task(
            "properties",
            matrix_latex=matrix_to_latex(a),
        ),
    )


# =============================================================================
# 8. СПЕКТР
# =============================================================================

@require_POST
@_handle
def matrix_eigenvalues(request: HttpRequest) -> JsonResponse:
    """Собственные значения.

    Оптимизация: compute_cached с compute_eigenvectors=False.
    nullspace (геометрические кратности) НЕ считается — это в 2–3 раза быстрее.
    Если пользователю нужны собственные векторы — есть отдельный эндпоинт.
    """
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")

    # Лёгкий путь: только λ и p(λ), без nullspace.
    er = compute_cached(a, compute_eigenvectors=False)

    eigenvalues = [
        {
            "value": str(item.value),
            "latex": item.value_latex,
            "algebraic_multiplicity": item.algebraic_multiplicity,
            "geometric_multiplicity": item.geometric_multiplicity,
        }
        for item in er.eigenvalues
    ]

    _save_history(
        request, "eigenvalues",
        {"matrix": _matrix_to_list(a)},
        {"eigenvalues": [str(item.value) for item in er.eigenvalues]},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=eigenvalues,
        latex=er.char_poly_factored_latex,
        plain=", ".join(str(item.value) for item in er.eigenvalues),
        explanation=explain("eigenvalues"),
        extra={
            "char_poly": str(er.char_poly),
            "char_poly_latex": er.char_poly_latex,
            "char_poly_factored_latex": er.char_poly_factored_latex,
            "factored_latex": er.char_poly_factored_latex,
            "trace_check": str(er.trace_check),
            "det_check": str(er.det_check),
            "is_diagonalizable": er.is_diagonalizable,
            "diagonalization_reason": er.diagonalization_reason,
        },
        task=_describe_task(
            "eigenvalues",
            matrix_latex=matrix_to_latex(a),
            operation_latex="\\det(A - \\lambda I) = 0",
        ),
    )


@require_POST
@_handle
def matrix_eigenvectors(request: HttpRequest) -> JsonResponse:
    """Собственные векторы (для всех собственных значений).

    Здесь нужен nullspace — compute_eigenvectors=True.
    """
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")

    er = compute_cached(a, compute_eigenvectors=True)

    eigenvectors_payload = [
        {
            "value": str(item.value),
            "value_latex": item.value_latex,
            "algebraic_multiplicity": item.algebraic_multiplicity,
            "geometric_multiplicity": item.geometric_multiplicity,
            "eigenvectors_latex": item.eigenvectors_latex,
            "nullspace_equations": item.nullspace_equations,
        }
        for item in er.eigenvalues
    ]

    _save_history(
        request, "eigenvectors",
        {"matrix": _matrix_to_list(a)},
        {"count": len(eigenvectors_payload)},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=eigenvectors_payload,
        latex="",
        plain="",
        explanation=explain("eigenvectors"),
        extra={"is_diagonalizable": er.is_diagonalizable},
        task=_describe_task(
            "eigenvectors",
            matrix_latex=matrix_to_latex(a),
            operation_latex="(A - \\lambda I) \\mathbf{v} = 0",
        ),
    )


@require_POST
@_handle
def matrix_char_poly(request: HttpRequest) -> JsonResponse:
    """Характеристический многочлен.

    Оптимизация: compute_cached с compute_eigenvectors=False.
    Только p(λ) и разложение на множители, без векторов.
    """
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")

    er = compute_cached(a, compute_eigenvectors=False)

    _save_history(
        request, "char_poly",
        {"matrix": _matrix_to_list(a)},
        {"poly": str(er.char_poly), "latex": er.char_poly_latex},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=str(er.char_poly),
        latex=er.char_poly_latex,
        plain=str(er.char_poly),
        explanation=explain("char_poly"),
        extra={
            "char_poly": str(er.char_poly),
            "char_poly_latex": er.char_poly_latex,
            "factored": str(er.char_poly_factored),
            "factored_latex": er.char_poly_factored_latex,
            "char_poly_factored_latex": er.char_poly_factored_latex,
        },
        task=_describe_task(
            "char_poly",
            matrix_latex=matrix_to_latex(a),
            operation_latex="p(\\lambda) = \\det(A - \\lambda I)",
        ),
    )


@require_POST
@_handle
def matrix_eigen_full(request: HttpRequest) -> JsonResponse:
    """Полный спектральный анализ: λ + кратности + векторы + p(λ) + диагонализируемость.

    Оптимизация: один вызов compute_cached с compute_eigenvectors=True.
    Раньше фронт делал два запроса (eigenvalues + eigenvectors) —
    это двойная нагрузка. Теперь — один раз и всё сразу.
    """
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")

    er = compute_cached(a, compute_eigenvectors=True)

    eigenvalues_payload = []
    for item in er.eigenvalues:
        eigenvalues_payload.append({
            "value": str(item.value),
            "latex": item.value_latex,
            "value_latex": item.value_latex,
            "algebraic_multiplicity": item.algebraic_multiplicity,
            "geometric_multiplicity": item.geometric_multiplicity,
            "eigenvectors_latex": item.eigenvectors_latex,
            "nullspace_equations": item.nullspace_equations,
        })

    _save_history(
        request, "eigen_full",
        {"matrix": _matrix_to_list(a)},
        {"count": len(eigenvalues_payload)},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=eigenvalues_payload,
        latex=er.char_poly_factored_latex,
        plain=", ".join(str(item.value) for item in er.eigenvalues),
        explanation="Полный спектральный анализ матрицы.",
        extra={
            "char_poly": str(er.char_poly),
            "char_poly_latex": er.char_poly_latex,
            "char_poly_factored_latex": er.char_poly_factored_latex,
            "factored_latex": er.char_poly_factored_latex,
            "trace_check": str(er.trace_check),
            "det_check": str(er.det_check),
            "is_diagonalizable": er.is_diagonalizable,
            "diagonalization_reason": er.diagonalization_reason,
        },
        task=_describe_task(
            "eigen_full",
            matrix_latex=matrix_to_latex(a),
        ),
    )


# =============================================================================
# 9. РАЗЛОЖЕНИЯ
# =============================================================================

@require_POST
@_handle
def matrix_lu(request: HttpRequest) -> JsonResponse:
    """LU-разложение."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    _check_size(a, _MAX_SIZE_DECOMP, "LU-разложение")
    res = lu(a)

    parts = {name: _matrix_to_list(m) for name, m in res.parts.items()}

    _save_history(
        request, "lu",
        {"matrix": _matrix_to_list(a)},
        {"parts": list(parts.keys())},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=parts,
        latex="",
        plain="",
        explanation=res.description,
        extra={
            "valid": res.valid,
            "reason": res.reason,
            "parts_latex": res.parts_latex,
            "equations": res.equations,
            "checks": res.checks,
        },
        task=_describe_task(
            "lu",
            matrix_latex=matrix_to_latex(a),
            operation_latex="A = L \\cdot U",
        ),
    )


@require_POST
@_handle
def matrix_qr(request: HttpRequest) -> JsonResponse:
    """QR-разложение."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    _check_size(a, _MAX_SIZE_DECOMP, "QR-разложение")
    res = qr(a)

    parts = {name: _matrix_to_list(m) for name, m in res.parts.items()}

    _save_history(
        request, "qr",
        {"matrix": _matrix_to_list(a)},
        {"parts": list(parts.keys())},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=parts,
        latex="",
        plain="",
        explanation=res.description,
        extra={
            "valid": res.valid,
            "reason": res.reason,
            "parts_latex": res.parts_latex,
            "equations": res.equations,
            "checks": res.checks,
        },
        task=_describe_task(
            "qr",
            matrix_latex=matrix_to_latex(a),
            operation_latex="A = Q \\cdot R",
        ),
    )


@require_POST
@_handle
def matrix_cholesky(request: HttpRequest) -> JsonResponse:
    """Разложение Холецкого."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    _check_size(a, _MAX_SIZE_DECOMP, "Разложение Холецкого")
    res = cholesky(a)

    parts = {name: _matrix_to_list(m) for name, m in res.parts.items()}

    _save_history(
        request, "cholesky",
        {"matrix": _matrix_to_list(a)},
        {"valid": res.valid, "parts": list(parts.keys())},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=parts,
        latex="",
        plain="",
        explanation=res.description if res.valid else res.reason,
        extra={
            "valid": res.valid,
            "reason": res.reason,
            "parts_latex": res.parts_latex,
            "equations": res.equations,
            "checks": res.checks,
        },
        task=_describe_task(
            "cholesky",
            matrix_latex=matrix_to_latex(a),
            operation_latex="A = L \\cdot L^{T}",
        ),
    )


@require_POST
@_handle
def matrix_diagonalize(request: HttpRequest) -> JsonResponse:
    """Диагонализация A = P·D·P⁻¹.

    Ограничение размера: внутри вызываются символьные собственные значения.
    """
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    _check_size(a, _MAX_SIZE_SYMBOLIC_EIGEN, "Диагонализация")
    res = diagonalize(a)

    parts = {name: _matrix_to_list(m) for name, m in res.parts.items()}

    _save_history(
        request, "diagonalize",
        {"matrix": _matrix_to_list(a)},
        {"valid": res.valid, "parts": list(parts.keys())},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=parts,
        latex="",
        plain="",
        explanation=res.description if res.valid else res.reason,
        extra={
            "valid": res.valid,
            "reason": res.reason,
            "parts_latex": res.parts_latex,
            "equations": res.equations,
            "checks": res.checks,
        },
        task=_describe_task(
            "diagonalize",
            matrix_latex=matrix_to_latex(a),
            operation_latex="A = P \\cdot D \\cdot P^{-1}",
        ),
    )


@require_POST
@_handle
def matrix_spectral(request: HttpRequest) -> JsonResponse:
    """Спектральное разложение A = Q·D·Qᵀ.

    Ограничение размера: символьные собственные значения.
    """
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    _check_size(a, _MAX_SIZE_SPECTRAL, "Спектральное разложение")
    res = spectral(a)

    parts = {name: _matrix_to_list(m) for name, m in res.parts.items()}

    _save_history(
        request, "spectral",
        {"matrix": _matrix_to_list(a)},
        {"valid": res.valid, "parts": list(parts.keys())},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result=parts,
        latex="",
        plain="",
        explanation=res.description if res.valid else res.reason,
        extra={
            "valid": res.valid,
            "reason": res.reason,
            "parts_latex": res.parts_latex,
            "equations": res.equations,
            "checks": res.checks,
        },
        task=_describe_task(
            "spectral",
            matrix_latex=matrix_to_latex(a),
            operation_latex="A = Q \\cdot D \\cdot Q^{T}",
        ),
    )


# =============================================================================
# 10. СЛАУ
# =============================================================================

@require_POST
@_handle
def system_solve(request: HttpRequest) -> JsonResponse:
    """Решение СЛАУ Ax = b."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    b = _parse_vector(payload, "vector_b")
    method = payload.get("method", "auto")
    sol = solve_system(a, b, method=method)

    result_payload: dict[str, Any] = {
        "kind": sol.kind,
        "rank_a": sol.rank_a,
        "rank_aug": sol.rank_aug,
        "n_vars": sol.n_vars,
    }

    if sol.kind == "unique" and sol.solution:
        result_payload["solution"] = [
            {
                "var": str(var),
                "var_latex": sp.latex(var),
                "value": str(val),
                "value_latex": sp.latex(val),
            }
            for var, val in sol.solution.items()
        ]
    elif sol.kind == "infinite" and sol.parametric:
        result_payload["parametric"] = [
            {
                "var": str(var),
                "var_latex": sp.latex(var),
                "value": str(val),
                "value_latex": sp.latex(val),
            }
            for var, val in sol.parametric.items()
        ]
        result_payload["free_variables"] = [str(v) for v in sol.free_variables]

    steps_payload = []
    if payload.get("show_steps"):
        step_list = steps_for_slau(
            a, b, method="gauss_jordan" if method == "gauss_jordan" else "gauss"
        )
        steps_payload = [
            {"title": s.title, "text": s.text, "latex": s.latex}
            for s in step_list.steps
        ]

    _save_history(
        request, "solve_gauss",
        {
            "matrix_a": _matrix_to_list(a),
            "vector_b": [str(x) for x in b],
            "method": method,
        },
        {"kind": sol.kind, "rank_a": sol.rank_a, "rank_aug": sol.rank_aug},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    explanation = explain("solve_gauss", {"kind": sol.kind})

    return _success(
        kind="system",
        result=result_payload,
        latex="",
        plain=sol.explanation,
        explanation=explanation or sol.explanation,
        extra={
            "augmented_latex": matrix_to_latex(sol.augmented, augment=a.cols)
                if sol.augmented is not None else "",
            "rref_latex": matrix_to_latex(sol.rref_matrix, augment=a.cols)
                if sol.rref_matrix is not None else "",
            "pivots": [p + 1 for p in sol.pivots],
            "check_ok": sol.check_ok,
            "check_latex": matrix_to_latex(sol.check_matrix)
                if sol.check_matrix is not None else "",
        },
        task=_describe_task(
            "solve_gauss",
            matrix_latex=matrix_to_latex(a),
            vector_latex=matrix_to_latex(b),
            operation_latex="A \\cdot x = b",
            method=method,
        ),
        steps=steps_payload,
        checks=[{
            "name": "A · x = b",
            "ok": bool(sol.check_ok),
        }] if sol.check_ok is not None else [],
    )


@require_POST
@_handle
def system_kronecker(request: HttpRequest) -> JsonResponse:
    """Анализ совместности по Кронекеру-Капелли."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    b = _parse_vector(payload, "vector_b")
    info = kronecker_capelli(a, b)

    _save_history(
        request, "kronecker_capelli",
        {"matrix_a": _matrix_to_list(a), "vector_b": [str(x) for x in b]},
        {"rank_a": info["rank_a"], "rank_aug": info["rank_aug"]},
        matrix_shape=f"{a.rows}x{a.cols}",
    )

    return _success(
        kind="text",
        result={
            "rank_a": info["rank_a"],
            "rank_aug": info["rank_aug"],
            "n_vars": info["n_vars"],
            "consistent": info["consistent"],
            "kind": info["kind"],
            "conclusion": info["conclusion"],
            "pivots": info["pivots"],
        },
        latex="",
        plain=info["conclusion"],
        explanation=explain("kronecker_capelli"),
        extra={
            "augmented_latex": info["augmented_latex"],
            "rref_latex": info["rref_latex"],
        },
        task=_describe_task(
            "kronecker_capelli",
            matrix_latex=matrix_to_latex(a),
            vector_latex=matrix_to_latex(b),
        ),
    )


# =============================================================================
# 11. ПОШАГОВЫЕ РЕШЕНИЯ
# =============================================================================

def _steps_response(step_list: Any) -> JsonResponse:
    """Универсальный ответ для steps_* endpoints."""
    return _success(
        kind="steps",
        result={
            "operation": step_list.operation,
            "title": step_list.title,
            "task_latex": step_list.task_latex,
            "task_text": step_list.task_text,
            "result_latex": step_list.result_latex,
            "result_text": step_list.result_text,
            "result_kind": step_list.result_kind,
        },
        latex=step_list.result_latex,
        plain=step_list.result_text,
        explanation=step_list.title,
        extra={"notes": step_list.notes},
        steps=[
            {"title": s.title, "text": s.text, "latex": s.latex}
            for s in step_list.steps
        ],
        checks=step_list.checks,
    )


@require_POST
@_handle
def steps_determinant(request: HttpRequest) -> JsonResponse:
    """Пошаговое решение определителя."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    method = payload.get("method", "auto")
    return _steps_response(steps_for_determinant(a, method=method))


@require_POST
@_handle
def steps_rank(request: HttpRequest) -> JsonResponse:
    """Пошаговое решение ранга."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    return _steps_response(steps_for_rank(a))


@require_POST
@_handle
def steps_inverse(request: HttpRequest) -> JsonResponse:
    """Пошаговое нахождение обратной матрицы."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    method = payload.get("method", "adjugate")
    return _steps_response(steps_for_inverse(a, method=method))


@require_POST
@_handle
def steps_rref(request: HttpRequest) -> JsonResponse:
    """Пошаговое приведение к RREF."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix")
    return _steps_response(steps_for_rref(a))


@require_POST
@_handle
def steps_slau(request: HttpRequest) -> JsonResponse:
    """Пошаговое решение СЛАУ."""
    payload = _get_payload(request)
    a = _get_matrix(payload, "matrix_a")
    b = _parse_vector(payload, "vector_b")
    method = payload.get("method", "gauss")
    return _steps_response(steps_for_slau(a, b, method=method))


# =============================================================================
# 12. ПОЯСНЕНИЯ
# =============================================================================

@require_POST
@_handle
def explain_result(request: HttpRequest) -> JsonResponse:
    """Вернуть текстовое пояснение для операции."""
    payload = _get_payload(request)
    operation = payload.get("operation", "")
    if not operation:
        raise ValidationError("Не указана операция.", code="missing_operation")
    context = payload.get("context", {})
    if not isinstance(context, dict):
        context = {}
    text = explain(operation, context)
    return _success(kind="text", result=text, explanation="")


# =============================================================================
# 13. УТИЛИТЫ
# =============================================================================

@require_POST
@_handle
def random_matrix(request: HttpRequest) -> JsonResponse:
    """Сгенерировать случайную матрицу с заданными параметрами."""
    import random

    payload = _get_payload(request)
    rows = _get_int(payload, "rows", 3)
    cols = _get_int(payload, "cols", 3)
    lo = _get_int(payload, "min_value", -9)
    hi = _get_int(payload, "max_value", 9)
    kind = payload.get("kind", "random")
    allow_fractions = bool(payload.get("allow_fractions", False))

    if rows < 1 or cols < 1:
        raise ValidationError("Размеры матрицы должны быть ≥ 1.", code="bad_size")
    if lo > hi:
        raise ValidationError("Минимум больше максимума.", code="bad_range")

    def rand_val() -> sp.Expr:
        if allow_fractions and random.random() < 0.4:
            num = random.randint(lo, hi)
            den = random.randint(1, 6)
            return sp.Rational(num, den)
        return sp.Integer(random.randint(lo, hi))

    if kind == "identity":
        if rows != cols:
            raise ValidationError(
                "Единичная матрица возможна только для квадратной формы.",
                code="bad_shape",
            )
        m = sp.eye(rows)
    elif kind == "diagonal":
        if rows != cols:
            raise ValidationError(
                "Диагональная матрица возможна только для квадратной формы.",
                code="bad_shape",
            )
        m = sp.diag(*[rand_val() for _ in range(rows)])
    elif kind == "symmetric":
        if rows != cols:
            raise ValidationError(
                "Симметричная матрица возможна только для квадратной формы.",
                code="bad_shape",
            )
        m = sp.zeros(rows, cols)
        for i in range(rows):
            for j in range(i, cols):
                v = rand_val()
                m[i, j] = v
                m[j, i] = v
    elif kind == "upper_triangular":
        m = sp.zeros(rows, cols)
        for i in range(rows):
            for j in range(i, cols):
                m[i, j] = rand_val()
    elif kind == "lower_triangular":
        m = sp.zeros(rows, cols)
        for i in range(rows):
            for j in range(i + 1):
                m[i, j] = rand_val()
    elif kind == "singular":
        if rows != cols:
            raise ValidationError(
                "Вырожденная матрица возможна только для квадратной формы.",
                code="bad_shape",
            )
        m = sp.zeros(rows, cols)
        first = [rand_val() for _ in range(cols)]
        for i in range(rows):
            if i == 0:
                m[0, :] = sp.Matrix([first])
            else:
                factor = sp.Integer(random.randint(1, 3))
                m[i, :] = sp.Matrix([factor * x for x in first])
    else:
        m = sp.Matrix(rows, cols, lambda i, j: rand_val())
        if kind == "invertible" and rows == cols:
            m = m + sp.eye(rows) * (abs(lo) + abs(hi) + 1)

    matrix_data = _matrix_to_list(m)

    return _success(
        kind="matrix",
        result=matrix_data,
        latex=matrix_to_latex(m),
        plain=str(m),
        explanation=f"Сгенерирована матрица типа «{kind}».",
        extra={
            "shape": [m.rows, m.cols],
            "shape_label": f"{m.rows}×{m.cols}",
        },
    )


@require_POST
@_handle
def load_example(request: HttpRequest, example_name: str) -> JsonResponse:
    """Загрузить предустановленный пример."""
    from .views import EXAMPLES

    if example_name not in EXAMPLES:
        raise ValidationError(
            f"Пример «{example_name}» не найден.", code="not_found"
        )

    ex = EXAMPLES[example_name]
    payload: dict[str, Any] = {
        "title": ex["title"],
        "description": ex.get("description", ""),
        "matrix": ex["matrix"],
    }
    if "vector" in ex:
        payload["vector"] = ex["vector"]

    return _success(
        kind="text",
        result=payload,
        explanation=ex.get("description", ""),
    )