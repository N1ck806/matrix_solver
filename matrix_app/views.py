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

from django.conf import settings
from django.http import (
    HttpRequest,
    HttpResponse,
    HttpResponseBadRequest,
    Http404,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .forms import SaveMatrixForm
from .models import CalculationHistory, SavedMatrix, generate_session_key
from .services.explanations import list_operations
from .telegram_bot import process_update

# --- Расширенный контент школ (теория, обозначения, примеры, визуализации) ---
# Импорт пакета регистрирует школы в CONTENT_REGISTRY.
from . import content  # noqa: F401
from .content.base import (
    get_direction_content,
    get_school_content,
)

logger = logging.getLogger("matrix_app.views")


# =============================================================================
# Утилиты для работы с сессией
# =============================================================================

def ensure_session_key(request: HttpRequest) -> str:
    """Вернуть session_key, создав его при необходимости."""
    key = request.session.get("matrixlab_key")
    if not key:
        key = generate_session_key()
        request.session["matrixlab_key"] = key
        request.session.modified = True
    return key


# =============================================================================
# Утилита: пример матрицы → LaTeX
# =============================================================================

def _example_to_latex(example: Any) -> str:
    """Преобразовать пример матрицы в LaTeX-строку для MathJax.

    Поддерживает:
        • строку "[[1, 2], [3, 4]]" — JSON-массив;
        • уже готовый список [[1, 2], [3, 4]];
        • плоский список [1, 2, 3] — трактуется как вектор-строка.

    Возвращает строку вида:
        "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}"

    Если пример распарсить не удалось — возвращает "\\text{—}".
    Никогда не бросает исключений: вызывается в рендере.
    """
    data: Any = example

    # Если пришла строка — пробуем JSON.
    if isinstance(data, str):
        clean = data.strip()
        for sep in ("—", "//", "#"):
            if sep in clean:
                clean = clean.split(sep, 1)[0].strip()
        try:
            data = json.loads(clean)
        except (ValueError, TypeError):
            return r"\text{—}"

    if not isinstance(data, list) or not data:
        return r"\text{—}"

    # Плоский список чисел → одна строка.
    if not isinstance(data[0], list):
        data = [data]

    rows: list[str] = []
    for row in data:
        if not isinstance(row, list):
            continue
        cells = [str(v) for v in row]
        rows.append(" & ".join(cells))

    if not rows:
        return r"\text{—}"

    body = r" \\ ".join(rows)
    return r"\begin{pmatrix} " + body + r" \end{pmatrix}"


# =============================================================================
# Утилита: обогащение solved_examples
# =============================================================================

def _enrich_solved_examples(examples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Добавить к каждому примеру поля matrix_latex и matrix_json.

    Это позволяет шаблону direction.html рендерить матрицу 3×3
    и передавать её в калькулятор через data-атрибут.
    """
    enriched: list[dict[str, Any]] = []
    for ex in examples:
        item = dict(ex)
        matrix = item.get("matrix")
        if matrix is not None:
            item["matrix_latex"] = _example_to_latex(matrix)
            try:
                item["matrix_json"] = json.dumps(matrix, ensure_ascii=False)
            except (TypeError, ValueError):
                item["matrix_json"] = ""
        enriched.append(item)
    return enriched


# =============================================================================
# Примеры матриц
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
    "graph_network": {
        "title": "Матрица смежности (граф связей)",
        "description": "Симметричная 0/1-матрица для анализа сети.",
        "matrix": [[0, 1, 1, 0], [1, 0, 0, 1], [1, 0, 0, 1], [0, 1, 1, 0]],
    },
    "markov_chain": {
        "title": "Стохастическая матрица (цепи Маркова)",
        "description": "Столбцы дают в сумме 1 — переходные вероятности.",
        "matrix": [["0.7", "0.2", "0.1"], ["0.2", "0.6", "0.2"], ["0.1", "0.2", "0.7"]],
    },
    "rotation_2d": {
        "title": "Матрица поворота 2D",
        "description": "Ортогональная матрица поворота на угол θ.",
        "matrix": [["cos(pi/6)", "-sin(pi/6)"], ["sin(pi/6)", "cos(pi/6)"]],
    },
    "rotation_3d": {
        "title": "Матрица поворота 3D",
        "description": "Поворот вокруг оси Z на угол 45°.",
        "matrix": [
            ["cos(pi/4)", "-sin(pi/4)", 0],
            ["sin(pi/4)",  "cos(pi/4)", 0],
            [0, 0, 1],
        ],
    },
    "population": {
        "title": "Матрица Лесли (динамика популяций)",
        "description": "Возрастная структура популяции.",
        "matrix": [[0, 2, 3], ["0.5", 0, 0], [0, "0.8", 0]],
    },
    "input_output": {
        "title": "Матрица «затраты — выпуск»",
        "description": "Модель Леонтьева для межотраслевого баланса.",
        "matrix": [["0.2", "0.3", "0.1"], ["0.4", "0.1", "0.3"], ["0.1", "0.2", "0.2"]],
    },
    "stiffness": {
        "title": "Матрица жёсткости (строительная механика)",
        "description": "Симметричная положительно определённая матрица.",
        "matrix": [[4, 1, 0], [1, 4, 1], [0, 1, 4]],
    },
    "image_filter": {
        "title": "Свёрточное ядро (фильтр изображения)",
        "description": "Матрица 3×3 для фильтрации — размытие, резкость, контуры.",
        "matrix": [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
    },
    "medical_diagnostic": {
        "title": "Матрица диагностических признаков",
        "description": "Корреляции симптомов и диагнозов.",
        "matrix": [[1, "0.6", "0.2"], ["0.6", 1, "0.4"], ["0.2", "0.4", 1]],
    },
    "camera_matrix": {
        "title": "Матрица проекции камеры",
        "description": "Связь 3D-сцены с 2D-изображением.",
        "matrix": [[500, 0, 320], [0, 500, 240], [0, 0, 1]],
    },
    "kimchi_linguistics": {
        "title": "Матрица текстовой близости (лингвистика)",
        "description": "Попарное сходство текстов по метрике TF-IDF.",
        "matrix": [
            [1, "0.72", "0.31", "0.15"],
            ["0.72", 1, "0.28", "0.11"],
            ["0.31", "0.28", 1, "0.55"],
            ["0.15", "0.11", "0.55", 1],
        ],
    },
    "game_theory": {
        "title": "Платёжная матрица (теория игр)",
        "description": "Выигрыши для стратегий двух игроков.",
        "matrix": [[3, -1, 4], [0, 2, -2], [1, 5, -3]],
    },
    "diet_optimization": {
        "title": "Матрица нутриентов (оптимизация рациона)",
        "description": "Вклад продуктов в покрытие потребностей.",
        "matrix": [[10, 5, 0, 2], [0, 20, 15, 3], [5, 0, 8, 12]],
    },
    "pharmacy_dosage": {
        "title": "Матрица фармакокинетики",
        "description": "Переходы между компартментами модели дозирования.",
        "matrix": [["-0.3", "0.1", "0.0"], ["0.3", "-0.2", "0.05"], ["0.0", "0.1", "-0.05"]],
    },
    "cosmetology_skin": {
        "title": "Матрица состояний кожи",
        "description": "Переходы между состояниями при уходе — марковская модель.",
        "matrix": [["0.85", "0.10", "0.05"], ["0.20", "0.70", "0.10"], ["0.05", "0.25", "0.70"]],
    },
    "fashion_design": {
        "title": "Матрица цветовых переходов (дизайн одежды)",
        "description": "Совместимость цветов в коллекции.",
        "matrix": [
            [1, "0.8", "0.2", "0.1"],
            ["0.8", 1, "0.6", "0.3"],
            ["0.2", "0.6", 1, "0.7"],
            ["0.1", "0.3", "0.7", 1],
        ],
    },
    "music_harmony": {
        "title": "Матрица гармонических переходов",
        "description": "Вероятности переходов между аккордами.",
        "matrix": [
            ["0.4", "0.3", "0.2", "0.1"],
            ["0.1", "0.5", "0.3", "0.1"],
            ["0.2", "0.4", "0.3", "0.1"],
            ["0.1", "0.2", "0.4", "0.3"],
        ],
    },
    "teacher_grade": {
        "title": "Матрица оценивания (педагогика)",
        "description": "Веса критериев оценки по заданиям.",
        "matrix": [[2, 3, 1, 1], [1, 2, 3, 2], [1, 1, 2, 3]],
    },
    "psychology_profile": {
        "title": "Матрица психологического профиля",
        "description": "Корреляции между шкалами теста.",
        "matrix": [
            [1, "0.65", "0.42", "0.18"],
            ["0.65", 1, "0.55", "0.27"],
            ["0.42", "0.55", 1, "0.61"],
            ["0.18", "0.27", "0.61", 1],
        ],
    },
    "translation_alignment": {
        "title": "Матрица выравнивания перевода",
        "description": "Попарное соответствие слов оригинала и перевода.",
        "matrix": [[1, 0, 1, 0, 0], [0, 1, 0, 1, 0], [0, 0, 1, 0, 1]],
    },
    "ecommerce_funnel": {
        "title": "Матрица воронки (e-commerce)",
        "description": "Переходы пользователей между этапами воронки продаж.",
        "matrix": [
            ["0.5", "0.3", "0.15", "0.05"],
            ["0", "0.6", "0.3", "0.1"],
            ["0", "0", "0.7", "0.3"],
            ["0", "0", "0", 1],
        ],
    },
    "physics_oscillator": {
        "title": "Матрица связанных осцилляторов",
        "description": "Симметричная система масс-пружин.",
        "matrix": [[2, -1, 0], [-1, 2, -1], [0, -1, 2]],
    },
}


# =============================================================================
# Данные для главной страницы
# =============================================================================

HOME_FEATURES: list[dict[str, str]] = [
    {"slug": "determinant",    "name": "Определитель",     "desc": "det A, миноры, разложение по строке"},
    {"slug": "inverse",        "name": "Обратная",         "desc": "A · A⁻¹ = I"},
    {"slug": "rank",           "name": "Ранг",             "desc": "rank A, базис образа"},
    {"slug": "transpose",      "name": "Транспонирование", "desc": "Aᵀ"},
    {"slug": "systems",        "name": "СЛАУ",             "desc": "Ax = b"},
    {"slug": "eigen",          "name": "Собственные",      "desc": "λ и собственные векторы"},
    {"slug": "decompositions", "name": "Разложения",       "desc": "LU, QR, Холецкий"},
    {"slug": "step-by-step",   "name": "Пошагово",         "desc": "Каждый шаг с обоснованием"},
]

HOME_PROCESS: list[dict[str, str]] = [
    {"slug": "input",  "title": "Ввод",     "desc": "Матрица или система"},
    {"slug": "choose", "title": "Выбор",    "desc": "Операция и метод"},
    {"slug": "result", "title": "Решение",  "desc": "Пошагово, с проверкой"},
    {"slug": "learn",  "title": "Изучение", "desc": "Теория и интуиция"},
]

HOME_POPULAR: list[dict[str, Any]] = [
    {"slug": "determinant",    "title": "Определитель",         "desc": "det A — площадь, объём, обратимость", "url_name": "matrix_app:properties",     "size": "large"},
    {"slug": "inverse",        "title": "Обратная",             "desc": "A · A⁻¹ = I",                        "url_name": "matrix_app:operations",     "size": "tall"},
    {"slug": "rank",           "title": "Ранг",                 "desc": "размерность образа",                 "url_name": "matrix_app:properties",     "size": ""},
    {"slug": "systems",        "title": "СЛАУ",                 "desc": "Ax = b",                             "url_name": "matrix_app:systems",        "size": ""},
    {"slug": "eigen",          "title": "Собственные значения", "desc": "λ и v — оси, которые не меняются",   "url_name": "matrix_app:eigen",          "size": "wide"},
    {"slug": "decompositions", "title": "LU-разложение",        "desc": "A = L · U",                          "url_name": "matrix_app:decompositions", "size": "wide"},
]


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
            "features": HOME_FEATURES,
            "process": HOME_PROCESS,
            "popular": HOME_POPULAR,
        },
    )


# =============================================================================
# Поиск
# =============================================================================

def search(request: HttpRequest) -> HttpResponse:
    """Поиск по сайту."""
    q = request.GET.get("q", "").strip()

    if not q:
        return redirect("matrix_app:calculator")

    operations = list_operations()
    query_lower = q.lower()
    matched_operations = [
        op for op in operations
        if query_lower in op.get("label", "").lower()
        or query_lower in op.get("code", "").lower()
    ]

    return render(
        request,
        "matrix_app/search.html",
        {
            "query": q,
            "operations": matched_operations,
            "results_count": len(matched_operations),
        },
    )


# =============================================================================
# Калькулятор
# =============================================================================

def calculator(request: HttpRequest) -> HttpResponse:
    """Калькулятор: одна матрица, множество операций.

    Поддерживает параметры GET:
        ?example=<slug>   — подгрузить пример в редактор;
        ?operation=<code> — выбрать операцию.
    """
    initial_example = request.GET.get("example", "").strip()
    initial_operation = request.GET.get("operation", "").strip()

    if initial_example and initial_example not in EXAMPLES:
        initial_example = ""

    return render(
        request,
        "matrix_app/calculator.html",
        {
            "examples": EXAMPLES,
            "initial_example": initial_example,
            "initial_operation": initial_operation,
            "operations": [
                {"code": "determinant",  "label": "Определитель",                 "icon": "="},
                {"code": "rank",         "label": "Ранг",                         "icon": "#"},
                {"code": "inverse",      "label": "Обратная матрица",             "icon": "⁻¹"},
                {"code": "transpose",    "label": "Транспонирование",             "icon": "ᵀ"},
                {"code": "trace",        "label": "След",                         "icon": "tr"},
                {"code": "rref",         "label": "RREF",                         "icon": "⇉"},
                {"code": "echelon",      "label": "Ступенчатая форма",            "icon": "△"},
                {"code": "properties",   "label": "Свойства",                     "icon": "✓"},
                {"code": "eigenvalues",  "label": "Собственные значения",         "icon": "λ"},
                {"code": "char_poly",    "label": "Характеристический многочлен", "icon": "p(λ)"},
                {"code": "lu",           "label": "LU-разложение",                "icon": "LU"},
                {"code": "qr",           "label": "QR-разложение",                "icon": "QR"},
                {"code": "cholesky",     "label": "Разложение Холецкого",         "icon": "LLᵀ"},
                {"code": "diagonalize",  "label": "Диагонализация",               "icon": "PDP⁻¹"},
            ],
        },
    )


# =============================================================================
# Операции над двумя матрицами
# =============================================================================

def operations(request: HttpRequest) -> HttpResponse:
    """Операции над A и B (сложение, умножение, сравнение и т.д.)."""
    return render(request, "matrix_app/operations.html", {"examples": EXAMPLES})


# =============================================================================
# Свойства
# =============================================================================

def properties(request: HttpRequest) -> HttpResponse:
    """Анализ свойств матрицы."""
    return render(request, "matrix_app/properties.html", {"examples": EXAMPLES})


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
                {"code": "auto",         "label": "Автоматически"},
                {"code": "gauss",        "label": "Метод Гаусса"},
                {"code": "gauss_jordan", "label": "Метод Гаусса-Жордана"},
                {"code": "cramer",       "label": "Правило Крамера"},
                {"code": "inverse",      "label": "Через обратную матрицу"},
            ],
        },
    )


# =============================================================================
# Разложения
# =============================================================================

def decompositions(request: HttpRequest) -> HttpResponse:
    """LU, QR, Холецкий, диагонализация, спектральное."""
    return render(request, "matrix_app/decompositions.html", {"examples": EXAMPLES})


# =============================================================================
# Спектр
# =============================================================================

def eigen(request: HttpRequest) -> HttpResponse:
    """Собственные значения, векторы, характеристический многочлен."""
    return render(request, "matrix_app/eigen.html", {"examples": EXAMPLES})


# =============================================================================
# Теория
# =============================================================================

THEORY_TOPICS: list[dict[str, str]] = [
    {"slug": "matrix-basics",     "title": "Что такое матрица",                  "category": "Основы"},
    {"slug": "matrix-types",      "title": "Виды матриц",                        "category": "Основы"},
    {"slug": "matrix-size",       "title": "Размер матрицы",                     "category": "Основы"},
    {"slug": "addition",          "title": "Сложение матриц",                    "category": "Операции"},
    {"slug": "subtraction",       "title": "Вычитание матриц",                   "category": "Операции"},
    {"slug": "multiplication",    "title": "Умножение матриц",                   "category": "Операции"},
    {"slug": "scalar",            "title": "Умножение на скаляр",                "category": "Операции"},
    {"slug": "transpose",         "title": "Транспонирование",                   "category": "Операции"},
    {"slug": "power",             "title": "Возведение в степень",               "category": "Операции"},
    {"slug": "determinant",       "title": "Определитель",                       "category": "Определители"},
    {"slug": "minors",            "title": "Миноры и алгебраические дополнения", "category": "Определители"},
    {"slug": "inverse",           "title": "Обратная матрица",                   "category": "Определители"},
    {"slug": "rank",              "title": "Ранг матрицы",                       "category": "Ранг"},
    {"slug": "slau",              "title": "Системы линейных уравнений",         "category": "СЛАУ"},
    {"slug": "gauss",             "title": "Метод Гаусса",                       "category": "СЛАУ"},
    {"slug": "gauss-jordan",      "title": "Метод Гаусса-Жордана",               "category": "СЛАУ"},
    {"slug": "cramer",            "title": "Правило Крамера",                    "category": "СЛАУ"},
    {"slug": "kronecker-capelli", "title": "Теорема Кронекера-Капелли",          "category": "СЛАУ"},
    {"slug": "eigenvalues",       "title": "Собственные значения",               "category": "Спектр"},
    {"slug": "eigenvectors",      "title": "Собственные векторы",                "category": "Спектр"},
    {"slug": "char-poly",         "title": "Характеристический многочлен",       "category": "Спектр"},
    {"slug": "diagonalization",   "title": "Диагонализация",                     "category": "Спектр"},
    {"slug": "lu",                "title": "LU-разложение",                      "category": "Разложения"},
    {"slug": "qr",                "title": "QR-разложение",                      "category": "Разложения"},
    {"slug": "cholesky",          "title": "Разложение Холецкого",               "category": "Разложения"},
    {"slug": "orthogonal",        "title": "Ортогональные матрицы",              "category": "Специальные"},
    {"slug": "symmetric",         "title": "Симметричные матрицы",               "category": "Специальные"},
    {"slug": "positive-definite", "title": "Положительно определённые матрицы",  "category": "Специальные"},
]


def theory(request: HttpRequest) -> HttpResponse:
    """Раздел теории. Группируем темы по категориям."""
    CATEGORY_ORDER = [
        "Основы", "Операции", "Определители", "Ранг",
        "СЛАУ", "Спектр", "Разложения", "Специальные",
    ]

    grouped: dict[str, list[dict[str, str]]] = {}
    for topic in THEORY_TOPICS:
        grouped.setdefault(topic["category"], []).append(topic)

    ordered_categories: dict[str, list[dict[str, str]]] = {}
    for name in CATEGORY_ORDER:
        if name in grouped:
            ordered_categories[name] = grouped[name]
    for name, items in grouped.items():
        if name not in ordered_categories:
            ordered_categories[name] = items

    return render(
        request,
        "matrix_app/theory.html",
        {
            "topics": THEORY_TOPICS,
            "categories": ordered_categories,
        },
    )


# =============================================================================
# Виды матриц
# =============================================================================

MATRIX_TYPES: list[dict[str, Any]] = [
    # ---- По форме ----
    {
        "slug": "square",
        "title": "Квадратная матрица",
        "category": "По форме",
        "definition": "Матрица, у которой число строк равно числу столбцов.",
        "formula": "m = n",
        "example": "[[1, 2], [3, 4]]",
        "uses": "Определитель, обратная матрица, собственные значения.",
    },
    {
        "slug": "rectangular",
        "title": "Прямоугольная матрица",
        "category": "По форме",
        "definition": "Число строк не равно числу столбцов.",
        "formula": "m \\neq n",
        "example": "[[1, 2, 3], [4, 5, 6]]",
        "uses": "Системы с разным числом уравнений и неизвестных.",
    },
    {
        "slug": "row-matrix",
        "title": "Матрица-строка (вектор-строка)",
        "category": "По форме",
        "definition": "Матрица размера 1 × n.",
        "formula": "1 \\times n",
        "example": "[[1, 2, 3, 4]]",
        "uses": "Скалярное произведение, ковекторы.",
    },
    {
        "slug": "column-matrix",
        "title": "Матрица-столбец (вектор-столбец)",
        "category": "По форме",
        "definition": "Матрица размера m × 1.",
        "formula": "m \\times 1",
        "example": "[[1], [2], [3]]",
        "uses": "Решение СЛАУ, базисные векторы.",
    },

    # ---- По структуре ----
    {
        "slug": "zero",
        "title": "Нулевая матрица",
        "category": "По структуре",
        "definition": "Все элементы равны нулю.",
        "formula": "a_{ij} = 0",
        "example": "[[0, 0], [0, 0]]",
        "uses": "Нейтральный элемент по сложению.",
    },
    {
        "slug": "identity",
        "title": "Единичная матрица",
        "category": "По структуре",
        "definition": "Диагональные элементы равны 1, остальные — 0.",
        "formula": "a_{ii} = 1, \\quad a_{ij} = 0 \\text{ при } i \\neq j",
        "example": "[[1, 0], [0, 1]]",
        "uses": "Нейтральный элемент по умножению.",
    },
    {
        "slug": "diagonal",
        "title": "Диагональная матрица",
        "category": "По структуре",
        "definition": "Все внедиагональные элементы равны нулю.",
        "formula": "a_{ij} = 0 \\text{ при } i \\neq j",
        "example": "[[2, 0], [0, 5]]",
        "uses": "Быстрое умножение, спектральные задачи.",
    },
    {
        "slug": "scalar-matrix",
        "title": "Скалярная матрица",
        "category": "По структуре",
        "definition": "Диагональная матрица с одинаковыми элементами λI.",
        "formula": "\\lambda \\cdot I",
        "example": "[[3, 0], [0, 3]]",
        "uses": "Подобие, гомотетия.",
    },
    {
        "slug": "triangular",
        "title": "Треугольная матрица",
        "category": "По структуре",
        "definition": "Все элементы выше (или ниже) главной диагонали равны нулю.",
        "formula": "a_{ij} = 0 \\text{ при } i > j \\; (\\text{верхняя})",
        "example": "[[1, 2], [0, 3]]",
        "uses": "LU-разложение, определитель — произведение диагоналей.",
    },
    {
        "slug": "band",
        "title": "Ленточная матрица",
        "category": "По структуре",
        "definition": "Ненулевые элементы сосредоточены вблизи главной диагонали.",
        "formula": "a_{ij} = 0 \\text{ при } |i - j| > w",
        "example": "[[4, 1, 0], [1, 4, 1], [0, 1, 4]]",
        "uses": "Численные методы, разреженные системы.",
    },
    {
        "slug": "tridiagonal",
        "title": "Трёхдиагональная матрица",
        "category": "По структуре",
        "definition": "Ленточная с шириной ленты 1.",
        "formula": "a_{ij} = 0 \\text{ при } |i - j| > 1",
        "example": "[[2, -1, 0], [-1, 2, -1], [0, -1, 2]]",
        "uses": "Разностные схемы, метод прогонки.",
    },
    {
        "slug": "toeplitz",
        "title": "Тёплицева матрица",
        "category": "По структуре",
        "definition": "Элементы постоянны вдоль каждой диагонали.",
        "formula": "a_{ij} = t_{j-i}",
        "example": "[[1, 2, 3], [4, 1, 2], [5, 4, 1]]",
        "uses": "Фильтры, свёртки, обработка сигналов.",
    },
    {
        "slug": "hankel",
        "title": "Ганкелева матрица",
        "category": "По структуре",
        "definition": "Элементы постоянны вдоль каждой антидиагонали.",
        "formula": "a_{ij} = h_{i+j}",
        "example": "[[1, 2, 3], [2, 3, 4], [3, 4, 5]]",
        "uses": "Теория систем, аппроксимация.",
    },
    {
        "slug": "circulant",
        "title": "Циркулянт",
        "category": "По структуре",
        "definition": "Каждая строка — циклический сдвиг предыдущей.",
        "formula": "a_{ij} = c_{(j-i) \\bmod n}",
        "example": "[[1, 2, 3], [3, 1, 2], [2, 3, 1]]",
        "uses": "БПФ, теория кодирования.",
    },
    {
        "slug": "block",
        "title": "Блочная матрица",
        "category": "По структуре",
        "definition": "Матрица, разбитая на блоки-подматрицы.",
        "formula": "M = \\begin{pmatrix} A & B \\\\ C & D \\end{pmatrix}",
        "example": "[[1, 2, 0, 0], [3, 4, 0, 0], [0, 0, 5, 6], [0, 0, 7, 8]]",
        "uses": "Блочное умножение, метод Шура.",
    },
    {
        "slug": "sparse",
        "title": "Разреженная матрица",
        "category": "По структуре",
        "definition": "Большинство элементов равны нулю.",
        "formula": "\\text{nnz}(A) \\ll m \\cdot n",
        "example": "[[1, 0, 0], [0, 0, 0], [0, 0, 5]]",
        "uses": "Хранение больших систем, графы.",
    },

    # ---- По свойствам ----
    {
        "slug": "symmetric",
        "title": "Симметричная матрица",
        "category": "По свойствам",
        "definition": "Совпадает со своей транспонированной: A = Aᵀ.",
        "formula": "a_{ij} = a_{ji}",
        "example": "[[1, 2], [2, 3]]",
        "uses": "Спектральное разложение, оптимизация.",
    },
    {
        "slug": "skew-symmetric",
        "title": "Кососимметричная матрица",
        "category": "По свойствам",
        "definition": "Aᵀ = −A, диагональ нулевая.",
        "formula": "a_{ij} = -a_{ji}",
        "example": "[[0, 2], [-2, 0]]",
        "uses": "Векторное произведение, угловая скорость.",
    },
    {
        "slug": "orthogonal",
        "title": "Ортогональная матрица",
        "category": "По свойствам",
        "definition": "Квадратная матрица, у которой AᵀA = I.",
        "formula": "A^{T} \\cdot A = I",
        "example": "[[0, -1], [1, 0]]",
        "example_note": "матрица поворота на 90°",
        "uses": "Повороты, отражения, QR-разложение.",
    },
    {
        "slug": "unitary",
        "title": "Унитарная матрица",
        "category": "По свойствам",
        "definition": "Комплексный аналог ортогональной: U*U = I.",
        "formula": "U^{*} \\cdot U = I",
        "example": [["1", "0"], ["0", "i"]],
        "uses": "Квантовая механика, комплексные преобразования.",
    },
    {
        "slug": "hermitian",
        "title": "Эрмитова матрица",
        "category": "По свойствам",
        "definition": "Комплексный аналог симметричной: A* = A.",
        "formula": "A^{*} = A",
        "example": [["2", "1+i"], ["1-i", "3"]],
        "uses": "Квантовая механика, спектральная теорема.",
    },
    {
        "slug": "positive-definite",
        "title": "Положительно определённая",
        "category": "По свойствам",
        "definition": "Симметричная матрица, у которой все собственные значения положительны.",
        "formula": "x^{T} A x > 0 \\text{ для всех } x \\neq 0",
        "example": "[[2, 0], [0, 3]]",
        "uses": "Оптимизация, разложение Холецкого, статистика.",
    },
    {
        "slug": "negative-definite",
        "title": "Отрицательно определённая",
        "category": "По свойствам",
        "definition": "Симметричная матрица, у которой все собственные значения отрицательны.",
        "formula": "x^{T} A x < 0 \\text{ для всех } x \\neq 0",
        "example": "[[-2, 0], [0, -3]]",
        "uses": "Точки максимума, седловые точки.",
    },
    {
        "slug": "idempotent",
        "title": "Идемпотентная матрица",
        "category": "По свойствам",
        "definition": "Матрица, равная своему квадрату: A² = A.",
        "formula": "A \\cdot A = A",
        "example": "[[1, 0], [0, 0]]",
        "example_note": "матрица-проектор",
        "uses": "Проекторы, статистика (матрица-шляпа).",
    },
    {
        "slug": "nilpotent",
        "title": "Нильпотентная матрица",
        "category": "По свойствам",
        "definition": "Некоторая степень равна нулю: Aᵏ = 0.",
        "formula": "A^{k} = 0 \\text{ для некоторого } k \\geq 1",
        "example": "[[0, 1], [0, 0]]",
        "uses": "Разложение Жордана, теория нильпотентных операторов.",
    },
    {
        "slug": "involutory",
        "title": "Инволютивная матрица",
        "category": "По свойствам",
        "definition": "Матрица, равная своей обратной: A² = I.",
        "formula": "A \\cdot A = I",
        "example": "[[0, 1], [1, 0]]",
        "example_note": "матрица-отражение",
        "uses": "Отражения, инволюции.",
    },
    {
        "slug": "stochastic",
        "title": "Стохастическая матрица",
        "category": "По свойствам",
        "definition": "Неотрицательная, сумма элементов в каждом столбце равна 1.",
        "formula": "a_{ij} \\geq 0, \\quad \\sum_i a_{ij} = 1",
        "example": [["0.7", "0.3"], ["0.3", "0.7"]],
        "uses": "Цепи Маркова, теория вероятностей.",
    },
    {
        "slug": "singular",
        "title": "Вырожденная (сингулярная) матрица",
        "category": "По свойствам",
        "definition": "Квадратная матрица с нулевым определителем.",
        "formula": "\\det(A) = 0",
        "example": "[[1, 2], [2, 4]]",
        "uses": "Отсутствие обратной, потеря размерности.",
    },
    {
        "slug": "nonsingular",
        "title": "Невырожденная матрица",
        "category": "По свойствам",
        "definition": "Квадратная матрица с ненулевым определителем.",
        "formula": "\\det(A) \\neq 0",
        "example": "[[1, 2], [3, 4]]",
        "uses": "Существование обратной, единственность решения СЛАУ.",
    },
]


def _enrich_matrix_types(types_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Добавить каждому типу вычисленный LaTeX-пример."""
    enriched: list[dict[str, Any]] = []
    for t in types_list:
        item = dict(t)
        item["example_latex"] = _example_to_latex(t.get("example"))
        enriched.append(item)
    return enriched


def types(request: HttpRequest) -> HttpResponse:
    """Классификация матриц по видам."""
    CATEGORY_ORDER = ["По форме", "По структуре", "По свойствам"]

    enriched = _enrich_matrix_types(MATRIX_TYPES)

    grouped: dict[str, list[dict[str, Any]]] = {}
    for t in enriched:
        grouped.setdefault(t["category"], []).append(t)

    ordered_categories: dict[str, list[dict[str, Any]]] = {}
    for name in CATEGORY_ORDER:
        if name in grouped:
            ordered_categories[name] = grouped[name]
    for name, items in grouped.items():
        if name not in ordered_categories:
            ordered_categories[name] = items

    return render(
        request,
        "matrix_app/types.html",
        {
            "types": enriched,
            "categories": ordered_categories,
        },
    )


# =============================================================================
# МОДУЛИ ПО НАПРАВЛЕНИЯМ
# =============================================================================

MODULE_SCHOOLS: list[dict[str, Any]] = [
    # =========================================================================
    # 1. ШКОЛА ОБРАЗОВАНИЯ
    # =========================================================================
    {
        "slug": "education",
        "title": "Школа образования",
        "subtitle": "Педагогика, языки, филология, психология — там, где важно "
                    "видеть структуру и находить закономерности.",
        "icon": "schools/school-education",
        "accent": "violet",
        "directions": [
            {
                "slug": "preschool-education",
                "title": "Дошкольное образование",
                "tagline": "Оценка развития, диагностика групп, распределение нагрузки",
                "description": (
                    "В дошкольной педагогике матрицы помогают работать с "
                    "многомерными наблюдениями: развитие каждого ребёнка по "
                    "нескольким шкалам, корреляции между показателями и "
                    "распределение по группам. Матрицы позволяют увидеть "
                    "скрытые закономерности там, где таблица уже не читается."
                ),
                "formula": "A \\cdot x = y",
                "formula_note": "Линейная модель развития: на входе — факторы, на выходе — показатель.",
                "uses": [
                    "Матрица наблюдений: дети × шкалы развития",
                    "Корреляционная матрица между показателями",
                    "Распределение детей по группам (кластеризация)",
                    "Оценка влияния методик — линейная модель",
                ],
                "example_slug": "teacher_grade",
                "operation": "rank",
                "icon": "math/matrix-grid",
            },
            {
                "slug": "primary-education",
                "title": "Начальное образование",
                "tagline": "Критериальное оценивание, веса заданий, диагностика класса",
                "description": (
                    "В начальной школе важно понимать, какие задания "
                    "действительно различают уровень учеников, а какие — нет. "
                    "Матрица «ученики × задания» и её ранг показывают, сколько "
                    "независимых измерений реально даёт тест. Это основа "
                    "критериального оценивания."
                ),
                "formula": "W \\cdot S = G",
                "formula_note": "Матрица весов W × матрица баллов S = итоговая оценка G.",
                "uses": [
                    "Матрица «ученики × задания»",
                    "Веса критериев оценивания",
                    "Анализ разнообразия заданий через ранг",
                    "Прогноз успеваемости по линейной модели",
                ],
                "example_slug": "teacher_grade",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "korean-philology",
                "title": "Корейская филология",
                "tagline": "Семантические поля, попарное сходство, разбор текстов",
                "description": (
                    "В филологии матрицы — основа количественного анализа "
                    "текста. Матрица «слово × документ» (term-document matrix), "
                    "её разложения и собственные значения дают семантические "
                    "оси: какие темы доминируют, как тексты группируются, "
                    "какие слова близки. Это тема LSA (Latent Semantic Analysis)."
                ),
                "formula": "A \\approx U \\Sigma V^{T}",
                "formula_note": "SVD разложение term-document матрицы — основа тематического анализа.",
                "uses": [
                    "Матрица «слово × документ»",
                    "Попарное сходство текстов (косинусная мера)",
                    "Кластеризация текстов по темам",
                    "Выделение ключевых слов через SVD",
                ],
                "example_slug": "kimchi_linguistics",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "english-teaching",
                "title": "Преподавание английского языка",
                "tagline": "Анализ ошибок, матрица прогресса, диагностика групп",
                "description": (
                    "Матрица «студент × тип ошибки» показывает, какие ошибки "
                    "систематичны, а какие случайны. Собственные значения такой "
                    "матрицы выделяют «главные» проблемы группы, а разложение — "
                    "типичные профили учеников."
                ),
                "formula": "E = U \\Sigma V^{T}",
                "formula_note": "Разложение матрицы ошибок на типичные профили.",
                "uses": [
                    "Матрица ошибок по темам",
                    "Профили учеников через кластеризацию",
                    "Динамика прогресса во времени",
                    "Подбор упражнений по слабым местам",
                ],
                "example_slug": "teacher_grade",
                "operation": "rank",
                "icon": "ui/grid",
            },
            {
                "slug": "history",
                "title": "История",
                "tagline": "Хронологические связи, сети, миграции, экономика",
                "description": (
                    "Исторические данные — это часто сети: кто с кем связан, "
                    "какие регионы торговали, как распространялись идеи. "
                    "Матрица смежности и её собственные значения показывают "
                    "«центральные» узлы и «мосты» — ключ к анализу сетей."
                ),
                "formula": "A \\cdot v = \\lambda \\cdot v",
                "formula_note": "Собственный вектор матрицы связей даёт «центральность» узлов.",
                "uses": [
                    "Матрица смежности исторических связей",
                    "Центральность персон и регионов",
                    "Анализ торговых путей",
                    "Экономические балансы эпох",
                ],
                "example_slug": "graph_network",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "special-pedagogy",
                "title": "Специальная педагогика",
                "tagline": "Индивидуальные профили, диагностические матрицы",
                "description": (
                    "В специальной педагогике важна индивидуальная траектория. "
                    "Матрица «ребёнок × навык» с весами позволяет построить "
                    "персональный профиль и отслеживать динамику. Матрицы "
                    "корреляций показывают, какие навыки развиваются вместе."
                ),
                "formula": "P = W \\cdot S",
                "formula_note": "Взвешенный профиль: W — веса навыков, S — уровень владения.",
                "uses": [
                    "Индивидуальный профиль развития",
                    "Матрица «навык × ребёнок»",
                    "Динамика коррекции",
                    "Корреляции между навыками",
                ],
                "example_slug": "psychology_profile",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "translation-studies-cn",
                "title": "Переводоведение (китайский и английский)",
                "tagline": "Выравнивание текстов, оценка качества, попарные метрики",
                "description": (
                    "Матрица выравнивания показывает, какому фрагменту "
                    "оригинала соответствует фрагмент перевода. Её анализ — "
                    "это и оценка качества, и поиск типичных ошибок, и "
                    "статистика автоматического перевода."
                ),
                "formula": "M_{ij} = \\text{sim}(s_i, t_j)",
                "formula_note": "Матрица близости: элемент — схожесть i-го оригинала и j-го перевода.",
                "uses": [
                    "Матрица выравнивания оригинала и перевода",
                    "Оценка качества перевода (BLEU, METEOR)",
                    "Попарная близость предложений",
                    "Кластеризация типичных ошибок",
                ],
                "example_slug": "translation_alignment",
                "operation": "rank",
                "icon": "ui/grid",
            },
            {
                "slug": "psychology",
                "title": "Психология",
                "tagline": "Корреляции шкал, факторный анализ, профили личности",
                "description": (
                    "Психологические тесты дают матрицу «испытуемый × шкала». "
                    "Её собственные значения — это факторы: устойчивые "
                    "латентные черты, стоящие за ответами. Это математическая "
                    "основа факторного анализа."
                ),
                "formula": "R \\cdot v = \\lambda \\cdot v",
                "formula_note": "Собственные векторы корреляционной матрицы — факторы.",
                "uses": [
                    "Корреляционная матрица шкал",
                    "Факторный анализ (PCA)",
                    "Профили личности",
                    "Кластеризация испытуемых",
                ],
                "example_slug": "psychology_profile",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "philology-russian",
                "title": "Филология и преподавание языков (русский)",
                "tagline": "Частотные словари, синтаксис, семантические расстояния",
                "description": (
                    "Матрица «слово × контекст» — основа дистрибутивной "
                    "семантики: слова со схожими контекстами близки по смыслу. "
                    "Разложения дают векторные представления слов — эмбеддинги."
                ),
                "formula": "w \\approx \\sum_{k} \\sigma_k u_k v_k^{T}",
                "formula_note": "Разложение матрицы контекстов даёт векторные представления слов.",
                "uses": [
                    "Частотная матрица «слово × текст»",
                    "Семантические расстояния между словами",
                    "Разбор синтаксических зависимостей",
                    "Стилометрия авторов",
                ],
                "example_slug": "kimchi_linguistics",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "uzbek-language",
                "title": "Узбекский язык и литература",
                "tagline": "Корпусные исследования, частотность, авторский стиль",
                "description": (
                    "Корпусная лингвистика — это матрицы частот. Ранг матрицы "
                    "«слово × жанр» показывает, сколько независимых измерений "
                    "различает тексты, а разложение — какие именно темы "
                    "доминируют в жанре."
                ),
                "formula": "F = U \\Sigma V^{T}",
                "formula_note": "Разложение частотной матрицы — основа тематического моделирования.",
                "uses": [
                    "Матрица «слово × жанр»",
                    "Частотный анализ корпуса",
                    "Авторский стиль через PCA",
                    "Сравнение периодов литературы",
                ],
                "example_slug": "kimchi_linguistics",
                "operation": "rank",
                "icon": "ui/grid",
            },
            {
                "slug": "translation-turkish",
                "title": "Теория и практика перевода (турецкий)",
                "tagline": "Сопоставление параллельных корпусов, оценка качества",
                "description": (
                    "Параллельные корпуса дают матрицу соответствий, а её "
                    "свойства — характеристику стиля переводчика: как часто "
                    "он сохраняет порядок, где меняет структуру. Это "
                    "математическая база переводческой критики."
                ),
                "formula": "D = A^{T} \\cdot B",
                "formula_note": "Матрица соответствий получается умножением матриц-текстов.",
                "uses": [
                    "Выравнивание параллельного корпуса",
                    "Оценка сохранения порядка",
                    "Автоматическая оценка перевода",
                    "Стилометрия переводчика",
                ],
                "example_slug": "translation_alignment",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "japanese-philology",
                "title": "Филология и преподавание языков (японский)",
                "tagline": "Иероглифические системы, семантика, корпусные методы",
                "description": (
                    "Японская письменность совмещает несколько систем — "
                    "матрицы позволяют моделировать их взаимодействие: "
                    "переходы между системами, частотность чтений, "
                    "семантические расстояния между иероглифами."
                ),
                "formula": "T_{ij} = P(\\text{чтение}_j \\mid \\text{иероглиф}_i)",
                "formula_note": "Матрица переходов между иероглифами и чтениями.",
                "uses": [
                    "Матрица «иероглиф × чтение»",
                    "Семантические расстояния между кандзи",
                    "Частотный анализ корпуса",
                    "Автоматическое распознавание текста",
                ],
                "example_slug": "kimchi_linguistics",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "physical-education",
                "title": "Физическая культура",
                "tagline": "Мониторинг показателей, распределение нагрузок, прогресс",
                "description": (
                    "Матрица «спортсмен × показатель» — основа мониторинга "
                    "тренированности. Собственные значения показывают, "
                    "сколько независимых осей реально варьируется, а "
                    "корреляции — какие показатели двигаются вместе."
                ),
                "formula": "S = W \\cdot P",
                "formula_note": "Итоговый рейтинг — это взвешенная матрица показателей.",
                "uses": [
                    "Матрица «спортсмен × тест»",
                    "Комплексная оценка подготовленности",
                    "Прогноз результатов",
                    "Баланс нагрузок и восстановления",
                ],
                "example_slug": "teacher_grade",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
        ],
    },

    # =========================================================================
    # 2. ШКОЛА БИЗНЕСА И ФИНАНСОВ
    # =========================================================================
    {
        "slug": "business",
        "title": "Школа бизнеса и финансов",
        "subtitle": "Экономика, маркетинг, финансы, менеджмент — там, где "
                    "решения принимаются на основе данных.",
        "icon": "schools/school-business",
        "accent": "emerald",
        "directions": [
            {
                "slug": "tourism",
                "title": "Туризм",
                "tagline": "Маршрутные потоки, загрузка, прогноз спроса",
                "description": (
                    "Туристические потоки — это матрица «откуда × куда»: "
                    "сколько людей едет из региона в регион. Её анализ "
                    "показывает «магниты» и «транзитные узлы», а прогноз — "
                    "основа планирования загрузки."
                ),
                "formula": "F_{ij} = P(\\text{из } i \\to j)",
                "formula_note": "Матрица миграционных потоков.",
                "uses": [
                    "Матрица «регион × регион» потоков",
                    "Загрузка сезонов",
                    "Прогноз спроса (Марков)",
                    "Оптимальные маршруты",
                ],
                "example_slug": "markov_chain",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "business-management",
                "title": "Управление бизнесом",
                "tagline": "Многокритериальные решения, ресурсы, KPI",
                "description": (
                    "Задачи менеджмента — многокритериальные: есть несколько "
                    "альтернатив и несколько критериев. Матрица «альтернатива × "
                    "критерий» с весами даёт итоговый рейтинг — это метод "
                    "анализа иерархий (AHP)."
                ),
                "formula": "S = A \\cdot W",
                "formula_note": "Итоговый балл = матрица оценок × веса критериев.",
                "uses": [
                    "Матрица «альтернатива × критерий»",
                    "Веса критериев (AHP)",
                    "Распределение ресурсов",
                    "Прогноз KPI",
                ],
                "example_slug": "teacher_grade",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "international-economic-relations",
                "title": "Международные экономические отношения",
                "tagline": "Торговые балансы, матрица «экспорт-импорт», модели роста",
                "description": (
                    "Модель Леонтьева «затраты — выпуск» описывает экономику "
                    "как систему линейных уравнений: чтобы выпустить продукт, "
                    "нужны ресурсы. Матрица коэффициентов — сердце модели; "
                    "её свойства определяют устойчивость экономики."
                ),
                "formula": "x = (I - A)^{-1} \\cdot d",
                "formula_note": "Модель Леонтьева: выпуск x через матрицу затрат A и спрос d.",
                "uses": [
                    "Матрица «отрасль × отрасль»",
                    "Торговые балансы стран",
                    "Прогноз роста экономики",
                    "Анализ устойчивости (собственные числа)",
                ],
                "example_slug": "input_output",
                "operation": "inverse",
                "icon": "math/inverse",
            },
            {
                "slug": "international-marketing",
                "title": "Международный маркетинг",
                "tagline": "Сегментация, поведение, ценовые матрицы",
                "description": (
                    "Матрица «потребитель × признак» — основа сегментации. "
                    "Кластеризация и понижение размерности (PCA) позволяют "
                    "выделить реальные сегменты, а не придуманные вручную."
                ),
                "formula": "X = U \\Sigma V^{T}",
                "formula_note": "SVD данных покупателей даёт латентные сегменты.",
                "uses": [
                    "Матрица «клиент × покупка»",
                    "Сегментация через кластеризацию",
                    "Прогноз спроса на рынке",
                    "Матрица цен и скидок",
                ],
                "example_slug": "ecommerce_funnel",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "accounting",
                "title": "Бухгалтерский учёт",
                "tagline": "Оборотные ведомости, балансовые матрицы, аудит",
                "description": (
                    "Бухгалтерский баланс — это система линейных уравнений: "
                    "активы равны пассивам, обороты сходятся. Матричная запись "
                    "позволяет быстро проверять согласованность, находить "
                    "ошибки и строить прогнозы."
                ),
                "formula": "A \\cdot x = b",
                "formula_note": "Балансовое уравнение: активы, пассивы, обороты.",
                "uses": [
                    "Матрица «счёт × счёт» оборотов",
                    "Проверка баланса",
                    "Прогноз денежных потоков",
                    "Аудит через анализ отклонений",
                ],
                "example_slug": "input_output",
                "operation": "determinant",
                "icon": "math/determinant",
            },
            {
                "slug": "banking",
                "title": "Банковское дело",
                "tagline": "Кредитные портфели, риски, корреляция заёмщиков",
                "description": (
                    "Банковский портфель — это матрица «заёмщик × риск-фактор». "
                    "Корреляции и собственные значения показывают, какие "
                    "риски системны, а какие диверсифицируемы. Это основа "
                    "управления капиталом (Basel III, VaR)."
                ),
                "formula": "\\Sigma = \\text{Cov}(r_i, r_j)",
                "formula_note": "Ковариационная матрица доходностей — основа оценки риска.",
                "uses": [
                    "Ковариационная матрица активов",
                    "Портфель минимального риска",
                    "Кредитный скоринг",
                    "Стресс-тестирование",
                ],
                "example_slug": "medical_diagnostic",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "finance",
                "title": "Финансы",
                "tagline": "Оптимизация портфеля, риски, оценка активов",
                "description": (
                    "Портфельная теория Марковица — это чистая линейная "
                    "алгебра: доходности и ковариации, оптимизация при "
                    "ограничениях. Собственные значения ковариационной "
                    "матрицы — это «факторы риска», движущие рынком."
                ),
                "formula": "w^{*} = \\frac{\\Sigma^{-1} \\mu}{\\mathbf{1}^{T} \\Sigma^{-1} \\mu}",
                "formula_note": "Оптимальный портфель через обратную ковариационную матрицу.",
                "uses": [
                    "Матрица доходностей активов",
                    "Оптимизация портфеля Марковица",
                    "Факторный анализ рисков",
                    "Оценка опционов (греки)",
                ],
                "example_slug": "input_output",
                "operation": "inverse",
                "icon": "math/inverse",
            },
            {
                "slug": "international-relations",
                "title": "Международные отношения",
                "tagline": "Геополитические сети, конфликты, альянсы",
                "description": (
                    "Международные отношения — это сеть: кто с кем торгует, "
                    "кто в каком альянсе, кто с кем конфликтует. Матрица "
                    "связей и её собственные значения показывают ключевых "
                    "игроков и «мосты» между блоками."
                ),
                "formula": "A \\cdot v = \\lambda \\cdot v",
                "formula_note": "Собственный вектор — «центральность» страны в сети.",
                "uses": [
                    "Матрица «страна × страна» связей",
                    "Центральность игроков",
                    "Анализ альянсов и блоков",
                    "Моделирование конфликтов",
                ],
                "example_slug": "graph_network",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
        ],
    },

    # =========================================================================
    # 3. ИНЖЕНЕРНАЯ ШКОЛА
    # =========================================================================
    {
        "slug": "engineering",
        "title": "Инженерная школа",
        "subtitle": "Строительство, энергетика, машиностроение, IT — там, где "
                    "математика становится инструментом.",
        "icon": "schools/school-engineering",
        "accent": "indigo",
        "directions": [
            {
                "slug": "architecture",
                "title": "Архитектура и градостроительство",
                "tagline": "Устойчивость конструкций, композиция, планировка",
                "description": (
                    "Архитектурные конструкции описываются матрицами "
                    "жёсткости: сколько усилий нужно, чтобы сместить узел. "
                    "Собственные значения такой матрицы — собственные частоты "
                    "колебаний; если они близки к резонансу, конструкция "
                    "опасна. Это классика строительной механики."
                ),
                "formula": "K \\cdot u = f",
                "formula_note": "Матрица жёсткости K × перемещения u = усилия f.",
                "uses": [
                    "Матрица жёсткости конструкции",
                    "Собственные частоты здания",
                    "Оптимальная планировка",
                    "Анализ устойчивости форм",
                ],
                "example_slug": "stiffness",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "construction",
                "title": "Строительство",
                "tagline": "Расчёт балок, ферм, устойчивость, нагрузки",
                "description": (
                    "Любая строительная конструкция — это система уравнений "
                    "равновесия. Матрица жёсткости собирается из блоков "
                    "(метод конечных элементов), решается — и мы получаем "
                    "напряжения и деформации. Без матриц это невозможно."
                ),
                "formula": "K \\cdot u = f",
                "formula_note": "Метод конечных элементов: матрица жёсткости и вектор нагрузок.",
                "uses": [
                    "Расчёт ферм и балок",
                    "Метод конечных элементов",
                    "Анализ устойчивости",
                    "Смета и оптимизация материалов",
                ],
                "example_slug": "stiffness",
                "operation": "lu",
                "icon": "math/lu",
            },
            {
                "slug": "engineering-communications",
                "title": "Строительство и монтаж инженерных коммуникаций",
                "tagline": "Сети трубопроводов, баланс потоков, оптимизация",
                "description": (
                    "Инженерные сети — это граф: узлы и трубы. Матрица "
                    "инцидентности описывает, куда втекает и откуда вытекает "
                    "поток. Её свойства связаны с законом Кирхгофа и "
                    "устойчивостью сети."
                ),
                "formula": "B \\cdot q = d",
                "formula_note": "Матрица инцидентности B × поток q = потребление d.",
                "uses": [
                    "Матрица инцидентности сети",
                    "Баланс давления и потоков",
                    "Оптимальные диаметры труб",
                    "Диагностика утечек",
                ],
                "example_slug": "input_output",
                "operation": "lu",
                "icon": "math/lu",
            },
            {
                "slug": "alternative-energy",
                "title": "Альтернативная энергетика",
                "tagline": "Распределение энергии, оптимизация, моделирование сетей",
                "description": (
                    "Энергосистема — это баланс: производство равно "
                    "потреблению. Матрица потоков мощности описывает, "
                    "как энергия идёт от генераторов к потребителям. "
                    "Собственные значения — устойчивость системы."
                ),
                "formula": "P = B \\cdot \\theta",
                "formula_note": "Поток мощности через матрицу проводимостей и углы напряжений.",
                "uses": [
                    "Матрица потоков энергии",
                    "Оптимизация распределения",
                    "Устойчивость энергосистемы",
                    "Прогноз выработки ВИЭ",
                ],
                "example_slug": "input_output",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "space-technology",
                "title": "Космические технологии",
                "tagline": "Ориентация, орбитальная динамика, телеметрия",
                "description": (
                    "Ориентация спутника описывается матрицей поворота. "
                    "Кинематика — матрицы Якоби. Управление — собственные "
                    "значения системы: устойчиво ли положение. Вся "
                    "космическая механика построена на матрицах."
                ),
                "formula": (
                    r"\mathbf{R} = \begin{pmatrix}"
                    r" c_\psi c_\theta &"
                    r" c_\psi s_\theta s_\phi - s_\psi c_\phi &"
                    r" c_\psi s_\theta c_\phi + s_\psi s_\phi \\"
                    r" s_\psi c_\theta &"
                    r" s_\psi s_\theta s_\phi + c_\psi c_\phi &"
                    r" s_\psi s_\theta c_\phi - c_\psi s_\phi \\"
                    r" -s_\theta & c_\theta s_\phi & c_\theta c_\phi"
                    r"\end{pmatrix}"
                ),
                "formula_note": "Матрица ориентации 3 × 3 — три оси, три угла Эйлера.",
                "uses": [
                    "Матрица ориентации спутника 3 × 3",
                    "Анализ устойчивости орбиты",
                    "Обработка телеметрии",
                    "Оптимальное управление",
                ],
                "example_slug": "rotation_2d",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "elevator-engineering",
                "title": "Лифтовое машиностроение",
                "tagline": "Динамика, вибрации, расчёт нагрузок",
                "description": (
                    "Лифт — это система масс, пружин и демпферов. Матрица "
                    "жёсткости и демпфирования описывает колебания кабины, "
                    "а собственные значения — резонансные частоты, которые "
                    "нужно избегать при проектировании."
                ),
                "formula": "M \\ddot{x} + C \\dot{x} + K x = F",
                "formula_note": "Матричное уравнение движения системы.",
                "uses": [
                    "Матрица жёсткости системы",
                    "Собственные частоты",
                    "Гашение вибраций",
                    "Оптимальное управление",
                ],
                "example_slug": "physics_oscillator",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "road-traffic",
                "title": "Управление дорожным движением",
                "tagline": "Потоки, светофоры, оптимизация, сети",
                "description": (
                    "Дорожная сеть — граф с потоками. Матрица интенсивности "
                    "переходов между участками описывает распространение "
                    "автомобилей. Её стационарное распределение — «равновесие» "
                    "потока; управление светофорами — задача оптимизации "
                    "матричной модели."
                ),
                "formula": "x_{t+1} = P \\cdot x_t",
                "formula_note": "Марковская модель потока через матрицу переходов.",
                "uses": [
                    "Матрица переходов между участками",
                    "Оптимизация светофоров",
                    "Прогноз заторов",
                    "Планирование маршрутов",
                ],
                "example_slug": "markov_chain",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "sustainable-transport",
                "title": "Устойчивый транспорт",
                "tagline": "Логистика, экология, оптимизация маршрутов",
                "description": (
                    "Устойчивый транспорт — это баланс между экономикой, "
                    "экологией и социальной доступностью. Матрица «маршрут × "
                    "критерий» с весами даёт комплексную оценку, а методы "
                    "оптимизации — наилучший план."
                ),
                "formula": "S = W \\cdot C",
                "formula_note": "Взвешенная оценка маршрута по критериям.",
                "uses": [
                    "Матрица «маршрут × критерий»",
                    "Оптимизация маршрутов",
                    "Оценка углеродного следа",
                    "Анализ доступности",
                ],
                "example_slug": "teacher_grade",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "electrical-engineering",
                "title": "Электротехника",
                "tagline": "Цепи, узлы, токи, матрицы проводимости",
                "description": (
                    "Электрическая цепь — это система линейных уравнений "
                    "(законы Кирхгофа). Матрица проводимости связывает "
                    "узлы и токи; её решение даёт напряжения в каждой "
                    "точке. Это метод узловых потенциалов — основа "
                    "всей схемотехники."
                ),
                "formula": "Y \\cdot U = I",
                "formula_note": "Матрица проводимости Y × напряжения U = токи I.",
                "uses": [
                    "Матрица проводимости цепи",
                    "Анализ переходных процессов",
                    "Оптимальное проектирование",
                    "Частотный анализ",
                ],
                "example_slug": "input_output",
                "operation": "lu",
                "icon": "math/lu",
            },
            {
                "slug": "mechatronics",
                "title": "Мехатроника",
                "tagline": "Управление, робототехника, сенсоры и приводы",
                "description": (
                    "Мехатронные системы — это комбинация механики, "
                    "электроники и управления. Матрицы состояния описывают "
                    "динамику, а собственные значения — устойчивость "
                    "и быстродействие системы управления."
                ),
                "formula": "\\dot{x} = A x + B u",
                "formula_note": "Матричное уравнение состояния системы управления.",
                "uses": [
                    "Матрица состояния системы",
                    "Анализ устойчивости",
                    "Синтез регулятора",
                    "Кинематика робота",
                ],
                "example_slug": "physics_oscillator",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "mechanical-engineering",
                "title": "Технология машиностроения",
                "tagline": "Расчёт деталей, напряжений, оптимизация",
                "description": (
                    "Детали машин работают под нагрузкой, и их напряжённое "
                    "состояние — это тензор, который в матричной форме "
                    "описывает напряжения в каждой точке. Собственные "
                    "значения — главные напряжения, определяющие прочность."
                ),
                "formula": "\\sigma = C \\cdot \\varepsilon",
                "formula_note": "Закон Гука в матричной форме: напряжения через деформации.",
                "uses": [
                    "Матрица напряжений",
                    "Главные напряжения",
                    "Прочность и усталость",
                    "Оптимизация геометрии",
                ],
                "example_slug": "stiffness",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "industrial-engineering",
                "title": "Промышленная инженерия и менеджмент",
                "tagline": "Планирование производства, ресурсы, оптимизация",
                "description": (
                    "Задачи планирования производства — это линейное "
                    "программирование: максимизировать выпуск при "
                    "ограничениях на ресурсы. Матрица ограничений — "
                    "основа симплекс-метода и всей оптимизации."
                ),
                "formula": "\\max c^{T} x \\quad \\text{при} \\quad A x \\leq b",
                "formula_note": "Линейная оптимизация: матрица ограничений A.",
                "uses": [
                    "Матрица «продукт × ресурс»",
                    "Оптимизация расписания",
                    "Управление запасами",
                    "Оценка узких мест",
                ],
                "example_slug": "input_output",
                "operation": "lu",
                "icon": "math/lu",
            },
            {
                "slug": "biotechnology",
                "title": "Биотехнология",
                "tagline": "Популяции, метаболизм, генетические сети",
                "description": (
                    "Биологические системы — это сети взаимодействий: "
                    "гены регулируют друг друга, метаболиты переходят "
                    "друг в друга. Матрица таких связей описывает "
                    "динамику системы, а собственные значения — "
                    "устойчивость и режимы."
                ),
                "formula": "\\dot{x} = A x",
                "formula_note": "Линейная модель биологической сети.",
                "uses": [
                    "Матрица генной регуляции",
                    "Динамика популяций (Лесли)",
                    "Метаболические пути",
                    "Устойчивость экосистем",
                ],
                "example_slug": "population",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "information-systems",
                "title": "Инженерия информационных систем",
                "tagline": "Архитектура систем, графы зависимостей, оптимизация",
                "description": (
                    "Информационные системы — это графы: сервисы, базы, "
                    "интеграции. Матрица смежности показывает зависимости "
                    "и точки отказа. Собственные значения — «узкие места», "
                    "которые нужно резервировать."
                ),
                "formula": "A \\cdot v = \\lambda \\cdot v",
                "formula_note": "Анализ графа зависимостей системы.",
                "uses": [
                    "Граф зависимостей сервисов",
                    "Поиск узких мест",
                    "Оценка надёжности",
                    "Оптимизация архитектуры",
                ],
                "example_slug": "graph_network",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "information-technology",
                "title": "Информационные системы и технологии",
                "tagline": "Базы данных, поиск, рекомендации, машинное обучение",
                "description": (
                    "Информационные системы работают с матрицами повсюду: "
                    "от индексов баз данных до рекомендательных систем. "
                    "SVD матрицы «пользователь × товар» — это основа "
                    "коллаборативной фильтрации."
                ),
                "formula": "R \\approx U \\Sigma V^{T}",
                "formula_note": "Разложение матрицы предпочтений — рекомендации.",
                "uses": [
                    "Матрица «пользователь × товар»",
                    "Рекомендательные системы",
                    "Поиск (TF-IDF, BM25)",
                    "Кластеризация данных",
                ],
                "example_slug": "ecommerce_funnel",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "software-engineering",
                "title": "Программная инженерия",
                "tagline": "Граф зависимостей кода, тестирование, метрики",
                "description": (
                    "Кодовая база — это граф зависимостей между модулями. "
                    "Матрица связей помогает найти «сильно связанные» "
                    "компоненты, оценить сложность рефакторинга и "
                    "спланировать тестирование."
                ),
                "formula": "C = A^{T} \\cdot A",
                "formula_note": "Матрица связности модулей через произведение.",
                "uses": [
                    "Граф зависимостей модулей",
                    "Метрики связанности",
                    "Планирование тестов",
                    "Анализ влияния изменений",
                ],
                "example_slug": "graph_network",
                "operation": "rank",
                "icon": "ui/grid",
            },
            {
                "slug": "computer-engineering",
                "title": "Компьютерная инженерия",
                "tagline": "Обработка сигналов, кодирование, встраиваемые системы",
                "description": (
                    "Обработка сигналов — это свёртки, а свёртки — "
                    "умножение на матрицу Тёплица. Кодирование — это "
                    "линейные коды над конечными полями: проверочная "
                    "матрица и её ранг определяют, сколько ошибок "
                    "можно исправить."
                ),
                "formula": "y = H \\cdot x",
                "formula_note": "Кодирование линейным кодом через проверочную матрицу.",
                "uses": [
                    "Фильтрация сигналов",
                    "Линейные коды (Хэмминг, Рида-Соломона)",
                    "Сжатие данных",
                    "Обработка изображений",
                ],
                "example_slug": "image_filter",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "applied-mathematics",
                "title": "Прикладная математика",
                "tagline": "Численные методы, оптимизация, моделирование",
                "description": (
                    "Прикладная математика — это язык матриц. Численные "
                    "методы решения уравнений, оптимизация, аппроксимация, "
                    "дифференциальные уравнения — всё это в матричной "
                    "форме. Собственные значения — универсальный "
                    "инструмент анализа."
                ),
                "formula": "A x = b \\;\\Rightarrow\\; x = A^{-1} b",
                "formula_note": "Решение линейной системы — базовый численный метод.",
                "uses": [
                    "Численное решение уравнений",
                    "Оптимизация функций",
                    "Аппроксимация данных",
                    "Анализ устойчивости",
                ],
                "example_slug": "matrix_3x3",
                "operation": "lu",
                "icon": "math/lu",
            },
            {
                "slug": "artificial-intelligence",
                "title": "Искусственный интеллект",
                "tagline": "Нейросети, эмбеддинги, обучение, трансформеры",
                "description": (
                    "Современный ИИ — это матрицы. Слой нейросети — "
                    "умножение на матрицу весов. Внимание в трансформерах — "
                    "матричное произведение Q·Kᵀ. Эмбеддинги слов — "
                    "результат разложения матрицы контекстов. Без линейной "
                    "алгебры ИИ не существует."
                ),
                "formula": "\\text{Attention}(Q,K,V) = \\text{softmax}\\!\\left(\\frac{Q K^{T}}{\\sqrt{d}}\\right) V",
                "formula_note": "Механизм внимания — три матрицы и softmax.",
                "uses": [
                    "Слои нейросети (веса)",
                    "Эмбеддинги (SVD, Word2Vec)",
                    "Механизм внимания (Q, K, V)",
                    "Метрики качества (матрица ошибок)",
                ],
                "example_slug": "image_filter",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
        ],
    },

    # =========================================================================
    # 4. ШКОЛА ИСКУССТВ
    # =========================================================================
    {
        "slug": "arts",
        "title": "Школа искусств",
        "subtitle": "Дизайн, живопись, музыка — там, где гармония становится "
                    "структурой.",
        "icon": "schools/school-arts",
        "accent": "rose",
        "directions": [
            {
                "slug": "fashion-design",
                "title": "Дизайн одежды",
                "tagline": "Цветовые гармонии, паттерны, тренды",
                "description": (
                    "Дизайнер работает с матрицами цветовых сочетаний: "
                    "какие цвета совместимы, какие — контрастируют. "
                    "Матрица цветовых переходов в коллекции показывает "
                    "её целостность; собственные значения — её "
                    "«температуру»."
                ),
                "formula": "C_{ij} = \\text{совместимость}(c_i, c_j)",
                "formula_note": "Матрица совместимости цветов коллекции.",
                "uses": [
                    "Матрица цветовых гармоний",
                    "Анализ трендов (PCA)",
                    "Кластеризация стилей",
                    "Прогноз коллекций",
                ],
                "example_slug": "fashion_design",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "painting",
                "title": "Живопись",
                "tagline": "Композиция, перспектива, анализ стиля",
                "description": (
                    "Композиция картины — это баланс масс и цветов. "
                    "Матрица распределения цвета по полотну и её "
                    "собственные значения показывают, где «центр "
                    "тяжести» картины. Это инструмент анализа стиля "
                    "и композиции."
                ),
                "formula": "M_{ij} = \\text{цвет в ячейке } (i, j)",
                "formula_note": "Цветовая матрица изображения.",
                "uses": [
                    "Цветовая матрица картины",
                    "Анализ композиции",
                    "Стилометрия художника",
                    "Восстановление и реставрация",
                ],
                "example_slug": "image_filter",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "interior-design",
                "title": "Дизайн интерьера",
                "tagline": "Планировка, зонирование, оптимизация пространства",
                "description": (
                    "Планировка помещения — это задача оптимизации: "
                    "разместить элементы так, чтобы связи между ними "
                    "были удобны. Матрица «зона × зона» с весами "
                    "близости — основа алгоритмов автоматической "
                    "планировки."
                ),
                "formula": "S = W \\cdot D",
                "formula_note": "Оценка планировки через взвешенные расстояния.",
                "uses": [
                    "Матрица «зона × зона»",
                    "Оптимизация планировки",
                    "Оценка освещённости",
                    "Зонирование пространства",
                ],
                "example_slug": "teacher_grade",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
        ],
    },

    # =========================================================================
    # 5. ШКОЛА МЕДИЦИНЫ
    # =========================================================================
    {
        "slug": "medicine",
        "title": "Школа медицины",
        "subtitle": "Диагностика, фармакокинетика, эпидемиология — там, где "
                    "данные спасают жизни.",
        "icon": "schools/school-medicine",
        "accent": "cyan",
        "directions": [
            {
                "slug": "general-medicine",
                "title": "Лечебное дело",
                "tagline": "Диагностика, симптомы, корреляции, прогноз",
                "description": (
                    "Диагностика — это матрица «симптом × диагноз»: "
                    "какие симптомы чаще встречаются при какой болезни. "
                    "Байесовский подход через матрицы условных вероятностей "
                    "лежит в основе медицинских экспертных систем."
                ),
                "formula": "P(D \\mid S) = \\frac{P(S \\mid D) P(D)}{P(S)}",
                "formula_note": "Байесовская диагностика через матрицу условных вероятностей.",
                "uses": [
                    "Матрица «симптом × диагноз»",
                    "Байесовская диагностика",
                    "Прогноз течения болезни",
                    "Кластеризация пациентов",
                ],
                "example_slug": "medical_diagnostic",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "dentistry",
                "title": "Стоматология",
                "tagline": "Топография зубов, окклюзия, биомеханика",
                "description": (
                    "Биомеханика зуба — это тензор напряжений в тканях. "
                    "Матрица нагрузок и матрица упругости вместе дают "
                    "распределение напряжений. Это основа ортодонтии и "
                    "протезирования."
                ),
                "formula": "\\sigma = C \\cdot \\varepsilon",
                "formula_note": "Матрица упругости тканей зуба.",
                "uses": [
                    "Матрица нагрузок на зуб",
                    "Анализ окклюзии",
                    "Планирование имплантата",
                    "Моделирование челюсти",
                ],
                "example_slug": "stiffness",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
            {
                "slug": "pediatrics",
                "title": "Педиатрия",
                "tagline": "Развитие, нормы, диагностика по возрастам",
                "description": (
                    "Педиатрия — это работа с нормами развития: рост, вес, "
                    "психомоторика. Матрица «ребёнок × показатель» с "
                    "возрастными нормами позволяет строить перцентильные "
                    "кривые и находить отклонения."
                ),
                "formula": "Z = \\frac{x - \\mu}{\\sigma}",
                "formula_note": "Z-оценка через матрицу норм и отклонений.",
                "uses": [
                    "Матрица показателей развития",
                    "Перцентильные кривые",
                    "Скрининг отклонений",
                    "Прогноз развития",
                ],
                "example_slug": "psychology_profile",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "nursing",
                "title": "Высшее сестринское дело",
                "tagline": "Уход, мониторинг, планирование нагрузки",
                "description": (
                    "Сестринский процесс — это алгоритм с обратной связью. "
                    "Матрица состояния пациента по показателям и матрица "
                    "вмешательств позволяют оптимизировать план ухода "
                    "и распределение времени медсестёр."
                ),
                "formula": "S_{t+1} = T \\cdot S_t",
                "formula_note": "Марковская модель состояния пациента.",
                "uses": [
                    "Матрица состояния пациента",
                    "Оптимизация нагрузки",
                    "Мониторинг динамики",
                    "Стандартизация протоколов",
                ],
                "example_slug": "markov_chain",
                "operation": "properties",
                "icon": "ui/check-badge",
            },
            {
                "slug": "cosmetology",
                "title": "Косметология",
                "tagline": "Состояния кожи, уход, оценка процедур",
                "description": (
                    "Кожа проходит через состояния: норма, сухость, "
                    "воспаление. Переходы между состояниями под "
                    "воздействием процедур — это марковская цепь. "
                    "Матрица переходов показывает долгосрочный эффект "
                    "ухода и помогает строить персонализированные "
                    "программы."
                ),
                "formula": "S_{t+1} = P \\cdot S_t",
                "formula_note": "Марковская модель состояний кожи.",
                "uses": [
                    "Матрица состояний кожи",
                    "Оценка эффективности процедур",
                    "Персонализация программ",
                    "Прогноз долгосрочного эффекта",
                ],
                "example_slug": "cosmetology_skin",
                "operation": "eigenvalues",
                "icon": "math/lambda",
            },
        ],
    },
]


# =============================================================================
# Пресеты для калькулятора на странице модулей
# =============================================================================

MODULE_PRESETS: list[dict[str, Any]] = [
    {
        "code": "determinant",
        "label": "Обратимость преобразования",
        "subtitle": "det A ≠ 0 — можно вернуться назад",
        "description": (
            "Определитель показывает, во сколько раз преобразование "
            "изменяет объём. Если он равен нулю — преобразование "
            "необратимо: часть информации теряется. Это фундамент "
            "любой задачи устойчивости."
        ),
        "icon": "math/determinant",
    },
    {
        "code": "eigenvalues",
        "label": "Собственные состояния",
        "subtitle": "λ — устойчивые режимы системы",
        "description": (
            "Собственные значения показывают, какие направления "
            "система сохраняет, а какие меняет. Это язык устойчивости, "
            "резонанса и главных компонент — от вибраций моста до "
            "факторов риска в портфеле."
        ),
        "icon": "math/lambda",
    },
    {
        "code": "lu",
        "label": "Разложение сложной задачи",
        "subtitle": "A = L·U — пошаговое решение",
        "description": (
            "Сложную матрицу можно разложить на простые треугольные "
            "множители. Тогда решение системы становится быстрым: "
            "сначала прямой ход, потом обратный. Это основа "
            "численных методов."
        ),
        "icon": "math/lu",
    },
    {
        "code": "rank",
        "label": "Размерность данных",
        "subtitle": "rank A — сколько независимых измерений",
        "description": (
            "Ранг матрицы — это число независимых строк. В данных "
            "он показывает, сколько скрытых факторов реально "
            "управляет результатом. Низкий ранг — сигнал, что "
            "данные избыточны."
        ),
        "icon": "math/rank",
    },
    {
        "code": "inverse",
        "label": "Обратное преобразование",
        "subtitle": "A⁻¹ — вернуться к исходному состоянию",
        "description": (
            "Обратная матрица решает обратную задачу: если мы знаем "
            "результат, что было на входе? Это нужно для "
            "дешифровки, восстановления сигнала и калибровки "
            "измерительных приборов."
        ),
        "icon": "math/inverse",
    },
    {
        "code": "properties",
        "label": "Полный анализ свойств",
        "subtitle": "Все характеристики матрицы сразу",
        "description": (
            "Одна матрица — и сразу полный портрет: квадратная ли, "
            "симметричная, ортогональная, вырожденная, "
            "положительно определённая, идемпотентная. "
            "Плюс определитель, ранг, след и собственные значения."
        ),
        "icon": "ui/check-badge",
    },
]


# =============================================================================
# Хелперы для работы с модулями
# =============================================================================

def _find_school(school_slug: str) -> dict[str, Any] | None:
    """Найти школу по slug. None — если не существует."""
    for school in MODULE_SCHOOLS:
        if school["slug"] == school_slug:
            return school
    return None


def _find_direction(school: dict[str, Any],
                    direction_slug: str) -> dict[str, Any] | None:
    """Найти направление внутри школы по slug."""
    for direction in school.get("directions", []):
        if direction["slug"] == direction_slug:
            return direction
    return None


def _neighbors_in_school(school: dict[str, Any],
                         direction_slug: str) -> dict[str, Any]:
    """Вернуть prev/next направления внутри школы."""
    directions = school.get("directions", [])
    prev_d = None
    next_d = None
    for i, d in enumerate(directions):
        if d["slug"] == direction_slug:
            if i > 0:
                prev_d = directions[i - 1]
            if i < len(directions) - 1:
                next_d = directions[i + 1]
            break
    return {"prev": prev_d, "next": next_d}


def _build_school_context(school: dict[str, Any]) -> dict[str, Any]:
    """Собрать контекст страницы школы."""
    school_slug = school["slug"]
    content_info = get_school_content(school_slug, school)

    enriched_directions: list[dict[str, Any]] = []
    for direction in school.get("directions", []):
        d_content = get_direction_content(school_slug, direction)
        enriched = dict(direction)
        enriched["content"] = d_content
        enriched["school_slug"] = school_slug
        enriched_directions.append(enriched)

    all_slugs = [s["slug"] for s in MODULE_SCHOOLS]
    idx = all_slugs.index(school_slug)
    prev_school = MODULE_SCHOOLS[idx - 1] if idx > 0 else None
    next_school = MODULE_SCHOOLS[idx + 1] if idx < len(MODULE_SCHOOLS) - 1 else None

    return {
        "school": {
            **school,
            "directions": enriched_directions,
        },
        "school_info": content_info,
        "directions": enriched_directions,
        "total_directions": len(enriched_directions),
        "prev_school": prev_school,
        "next_school": next_school,
    }


def _build_direction_context(school: dict[str, Any],
                             direction: dict[str, Any]) -> dict[str, Any]:
    """Собрать контекст страницы направления."""
    school_slug = school["slug"]
    direction_slug = direction["slug"]

    d_content = dict(get_direction_content(school_slug, direction))

    if d_content.get("solved_examples"):
        d_content["solved_examples"] = _enrich_solved_examples(
            d_content["solved_examples"]
        )

    neighbors = _neighbors_in_school(school, direction_slug)

    related_default = [
        d for d in school.get("directions", [])
        if d["slug"] != direction_slug
    ][:3]

    return {
        "school": school,
        "direction": direction,
        "content": d_content,
        "prev_direction": neighbors["prev"],
        "next_direction": neighbors["next"],
        "related_directions": related_default,
    }


# =============================================================================
# Страница «Применение по направлениям» (обзорная)
# =============================================================================

def modules(request: HttpRequest) -> HttpResponse:
    """Страница «Применение по направлениям»."""
    return render(
        request,
        "matrix_app/modules.html",
        {
            "schools": MODULE_SCHOOLS,
            "presets": MODULE_PRESETS,
            "examples": EXAMPLES,
            "total_directions": sum(
                len(s["directions"]) for s in MODULE_SCHOOLS
            ),
        },
    )


# =============================================================================
# Страница школы
# =============================================================================

def school_detail(request: HttpRequest, school_slug: str) -> HttpResponse:
    """Отдельная страница школы."""
    school = _find_school(school_slug)
    if not school:
        raise Http404(f"Школа «{school_slug}» не найдена.")

    context = _build_school_context(school)
    context["presets"] = MODULE_PRESETS
    context["examples"] = EXAMPLES
    context["all_schools"] = MODULE_SCHOOLS

    return render(request, "matrix_app/school.html", context)


# =============================================================================
# Страница направления
# =============================================================================

def direction_detail(request: HttpRequest,
                     school_slug: str,
                     direction_slug: str) -> HttpResponse:
    """Отдельная страница направления."""
    school = _find_school(school_slug)
    if not school:
        raise Http404(f"Школа «{school_slug}» не найдена.")

    direction = _find_direction(school, direction_slug)
    if not direction:
        raise Http404(
            f"Направление «{direction_slug}» не найдено в школе «{school_slug}»."
        )

    context = _build_direction_context(school, direction)
    context["presets"] = MODULE_PRESETS
    context["examples"] = EXAMPLES
    context["all_schools"] = MODULE_SCHOOLS

    return render(request, "matrix_app/direction.html", context)


# =============================================================================
# История
# =============================================================================

def history(request: HttpRequest) -> HttpResponse:
    """История вычислений пользователя (по сессии)."""
    key = ensure_session_key(request)
    qs = CalculationHistory.objects.filter(session_key=key).order_by("-created_at")
    entries = list(qs[:200])
    return render(
        request,
        "matrix_app/history.html",
        {
            "history_entries": entries,
            "history_count": len(entries),
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
    items = SavedMatrix.objects.filter(session_key=key).order_by("-updated_at")
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
    """Принимает апдейты от Telegram."""
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
        return HttpResponse("error handled")

    return HttpResponse("ok")