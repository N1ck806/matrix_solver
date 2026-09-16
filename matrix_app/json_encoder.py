"""
Кастомный JSON-энкодер для SymPy-объектов.

Позволяет сериализовать sp.Integer, sp.One, sp.Rational, sp.Symbol,
sp.Matrix и другие объекты SymPy в JSON.

Структура:
    1.  Импорты
    2.  Конвертер SymPy → примитивы (_to_jsonable)
    3.  Класс SymPyJSONEncoder
    4.  Утилита safe_json_dumps
"""
from __future__ import annotations

import json
from typing import Any

import sympy as sp
from django.core.serializers.json import DjangoJSONEncoder


# =============================================================================
# 1. КОНВЕРТЕР SYMPY → ПРИМИТИВЫ
# =============================================================================

def _to_jsonable(value: Any) -> Any:
    """Конвертирует SymPy-объекты в JSON-совместимые примитивы.

    Правила:
        sp.Integer / sp.One / sp.Zero → int
        sp.Rational → int (если знаменатель 1) или float
        sp.Float → float
        sp.Symbol → str
        sp.Expr (общее) → str
        sp.Matrix → list[list[...]]
        dict / list / tuple → рекурсивно
    """
    # --- Числа ---
    if isinstance(value, sp.Integer):
        return int(value)

    if isinstance(value, sp.Rational):
        return int(value) if value.q == 1 else float(value)

    if isinstance(value, sp.Float):
        return float(value)

    # --- Символы и выражения ---
    if isinstance(value, sp.Symbol):
        return str(value)

    if isinstance(value, sp.Expr):
        return str(value)

    # --- Матрицы ---
    if isinstance(value, sp.MatrixBase):
        return [[_to_jsonable(x) for x in row] for row in value.tolist()]

    # --- Множества ---
    if isinstance(value, (sp.FiniteSet, set, frozenset)):
        return [_to_jsonable(x) for x in value]

    # --- Контейнеры ---
    if isinstance(value, dict):
        return {k: _to_jsonable(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [_to_jsonable(x) for x in value]

    # --- Всё остальное — как есть ---
    return value


# =============================================================================
# 2. КЛАСС SymPyJSONEncoder
# =============================================================================

class SymPyJSONEncoder(DjangoJSONEncoder):
    """JSON-энкодер, понимающий SymPy-объекты."""

    def default(self, o: Any) -> Any:
        # Пробуем конвертировать через _to_jsonable.
        converted = _to_jsonable(o)
        if converted is not o:
            return converted
        # Если не получилось — отдаём Django.
        return super().default(o)


# =============================================================================
# 3. УТИЛИТА SAFE_JSON_DUMPS
# =============================================================================

def safe_json_dumps(data: Any, **kwargs: Any) -> str:
    """Безопасный json.dumps с поддержкой SymPy.

    Args:
        data: Данные для сериализации.
        **kwargs: Параметры json.dumps.

    Returns:
        JSON-строка.
    """
    kwargs.setdefault("cls", SymPyJSONEncoder)
    kwargs.setdefault("ensure_ascii", False)
    return json.dumps(data, **kwargs)