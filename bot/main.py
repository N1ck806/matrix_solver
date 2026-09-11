"""
Telegram-бот MatrixLab на webhook (Render Free).

- Flask отдаёт /, /health и /webhook/<secret>.
- Aiogram принимает апдейты через webhook.
- При старте бот сам устанавливает webhook на свой Render-URL.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, request

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
)

# ---------- Настройки ----------
BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "matrixlab-secret")
SITE_URL = "https://matrix-solver-qa4g.onrender.com"

# URL, по которому Render отдаёт сервис. Render сам подставляет эту переменную.
RENDER_URL = os.environ.get(
    "RENDER_EXTERNAL_URL",
    "https://matrixlab-bot.onrender.com",
).rstrip("/")

WEBHOOK_PATH = f"/webhook/{WEBHOOK_SECRET}"
WEBHOOK_URL = f"{RENDER_URL}{WEBHOOK_PATH}"

# ---------- Логи ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("matrixlab-bot")

# ---------- Aiogram ----------
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Открыть MatrixLab", url=SITE_URL)]
        ]
    )
    await message.answer(
        "Привет! Это бот MatrixLab — сервиса для решения задач по матрицам.\n\n"
        "Нажми на кнопку ниже, чтобы открыть сайт:",
        reply_markup=keyboard,
    )


# ---------- Flask ----------
app = Flask(__name__)


@app.get("/")
def index() -> str:
    return "MatrixLab bot is running."


@app.get("/health")
def health() -> str:
    return "OK"


@app.post(WEBHOOK_PATH)
def webhook() -> tuple[str, int]:
    """Принимает апдейты от Telegram."""
    update_data = request.get_json(force=True)

    # Aiogram асинхронный → запускаем обработку в новом event loop.
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        update = Update.model_validate(update_data, context={"bot": bot})
        loop.run_until_complete(dp.feed_update(bot, update))
    finally:
        loop.close()

    return "ok", 200


def _set_webhook() -> None:
    """Синхронно установить webhook (один раз при старте)."""
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        loop.run_until_complete(bot.set_webhook(WEBHOOK_URL))
        log.info("Webhook установлен: %s", WEBHOOK_URL)
    finally:
        loop.close()


if __name__ == "__main__":
    _set_webhook()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)