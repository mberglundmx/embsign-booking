import os


def get_env(name: str, default: str) -> str:
    return os.getenv(name, default)


DATABASE_PATH = get_env("DATABASE_PATH", "app.db")
SESSION_TTL_SECONDS = int(get_env("SESSION_TTL_SECONDS", "600"))
CSV_URL = os.getenv("CSV_URL")
CONFIG_URL = os.getenv("CONFIG_URL")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
FRONTEND_ORIGINS = get_env("FRONTEND_ORIGINS", "http://localhost:5173")
