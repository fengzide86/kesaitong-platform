"""Versioned runtime assignments. No customer credentials or browser state."""

from sqlalchemy import JSON, Boolean, Column, DateTime, Integer, String, UniqueConstraint, func

from models.base import Base


class ScenarioAssignment(Base):
    __tablename__ = "scenario_assignments"
    id = Column(Integer, primary_key=True, autoincrement=True)
    subject_type = Column(String(16), nullable=False)
    subject_id = Column(Integer, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    mode = Column(String(16), nullable=False)
    entry_url = Column(String(2048), nullable=False)
    allowed_origins = Column(JSON, nullable=False)
    status = Column(String(16), nullable=False, default="active")
    expires_at = Column(DateTime, nullable=False)
    updated_by = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    __table_args__ = (UniqueConstraint("subject_type", "subject_id", name="uq_scenario_subject"),)


class StaffRuntimePermission(Base):
    """Explicit local-runtime grant; does not imply customer/B-plan entitlements."""

    __tablename__ = "staff_runtime_permissions"
    staff_id = Column(Integer, primary_key=True)
    revision = Column(Integer, nullable=False, default=1)
    enabled = Column(Boolean, nullable=False, default=False)
    # Staff can keep up to ten isolated account scenes.  This is a window
    # limit, not a promise that ten live tasks may submit concurrently.
    max_scenes = Column(Integer, nullable=False, default=10)
    allowed_origins = Column(JSON, nullable=False, default=list)
    allowed_capabilities = Column(JSON, nullable=False, default=list)
    expires_at = Column(DateTime, nullable=False)
    updated_by = Column(Integer, nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class StaffToolGrant(Base):
    __tablename__ = "staff_tool_grants"
    id = Column(Integer, primary_key=True, autoincrement=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    staff_id = Column(Integer, nullable=False, index=True)
    staff_token_version = Column(Integer, nullable=False)
    policy_revision = Column(Integer, nullable=False)
    device_id = Column(String(200), nullable=False)
    account_slot = Column(String(64), nullable=False)
    attempt_id = Column(String(128), nullable=False)
    tool_id = Column(String(128), nullable=False)
    target_profile_id = Column(String(128), nullable=False)
    target_profile_revision = Column(Integer, nullable=False)
    site_origin = Column(String(300), nullable=False)
    capability = Column(String(128), nullable=False)
    context_hash = Column(String(64), nullable=False)
    input_hash = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False, default="pending")
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    report = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (UniqueConstraint("staff_id", "device_id", "attempt_id", name="uq_staff_tool_attempt"),)


class ProjectRuntimeScope(Base):
    __tablename__ = "project_runtime_scopes"
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String(128), nullable=False)
    site_origin = Column(String(300), nullable=False)
    mode = Column(String(16), nullable=False)
    course_refs = Column(JSON, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    status = Column(String(16), nullable=False, default="active")
    updated_by = Column(Integer, nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    __table_args__ = (UniqueConstraint("project_id", "site_origin", name="uq_project_runtime_origin"),)
