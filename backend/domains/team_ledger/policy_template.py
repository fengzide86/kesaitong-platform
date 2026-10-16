"""Read an operator-supplied private policy without changing stored policies."""

import os
from pathlib import Path

from fastapi import HTTPException

from schemas.team_ledger import PolicyInput


def latest_policy_template() -> PolicyInput:
    """Validate a fresh private runtime file on each restricted preview request."""
    configured = os.getenv("TEAM_POLICY_TEMPLATE_FILE", "").strip()
    runtime_root = os.getenv("TOOLBOX_RUNTIME_DIR", "").strip()
    try:
        if configured:
            source = Path(configured).expanduser()
        elif runtime_root:
            source = Path(runtime_root).expanduser() / "private" / "team-policy-template.json"
        else:
            raise ValueError("private policy location is not configured")
        return PolicyInput.model_validate_json(source.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        # No source path, file contents, or validation details leave this boundary.
        raise HTTPException(status_code=503, detail="分成方案暂不可用，请联系管理员核对配置后重试") from None
