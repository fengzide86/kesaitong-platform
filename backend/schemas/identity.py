"""Contracts for safe account leases and server-visible login sessions."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.response import APIResponse
from schemas.scenario import origin_list


class AccountLeaseAcquireRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    site_origin: str = Field(min_length=8, max_length=300)
    # Accepted only for one-way hashing; it is never returned or stored.
    external_account_ref: str = Field(min_length=1, max_length=200)
    device_id: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._:-]+$")
    workspace_id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._:-]+$")
    account_slot: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    scene_id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._:-]+$")
    takeover: bool = False

    @field_validator("site_origin")
    @classmethod
    def validate_origin(cls, value: str) -> str:
        return origin_list([value])[0]


class AccountLeaseHeartbeatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lease_token: str = Field(min_length=20, max_length=256)


class AccountLeaseRead(BaseModel):
    id: int
    owner_kind: Literal["user", "staff"]
    owner_id: int
    workspace_id: str
    account_slot: str
    scene_id: str
    site_origin: str
    external_account_hint: str
    status: Literal["active", "paused", "needs_relogin", "released", "expired"]
    revision: int
    last_heartbeat_at: str
    expires_at: str


class AccountLeaseAcquireRead(AccountLeaseRead):
    lease_token: str


class AccountLeaseEnvelope(APIResponse[AccountLeaseRead]):
    """Response for a lease heartbeat or release-adjacent read."""


class AccountLeaseAcquireEnvelope(APIResponse[AccountLeaseAcquireRead]):
    """The one-time lease token is returned only when a lease is acquired."""


class AccountLeaseListEnvelope(APIResponse[list[AccountLeaseRead]]):
    """Safe list shape; raw external account identifiers are never exposed."""


class AccountBindingTakeoverRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    site_origin: str = Field(min_length=8, max_length=300)
    # Accepted only for one-way hashing.  The service never stores or returns it.
    external_account_ref: str = Field(min_length=1, max_length=200)
    reason: str = Field(default="管理员重新绑定", min_length=2, max_length=200)

    @field_validator("site_origin")
    @classmethod
    def validate_origin(cls, value: str) -> str:
        return origin_list([value])[0]


class AccountBindingTakeoverRead(BaseModel):
    binding_id: int
    auth_code_id: int
    site_origin: str
    external_account_hint: str
    status: Literal["active", "revoked"]
    replaced_binding_id: int | None = None


class AccountBindingTakeoverEnvelope(APIResponse[AccountBindingTakeoverRead]):
    """Staff-only result for an explicit customer account rebind."""


class AuthSessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    principal_kind: Literal["user", "staff"]
    principal_id: int = Field(gt=0)
    auth_code_id: int | None = Field(default=None, gt=0)
    device_id: str = Field(min_length=1, max_length=200)
    replace_existing: bool = False


class AuthSessionRead(BaseModel):
    id: int
    session_id: str
    principal_kind: Literal["user", "staff"]
    principal_id: int
    auth_code_id: int | None = None
    device_id: str
    status: Literal["active", "revoked", "expired"]
    last_seen_at: str
    expires_at: str


class AuthSessionCreateRead(AuthSessionRead):
    session_token: str
