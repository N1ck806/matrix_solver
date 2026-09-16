"""
Django-формы приложения MatrixLab.

Формы — тонкий слой над services/. Основная валидация — в
services/parser.py и services/validators.py; здесь только:
    • привязка HTML-полей к параметрам операций;
    • преобразование строк из формы в символьные матрицы SymPy;
    • человекочитаемые сообщения об ошибках.

Используется:
    • на страницах calculator/operations/properties/systems —
      для начального рендера полей и первичной валидации;
    • в API как fallback, если данные пришли не JSON-ом, а form-encoded.

Ключевой принцип: форма не выполняет математических операций.
Она только парсит ввод и превращает его в структуры, понятные services/.
"""
from __future__ import annotations

from typing import Any

import sympy as sp
from django import forms
from django.conf import settings
from django.utils.translation import gettext_lazy as _

from .services.parser import parse_matrix, parse_scalar
from .services.validators import ValidationError as MatrixValidationError


# =============================================================================
# Утилиты
# =============================================================================

def _max_rows() -> int:
    return int(getattr(settings, "MAX_MATRIX_ROWS", 10))


def _max_cols() -> int:
    return int(getattr(settings, "MAX_MATRIX_COLS", 10))


def _split_matrix_input(raw: Any) -> list[list[str]]:
    """Разобрать матрицу из различных форматов формы.

    Поддерживаются:
        • строка, где строки разделены ';' или '\\n', а элементы —
          запятыми/пробелами:  "1 2; 3 4"  или  "1,2\\n3,4";
        • список списков (уже готовый);
        • список строк;
        • плоский список (тогда формируется одна строка).
    """
    if raw is None or raw == "":
        return []

    # Уже готовая матрица.
    if isinstance(raw, list):
        if not raw:
            return []
        if all(isinstance(row, list) for row in raw):
            return [[str(cell).strip() for cell in row] for row in raw]
        if all(not isinstance(row, (list, tuple)) for row in raw):
            # Плоский список — одна строка.
            return [[str(cell).strip() for cell in raw]]
        # Смешанное — приводим как есть.
        return [[str(cell).strip() for cell in row] for row in raw]

    # Строка.
    text = str(raw).strip()
    if not text:
        return []

    rows_raw: list[str]
    if ";" in text:
        rows_raw = text.split(";")
    elif "\n" in text:
        rows_raw = text.splitlines()
    else:
        rows_raw = [text]

    matrix: list[list[str]] = []
    for row_text in rows_raw:
        row_text = row_text.strip()
        if not row_text:
            continue
        # Разделители: запятая, табуляция или пробелы.
        if "," in row_text:
            cells = [c.strip() for c in row_text.split(",")]
        else:
            cells = row_text.split()
        matrix.append(cells)
    return matrix


# =============================================================================
# Кастомные поля
# =============================================================================

class MatrixField(forms.Field):
    """Поле, принимающее матрицу в свободной форме и возвращающее sp.Matrix."""

    default_error_messages = {
        "required": _("Введите матрицу."),
        "invalid": _("Некорректный ввод матрицы: %(detail)s"),
        "empty": _("Матрица пуста."),
        "too_big": _("Слишком большой размер матрицы: %(shape)s. Максимум %(max)s."),
    }

    def __init__(self, *, max_rows: int | None = None, max_cols: int | None = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.max_rows = max_rows if max_rows is not None else _max_rows()
        self.max_cols = max_cols if max_cols is not None else _max_cols()

    def to_python(self, value: Any) -> sp.Matrix | None:
        if value in self.empty_values:
            return None
        raw = _split_matrix_input(value)
        if not raw:
            raise forms.ValidationError(
                self.error_messages["empty"], code="empty"
            )
        if len(raw) > self.max_rows:
            raise forms.ValidationError(
                self.error_messages["too_big"]
                % {
                    "shape": f"{len(raw)}×{max(len(r) for r in raw)}",
                    "max": f"{self.max_rows}×{self.max_cols}",
                },
                code="too_big",
            )
        try:
            return parse_matrix(raw)
        except MatrixValidationError as exc:
            raise forms.ValidationError(
                self.error_messages["invalid"] % {"detail": str(exc)},
                code="invalid",
            ) from exc

    def validate(self, value: sp.Matrix | None) -> None:
        super().validate(value)
        if value is None:
            return
        if value.rows > self.max_rows or value.cols > self.max_cols:
            raise forms.ValidationError(
                self.error_messages["too_big"]
                % {
                    "shape": f"{value.rows}×{value.cols}",
                    "max": f"{self.max_rows}×{self.max_cols}",
                },
                code="too_big",
            )


class ScalarField(forms.Field):
    """Поле для скаляра: целое, дробь, выражение, комплексное."""

    default_error_messages = {
        "required": _("Введите значение."),
        "invalid": _("Некорректное значение: %(detail)s"),
    }

    def to_python(self, value: Any) -> sp.Expr | None:
        if value in self.empty_values:
            return None
        try:
            return parse_scalar(value)
        except MatrixValidationError as exc:
            raise forms.ValidationError(
                self.error_messages["invalid"] % {"detail": str(exc)},
                code="invalid",
            ) from exc


# =============================================================================
# Базовая форма для одной матрицы
# =============================================================================

class SingleMatrixForm(forms.Form):
    """Базовая форма для операций с одной матрицей."""

    matrix = MatrixField(
        label=_("Матрица A"),
        required=True,
        widget=forms.HiddenInput(
            attrs={
                "id": "id_single_matrix",
                "data-matrix-input": "single",
            }
        ),
    )

    # Поле выбора операции (используется на странице /calculator/).
    operation = forms.ChoiceField(
        label=_("Операция"),
        required=False,
        choices=[
            ("determinant", _("Определитель")),
            ("rank", _("Ранг")),
            ("inverse", _("Обратная матрица")),
            ("transpose", _("Транспонирование")),
            ("trace", _("След")),
            ("rref", _("Приведённая ступенчатая форма")),
            ("echelon", _("Ступенчатая форма")),
            ("properties", _("Свойства")),
            ("eigenvalues", _("Собственные значения")),
            ("eigenvectors", _("Собственные векторы")),
            ("char_poly", _("Характеристический многочлен")),
            ("lu", _("LU-разложение")),
            ("qr", _("QR-разложение")),
            ("cholesky", _("Разложение Холецкого")),
            ("diagonalize", _("Диагонализация")),
        ],
        widget=forms.HiddenInput(attrs={"id": "id_operation"}),
    )

    # Параметры для операций, где они нужны.
    power = forms.IntegerField(
        label=_("Степень"),
        required=False,
        min_value=-(10**6),
        max_value=10**6,
        widget=forms.HiddenInput(attrs={"id": "id_power"}),
    )

    method = forms.ChoiceField(
        label=_("Метод"),
        required=False,
        choices=[
            ("auto", _("Автоматически")),
            ("cofactor", _("Разложение по строке/столбцу")),
            ("gauss", _("Метод Гаусса")),
            ("gauss_jordan", _("Метод Гаусса-Жордана")),
        ],
        widget=forms.HiddenInput(attrs={"id": "id_method"}),
    )

    show_steps = forms.BooleanField(
        label=_("Показывать решение"),
        required=False,
        initial=True,
        widget=forms.HiddenInput(attrs={"id": "id_show_steps"}),
    )


# =============================================================================
# Форма для двух матриц (A и B)
# =============================================================================

class TwoMatricesForm(forms.Form):
    """Форма для операций, требующих двух матриц."""

    matrix_a = MatrixField(
        label=_("Матрица A"),
        required=True,
        widget=forms.HiddenInput(
            attrs={
                "id": "id_matrix_a",
                "data-matrix-input": "a",
            }
        ),
    )

    matrix_b = MatrixField(
        label=_("Матрица B"),
        required=False,
        widget=forms.HiddenInput(
            attrs={
                "id": "id_matrix_b",
                "data-matrix-input": "b",
            }
        ),
    )

    operation = forms.ChoiceField(
        label=_("Операция"),
        required=True,
        choices=[
            ("add", _("A + B")),
            ("subtract", _("A − B")),
            ("multiply", _("A × B")),
            ("scalar_multiply", _("kA — умножение на скаляр")),
            ("transpose", _("Aᵀ")),
            ("transpose_b", _("Bᵀ")),
            ("power", _("Aⁿ — возведение в степень")),
            ("compare", _("Сравнить A и B")),
        ],
        widget=forms.HiddenInput(attrs={"id": "id_operation_two"}),
    )

    scalar = ScalarField(
        label=_("Скаляр k"),
        required=False,
        widget=forms.HiddenInput(attrs={"id": "id_scalar"}),
    )

    power = forms.IntegerField(
        label=_("Степень"),
        required=False,
        min_value=-(10**6),
        max_value=10**6,
        widget=forms.HiddenInput(attrs={"id": "id_power_two"}),
    )

    show_steps = forms.BooleanField(
        label=_("Показывать решение"),
        required=False,
        initial=True,
        widget=forms.HiddenInput(attrs={"id": "id_show_steps_two"}),
    )

    def clean(self) -> dict[str, Any]:
        cleaned = super().clean()
        operation = cleaned.get("operation")
        a = cleaned.get("matrix_a")
        b = cleaned.get("matrix_b")
        scalar = cleaned.get("scalar")
        power = cleaned.get("power")

        needs_b = operation in {"add", "subtract", "multiply", "transpose_b", "compare"}
        if needs_b and b is None:
            self.add_error("matrix_b", _("Для этой операции требуется матрица B."))

        if operation == "scalar_multiply" and scalar is None:
            self.add_error("scalar", _("Укажите скаляр k."))

        if operation == "power":
            if a is None:
                self.add_error("matrix_a", _("Для возведения в степень нужна матрица A."))
            elif a.rows != a.cols:
                self.add_error(
                    "matrix_a",
                    _("Возведение в степень возможно только для квадратной матрицы."),
                )
            if power is None:
                self.add_error("power", _("Укажите целую степень."))

        return cleaned


# =============================================================================
# Форма СЛАУ: A и b
# =============================================================================

class LinearSystemForm(forms.Form):
    """Форма системы линейных уравнений Ax = b."""

    matrix_a = MatrixField(
        label=_("Матрица коэффициентов A"),
        required=True,
        widget=forms.HiddenInput(attrs={"id": "id_system_a"}),
    )

    vector_b = forms.Field(
        label=_("Вектор свободных членов b"),
        required=True,
        widget=forms.HiddenInput(attrs={"id": "id_system_b"}),
    )

    method = forms.ChoiceField(
        label=_("Метод решения"),
        required=False,
        initial="auto",
        choices=[
            ("auto", _("Автоматически")),
            ("gauss", _("Метод Гаусса")),
            ("gauss_jordan", _("Метод Гаусса-Жордана")),
            ("cramer", _("Правило Крамера")),
            ("inverse", _("Через обратную матрицу")),
        ],
        widget=forms.HiddenInput(attrs={"id": "id_system_method"}),
    )

    show_steps = forms.BooleanField(
        label=_("Показывать решение"),
        required=False,
        initial=True,
        widget=forms.HiddenInput(attrs={"id": "id_system_steps"}),
    )

    def clean_vector_b(self) -> sp.Matrix:
        raw = self.cleaned_data.get("vector_b")
        cells = _split_matrix_input(raw)
        if not cells:
            raise forms.ValidationError(_("Вектор b пуст."))
        # Плоский список или одна строка/столбец.
        if len(cells) == 1 and len(cells[0]) > 1:
            values = cells[0]
        elif all(len(row) == 1 for row in cells):
            values = [row[0] for row in cells]
        else:
            # Возможно, что пришло как строка с разделителями.
            flat: list[str] = []
            for row in cells:
                flat.extend(row)
            values = flat

        try:
            parsed = [parse_scalar(v) for v in values]
        except MatrixValidationError as exc:
            raise forms.ValidationError(str(exc)) from exc

        return sp.Matrix(parsed)

    def clean(self) -> dict[str, Any]:
        cleaned = super().clean()
        a = cleaned.get("matrix_a")
        b = cleaned.get("vector_b")
        if a is not None and b is not None:
            if a.rows != b.rows:
                self.add_error(
                    "vector_b",
                    _(
                        "Размер вектора b (%(b)d) не совпадает с числом строк A (%(a)d)."
                    )
                    % {"b": b.rows, "a": a.rows},
                )
        return cleaned


# =============================================================================
# Формы для генератора случайных матриц
# =============================================================================

class RandomMatrixForm(forms.Form):
    """Параметры генерации случайной матрицы."""

    TYPE_CHOICES = [
        ("random", _("Случайная")),
        ("symmetric", _("Симметричная")),
        ("diagonal", _("Диагональная")),
        ("identity", _("Единичная")),
        ("upper_triangular", _("Верхняя треугольная")),
        ("lower_triangular", _("Нижняя треугольная")),
        ("invertible", _("Обратимая")),
        ("singular", _("Вырожденная")),
    ]

    rows = forms.IntegerField(
        label=_("Строк"),
        min_value=1,
        max_value=_max_rows(),
        initial=3,
    )
    cols = forms.IntegerField(
        label=_("Столбцов"),
        min_value=1,
        max_value=_max_cols(),
        initial=3,
    )
    min_value = forms.IntegerField(
        label=_("Минимум"),
        initial=-9,
        required=False,
    )
    max_value = forms.IntegerField(
        label=_("Максимум"),
        initial=9,
        required=False,
    )
    kind = forms.ChoiceField(
        label=_("Тип матрицы"),
        choices=TYPE_CHOICES,
        initial="random",
    )
    allow_fractions = forms.BooleanField(
        label=_("Разрешить дроби"),
        required=False,
        initial=False,
    )

    def clean(self) -> dict[str, Any]:
        cleaned = super().clean()
        lo = cleaned.get("min_value")
        hi = cleaned.get("max_value")
        if lo is not None and hi is not None and lo > hi:
            self.add_error(
                "min_value",
                _("Минимум не должен превышать максимум."),
            )

        rows = cleaned.get("rows")
        cols = cleaned.get("cols")
        kind = cleaned.get("kind")
        if kind in {"symmetric", "identity", "invertible", "singular"} and rows != cols:
            self.add_error(
                "cols",
                _("Для выбранного типа матрица должна быть квадратной."),
            )
        return cleaned


# =============================================================================
# Форма сохранения матрицы
# =============================================================================

class SaveMatrixForm(forms.Form):
    """Форма сохранения именованной матрицы."""

    name = forms.CharField(
        label=_("Название"),
        max_length=120,
        required=True,
        widget=forms.TextInput(
            attrs={
                "class": "input",
                "placeholder": _("Например, «Матрица A из задачи 3.4»"),
                "autocomplete": "off",
            }
        ),
    )

    matrix = MatrixField(
        label=_("Матрица"),
        required=True,
        widget=forms.HiddenInput(attrs={"id": "id_saved_matrix"}),
    )

    notes = forms.CharField(
        label=_("Заметка"),
        required=False,
        widget=forms.Textarea(
            attrs={
                "class": "textarea",
                "rows": 3,
                "placeholder": _("Необязательное описание."),
            }
        ),
    )


# =============================================================================
# Форма «что это значит?»
# =============================================================================

class ExplainForm(forms.Form):
    """Форма запроса пояснения к результату операции."""

    operation = forms.CharField(max_length=64, required=True)
    payload = forms.JSONField(required=False)