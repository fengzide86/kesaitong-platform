"""Public access-domain contract."""

from domains.access.entitlements import (
    DEFAULT_ENTITLEMENTS,
    normalize_entitlements,
    require_business_access,
    resolve_product_access,
    serialize_entitlements,
)
from domains.access.license_state import effective_license_status, effective_license_status_sql
from domains.access.locking import lock_auth_code
from domains.access.plan_identity import (
    fixed_plan_entitlements,
    plan_entitlements_source,
    resolve_plan_code,
)

# Identity lease services import the scenario URL contract, which itself
# imports automation/catalog modules.  Load these names lazily so importing
# ``domains.access`` during app startup does not create a catalog cycle.
_IDENTITY_EXPORTS = {
    "AuthSessionConflict",
    "AuthSessionNotFound",
    "IdentityLeaseConflict",
    "IdentityLeaseNeedsRelogin",
    "IdentityLeaseNotFound",
    "acquire_identity_lease",
    "create_auth_session",
    "external_account_ref_hash",
    "heartbeat_identity_lease",
    "list_identity_leases",
    "mark_identity_needs_relogin",
    "release_identity_lease",
    "revoke_auth_session",
    "revoke_principal_sessions",
    "takeover_customer_binding",
    "validate_auth_session",
}


def __getattr__(name: str):
    if name not in _IDENTITY_EXPORTS:
        raise AttributeError(name)
    from domains.access import identity_leases

    value = getattr(identity_leases, name)
    globals()[name] = value
    return value

__all__ = [
    "DEFAULT_ENTITLEMENTS",
    "effective_license_status",
    "effective_license_status_sql",
    "fixed_plan_entitlements",
    "lock_auth_code",
    "normalize_entitlements",
    "plan_entitlements_source",
    "require_business_access",
    "resolve_product_access",
    "resolve_plan_code",
    "serialize_entitlements",
    *_IDENTITY_EXPORTS,
]
