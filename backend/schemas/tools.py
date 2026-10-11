"""Contracts for the tool catalog and one-time launch grants."""

from typing import Literal

from pydantic import BaseModel, Field, JsonValue, RootModel


class ConfigJsonValue(RootModel[JsonValue]):
    """Explicit whitelist for administrator-managed free-form JSON settings."""


class ToolConfigUpdateResponse(BaseModel):
    success: Literal[True]
    data: list[dict[str, JsonValue]]


class ConfigUpdateResponse(BaseModel):
    success: Literal[True]


class ToolManifestResponse(BaseModel):
    schemaVersion: int
    toolId: str
    version: str
    scriptKey: str
    runnerApiVersion: int
    artifactSha256: str | None
    artifactUrl: str | None


class LaunchDataResponse(BaseModel):
    platform_key: str
    tool_id: str
    token: str
    script_key: str
    tool_name: str | None
    tool_module: str | None
    target_url: str
    category: str
    description: str
    expires_at: str
    runner_api_version: int
    tool_version: str
    tool_manifest: ToolManifestResponse
    tool_signature: str | None
    signing_key_id: str | None
    signature_required: bool
    execution_mode: str
    client_batch_id: str | None
    client_item_id: str | None


class LaunchGrantDataResponse(BaseModel):
    token: str
    expires_in: int
    expires_at: str
    launch_data: LaunchDataResponse


class LaunchGrantSuccessResponse(BaseModel):
    success: Literal[True]
    message: str
    data: LaunchGrantDataResponse


class LaunchGrantVerifyDataResponse(BaseModel):
    valid: Literal[True]
    user_id: int
    auth_code_id: int
    platform_key: str
    tool_id: str
    script_key: str
    device_id: str
    execution_mode: str
    client_batch_id: str | None
    client_item_id: str | None


class LaunchGrantVerifyRequest(BaseModel):
    """New clients keep the one-use grant out of URL and proxy access logs."""
    token: str = Field(min_length=1, max_length=512)


class LaunchGrantVerifySuccessResponse(BaseModel):
    success: Literal[True]
    message: str
    data: LaunchGrantVerifyDataResponse


class ToolOperationErrorResponse(BaseModel):
    success: Literal[False]
    message: str
    error_code: int
    detail: JsonValue | None = None


class FeatureDisabledDetailResponse(BaseModel):
    code: str
    message: str
    reason: str | None = None


class FeatureDisabledResponse(BaseModel):
    detail: FeatureDisabledDetailResponse


LaunchGrantResponse = LaunchGrantSuccessResponse | ToolOperationErrorResponse
LaunchGrantVerifyResponse = LaunchGrantVerifySuccessResponse | ToolOperationErrorResponse
