"""Public guards used by launch authorization; implementation remains internal."""

from .service import assert_customer_access, assert_project_scope

__all__ = ["assert_customer_access", "assert_project_scope"]
