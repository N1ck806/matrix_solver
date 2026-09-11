"""
Telegram-бот MatrixLab, встроенный в Django.

Webhook работает в отдельном фоновом потоке с постоянным event loop —
это критично, потому что aiogram-сессия привязана к loop'у и не может
переживать его закрытие.

ВАЖНО: Bot и Dispatcher создаются ВНУТРИ фонового loop'а, а не в
главном потоке Django. Иначе aiohttp.ClientSession привязывается
не к тому loop'у и запросы зависают.
"""
from __future__ import annotations

import asyncio
import logging
import threading

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
)
from django.conf import settings

logger = logging.getLogger("matrix_app.telegram_bot")

_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_bot: Bot | None = None
_dp: Dispatcher | None = None
_lock = threading.Lock()


# =============================================================================
# Фоновый event loop
# =============================================================================

async def _bootstrap() -> None:
    """Создаём Bot и Dispatcher внутри фонового loop'а."""
    global _bot, _dp
    _bot = Bot(token=settings.BOT_TOKEN)
    _dp = Dispatcher()
    _dp.message.register(cmd_start, CommandStart())


def _ensure_loop() -> asyncio.AbstractEventLoop:
    """Создать (или вернуть существующий) фоновый event loop."""
    global _loop, _thread

    with _lock:
        if _loop is not None and _loop.is_running():
            return _loop

        _loop = asyncio.new_event_loop()

        def _runner() -> None:
            asyncio.set_event_loop(_loop)
            # Инициализируем Bot и Dispatcher ВНУТРИ этого loop'а.
            _loop.run_until_complete(_bootstrap())
            _loop.run_forever()

        _thread = threading.Thread(
            target=_runner,
            name="matrixlab-telegram-bot",
            daemon=True,
        )
        _thread.start()
        logger.info("Telegram: фоновый event loop запущен")

        return _loop


# =============================================================================
# Обработчики
# =============================================================================

async def cmd_start(message: Message) -> None:
    """Обработчик /start — кнопка на сайт."""
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть MatrixLab",
                    url=settings.SITE_URL,
                )
            ]
        ]
    )
    await message.answer(
        "Привет! Это бот MatrixLab — сервиса для решения задач по матрицам.\n\n"
        "Нажми на кнопку ниже, чтобы открыть сайт:",
        reply_markup=keyboard,
    )


# =============================================================================
# Публичные функции (синхронные обёртки)
# =============================================================================

def setup_webhook() -> None:
    """Установить webhook у Telegram."""
    loop = _ensure_loop()

    async def _set() -> None:
        url = (
            f"{settings.SITE_URL.rstrip('/')}"
            f"/telegram/webhook/{settings.WEBHOOK_SECRET}/"
        )
        await _bot.set_webhook(url)
        logger.info("Telegram webhook установлен: %s", url)

    future = asyncio.run_coroutine_threadsafe(_set(), loop)
    future.result(timeout=15)


def process_update(update_data: dict) -> None:
    """Обработать один апдейт от Telegram."""
    loop = _ensure_loop()

    async def _process() -> None:
        update = Update.model_validate(update_data, context={"bot": _bot})
        await _dp.feed_update(_bot, update)

    future = asyncio.run_coroutine_threadsafe(_process(), loop)
    future.result(timeout=30)