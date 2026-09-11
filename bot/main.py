import asyncio
import logging
import os
import threading
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

BOT_TOKEN = os.environ["BOT_TOKEN"]
SITE_URL = "https://matrix-solver-qa4g.onrender.com"

# Flask для Render
app = Flask(__name__)

@app.route("/")
def index():
    return "Bot is running"

@app.route("/health")
def health():
    return "OK"

# Aiogram
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Открыть MatrixLab", url=SITE_URL)]]
    )
    await message.answer("Привет! Открой MatrixLab по кнопке ниже:", reply_markup=keyboard)

async def run_bot():
    await dp.start_polling(bot)

def start_bot_thread():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_bot())

if __name__ == "__main__":
    # Запускаем бота в отдельном потоке
    threading.Thread(target=start_bot_thread, daemon=True).start()
    # Запускаем Flask на порту Render
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)