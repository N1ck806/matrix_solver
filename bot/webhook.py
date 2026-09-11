"""
Telegram-бот на webhook, работающий на том же сервере, что и Django.
"""
import os

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
)
from fastapi import FastAPI, Request

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "matrixlab-secret")
SITE_URL = "https://matrix-solver-qa4g.onrender.com"
RENDER_URL = os.environ.get(
    "RENDER_EXTERNAL_URL",
    "https://matrix-solver-qa4g.onrender.com",
)

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
        "Привет! Открой MatrixLab по кнопке ниже:",
        reply_markup=keyboard,
    )


app = FastAPI()


@app.on_event("startup")
async def on_startup() -> None:
    webhook_url = f"{RENDER_URL}/bot/webhook/{WEBHOOK_SECRET}"
    await bot.set_webhook(webhook_url)
    print(f"Webhook set to {webhook_url}")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await bot.delete_webhook()


@app.post(f"/bot/webhook/{WEBHOOK_SECRET}")
async def webhook(request: Request) -> dict:
    update = Update.model_validate(await request.json(), context={"bot": bot})
    await dp.feed_update(bot, update)
    return {"ok": True}