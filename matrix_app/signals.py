"""
Сигналы приложения MatrixLab.

Подключаются в `matrix_app.apps.MatrixAppConfig.ready()`.

Зачем нужны сигналы в этом проекте:

    1. Автоочистка истории — при сохранении новой записи CalculationHistory
       проверяем, не превышен ли лимит HISTORY_LIMIT, и удаляем самые старые
       записи, чтобы БД не разрасталась.

    2. Автоочистка сохранённых матриц — аналогично для SavedMatrix
       (лимит SAVED_MATRICES_LIMIT).

    3. Логирование — при сохранении истории пишем компактную строку в лог
       для отладки (только в DEBUG).

Сигналы намеренно размещены в отдельном модуле: это стандартная практика
Django, упрощает тестирование (можно отключить импортом) и не засоряет
apps.py.
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

logger = logging.getLogger("matrix_app.signals")


# =============================================================================
# Автоочистка: история вычислений
# =============================================================================

@receiver(post_save, dispatch_uid="matrix_app.trim_history_on_save")
def trim_history_on_save(sender, instance, created, **kwargs) -> None:
    """После сохранения новой записи истории — подрезаем до лимита.

    Логика: если записей больше HISTORY_LIMIT, удаляем самые старые,
    оставляя ровно HISTORY_LIMIT последних.
    """
    # Импорт внутри функции — избегаем циклических зависимостей.
    from .models import CalculationHistory

    if sender is not CalculationHistory:
        return
    if not created:
        return

    limit: int = getattr(settings, "HISTORY_LIMIT", 200)
    if limit <= 0:
        return

    try:
        total = CalculationHistory.objects.count()
        if total <= limit:
            return
        excess = total - limit
        # Получаем ID самых старых записей и удаляем их пачкой.
        old_ids = list(
            CalculationHistory.objects.order_by("created_at")
            .values_list("id", flat=True)[:excess]
        )
        if old_ids:
            deleted, _ = CalculationHistory.objects.filter(id__in=old_ids).delete()
            if settings.DEBUG:
                logger.debug(
                    "Автоочистка истории: удалено %d старых записей (лимит %d).",
                    deleted,
                    limit,
                )
    except Exception:  # noqa: BLE001
        # Автоочистка не должна ломать основной поток.
        logger.exception("Ошибка автоочистки истории вычислений.")


# =============================================================================
# Автоочистка: сохранённые матрицы
# =============================================================================

@receiver(post_save, dispatch_uid="matrix_app.trim_saved_matrices_on_save")
def trim_saved_matrices_on_save(sender, instance, created, **kwargs) -> None:
    """После сохранения новой матрицы — подрезаем до лимита."""
    from .models import SavedMatrix

    if sender is not SavedMatrix:
        return
    if not created:
        return

    limit: int = getattr(settings, "SAVED_MATRICES_LIMIT", 100)
    if limit <= 0:
        return

    try:
        session_key = getattr(instance, "session_key", None)
        qs = SavedMatrix.objects.all()
        if session_key:
            qs = qs.filter(session_key=session_key)

        total = qs.count()
        if total <= limit:
            return

        excess = total - limit
        old_ids = list(
            qs.order_by("created_at").values_list("id", flat=True)[:excess]
        )
        if old_ids:
            deleted, _ = SavedMatrix.objects.filter(id__in=old_ids).delete()
            if settings.DEBUG:
                logger.debug(
                    "Автоочистка сохранённых матриц: удалено %d записей (лимит %d).",
                    deleted,
                    limit,
                )
    except Exception:  # noqa: BLE001
        logger.exception("Ошибка автоочистки сохранённых матриц.")


# =============================================================================
# Логирование (только в DEBUG)
# =============================================================================

@receiver(post_save, dispatch_uid="matrix_app.log_history_save")
def log_history_save(sender, instance, created, **kwargs) -> None:
    """Пишем компактную строку в лог при создании записи истории."""
    if not settings.DEBUG:
        return

    from .models import CalculationHistory

    if sender is not CalculationHistory or not created:
        return

    try:
        logger.debug(
            "История: id=%s, операция=%s, размер=%s",
            instance.pk,
            getattr(instance, "operation", "?"),
            getattr(instance, "matrix_shape", "?"),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Ошибка логирования сохранения истории.")


@receiver(post_delete, dispatch_uid="matrix_app.log_history_delete")
def log_history_delete(sender, instance, **kwargs) -> None:
    """Пишем в лог удаление записи истории (только в DEBUG)."""
    if not settings.DEBUG:
        return

    from .models import CalculationHistory

    if sender is not CalculationHistory:
        return
    logger.debug("История: удалена запись id=%s", getattr(instance, "pk", "?"))