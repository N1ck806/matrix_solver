"""
Контекст-процессоры приложения MatrixLab.

Добавляют глобальные переменные во все шаблоны:

    • app_meta         — название, описание, автор, текущий год;
    • limits           — лимиты интерфейса (max_rows, max_cols, СЛАУ, точность);
    • cdn              — URL-адреса CDN-библиотек (MathJax, Chart.js);
    • navigation       — пункты меню (NAV_ITEMS), активная страница и группа;
    • matrixlab_config — единый JSON-совместимый конфиг для window.MatrixLab.

Процессоры тонкие и быстрые — выполняются на каждом запросе,
поэтому обращений к БД здесь нет.
"""
from __future__ import annotations

import datetime
from typing import Any, Final

from django.conf import settings
from django.http import HttpRequest

from . import __description__, __title__, __version__


# =============================================================================
# Метаданные приложения
# =============================================================================

def app_meta(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """
    Название, описание, автор и текущий год.

    Используется в:
        • <title>, meta description, Open Graph;
        • шапке (логотип, alt);
        • футере (копирайт, подпись).
    """
    return {
        "APP_NAME": __title__,
        "APP_VERSION": __version__,
        "APP_DESCRIPTION": __description__,
        "APP_AUTHOR": getattr(settings, "APP_AUTHOR", "MatrixLab"),
        "CURRENT_YEAR": datetime.date.today().year,
    }


# =============================================================================
# Лимиты интерфейса
# =============================================================================

def limits(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """
    Ограничения, которые нужны фронтенду:

        • размеры матриц (обычные и для СЛАУ);
        • символические вычисления;
        • история и сохранённые матрицы;
        • формат вывода и точность.

    Значения берутся из settings с безопасными значениями по умолчанию —
    если настройки нет, шаблон всё равно отрендерится.
    """
    max_rows = getattr(settings, "MAX_MATRIX_ROWS", 10)
    max_cols = getattr(settings, "MAX_MATRIX_COLS", 10)

    return {
        # --- Обычные матрицы ---
        "MAX_MATRIX_ROWS":       max_rows,
        "MAX_MATRIX_COLS":       max_cols,

        # --- СЛАУ: расширенная матрица [A | b] имеет размер n × (m + 1) ---
        "MAX_SLAU_ROWS":         getattr(settings, "MAX_SLAU_ROWS", max_rows),
        "MAX_SLAU_COLS":         getattr(settings, "MAX_SLAU_COLS", max_cols + 1),
        "MAX_PARAMETERS_SLAU":   getattr(settings, "MAX_PARAMETERS_SLAU", 20),

        # --- Символьные вычисления ---
        "MAX_SYMBOLIC_SIZE":     getattr(settings, "MAX_SYMBOLIC_SIZE", 5),
        "MAX_MATRIX_POWER":      getattr(settings, "MAX_MATRIX_POWER", 100),

        # --- История и сохранённые ---
        "HISTORY_LIMIT":         getattr(settings, "HISTORY_LIMIT", 200),
        "SAVED_MATRICES_LIMIT":  getattr(settings, "SAVED_MATRICES_LIMIT", 100),

        # --- Формат вывода ---
        "DEFAULT_OUTPUT_FORMAT": getattr(settings, "DEFAULT_OUTPUT_FORMAT", "exact"),
        "DECIMAL_PRECISION":     getattr(settings, "DECIMAL_PRECISION", 6),
        "SYMBOLIC_TERM_LIMIT":   getattr(settings, "SYMBOLIC_TERM_LIMIT", 500),
    }


# =============================================================================
# CDN
# =============================================================================

def cdn(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """
    Ссылки на внешние ресурсы. Определены в settings.CDN.

    Пример:
        CDN = {
            "mathjax": "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js",
            "chartjs": "https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js",
        }

    Дополнительно отдаём `CDN_PRECONNECT` — список origin'ов, на которые
    шаблон может поставить <link rel="preconnect">.
    """
    cdn_map = dict(getattr(settings, "CDN", {}) or {})

    # Уникальные origin'ы из URL'ов.
    origins: set[str] = set()
    for url in cdn_map.values():
        if not isinstance(url, str):
            continue
        # https://cdn.jsdelivr.net/npm/... → https://cdn.jsdelivr.net
        parts = url.split("/", 3)
        if len(parts) >= 3 and parts[0] in ("http:", "https:"):
            origins.add("/".join(parts[:3]))

    return {
        "CDN": cdn_map,
        "CDN_PRECONNECT": sorted(origins),
    }


# =============================================================================
# Навигация
# =============================================================================

# Единый источник пунктов меню.
# Используется в base.html (шапка, мобильное меню) и в футере.
#
# Поля:
#   url_name    — полное имя маршрута с namespace: 'matrix_app:calculator'
#   label       — название пункта
#   description — короткая подпись (мобильное меню, подсказки)
#   icon        — идентификатор иконки для {% icon %}
#   group       — логическая группа: 'tools' | 'learn'
#
NAV_ITEMS: Final[tuple[dict[str, str], ...]] = (
    {
        "url_name": "matrix_app:calculator",
        "label": "Калькулятор",
        "description": "Решать матрицы",
        "icon": "calculator",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:operations",
        "label": "Операции",
        "description": "Сложение, умножение, степень",
        "icon": "layers",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:properties",
        "label": "Свойства",
        "description": "Определитель, ранг, след",
        "icon": "check-badge",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:systems",
        "label": "СЛАУ",
        "description": "Системы линейных уравнений",
        "icon": "system",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:decompositions",
        "label": "Разложения",
        "description": "LU, QR, Холецкий",
        "icon": "grid",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:eigen",
        "label": "Спектр",
        "description": "Собственные значения и векторы",
        "icon": "lambda",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:theory",
        "label": "Теория",
        "description": "Линейная алгебра",
        "icon": "book-open",
        "group": "learn",
    },
    {
        "url_name": "matrix_app:types",
        "label": "Виды матриц",
        "description": "Классификация и примеры",
        "icon": "matrix-grid",
        "group": "learn",
    },
)


def navigation(request: HttpRequest) -> dict[str, Any]:
    """
    Пункты навигации, текущая активная страница и группа.

    ACTIVE_PAGE  — полное имя маршрута (например, 'matrix_app:calculator').
    ACTIVE_GROUP — группа активного пункта ('tools' | 'learn'), либо ''.
    """
    active: str = ""
    if request is not None and getattr(request, "resolver_match", None) is not None:
        active = request.resolver_match.view_name or ""

    active_group: str = ""
    if active:
        for item in NAV_ITEMS:
            if item["url_name"] == active:
                active_group = item["group"]
                break

    return {
        "NAV_ITEMS": NAV_ITEMS,
        "ACTIVE_PAGE": active,
        "ACTIVE_GROUP": active_group,
    }


# =============================================================================
# Единый конфиг для window.MatrixLab
# =============================================================================

def matrixlab_config(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """
    Готовый JSON-совместимый конфиг, который в base.html можно
    сериализовать в <script>:

        <script>
        window.MatrixLab = window.MatrixLab || {};
        window.MatrixLab.config = {{ MATRIXLAB_CONFIG_JSON|safe }};
        </script>

    Содержит только то, что реально нужно фронтенду:
    лимиты, формат вывода, CDN.
    """
    max_rows = getattr(settings, "MAX_MATRIX_ROWS", 10)
    max_cols = getattr(settings, "MAX_MATRIX_COLS", 10)

    config: dict[str, Any] = {
        # Лимиты
        "MAX_MATRIX_ROWS":       max_rows,
        "MAX_MATRIX_COLS":       max_cols,
        "MAX_SLAU_ROWS":         getattr(settings, "MAX_SLAU_ROWS", max_rows),
        "MAX_SLAU_COLS":         getattr(settings, "MAX_SLAU_COLS", max_cols + 1),
        "MAX_PARAMETERS_SLAU":   getattr(settings, "MAX_PARAMETERS_SLAU", 20),
        "MAX_SYMBOLIC_SIZE":     getattr(settings, "MAX_SYMBOLIC_SIZE", 5),
        "MAX_MATRIX_POWER":      getattr(settings, "MAX_MATRIX_POWER", 100),
        "HISTORY_LIMIT":         getattr(settings, "HISTORY_LIMIT", 200),
        "SAVED_MATRICES_LIMIT":  getattr(settings, "SAVED_MATRICES_LIMIT", 100),

        # Формат
        "DEFAULT_OUTPUT_FORMAT": getattr(settings, "DEFAULT_OUTPUT_FORMAT", "exact"),
        "DECIMAL_PRECISION":     getattr(settings, "DECIMAL_PRECISION", 6),
        "SYMBOLIC_TERM_LIMIT":   getattr(settings, "SYMBOLIC_TERM_LIMIT", 500),

        # Режим
        "DEBUG":                 bool(getattr(settings, "DEBUG", False)),

        # CDN
        "CDN":                   dict(getattr(settings, "CDN", {}) or {}),
    }

    return {"MATRIXLAB_CONFIG": config}