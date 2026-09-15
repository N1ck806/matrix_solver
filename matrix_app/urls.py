"""
URL-маршруты приложения MatrixLab.

Разделены на группы:
    • HTML-страницы   — отдаются через views.py;
    • Сохранение      — saved/, history/;
    • Генерация       — примеры, случайные матрицы;
    • JSON API        — математические операции;
    • Telegram        — webhook для бота.

Пространство имён: matrix_app (см. config/urls.py).

Структура:
    1.  HTML-страницы
    2.  Сохранение и история
    3.  Генерация примеров и случайных матриц
    4.  JSON API — базовые операции
    5.  JSON API — цепочка N матриц
    6.  JSON API — свойства одной матрицы
    7.  JSON API — спектр
    8.  JSON API — разложения
    9.  JSON API — СЛАУ
    10. JSON API — пошаговые решения
    11. JSON API — пояснения
    12. Telegram webhook
"""
from __future__ import annotations

from django.urls import path

from . import api, views

app_name = "matrix_app"


# =============================================================================
# 1. HTML-СТРАНИЦЫ
# =============================================================================

urlpatterns = [
    path("", views.home, name="home"),
    path("calculator/", views.calculator, name="calculator"),
    path("operations/", views.operations, name="operations"),
    path("properties/", views.properties, name="properties"),
    path("systems/", views.systems, name="systems"),
    path("decompositions/", views.decompositions, name="decompositions"),
    path("eigen/", views.eigen, name="eigen"),

    # Обучение
    path("theory/", views.theory, name="theory"),
    path("types/", views.types, name="types"),

    # Применение по направлениям (модули)
    path("modules/", views.modules, name="modules"),

    # Личное
    path("history/", views.history, name="history"),
    path("about/", views.about, name="about"),

    # Поиск по сайту
    path("search/", views.search, name="search"),
]


# =============================================================================
# 2. СОХРАНЕНИЕ И ИСТОРИЯ
# =============================================================================

urlpatterns += [
    path("saved/", views.saved_matrices, name="saved_matrices"),
    path("saved/save/", views.save_matrix, name="save_matrix"),
    path(
        "saved/<int:pk>/delete/",
        views.delete_saved_matrix,
        name="delete_saved_matrix",
    ),
    path(
        "history/<int:pk>/delete/",
        views.delete_history_entry,
        name="delete_history_entry",
    ),
    path("history/clear/", views.clear_history, name="clear_history"),
]


# =============================================================================
# 3. ГЕНЕРАЦИЯ ПРИМЕРОВ И СЛУЧАЙНЫХ МАТРИЦ
# =============================================================================

urlpatterns += [
    path("api/random-matrix/", api.random_matrix, name="api_random_matrix"),
    path(
        "api/example/<str:example_name>/",
        api.load_example,
        name="api_load_example",
    ),
]


# =============================================================================
# 4. JSON API — БАЗОВЫЕ ОПЕРАЦИИ
# =============================================================================

urlpatterns += [
    path("api/matrix/add/", api.matrix_add, name="api_add"),
    path("api/matrix/subtract/", api.matrix_subtract, name="api_subtract"),
    path("api/matrix/multiply/", api.matrix_multiply, name="api_multiply"),
    path("api/matrix/scalar/", api.matrix_scalar, name="api_scalar"),
    path("api/matrix/transpose/", api.matrix_transpose, name="api_transpose"),
    path("api/matrix/power/", api.matrix_power, name="api_power"),
    path("api/matrix/compare/", api.matrix_compare, name="api_compare"),
]


# =============================================================================
# 5. JSON API — ЦЕПОЧКА N МАТРИЦ
# =============================================================================

urlpatterns += [
    path("api/matrix/chain/", api.matrix_chain, name="api_chain"),
]


# =============================================================================
# 6. JSON API — СВОЙСТВА ОДНОЙ МАТРИЦЫ
# =============================================================================

urlpatterns += [
    path("api/matrix/determinant/", api.matrix_determinant, name="api_determinant"),
    path("api/matrix/trace/", api.matrix_trace, name="api_trace"),
    path("api/matrix/rank/", api.matrix_rank, name="api_rank"),
    path("api/matrix/inverse/", api.matrix_inverse, name="api_inverse"),
    path("api/matrix/rref/", api.matrix_rref, name="api_rref"),
    path("api/matrix/echelon/", api.matrix_echelon, name="api_echelon"),
    path("api/matrix/minor/", api.matrix_minor, name="api_minor"),
    path("api/matrix/cofactors/", api.matrix_cofactors, name="api_cofactors"),
    path("api/matrix/adjugate/", api.matrix_adjugate, name="api_adjugate"),
    path("api/matrix/properties/", api.matrix_properties, name="api_properties"),
]


# =============================================================================
# 7. JSON API — СПЕКТР
# =============================================================================

urlpatterns += [
    path("api/matrix/eigenvalues/", api.matrix_eigenvalues, name="api_eigenvalues"),
    path("api/matrix/eigenvectors/", api.matrix_eigenvectors, name="api_eigenvectors"),
    path("api/matrix/char-poly/", api.matrix_char_poly, name="api_char_poly"),
]


# =============================================================================
# 8. JSON API — РАЗЛОЖЕНИЯ
# =============================================================================

urlpatterns += [
    path("api/matrix/lu/", api.matrix_lu, name="api_lu"),
    path("api/matrix/qr/", api.matrix_qr, name="api_qr"),
    path("api/matrix/cholesky/", api.matrix_cholesky, name="api_cholesky"),
    path("api/matrix/diagonalize/", api.matrix_diagonalize, name="api_diagonalize"),
    path("api/matrix/spectral/", api.matrix_spectral, name="api_spectral"),
]


# =============================================================================
# 9. JSON API — СЛАУ
# =============================================================================

urlpatterns += [
    path("api/system/solve/", api.system_solve, name="api_system_solve"),
    path("api/system/kronecker/", api.system_kronecker, name="api_system_kronecker"),
]


# =============================================================================
# 10. JSON API — ПОШАГОВЫЕ РЕШЕНИЯ
# =============================================================================

urlpatterns += [
    path("api/steps/determinant/", api.steps_determinant, name="api_steps_determinant"),
    path("api/steps/rank/", api.steps_rank, name="api_steps_rank"),
    path("api/steps/inverse/", api.steps_inverse, name="api_steps_inverse"),
    path("api/steps/rref/", api.steps_rref, name="api_steps_rref"),
    path("api/steps/slau/", api.steps_slau, name="api_steps_slau"),
]


# =============================================================================
# 11. JSON API — ПОЯСНЕНИЯ
# =============================================================================

urlpatterns += [
    path("api/explain/", api.explain_result, name="api_explain"),
]


# =============================================================================
# 12. TELEGRAM WEBHOOK
# =============================================================================

urlpatterns += [
    path(
        "telegram/webhook/<str:secret>/",
        views.telegram_webhook,
        name="telegram_webhook",
    ),
]