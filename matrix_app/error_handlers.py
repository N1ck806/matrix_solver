"""
Кастомные обработчики ошибок 400/403/404/500.

Django вызывает эти функции автоматически, если они объявлены в
config/urls.py как handler400/handler403/handler404/handler500.

Возвращают красивые страницы, не технические трейсбеки.
"""
from __future__ import annotations

import logging

from django.http import HttpRequest, HttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import requires_csrf_token

logger = logging.getLogger("matrix_app.error_handlers")


# =============================================================================
# 400 — Bad Request
# =============================================================================

@requires_csrf_token
def bad_request(request: HttpRequest, exception: Exception | None = None) -> HttpResponse:  # noqa: ARG001
    """400: сервер не смог обработать запрос (некорректные данные)."""
    logger.warning("400 Bad Request: %s", request.path)
    return render(
        request,
        "matrix_app/errors/400.html",
        status=400,
    )


# =============================================================================
# 403 — Forbidden
# =============================================================================

@requires_csrf_token
def permission_denied(request: HttpRequest, exception: Exception | None = None) -> HttpResponse:  # noqa: ARG001
    """403: доступ запрещён (чаще всего — CSRF)."""
    logger.warning("403 Forbidden: %s", request.path)
    return render(
        request,
        "matrix_app/errors/403.html",
        status=403,
    )


# =============================================================================
# 404 — Not Found
# =============================================================================

@requires_csrf_token
def page_not_found(request: HttpRequest, exception: Exception | None = None) -> HttpResponse:  # noqa: ARG001
    """404: страница не найдена."""
    return render(
        request,
        "matrix_app/errors/404.html",
        status=404,
    )


# =============================================================================
# 500 — Internal Server Error
# =============================================================================

@requires_csrf_token
def server_error(request: HttpRequest) -> HttpResponse:
    """500: внутренняя ошибка сервера. Ничего технического пользователю."""
    logger.exception("500 Internal Server Error: %s", request.path)
    return render(
        request,
        "matrix_app/errors/500.html",
        status=500,
    )