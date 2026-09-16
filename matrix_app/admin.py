"""
Админка приложения MatrixLab.

Регистрирует модели истории и сохранённых матриц с удобными
фильтрами, поиском и read-only полями для JSON.
"""
from __future__ import annotations

from django.contrib import admin
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

from .models import CalculationHistory, SavedMatrix


@admin.register(CalculationHistory)
class CalculationHistoryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "operation",
        "operation_label",
        "matrix_shape",
        "session_key_short",
        "created_at",
    )
    list_filter = ("operation", "created_at")
    search_fields = ("session_key", "operation", "operation_label")
    readonly_fields = (
        "session_key",
        "operation",
        "operation_label",
        "matrix_shape",
        "created_at",
        "input_data_pretty",
        "result_data_pretty",
    )
    date_hierarchy = "created_at"
    ordering = ("-created_at",)
    list_per_page = 50

    fieldsets = (
        (None, {
            "fields": ("session_key", "operation", "operation_label", "matrix_shape", "created_at"),
        }),
        (_("Входные данные"), {
            "fields": ("input_data_pretty",),
        }),
        (_("Результат"), {
            "fields": ("result_data_pretty",),
        }),
    )

    @admin.display(description=_("сессия"))
    def session_key_short(self, obj: CalculationHistory) -> str:
        return obj.session_key[:12] + "…" if len(obj.session_key) > 12 else obj.session_key

    @admin.display(description=_("input_data"))
    def input_data_pretty(self, obj: CalculationHistory) -> str:
        import json
        return format_html(
            "<pre style='max-width:800px;white-space:pre-wrap'>{}</pre>",
            json.dumps(obj.input_data, ensure_ascii=False, indent=2),
        )

    @admin.display(description=_("result_data"))
    def result_data_pretty(self, obj: CalculationHistory) -> str:
        import json
        return format_html(
            "<pre style='max-width:800px;white-space:pre-wrap'>{}</pre>",
            json.dumps(obj.result_data, ensure_ascii=False, indent=2),
        )


@admin.register(SavedMatrix)
class SavedMatrixAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "shape_label",
        "session_key_short",
        "created_at",
        "updated_at",
    )
    list_filter = ("created_at", "updated_at")
    search_fields = ("name", "session_key", "notes")
    readonly_fields = ("created_at", "updated_at", "rows", "cols")
    ordering = ("-updated_at",)
    list_per_page = 50

    fieldsets = (
        (None, {
            "fields": ("session_key", "name", "rows", "cols"),
        }),
        (_("Данные"), {
            "fields": ("matrix_data", "notes"),
        }),
        (_("Время"), {
            "fields": ("created_at", "updated_at"),
        }),
    )

    @admin.display(description=_("сессия"))
    def session_key_short(self, obj: SavedMatrix) -> str:
        return obj.session_key[:12] + "…" if len(obj.session_key) > 12 else obj.session_key

    @admin.display(description=_("размер"))
    def shape_label(self, obj: SavedMatrix) -> str:
        return f"{obj.rows}×{obj.cols}"