"""Credential-free registration and signed target profile contracts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Edition = Literal["v2", "v3", "unknown"]
Marker = Literal["amazon-v2", "amazon-v3", "seller-shipping-template", "course-index"]


class TargetPageFingerprints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    courseMap: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    templateList: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    templateEditor: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class TargetExecutionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: Literal["training"] = "training"
    stage: Literal["not_applicable"] = "not_applicable"
    courseRef: str = Field(pattern=r"^[a-f0-9]{64}$")
    source: Literal["admin-verified"] = "admin-verified"
    evidenceRef: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")


class TargetEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edition: Edition = "unknown"
    pageFingerprint: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    markers: list[Marker] = Field(default_factory=list, max_length=4)
    source: Literal["client-observed", "admin-verified"] = "client-observed"
    pageFingerprints: TargetPageFingerprints | None = None


class TargetRoute(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin: str = Field(min_length=8, max_length=300)
    pathPrefix: str = Field(min_length=1, max_length=300)
    role: Literal["entry", "login", "business"]


class TargetProfileSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    entryUrl: str = Field(min_length=8, max_length=4096)
    providerId: Literal["bjysoft"] = "bjysoft"
    productKey: Literal["amazon"] = "amazon"
    edition: Edition = "unknown"
    evidence: TargetEvidence = Field(default_factory=TargetEvidence)


class TargetProfileReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=1)
    reviewStatus: Literal["approved", "rejected", "disabled"]
    # Rejection and disablement are status-only decisions.  Keeping the
    # editable approval draft out of those requests prevents an invalid draft
    # from blocking a safe state transition.  Approval still requires every
    # saved configuration field below (see the model validator).
    edition: Edition | None = None
    allowedRoutes: list[TargetRoute] | None = Field(default=None, max_length=24)
    capabilities: list[Literal["template.create.v1"]] | None = Field(default=None, max_length=1)
    adapterVersion: Literal["bjysoft-v2-template.1"] | None = None
    evidence: TargetEvidence | None = None
    executionScopes: list[TargetExecutionScope] | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def require_approval_configuration(self) -> "TargetProfileReview":
        if self.reviewStatus == "approved":
            required = {
                "edition": self.edition,
                "allowedRoutes": self.allowedRoutes,
                "capabilities": self.capabilities,
                "evidence": self.evidence,
                "executionScopes": self.executionScopes,
            }
            missing = [name for name, value in required.items() if value is None]
            if missing:
                raise ValueError(f"批准入口必须提供完整配置: {', '.join(missing)}")
        return self


class TargetProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal[1] = 1
    id: str
    revision: int
    name: str = Field(min_length=1, max_length=100)
    providerId: Literal["bjysoft"]
    productKey: Literal["amazon"]
    edition: Edition
    entryUrl: str = Field(min_length=8, max_length=2048)
    allowedRoutes: list[TargetRoute] = Field(max_length=24)
    reviewStatus: Literal["pending", "approved", "rejected", "disabled"]
    capabilities: list[str]
    adapterVersion: str | None
    evidence: TargetEvidence
    executionScopes: list[TargetExecutionScope] = Field(default_factory=list, max_length=32)


class SignedTargetProfile(BaseModel):
    profile: TargetProfile
    signature: str | None
    signingKeyId: str | None


class TargetProfileResponse(BaseModel):
    success: Literal[True]
    message: str
    data: SignedTargetProfile


class TargetProfileListResponse(BaseModel):
    success: Literal[True]
    message: str
    data: list[SignedTargetProfile]
