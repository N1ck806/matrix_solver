"""
System checks приложения MatrixLab.

Django автоматически запускает эти проверки при:
    • `python manage.py check`
    • `python manage.py migrate`
    • `python manage.py runserver`

Проверяем то, что действительно может пойти не так в конфигурации:
    • некорректные лимиты (отрицательные, нулевые, слишком большие);
    • отсутствие обязательных настроек;
    • противоречия между лимитами (например, символический лимит больше
      обычного — это бессмысленно);
    • несовместимые форматы вывода.

Все ошибки возвращаются через Errors/Warnings из django.core.checks,
а не через исключения — это правильный способ сообщать о проблемах
конфигурации.
"""
from __future__ import annotations

from django.conf import settings
from django.core.checks import Error, Info, Warning, register


# Коды проверок — префикс "matrixlab." для уникальности.
_ERROR_LIMITS = "matrixlab.E001"
_ERROR_FORMAT = "matrixlab.E002"
_WARN_SYMBOLIC = "matrixlab.W001"
_WARN_DECIMAL = "matrixlab.W002"
_INFO_DEFAULTS = "matrixlab.I001"


# =============================================================================
# Проверка числовых лимитов
# =============================================================================

@register()
def check_matrix_limits(app_configs, **kwargs):  # noqa: ANN001, ARG001
    """Проверить лимиты размеров матриц и других числовых параметров."""
    errors: list[Error | Warning] = []

    numeric_limits: dict[str, tuple[int, int]] = {
        "MAX_MATRIX_ROWS": (1, 50),
        "MAX_MATRIX_COLS": (1, 50),
        "MAX_SYMBOLIC_SIZE": (1, 20),
        "MAX_PARAMETERS_SLAU": (1, 100),
        "MAX_MATRIX_POWER": (1, 1000),
        "HISTORY_LIMIT": (0, 100000),
        "SAVED_MATRICES_LIMIT": (0, 100000),
        "DECIMAL_PRECISION": (1, 30),
        "SYMBOLIC_TERM_LIMIT": (10, 100000),
    }

    for name, (lo, hi) in numeric_limits.items():
        value = getattr(settings, name, None)
        if value is None:
            errors.append(
                Error(
                    f"Настройка {name} не задана.",
                    hint=(
                        f"Задайте {name} в config/settings.py. "
                        f"Разумный диапазон: {lo}..{hi}."
                    ),
                    id=_ERROR_LIMITS,
                    obj="config.settings",
                )
            )
            continue

        if not isinstance(value, int) or isinstance(value, bool):
            errors.append(
                Error(
                    f"Настройка {name} должна быть целым числом, "
                    f"сейчас: {type(value).__name__}.",
                    hint="Проверьте тип значения в settings.py.",
                    id=_ERROR_LIMITS,
                    obj="config.settings",
                )
            )
            continue

        if value < lo or value > hi:
            errors.append(
                Warning(
                    f"Настройка {name} = {value} вне рекомендуемого "
                    f"диапазона {lo}..{hi}.",
                    hint=(
                        "Слишком маленькое значение ограничит "
                        "функциональность, слишком большое — "
                        "может привести к зависаниям при символьных "
                        "вычислениях."
                    ),
                    id=_WARN_SYMBOLIC,
                    obj="config.settings",
                )
            )

    return errors


# =============================================================================
# Проверка консистентности лимитов
# =============================================================================

@register()
def check_limits_consistency(app_configs, **kwargs):  # noqa: ANN001, ARG001
    """Проверить, что лимиты не противоречат друг другу."""
    errors: list[Error | Warning] = []

    max_rows = getattr(settings, "MAX_MATRIX_ROWS", 10)
    max_cols = getattr(settings, "MAX_MATRIX_COLS", 10)
    max_sym = getattr(settings, "MAX_SYMBOLIC_SIZE", 5)
    max_pow = getattr(settings, "MAX_MATRIX_POWER", 100)

    # Символьный лимит не может превышать обычный.
    if max_sym > max(max_rows, max_cols):
        errors.append(
            Error(
                f"MAX_SYMBOLIC_SIZE ({max_sym}) больше размера обычных "
                f"матриц ({max_rows}×{max_cols}). "
                "Символьные операции выполняются дольше, поэтому их лимит "
                "не должен превышать общий лимит размеров.",
                hint="Уменьшите MAX_SYMBOLIC_SIZE или увеличьте MAX_MATRIX_*.",
                id=_ERROR_LIMITS,
                obj="config.settings",
            )
        )

    # Степень не должна быть абсурдно большой для больших матриц.
    if max_pow > 100 and max(max_rows, max_cols) > 20:
        errors.append(
            Warning(
                f"MAX_MATRIX_POWER = {max_pow} при размере матриц до "
                f"{max_rows}×{max_cols} может приводить к долгим вычислениям "
                "и большим числам.",
                hint="Рассмотрите уменьшение MAX_MATRIX_POWER.",
                id=_WARN_SYMBOLIC,
                obj="config.settings",
            )
        )

    return errors


# =============================================================================
# Проверка формата вывода
# =============================================================================

@register()
def check_output_format(app_configs, **kwargs):  # noqa: ANN001, ARG001
    """Проверить, что формат вывода и точность согласованы."""
    errors: list[Error] = []

    fmt = getattr(settings, "DEFAULT_OUTPUT_FORMAT", "exact")
    allowed = {"exact", "decimal"}

    if fmt not in allowed:
        errors.append(
            Error(
                f"DEFAULT_OUTPUT_FORMAT = {fmt!r} не поддерживается.",
                hint=f"Допустимые значения: {sorted(allowed)}.",
                id=_ERROR_FORMAT,
                obj="config.settings",
            )
        )

    precision = getattr(settings, "DECIMAL_PRECISION", 6)
    if fmt == "decimal" and precision < 1:
        errors.append(
            Error(
                "DEFAULT_OUTPUT_FORMAT='decimal', но DECIMAL_PRECISION < 1. "
                "Результаты будут округляться до целого без дробной части.",
                hint="Установите DECIMAL_PRECISION >= 3.",
                id=_ERROR_FORMAT,
                obj="config.settings",
            )
        )

    return errors


# =============================================================================
# Информация о конфигурации (для удобства разработчика)
# =============================================================================

@register()
def info_matrixlab_config(app_configs, **kwargs):  # noqa: ANN001, ARG001
    """Вывести текущие лимиты MatrixLab в виде Info-сообщений.

    Полезно при `manage.py check --deploy` и для быстрой проверки
    конфигурации без чтения settings.py.
    """
    messages: list[Info] = []

    summary = (
        f"Матрицы: до {getattr(settings, 'MAX_MATRIX_ROWS', '?')}×"
        f"{getattr(settings, 'MAX_MATRIX_COLS', '?')}, "
        f"символьные: до {getattr(settings, 'MAX_SYMBOLIC_SIZE', '?')}, "
        f"степень: до {getattr(settings, 'MAX_MATRIX_POWER', '?')}, "
        f"история: {getattr(settings, 'HISTORY_LIMIT', '?')}, "
        f"сохранённые: {getattr(settings, 'SAVED_MATRICES_LIMIT', '?')}, "
        f"формат: {getattr(settings, 'DEFAULT_OUTPUT_FORMAT', '?')}"
    )

    messages.append(
        Info(
            f"MatrixLab: {summary}",
            id=_INFO_DEFAULTS,
            obj="config.settings",
        )
    )

    return messages