"""Public runtime contracts; schemaVersion is independent of tool protocols."""

from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from domains.automation.schemas import ExecutionReconcileRequest
from schemas.target_profiles import SignedTargetProfile
from schemas.tools import ToolManifestResponse

COMPETITION_ENTRY = "https://www.idtrade.cn/User/Contest"
COMPETITION_ORIGIN = "https://www.idtrade.cn"


def exact_origin(value: str) -> str:
    """Canonical HTTP(S) origin, never prefix/domain suffix matching."""
    if not isinstance(value, str) or not value or any(ord(ch) < 33 for ch in value) or "\\" in value:
        raise ValueError("网站地址包含无效字符")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("仅允许不含凭据的 HTTP(S) 网站")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("网站端口无效") from exc
    host = parsed.hostname.encode("idna").decode("ascii").lower()
    if ":" in host:
        host = f"[{host}]"
    if port == 0:
        raise ValueError("网站端口无效")
    suffix = f":{port}" if port is not None and port != (443 if parsed.scheme == "https" else 80) else ""
    return f"{parsed.scheme}://{host}{suffix}"


def origin_list(values: list[str]) -> list[str]:
    normalized = []
    for value in values:
        parsed = urlsplit(value)
        origin = exact_origin(value)
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("允许列表只能填写协议、主机和端口，不包含路径或参数")
        if origin not in normalized:
            normalized.append(origin)
    return normalized


class ScenarioAssignmentWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    mode: Literal["training", "competition"]
    entry_url: str = Field(min_length=8, max_length=2048)
    allowed_origins: list[str] = Field(min_length=1, max_length=12)
    status: Literal["active", "disabled"] = "active"
    expires_at: datetime

    _origins = field_validator("allowed_origins")(origin_list)

    @model_validator(mode="after")
    def validate_entry(self):
        origin = exact_origin(self.entry_url)
        if urlsplit(self.entry_url).fragment or urlsplit(self.entry_url).query:
            raise ValueError("入口不能含登录凭据、参数或片段")
        if origin not in self.allowed_origins:
            raise ValueError("入口必须属于明确批准的站点")
        if self.mode == "competition" and self.entry_url != COMPETITION_ENTRY:
            raise ValueError("当前比赛仅支持已确认的官方入口")
        return self


class StaffRuntimePermissionWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    enabled: bool = False
    max_scenes: int = Field(default=10, ge=1, le=10)
    allowed_origins: list[str] = Field(default_factory=list, max_length=12)
    allowed_capabilities: list[Literal["template.create.v1"]] = Field(default_factory=list, max_length=1)
    expires_at: datetime
    _origins = field_validator("allowed_origins")(origin_list)

    @model_validator(mode="after")
    def require_origins(self):
        if self.enabled and not self.allowed_origins:
            raise ValueError("启用本机工作台前须明确批准站点")
        return self


class StaffRuntimeLaunchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._:-]+$")
    account_slot: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    origin: str = Field(min_length=8, max_length=300)

    @field_validator("origin")
    @classmethod
    def validate_origin(cls, value: str) -> str:
        return origin_list([value])[0]


class StaffToolGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_id: str = Field(min_length=1, max_length=128)
    target_profile_id: str = Field(min_length=1, max_length=128)
    target_profile_revision: int = Field(ge=1)
    device_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._:-]+$")
    account_slot: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    attempt_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    context_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class StaffToolGrantVerify(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=256)


class StaffExecutionReconcileRequest(ExecutionReconcileRequest):
    device_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._:-]+$")
    account_slot: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    context_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ProjectRuntimeScopeWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    project_id: str = Field(min_length=1, max_length=128)
    site_origin: str = Field(min_length=8, max_length=300)
    mode: Literal["training", "competition"]
    course_refs: list[str] = Field(min_length=1, max_length=64)
    status: Literal["active", "disabled"] = "active"

    @field_validator("site_origin")
    @classmethod
    def origin(cls, value: str) -> str:
        return origin_list([value])[0]

    @field_validator("course_refs")
    @classmethod
    def course_hashes(cls, values: list[str]) -> list[str]:
        import re
        if any(not re.fullmatch(r"[a-f0-9]{64}", value) for value in values):
            raise ValueError("课程引用必须来自已核验现场的完整摘要")
        return sorted(set(values))


class ScenarioPrincipal(BaseModel):
    kind: Literal["customer", "staff"]
    id: str


class ScenarioEffectivePolicy(BaseModel):
    schemaVersion: Literal[1]
    principal: ScenarioPrincipal
    revision: str
    status: Literal["unassigned", "active", "blocked"]
    mode: Literal["training", "competition"]
    entryUrl: str | None
    allowedOrigins: list[str]
    maxScenes: int
    checkedAt: str
    expiresAt: str | None
    refreshAfterSeconds: Literal[30]


class ScenarioAssignmentRead(BaseModel):
    id: int
    subject_type: Literal["user", "auth_code"]
    subject_id: int
    revision: int
    mode: Literal["training", "competition"]
    entry_url: str
    allowed_origins: list[str]
    status: Literal["active", "disabled"]
    expires_at: str


class StaffRuntimePermissionRead(BaseModel):
    staff_id: int
    revision: int
    enabled: bool
    max_scenes: int
    allowed_origins: list[str]
    allowed_capabilities: list[str]
    expires_at: str


class ProjectRuntimeScopeRead(BaseModel):
    id: int
    project_id: str
    site_origin: str
    mode: Literal["training", "competition"]
    course_refs: list[str]
    revision: int
    status: Literal["active", "disabled"]


class StaffBrowseToken(BaseModel):
    token: str
    expires_in: Literal[60]
    permissions: list[Literal["scene.open"]]
    runner_api_version: Literal[3]


class StaffBrowseGrantRead(BaseModel):
    policy: ScenarioEffectivePolicy
    grant: StaffBrowseToken


class StaffToolLaunchData(BaseModel):
    token: str
    tool_id: str
    platform_key: Literal["amazon"]
    script_key: str
    tool_version: str
    runner_api_version: Literal[2]
    signature_required: Literal[True]
    tool_signature: str
    signing_key_id: str
    tool_manifest: ToolManifestResponse
    target_profile: SignedTargetProfile
    expires_at: str


class StaffToolGrantRead(BaseModel):
    launch_data: StaffToolLaunchData


class StaffToolVerificationRead(BaseModel):
    valid: Literal[True]
    principal_kind: Literal["staff"]
    staff_id: int
    device_id: str
    account_slot: str
    context_hash: str
    input_hash: str
    tool_id: str
    platform_key: Literal["amazon"]
    target_profile_id: str
    target_profile_revision: int
    required_capability: str


class StaffExecutionReportRead(BaseModel):
    execution_id: int
    duplicate: bool
