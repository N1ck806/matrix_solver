"""
Приложение MatrixLab — матричные вычисления.

Метаданные пакета используются в context_processors.app_meta
для передачи в шаблоны (название, версия, описание).
"""
from __future__ import annotations

__title__: str = "MatrixLab"
__version__: str = "1.0.0"
__description__: str = (
    "Веб-сервис для работы с матрицами и линейной алгеброй. "
    "Точные вычисления на SymPy, пошаговые решения, интерактивный интерфейс."
)
__author__: str = "MatrixLab"

default_app_config = "matrix_app.apps.MatrixAppConfig"