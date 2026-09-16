"""
Контекст-процессоры приложения MatrixLab.

Добавляют глобальные переменные во все шаблоны:

    • app_meta         — название, описание, автор, текущий год;
    • limits           — лимиты интерфейса (max_rows, max_cols, СЛАУ, точность);
    • cdn              — URL-адреса CDN-библиотек (MathJax, Chart.js);
    • navigation       — пункты меню (NAV_ITEMS), активная страница и группа;
    • module_schools   — школы и активная школа/направление (для сайдбара);
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
    """Название, описание, автор и текущий год."""
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
    """Ограничения, которые нужны фронтенду."""
    max_rows = getattr(settings, "MAX_MATRIX_ROWS", 10)
    max_cols = getattr(settings, "MAX_MATRIX_COLS", 10)

    return {
        "MAX_MATRIX_ROWS":       max_rows,
        "MAX_MATRIX_COLS":       max_cols,
        "MAX_SLAU_ROWS":         getattr(settings, "MAX_SLAU_ROWS", max_rows),
        "MAX_SLAU_COLS":         getattr(settings, "MAX_SLAU_COLS", max_cols + 1),
        "MAX_PARAMETERS_SLAU":   getattr(settings, "MAX_PARAMETERS_SLAU", 20),
        "MAX_SYMBOLIC_SIZE":     getattr(settings, "MAX_SYMBOLIC_SIZE", 5),
        "MAX_MATRIX_POWER":      getattr(settings, "MAX_MATRIX_POWER", 100),
        "HISTORY_LIMIT":         getattr(settings, "HISTORY_LIMIT", 200),
        "SAVED_MATRICES_LIMIT":  getattr(settings, "SAVED_MATRICES_LIMIT", 100),
        "DEFAULT_OUTPUT_FORMAT": getattr(settings, "DEFAULT_OUTPUT_FORMAT", "exact"),
        "DECIMAL_PRECISION":     getattr(settings, "DECIMAL_PRECISION", 6),
        "SYMBOLIC_TERM_LIMIT":   getattr(settings, "SYMBOLIC_TERM_LIMIT", 500),
    }


# =============================================================================
# CDN
# =============================================================================

def cdn(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """Ссылки на внешние ресурсы и origin'ы для preconnect."""
    cdn_map = dict(getattr(settings, "CDN", {}) or {})

    origins: set[str] = set()
    for url in cdn_map.values():
        if not isinstance(url, str):
            continue
        parts = url.split("/", 3)
        if len(parts) >= 3 and parts[0] in ("http:", "https:"):
            origins.add("/".join(parts[:3]))

    return {
        "CDN": cdn_map,
        "CDN_PRECONNECT": sorted(origins),
    }


# =============================================================================
# Навигация (инструменты / обучение / личное)
# =============================================================================

NAV_ITEMS: Final[tuple[dict[str, str], ...]] = (
    # --- Инструменты -------------------------------------------------------
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
        "icon": "operations",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:properties",
        "label": "Свойства",
        "description": "Определитель, ранг, след",
        "icon": "properties",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:systems",
        "label": "СЛАУ",
        "description": "Системы линейных уравнений",
        "icon": "systems",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:decompositions",
        "label": "Разложения",
        "description": "LU, QR, Холецкий",
        "icon": "decompositions",
        "group": "tools",
    },
    {
        "url_name": "matrix_app:eigen",
        "label": "Спектр",
        "description": "Собственные значения и векторы",
        "icon": "eigen",
        "group": "tools",
    },

    # --- Обучение ----------------------------------------------------------
    {
        "url_name": "matrix_app:theory",
        "label": "Теория",
        "description": "Линейная алгебра",
        "icon": "theory",
        "group": "learn",
    },
    {
        "url_name": "matrix_app:types",
        "label": "Виды матриц",
        "description": "Классификация и примеры",
        "icon": "types",
        "group": "learn",
    },
    {
        "url_name": "matrix_app:modules",
        "label": "Применение",
        "description": "Матрицы в реальных профессиях",
        "icon": "modules",
        "group": "learn",
    },

    # --- Личное ------------------------------------------------------------
    {
        "url_name": "matrix_app:saved_matrices",
        "label": "Сохранённые",
        "description": "Ваши матрицы",
        "icon": "bookmark",
        "group": "personal",
    },
    {
        "url_name": "matrix_app:history",
        "label": "История",
        "description": "Последние вычисления",
        "icon": "history",
        "group": "personal",
    },
    {
        "url_name": "matrix_app:about",
        "label": "О проекте",
        "description": "О MatrixLab",
        "icon": "info",
        "group": "personal",
    },
)


def navigation(request: HttpRequest) -> dict[str, Any]:
    """Пункты навигации + активная страница и группа."""
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
# МОДУЛИ ПО НАПРАВЛЕНИЯМ — школы и активная школа/направление
# =============================================================================

def module_schools(request: HttpRequest) -> dict[str, Any]:
    """
    Список школ и активная школа/направление.

    Используется в сайдбаре (base.html) для группы «Применение»:

        • MODULE_SCHOOLS         — список всех школ (с directions);
        • ACTIVE_SCHOOL_SLUG     — slug текущей школы (или '');
        • ACTIVE_DIRECTION_SLUG  — slug текущего направления (или '').
    """
    # Ленивый импорт — чтобы не тянуть views.py при загрузке settings.
    from .views import MODULE_SCHOOLS

    resolver = getattr(request, "resolver_match", None)
    school_slug: str = ""
    direction_slug: str = ""

    if resolver is not None:
        url_name = resolver.url_name or ""
        kwargs = resolver.kwargs or {}

        if url_name == "school_detail":
            school_slug = kwargs.get("school_slug", "") or ""
        elif url_name == "direction_detail":
            school_slug = kwargs.get("school_slug", "") or ""
            direction_slug = kwargs.get("direction_slug", "") or ""

    return {
        "MODULE_SCHOOLS": MODULE_SCHOOLS,
        "ACTIVE_SCHOOL_SLUG": school_slug,
        "ACTIVE_DIRECTION_SLUG": direction_slug,
    }


# =============================================================================
# Единый конфиг для window.MatrixLab
# =============================================================================

def matrixlab_config(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """JSON-совместимый конфиг для фронтенда."""
    max_rows = getattr(settings, "MAX_MATRIX_ROWS", 10)
    max_cols = getattr(settings, "MAX_MATRIX_COLS", 10)

    config: dict[str, Any] = {
        "MAX_MATRIX_ROWS":       max_rows,
        "MAX_MATRIX_COLS":       max_cols,
        "MAX_SLAU_ROWS":         getattr(settings, "MAX_SLAU_ROWS", max_rows),
        "MAX_SLAU_COLS":         getattr(settings, "MAX_SLAU_COLS", max_cols + 1),
        "MAX_PARAMETERS_SLAU":   getattr(settings, "MAX_PARAMETERS_SLAU", 20),
        "MAX_SYMBOLIC_SIZE":     getattr(settings, "MAX_SYMBOLIC_SIZE", 5),
        "MAX_MATRIX_POWER":      getattr(settings, "MAX_MATRIX_POWER", 100),
        "HISTORY_LIMIT":         getattr(settings, "HISTORY_LIMIT", 200),
        "SAVED_MATRICES_LIMIT":  getattr(settings, "SAVED_MATRICES_LIMIT", 100),
        "DEFAULT_OUTPUT_FORMAT": getattr(settings, "DEFAULT_OUTPUT_FORMAT", "exact"),
        "DECIMAL_PRECISION":     getattr(settings, "DECIMAL_PRECISION", 6),
        "SYMBOLIC_TERM_LIMIT":   getattr(settings, "SYMBOLIC_TERM_LIMIT", 500),
        "DEBUG":                 bool(getattr(settings, "DEBUG", False)),
        "CDN":                   dict(getattr(settings, "CDN", {}) or {}),
    }

    return {"MATRIXLAB_CONFIG": config}