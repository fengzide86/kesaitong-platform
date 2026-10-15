import base64
import hashlib

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from services.tool_release_service import (
    canonical_artifact,
    create_release,
    resolve_release,
    rollback_releases,
    rollout_bucket,
    verify_manifest_signature,
)


def key_pair():
    private = Ed25519PrivateKey.generate()
    private_raw = private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(private_raw).decode(), base64.b64encode(public_raw).decode()


def test_release_manifest_is_signed_and_tamper_evident():
    private_key, public_key = key_pair()
    release = create_release({
        "tool_id": "tool_register",
        "version": "1.2.0",
        "script_key": "amazon.register.v1",
        "artifact_sha256": "a" * 64,
    }, private_key)

    assert verify_manifest_signature(release["manifest"], release["signature"], public_key)
    release["manifest"]["scriptKey"] = "amazon.evil.v1"
    assert not verify_manifest_signature(release["manifest"], release["signature"], public_key)


def test_declarative_adapter_is_hashed_and_embedded_in_release_storage():
    private_key, public_key = key_pair()
    adapter = {
        "key": "amazon.register.v1",
        "version": "1.3.0",
        "mode": "workflow",
        "sandbox": False,
        "steps": [{"id": "fill", "actions": [{"id": "name", "kind": "fill"}]}],
        "successChecks": [{"id": "success", "kind": "assertText"}],
    }
    release = create_release({
        "tool_id": "tool_register",
        "version": "1.3.0",
        "script_key": "amazon.register.v1",
        "artifact_url": "/api/tool-releases/tool_register/1.3.0/artifact",
        "adapter": adapter,
    }, private_key)

    assert release["adapter"] == adapter
    assert release["manifest"]["artifactSha256"] == hashlib.sha256(canonical_artifact(adapter)).hexdigest()
    assert verify_manifest_signature(release["manifest"], release["signature"], public_key)


def test_gray_release_selection_is_stable_per_subject():
    releases = [
        {"tool_id": "tool_a", "version": "1.0.0", "channel": "stable", "status": "published"},
        {"tool_id": "tool_a", "version": "1.1.0", "channel": "canary", "status": "published", "rollout_percentage": 100},
    ]

    assert rollout_bucket("tool_a", "1.1.0", "device-1") == rollout_bucket("tool_a", "1.1.0", "device-1")
    assert resolve_release(releases, "tool_a", "device-1")["version"] == "1.1.0"
    releases[1]["rollout_percentage"] = 0
    assert resolve_release(releases, "tool_a", "device-1")["version"] == "1.0.0"


def test_rollback_promotes_target_and_retires_current_stable():
    releases = [
        {"tool_id": "tool_a", "version": "1.0.0", "channel": "stable", "status": "retired"},
        {"tool_id": "tool_a", "version": "1.1.0", "channel": "stable", "status": "published"},
    ]

    rollback_releases(releases, "tool_a", "1.0.0")

    assert releases[0]["status"] == "published"
    assert releases[0]["rollout_percentage"] == 100
    assert releases[1]["status"] == "retired"


def test_protocol_two_release_is_filtered_before_gray_selection():
    releases = [
        {"tool_id": "tool_a", "version": "1.0.0", "channel": "stable", "status": "published", "runner_api_version": 1},
        {"tool_id": "tool_a", "version": "2.0.0", "channel": "canary", "status": "published", "rollout_percentage": 100, "runner_api_version": 2},
    ]
    assert resolve_release(releases, "tool_a", "device-1", 1)["version"] == "1.0.0"
    assert resolve_release(releases, "tool_a", "device-1", 2)["version"] == "2.0.0"
    assert resolve_release(releases[1:], "tool_a", "device-1", 1) is None


def test_new_manifest_signs_required_capability_with_protocol_two():
    private, public = key_pair()
    release = create_release({"tool_id": "template", "version": "1.0.0", "script_key": "bjysoft-v2-template.1",
                              "runner_api_version": 2, "required_capability": "template.create.v1"}, private)
    assert release["manifest"]["schemaVersion"] == 2
    assert release["manifest"]["requiredCapability"] == "template.create.v1"
    assert verify_manifest_signature(release["manifest"], release["signature"], public)
    release["manifest"]["requiredCapability"] = "orders.dispatch"
    assert not verify_manifest_signature(release["manifest"], release["signature"], public)
