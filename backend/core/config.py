"""
应用配置管理
集中管理所有配置项，支持环境变量覆盖
"""

import json
import os

# 加载 .env 文件（如果存在）
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass  # python-dotenv 未安装时忽略


def _get_version() -> str:
    """从 package.json 自动读取版本号"""
    # 尝试多个路径：本地开发 / 服务器部署
    for rel in ["../../package.json", "../package.json", "package.json"]:
        try:
            pkg_path = os.path.normpath(os.path.join(os.path.dirname(__file__), rel))
            with open(pkg_path, encoding="utf-8") as f:
                v = json.load(f).get("version", "")
                if v:
                    return v
        except Exception:
            pass
    return "unknown"


class Settings:
    """应用配置"""

    # 应用配置
    APP_NAME: str = "课赛通 KST · 跨境电商赛训效率平台"
    APP_VERSION: str = _get_version()
    APP_ENV: str = "internal"
    DEBUG: bool = False
    TOOL_EXECUTION_MODE: str = "demo"
    AI_SUPPORT_MODE: str = "rules"
    BUNDLED_BACKEND_ENABLED: bool = False
    COMMIT_SHA: str = "unknown"
    RELEASE_ID: str | None = None

    # 服务器配置
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS 配置
    CORS_ORIGINS: list[str]

    # ===== 数据库配置 =====
    # 数据库类型: "sqlite" (本地开发) 或 "mysql" (生产环境)
    DB_TYPE: str = ""

    # SQLite 配置（本地开发用）
    DB_PATH: str = ""

    # MySQL 配置（生产环境用）
    MYSQL_HOST: str = ""
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = ""
    MYSQL_PASSWORD: str = ""
    MYSQL_DATABASE: str = ""

    # ===== JWT 配置 =====
    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24小时

    # ===== Redis 配置（internal/production 默认必需）=====
    REDIS_URL: str | None = None
    # Internal/production Redis backs distributed rate limiting and revocation.
    # Set false only for an intentionally single-process degraded deployment.
    REDIS_REQUIRED: bool = False

    # ===== 自动化工具签名（Ed25519 原始密钥，Base64）=====
    TOOL_SIGNING_PRIVATE_KEY_B64: str = ""
    TOOL_SIGNING_PUBLIC_KEY_B64: str = ""
    TOOL_SIGNING_KEY_ID: str = "tool-signing-v1"

    # ===== API 频率限制 =====
    RATE_LIMIT_PER_MINUTE: int = 60  # 每分钟最多60次请求

    # 默认分润比例
    DEFAULT_PROFIT_RATIOS: dict[str, str]

    # ===== AI 客服配置 =====
    AI_PROVIDER: str = "qwen"  # qwen/openai
    QWEN_API_KEY: str = ""  # 通义千问API Key
    QWEN_MODEL: str = "qwen-turbo"  # 对话模型
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v2"  # Embedding模型
    OPENAI_API_KEY: str = ""  # OpenAI API Key
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    CHROMA_PERSIST_DIR: str = "./chroma_db"  # ChromaDB数据目录
    AI_CHAT_MAX_RETRIES: int = 2  # AI最大重试次数
    AI_CHAT_MAX_HISTORY: int = 5  # 对话历史轮数

    def __init__(self) -> None:
        self.APP_ENV = os.getenv("APP_ENV", "internal").strip().lower() or "internal"
        # 初始化 DEBUG 模式（优先环境变量）
        self.DEBUG = os.getenv("DEBUG", "false").lower() == "true"
        self.TOOL_EXECUTION_MODE = os.getenv("TOOL_EXECUTION_MODE", "demo").strip().lower() or "demo"
        self.AI_SUPPORT_MODE = os.getenv("AI_SUPPORT_MODE", "rules").strip().lower() or "rules"
        self.BUNDLED_BACKEND_ENABLED = os.getenv("BUNDLED_BACKEND_ENABLED", "false").lower() == "true"
        self.COMMIT_SHA = os.getenv("TOOLBOX_COMMIT_SHA", "").strip() or "unknown"
        self.RELEASE_ID = os.getenv("TOOLBOX_RELEASE_ID", "").strip() or None

        # 初始化 CORS 配置（生产环境禁止使用 *）
        cors_env = os.getenv("CORS_ORIGINS", "")
        if cors_env:
            self.CORS_ORIGINS = [origin.strip() for origin in cors_env.split(",") if origin.strip()]
        else:
            # 开发环境默认允许 localhost，生产环境必须配置 CORS_ORIGINS
            # null 来源对应打包后 Electron 应用的 file:// 协议页面
            self.CORS_ORIGINS = [
                "http://localhost:3000",
                "http://localhost:3001",
                "http://localhost:5173",
                "http://localhost:4173",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:4173",
                "null",
            ]
        if "app://toolbox" not in self.CORS_ORIGINS:
            self.CORS_ORIGINS.append("app://toolbox")

        # ===== 初始化数据库配置 =====
        # Development/test may intentionally use SQLite. Internal/production
        # must declare MySQL explicitly so a missing variable cannot silently
        # start a second local database and accept real traffic.
        configured_db_type = os.getenv("DB_TYPE", "").strip().lower()
        if configured_db_type == "mysql":
            self.DB_TYPE = "mysql"
            # 生产环境：使用 MySQL
            self.MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
            self.MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
            self.MYSQL_USER = os.getenv("MYSQL_USER", "root")
            self.MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
            self.MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "amazon_toolbox")
        elif configured_db_type in {"", "sqlite"} and self.APP_ENV in {"development", "test"}:
            # 本地开发：使用 SQLite
            self.DB_TYPE = "sqlite"
            self.DB_PATH = self._get_db_path()
        else:
            raise ValueError(
                "APP_ENV 为 internal/production 时必须显式配置 DB_TYPE=mysql，"
                "拒绝静默切换到 SQLite。"
            )

        # ===== 初始化 JWT 配置 =====
        # 生产环境必须设置强密码！
        jwt_key = os.getenv("JWT_SECRET_KEY", "")

        # 判断是否为生产环境（使用 MySQL 且非 DEBUG 模式）
        is_production = not self.DEBUG and self.DB_TYPE == "mysql"

        if not jwt_key:
            if is_production:
                # 生产环境：强制要求配置 JWT_SECRET_KEY
                raise ValueError(
                    "生产环境必须配置 JWT_SECRET_KEY！\n"
                    "请在 .env 文件中设置：JWT_SECRET_KEY=你的强密钥（至少32位）\n"
                    '可以使用命令生成：python -c "import secrets; print(secrets.token_urlsafe(48))"'
                )
            else:
                # 开发环境：使用固定的开发密钥（确保重启后 Token 不失效）
                import warnings

                warnings.warn(
                    "JWT_SECRET_KEY 未设置，使用开发环境固定密钥。\n生产环境请在 .env 文件中配置 JWT_SECRET_KEY。",
                    UserWarning,
                    stacklevel=2,
                )
                jwt_key = "dev-only-fixed-key-for-restart-stability-do-not-use-in-production"

        self.JWT_SECRET_KEY = jwt_key

        # ===== 初始化 Redis 配置 =====
        self.REDIS_URL = os.getenv("REDIS_URL")  # 例如: redis://localhost:6379/0
        redis_required = os.getenv("REDIS_REQUIRED", "").strip().lower()
        if redis_required and redis_required not in {"true", "false"}:
            raise ValueError("REDIS_REQUIRED 必须是 true 或 false")
        self.REDIS_REQUIRED = (
            redis_required == "true" if redis_required
            else self.APP_ENV in {"internal", "production"}
        )
        self.TOOL_SIGNING_PRIVATE_KEY_B64 = os.getenv("TOOL_SIGNING_PRIVATE_KEY_B64", "")
        self.TOOL_SIGNING_PUBLIC_KEY_B64 = os.getenv("TOOL_SIGNING_PUBLIC_KEY_B64", "")
        self.TOOL_SIGNING_KEY_ID = os.getenv("TOOL_SIGNING_KEY_ID", "tool-signing-v1")

        # 初始化默认分润比例
        self.DEFAULT_PROFIT_RATIOS = {
            "tech": "0.30",
            "market": "0.25",
            "product": "0.15",
            "service": "0.15",
            "coordination": "0.10",
            "record": "0.05",
        }

        # ===== 初始化 AI 客服配置 =====
        self.AI_PROVIDER = os.getenv("AI_PROVIDER", "qwen").lower()
        self.QWEN_API_KEY = os.getenv("QWEN_API_KEY", "")
        self.QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen-turbo")
        self.QWEN_EMBEDDING_MODEL = os.getenv("QWEN_EMBEDDING_MODEL", "text-embedding-v2")
        self.OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
        self.OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        self.OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.OPENAI_EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        self.CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")

    def _get_db_path(self) -> str:
        """Get the local SQLite database path, preferring the configured runtime root."""
        configured_path = os.environ.get("DB_PATH", "").strip()
        if configured_path:
            return os.path.abspath(os.path.expanduser(configured_path))
        runtime_root = os.environ.get("TOOLBOX_RUNTIME_DIR", "").strip()
        if runtime_root:
            db_dir = os.path.join(runtime_root, "AmazonToolbox")
        else:
            appdata = os.environ.get("APPDATA") or os.path.expanduser("~")
            db_dir = os.path.join(appdata, "AmazonToolbox")
        os.makedirs(db_dir, exist_ok=True)
        return os.path.join(db_dir, "toolbox.db")

    def get_database_url(self) -> str:
        """获取数据库连接 URL"""
        if self.DB_TYPE == "mysql":
            # MySQL 异步连接 URL
            return f"mysql+aiomysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}?charset=utf8mb4"
        else:
            # SQLite 异步连接 URL
            return f"sqlite+aiosqlite:///{self.DB_PATH}"

    def check_security(self) -> dict:
        """
        生产环境安全检查
        返回: {"warnings": [], "errors": []}
        - warnings: 低风险警告，不阻止启动
        - errors: 高风险错误，建议修复后再启动
        """
        result: dict[str, list[str]] = {"warnings": [], "errors": []}
        # 使用 SQLite 或 DEBUG 模式时，视为开发环境，跳过严格检查
        is_production = not self.DEBUG and self.DB_TYPE != "sqlite"

        # 1. JWT_SECRET_KEY 长度检查
        if not self.JWT_SECRET_KEY or len(self.JWT_SECRET_KEY) < 32:
            result["errors"].append("JWT_SECRET_KEY 未设置或长度不足 32 位，存在安全风险")

        # 2. CORS 配置检查（仅生产环境）
        if is_production and "*" in self.CORS_ORIGINS:
            result["errors"].append("生产环境 CORS_ORIGINS 不应包含 *，请设置具体域名")

        # 3. DEBUG 模式检查
        if self.DEBUG:
            result["warnings"].append("DEBUG 模式已启用，生产环境应设置 DEBUG=False")

        # 4. MySQL 密码检查（仅生产环境）
        if is_production and self.DB_TYPE == "mysql" and not self.MYSQL_PASSWORD:
            result["errors"].append("生产环境 MySQL 密码未设置")

        # 5. 仅在线 AI 模式需要供应商密钥；规则客服不依赖外部模型。
        if is_production and self.AI_SUPPORT_MODE != "rules" and not self.QWEN_API_KEY:
            result["warnings"].append("生产环境未配置 QWEN_API_KEY，工具帮助将使用 FAQ 与人工工单降级")

        # 6. 更新地址检查（仅生产环境）
        update_url = os.getenv("UPDATE_URL", "")
        if is_production and (not update_url or "localhost" in update_url or "127.0.0.1" in update_url):
            result["warnings"].append("生产环境 UPDATE_URL 未设置或仍为本地地址")

        return result


# 全局配置实例
settings = Settings()
