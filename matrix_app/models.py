"""
Модели приложения MatrixLab.

Содержимое:
    • CalculationHistory — история вычислений (операция, вход, результат, время).
    • SavedMatrix — сохранённые пользователем матрицы (именованные).

Особенности:
    • Обе модели используют session_key для привязки к пользователю без
      авторизации. При первом обращении middleware/views создаёт ключ и
      сохраняет его в сессии браузера.
    • Матрицы хранятся как JSON — точные значения (Rational, символьные
      выражения) сериализуются в строки, что сохраняет точность.
    • Модели тонкие: вся логика — в services/. Здесь только поля,
      индексы и удобные методы.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


# =============================================================================
# Вспомогательные функции
# =============================================================================

def generate_session_key() -> str:
    """Сгенерировать новый ключ сессии для анонимного пользователя."""
    return uuid.uuid4().hex


# =============================================================================
# Модель: история вычислений
# =============================================================================

class CalculationHistory(models.Model):
    """Запись об одной выполненной операции.

    Хранит:
        session_key  — привязка к браузеру пользователя;
        operation    — машинный код операции ('det', 'rank', 'inverse', ...);
        operation_label — человекочитаемое название ('Определитель', ...);
        input_data   — JSON-описание входа (матрицы A, B, скаляры);
        result_data  — JSON-описание результата (значение, матрица, шаги);
        matrix_shape — '3x3' для быстрого отображения в списке;
        created_at   — когда была выполнена операция.
    """

    OPERATION_CHOICES: list[tuple[str, str]] = [
        # Базовые операции
        ("add", _("Сложение")),
        ("subtract", _("Вычитание")),
        ("multiply", _("Умножение матриц")),
        ("scalar_multiply", _("Умножение на скаляр")),
        ("transpose", _("Транспонирование")),
        ("power", _("Возведение в степень")),
        # Свойства матрицы
        ("determinant", _("Определитель")),
        ("trace", _("След")),
        ("rank", _("Ранг")),
        ("inverse", _("Обратная матрица")),
        ("rref", _("Приведённая ступенчатая форма")),
        ("echelon", _("Ступенчатая форма")),
        # Продвинутые
        ("properties", _("Свойства матрицы")),
        ("eigenvalues", _("Собственные значения")),
        ("eigenvectors", _("Собственные векторы")),
        ("char_poly", _("Характеристический многочлен")),
        ("lu", _("LU-разложение")),
        ("qr", _("QR-разложение")),
        ("cholesky", _("Разложение Холецкого")),
        ("diagonalize", _("Диагонализация")),
        # СЛАУ
        ("solve_gauss", _("СЛАУ — метод Гаусса")),
        ("solve_gauss_jordan", _("СЛАУ — метод Гаусса-Жордана")),
        ("solve_cramer", _("СЛАУ — правило Крамера")),
        ("solve_inverse", _("СЛАУ — через обратную матрицу")),
        ("kronecker_capelli", _("Теорема Кронекера-Капелли")),
        # Прочее
        ("minors", _("Минор и алгебраическое дополнение")),
        ("cofactor_matrix", _("Матрица кофакторов")),
        ("adjugate", _("Присоединённая матрица")),
        ("compare", _("Сравнение матриц")),
    ]

    session_key: str = models.CharField(
        _("ключ сессии"),
        max_length=64,
        db_index=True,
        help_text=_("Идентификатор браузера пользователя без авторизации."),
    )

    operation: str = models.CharField(
        _("код операции"),
        max_length=32,
        choices=OPERATION_CHOICES,
        db_index=True,
    )

    operation_label: str = models.CharField(
        _("название операции"),
        max_length=64,
        blank=True,
        help_text=_("Человекочитаемое имя для отображения в списке."),
    )

    input_data: dict[str, Any] = models.JSONField(
        _("входные данные"),
        default=dict,
        help_text=_("Матрицы A, B, скаляры и прочие параметры операции."),
    )

    result_data: dict[str, Any] = models.JSONField(
        _("результат"),
        default=dict,
        help_text=_("Результат операции, шаги решения, проверки."),
    )

    matrix_shape: str = models.CharField(
        _("размер матрицы"),
        max_length=16,
        blank=True,
        help_text=_("Например, '3x3' — для быстрого отображения в списке."),
    )

    created_at: models.DateTimeField = models.DateTimeField(
        _("создано"),
        default=timezone.now,
        db_index=True,
    )

    class Meta:
        verbose_name = _("запись истории")
        verbose_name_plural = _("история вычислений")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["session_key", "-created_at"]),
            models.Index(fields=["operation", "-created_at"]),
        ]

    def __str__(self) -> str:
        return (
            f"{self.get_operation_display()} [{self.matrix_shape}] — "
            f"{self.created_at:%d.%m.%Y %H:%M}"
        )

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Автозаполнение человекочитаемой метки при сохранении."""
        if not self.operation_label:
            for code, label in self.OPERATION_CHOICES:
                if code == self.operation:
                    self.operation_label = str(label)
                    break
        super().save(*args, **kwargs)

    # -------------------------------------------------------------------------
    # Удобные свойства для шаблонов
    # -------------------------------------------------------------------------

    @property
    def input_preview(self) -> str:
        """Короткое текстовое представление входа для списка истории."""
        try:
            if "matrix" in self.input_data:
                m = self.input_data["matrix"]
                rows = len(m)
                cols = len(m[0]) if rows else 0
                return f"A: {rows}×{cols}"
            if "a" in self.input_data:
                m = self.input_data["a"]
                rows = len(m)
                cols = len(m[0]) if rows else 0
                return f"A: {rows}×{cols}"
        except Exception:  # noqa: BLE001
            pass
        return ""

    @property
    def result_preview(self) -> str:
        """Короткое текстовое представление результата для списка."""
        try:
            if "value" in self.result_data:
                return str(self.result_data["value"])[:60]
            if "latex" in self.result_data:
                return str(self.result_data["latex"])[:60]
            if "matrix" in self.result_data:
                return f"матрица {len(self.result_data['matrix'])}×"
        except Exception:  # noqa: BLE001
            pass
        return ""

    def to_json(self) -> str:
        """Сериализовать запись полностью (для экспорта в JSON)."""
        return json.dumps(
            {
                "id": self.pk,
                "operation": self.operation,
                "operation_label": self.operation_label,
                "input": self.input_data,
                "result": self.result_data,
                "matrix_shape": self.matrix_shape,
                "created_at": self.created_at.isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )


# =============================================================================
# Модель: сохранённые матрицы
# =============================================================================

class SavedMatrix(models.Model):
    """Именованная матрица, сохранённая пользователем.

    Позволяет вернуться к матрице позже, дать ей понятное имя
    (например, «Матрица из задачи 3.4») и использовать повторно.
    """

    session_key: str = models.CharField(
        _("ключ сессии"),
        max_length=64,
        db_index=True,
    )

    name: str = models.CharField(
        _("название"),
        max_length=120,
        help_text=_("Например, «Матрица A из задачи 3.4»."),
    )

    matrix_data: list = models.JSONField(
        _("данные матрицы"),
        default=list,
        help_text=_("Двумерный массив строк — точные значения."),
    )

    rows: int = models.PositiveSmallIntegerField(_("строк"), default=0)
    cols: int = models.PositiveSmallIntegerField(_("столбцов"), default=0)

    notes: str = models.TextField(
        _("заметка"),
        blank=True,
        help_text=_("Свободное описание, зачем эта матрица сохранена."),
    )

    created_at: models.DateTimeField = models.DateTimeField(
        _("создано"),
        default=timezone.now,
        db_index=True,
    )

    updated_at: models.DateTimeField = models.DateTimeField(
        _("обновлено"),
        default=timezone.now,
        db_index=True,
    )

    class Meta:
        verbose_name = _("сохранённая матрица")
        verbose_name_plural = _("сохранённые матрицы")
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["session_key", "-updated_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["session_key", "name"],
                name="unique_matrix_name_per_session",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.rows}×{self.cols})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Автозаполнение размеров и времени обновления."""
        # Размеры из данных.
        if self.matrix_data:
            self.rows = len(self.matrix_data)
            self.cols = len(self.matrix_data[0]) if self.rows else 0
        # Время обновления.
        self.updated_at = timezone.now()
        super().save(*args, **kwargs)

    @property
    def shape_label(self) -> str:
        return f"{self.rows}×{self.cols}"