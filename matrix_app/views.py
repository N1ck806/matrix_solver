"""
HTML-представления MatrixLab.

Все страницы тонкие: получают данные из services/, формируют контекст,
рендерят шаблон. Основная логика — в services/, а не здесь.

Единый подход: если страница поддерживает форму (GET + POST через AJAX),
POST обрабатывается в API, а HTML-view только рендерит страницу.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from asgiref.sync import async_to_sync
from django.conf import settings
from django.contrib import messages
from django.http import (
    HttpRequest,
    HttpResponse,
    HttpResponseBadRequest,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST

from .forms import SaveMatrixForm
from .models import CalculationHistory, SavedMatrix
from .services import parse_matrix, ValidationError
from .services.explanations import list_operations
from .telegram_bot import process_update

logger = logging.getLogger("matrix_app.views")


# =============================================================================
# Утилиты для работы с сессией
# =============================================================================

def ensure_session_key(request: HttpRequest) -> str:
    """Вернуть session_key, создав его при необходимости.

    Используется как «идентификатор пользователя без авторизации»:
    привязывает историю и сохранённые матрицы к браузеру.
    """
    key = request.session.get("matrixlab_key")
    if not key:
        from .models import generate_session_key

        key = generate_session_key()
        request.session["matrixlab_key"] = key
        request.session.modified = True
    return key


# =============================================================================
# Примеры матриц (используются на нескольких страницах)
# =============================================================================

EXAMPLES: dict[str, dict[str, Any]] = {
    "matrix_2x2": {
        "title": "Матрица 2×2",
        "description": "Простой пример для базовых операций.",
        "matrix": [[1, 2], [3, 4]],
    },
    "matrix_3x3": {
        "title": "Матрица 3×3",
        "description": "Пример для определителя и обратной матрицы.",
        "matrix": [[2, -1, 0], [1, 3, 4], [0, 2, -2]],
    },
    "determinant": {
        "title": "Определитель 3×3",
        "description": "Матрица с ненулевым определителем для разложения по строке.",
        "matrix": [[1, 2, 3], [4, 5, 6], [7, 8, 10]],
    },
    "inverse": {
        "title": "Обратная матрица",
        "description": "Хорошо обусловленная матрица 3×3.",
        "matrix": [[1, 2, 3], [0, 1, 4], [5, 6, 0]],
    },
    "rank": {
        "title": "Ранг матрицы",
        "description": "Матрица с линейно зависимыми строками.",
        "matrix": [[1, 2, 3], [2, 4, 6], [1, 1, 1]],
    },
    "singular": {
        "title": "Вырожденная матрица",
        "description": "det(A) = 0 — обратной не существует.",
        "matrix": [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
    },
    "symmetric": {
        "title": "Симметричная матрица",
        "description": "A = Aᵀ, подходит для спектрального разложения.",
        "matrix": [[2, 1, 0], [1, 3, 1], [0, 1, 2]],
    },
    "fractions": {
        "title": "Матрица с дробями",
        "description": "Точная арифметика: дроби сохраняются как Rational.",
        "matrix": [["1/2", "1/3"], ["1/4", "1/5"]],
    },
    "complex": {
        "title": "Комплексная матрица",
        "description": "Элементы вида a+bi.",
        "matrix": [["1+i", "2"], ["2", "1-i"]],
    },
    "slau_unique": {
        "title": "СЛАУ с единственным решением",
        "description": "Квадратная система с det ≠ 0.",
        "matrix": [[2, 1, -1], [1, 3, 2], [3, -1, 1]],
        "vector": [8, 13, 5],
    },
    "slau_infinite": {
        "title": "СЛАУ с бесконечным множеством решений",
        "description": "rank(A) = rank([A|b]) < n.",
        "matrix": [[1, 2, 3], [2, 4, 6], [1, 1, 1]],
        "vector": [1, 2, 3],
    },
    "slau_none": {
        "title": "Несовместная СЛАУ",
        "description": "rank(A) ≠ rank([A|b]).",
        "matrix": [[1, 1], [2, 2], [3, 3]],
        "vector": [1, 2, 4],
    },
}


# =============================================================================
# Главная
# =============================================================================

def home(request: HttpRequest) -> HttpResponse:
    """Главная страница: описание сервиса, возможности, примеры."""
    return render(
        request,
        "matrix_app/home.html",
        {
            "examples": EXAMPLES,
            "featured_examples": [
                EXAMPLES["matrix_3x3"],
                EXAMPLES["determinant"],
                EXAMPLES["inverse"],
            ],
        },
    )


# =============================================================================
# Калькулятор
# =============================================================================

def calculator(request: HttpRequest) -> HttpResponse:
    """Калькулятор: одна матрица, множество операций."""
    return render(
        request,
        "matrix_app/calculator.html",
        {
            "examples": EXAMPLES,
            "operations": [
                {"code": "determinant", "label": "Определитель", "icon": "="},
                {"code": "rank", "label": "Ранг", "icon": "#"},
                {"code": "inverse", "label": "Обратная матрица", "icon": "⁻¹"},
                {"code": "transpose", "label": "Транспонирование", "icon": "ᵀ"},
                {"code": "trace", "label": "След", "icon": "tr"},
                {"code": "rref", "label": "RREF", "icon": "⇉"},
                {"code": "echelon", "label": "Ступенчатая форма", "icon": "△"},
                {"code": "properties", "label": "Свойства", "icon": "✓"},
                {"code": "eigenvalues", "label": "Собственные значения", "icon": "λ"},
                {"code": "char_poly", "label": "Характеристический многочлен", "icon": "p(λ)"},
                {"code": "lu", "label": "LU-разложение", "icon": "LU"},
                {"code": "qr", "label": "QR-разложение", "icon": "QR"},
                {"code": "cholesky", "label": "Разложение Холецкого", "icon": "LLᵀ"},
                {"code": "diagonalize", "label": "Диагонализация", "icon": "PDP⁻¹"},
            ],
        },
    )


# =============================================================================
# Операции над двумя матрицами
# =============================================================================

def operations(request: HttpRequest) -> HttpResponse:
    """Операции над A и B (сложение, умножение, сравнение и т.д.)."""
    return render(
        request,
        "matrix_app/operations.html",
        {
            "examples": EXAMPLES,
        },
    )


# =============================================================================
# Свойства
# =============================================================================

def properties(request: HttpRequest) -> HttpResponse:
    """Анализ свойств матрицы."""
    return render(
        request,
        "matrix_app/properties.html",
        {"examples": EXAMPLES},
    )


# =============================================================================
# СЛАУ
# =============================================================================

def systems(request: HttpRequest) -> HttpResponse:
    """Решение систем линейных уравнений."""
    return render(
        request,
        "matrix_app/systems.html",
        {
            "examples": EXAMPLES,
            "methods": [
                {"code": "auto", "label": "Автоматически"},
                {"code": "gauss", "label": "Метод Гаусса"},
                {"code": "gauss_jordan", "label": "Метод Гаусса-Жордана"},
                {"code": "cramer", "label": "Правило Крамера"},
                {"code": "inverse", "label": "Через обратную матрицу"},
            ],
        },
    )


# =============================================================================
# Разложения
# =============================================================================

def decompositions(request: HttpRequest) -> HttpResponse:
    """LU, QR, Холецкий, диагонализация, спектральное."""
    return render(
        request,
        "matrix_app/decompositions.html",
        {"examples": EXAMPLES},
    )


# =============================================================================
# Спектр
# =============================================================================

def eigen(request: HttpRequest) -> HttpResponse:
    """Собственные значения, векторы, характеристический многочлен."""
    return render(
        request,
        "matrix_app/eigen.html",
        {"examples": EXAMPLES},
    )


# =============================================================================
# Теория
# =============================================================================

THEORY_TOPICS: list[dict[str, str]] = [
    {"slug": "matrix-basics", "title": "Что такое матрица", "category": "Основы"},
    {"slug": "matrix-types", "title": "Виды матриц", "category": "Основы"},
    {"slug": "matrix-size", "title": "Размер матрицы", "category": "Основы"},
    {"slug": "addition", "title": "Сложение матриц", "category": "Операции"},
    {"slug": "subtraction", "title": "Вычитание матриц", "category": "Операции"},
    {"slug": "multiplication", "title": "Умножение матриц", "category": "Операции"},
    {"slug": "scalar", "title": "Умножение на скаляр", "category": "Операции"},
    {"slug": "transpose", "title": "Транспонирование", "category": "Операции"},
    {"slug": "power", "title": "Возведение в степень", "category": "Операции"},
    {"slug": "determinant", "title": "Определитель", "category": "Определители"},
    {"slug": "minors", "title": "Миноры и алгебраические дополнения", "category": "Определители"},
    {"slug": "inverse", "title": "Обратная матрица", "category": "Определители"},
    {"slug": "rank", "title": "Ранг матрицы", "category": "Ранг"},
    {"slug": "slau", "title": "Системы линейных уравнений", "category": "СЛАУ"},
    {"slug": "gauss", "title": "Метод Гаусса", "category": "СЛАУ"},
    {"slug": "gauss-jordan", "title": "Метод Гаусса-Жордана", "category": "СЛАУ"},
    {"slug": "cramer", "title": "Правило Крамера", "category": "СЛАУ"},
    {"slug": "kronecker", "title": "Теорема Кронекера-Капелли", "category": "СЛАУ"},
    {"slug": "eigenvalues", "title": "Собственные значения", "category": "Спектр"},
    {"slug": "eigenvectors", "title": "Собственные векторы", "category": "Спектр"},
    {"slug": "char-poly", "title": "Характеристический многочлен", "category": "Спектр"},
    {"slug": "diagonalization", "title": "Диагонализация", "category": "Спектр"},
    {"slug": "lu", "title": "LU-разложение", "category": "Разложения"},
    {"slug": "qr", "title": "QR-разложение", "category": "Разложения"},
    {"slug": "cholesky", "title": "Разложение Холецкого", "category": "Разложения"},
    {"slug": "orthogonal", "title": "Ортогональные матрицы", "category": "Специальные"},
    {"slug": "symmetric", "title": "Симметричные матрицы", "category": "Специальные"},
    {"slug": "positive-definite", "title": "Положительно определённые матрицы", "category": "Специальные"},
]


def theory(request: HttpRequest) -> HttpResponse:
    """Раздел теории. Группируем темы по категориям."""
    categories: dict[str, list[dict[str, str]]] = {}
    for topic in THEORY_TOPICS:
        categories.setdefault(topic["category"], []).append(topic)

    return render(
        request,
        "matrix_app/theory.html",
        {
            "topics": THEORY_TOPICS,
            "categories": categories,
        },
    )


# =============================================================================
# Виды матриц
# =============================================================================

MATRIX_TYPES: list[dict[str, Any]] = [
    {
        "slug": "square",
        "title": "Квадратная матрица",
        "category": "Базовые",
        "definition": "Матрица, у которой число строк равно числу столбцов.",
        "formula": "m = n",
        "example": "[[1, 2], [3, 4]]",
        "uses": "Определитель, обратная матрица, собственные значения.",
    },
    {
        "slug": "zero",
        "title": "Нулевая матрица",
        "category": "Базовые",
        "definition": "Все элементы равны нулю.",
        "formula": "aᵢⱼ = 0",
        "example": "[[0, 0], [0, 0]]",
        "uses": "Нейтральный элемент по сложению.",
    },
    {
        "slug": "identity",
        "title": "Единичная матрица",
        "category": "Базовые",
        "definition": "Диагональные элементы равны 1, остальные — 0.",
        "formula": "aᵢᵢ = 1, aᵢⱼ = 0 при i ≠ j",
        "example": "[[1, 0], [0, 1]]",
        "uses": "Нейтральный элемент по умножению.",
    },
    {
        "slug": "diagonal",
        "title": "Диагональная матрица",
        "category": "Базовые",
        "definition": "Все внедиагональные элементы равны нулю.",
        "formula": "aᵢⱼ = 0 при i ≠ j",
        "example": "[[2, 0], [0, 5]]",
        "uses": "Быстрое умножение, спектральные задачи.",
    },
    {
        "slug": "symmetric",
        "title": "Симметричная матрица",
        "category": "Специальные",
        "definition": "Совпадает со своей транспонированной: A = Aᵀ.",
        "formula": "aᵢⱼ = aⱼᵢ",
        "example": "[[1, 2], [2, 3]]",
        "uses": "Спектральное разложение, оптимизация.",
    },
    {
        "slug": "orthogonal",
        "title": "Ортогональная матрица",
        "category": "Специальные",
        "definition": "Квадратная матрица, у которой AᵀA = I.",
        "formula": "Aᵀ · A = I",
        "example": "[[0, -1], [1, 0]] — матрица поворота",
        "uses": "Повороты, отражения, QR-разложение.",
    },
    {
        "slug": "positive-definite",
        "title": "Положительно определённая",
        "category": "Специальные",
        "definition": "Симметричная матрица, у которой все собственные значения положительны.",
        "formula": "xᵀAx > 0 для всех x ≠ 0",
        "example": "[[2, 0], [0, 3]]",
        "uses": "Оптимизация, разложение Холецкого, статистика.",
    },
    {
        "slug": "idempotent",
        "title": "Идемпотентная матрица",
        "category": "Специальные",
        "definition": "Матрица, равная своему квадрату: A² = A.",
        "formula": "A · A = A",
        "example": "[[1, 0], [0, 0]] — проектор",
        "uses": "Проекторы, статистика (матрица-шляпа).",
    },
    {
        "slug": "nilpotent",
        "title": "Нильпотентная матрица",
        "category": "Специальные",
        "definition": "Некоторая степень равна нулю: Aᵏ = 0.",
        "formula": "Aᵏ = 0 для некоторого k ≥ 1",
        "example": "[[0, 1], [0, 0]]",
        "uses": "Разложение Жордана, теория нильпотентных операторов.",
    },
    {
        "slug": "triangular",
        "title": "Треугольная матрица",
        "category": "Специальные",
        "definition": "Все элементы выше (или ниже) главной диагонали равны нулю.",
        "formula": "aᵢⱼ = 0 при i > j (верхняя)",
        "example": "[[1, 2], [0, 3]]",
        "uses": "LU-разложение, решение СЛАУ, определитель — произведение диагоналей.",
    },
]


def types(request: HttpRequest) -> HttpResponse:
    """Классификация матриц по видам."""
    categories: dict[str, list[dict[str, Any]]] = {}
    for t in MATRIX_TYPES:
        categories.setdefault(t["category"], []).append(t)

    return render(
        request,
        "matrix_app/types.html",
        {
            "types": MATRIX_TYPES,
            "categories": categories,
        },
    )


# =============================================================================
# История
# =============================================================================

def history(request: HttpRequest) -> HttpResponse:
    """История вычислений пользователя (по сессии)."""
    key = ensure_session_key(request)
    entries = CalculationHistory.objects.filter(session_key=key)[:200]
    return render(
        request,
        "matrix_app/history.html",
        {
            "history_entries": entries,
            "history_count": entries.count(),
        },
    )


@require_POST
def delete_history_entry(request: HttpRequest, pk: int) -> JsonResponse:
    """Удалить одну запись истории."""
    key = ensure_session_key(request)
    entry = get_object_or_404(CalculationHistory, pk=pk, session_key=key)
    entry.delete()
    return JsonResponse({"success": True})


@require_POST
def clear_history(request: HttpRequest) -> JsonResponse:
    """Очистить всю историю пользователя."""
    key = ensure_session_key(request)
    CalculationHistory.objects.filter(session_key=key).delete()
    return JsonResponse({"success": True})


# =============================================================================
# Сохранённые матрицы
# =============================================================================

def saved_matrices(request: HttpRequest) -> HttpResponse:
    """Список сохранённых матриц."""
    key = ensure_session_key(request)
    items = SavedMatrix.objects.filter(session_key=key)
    return render(
        request,
        "matrix_app/saved.html",
        {"saved": items},
    )


@require_POST
def save_matrix(request: HttpRequest) -> JsonResponse:
    """Сохранить именованную матрицу (через API)."""
    key = ensure_session_key(request)
    form = SaveMatrixForm(request.POST)
    if not form.is_valid():
        return JsonResponse(
            {"success": False, "errors": form.errors},
            status=400,
        )
    name = form.cleaned_data["name"].strip()
    matrix = form.cleaned_data["matrix"]
    notes = form.cleaned_data.get("notes", "")

    # Преобразуем в список строк — сохраняем точное представление.
    matrix_data = [
        [str(matrix[i, j]) for j in range(matrix.cols)]
        for i in range(matrix.rows)
    ]

    obj, created = SavedMatrix.objects.update_or_create(
        session_key=key,
        name=name,
        defaults={
            "matrix_data": matrix_data,
            "notes": notes,
            "rows": matrix.rows,
            "cols": matrix.cols,
        },
    )

    return JsonResponse({
        "success": True,
        "created": created,
        "id": obj.pk,
        "name": obj.name,
        "shape": f"{obj.rows}×{obj.cols}",
    })


@require_POST
def delete_saved_matrix(request: HttpRequest, pk: int) -> JsonResponse:
    """Удалить сохранённую матрицу."""
    key = ensure_session_key(request)
    obj = get_object_or_404(SavedMatrix, pk=pk, session_key=key)
    obj.delete()
    return JsonResponse({"success": True})


# =============================================================================
# О проекте
# =============================================================================

def about(request: HttpRequest) -> HttpResponse:
    """Страница о проекте."""
    return render(
        request,
        "matrix_app/about.html",
        {
            "operations_count": len(list_operations()),
        },
    )

# =============================================================================
# Telegram webhook
# =============================================================================

@csrf_exempt
@require_POST
def telegram_webhook(request: HttpRequest, secret: str) -> HttpResponse:
    """Принимает апдейты от Telegram.

    Telegram сам стучится на этот URL, когда пользователь пишет боту.
    """
    if secret != settings.WEBHOOK_SECRET:
        logger.warning("Telegram webhook: неверный secret")
        return HttpResponseBadRequest("forbidden")

    if not getattr(settings, "BOT_TOKEN", ""):
        logger.warning("Telegram webhook: BOT_TOKEN не задан")
        return HttpResponse("bot disabled")

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponseBadRequest("bad json")

    try:
        process_update(data)
    except Exception:
        logger.exception("Ошибка обработки Telegram update")
        # Возвращаем 200, чтобы Telegram не спамил повторами.
        return HttpResponse("error handled")

    return HttpResponse("ok")