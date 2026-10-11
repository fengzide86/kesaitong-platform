"""
认证服务测试
"""
from datetime import UTC, datetime, timedelta

from core.security import create_access_token, hash_password, verify_password, verify_token


class TestAuthService:
    """认证服务测试"""

    def test_create_access_token(self):
        """测试创建访问令牌"""
        data = {"sub": "user1", "role": "user"}
        token = create_access_token(data)
        
        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0

    def test_verify_token_valid(self):
        """测试验证有效令牌"""
        data = {"sub": "user1", "role": "user"}
        token = create_access_token(data)
        
        payload = verify_token(token)
        assert payload is not None
        assert payload["sub"] == "user1"
        assert payload["role"] == "user"

    def test_verify_token_expired(self):
        """测试验证过期令牌"""
        data = {"sub": "user1", "exp": datetime.now(UTC) - timedelta(hours=1)}
        token = create_access_token(data, expires_delta=timedelta(hours=-1))
        
        payload = verify_token(token)
        assert payload is None

    def test_verify_token_invalid(self):
        """测试验证无效令牌"""
        payload = verify_token("invalid_token")
        assert payload is None

    def test_password_hash(self):
        """测试密码哈希"""
        password = "test_password_123"
        hashed = hash_password(password)
        
        assert hashed is not None
        assert hashed != password
        assert len(hashed) > 0

    def test_verify_password_correct(self):
        """测试验证正确密码"""
        password = "test_password_123"
        hashed = hash_password(password)
        
        assert verify_password(password, hashed) is True

    def test_verify_password_incorrect(self):
        """测试验证错误密码"""
        password = "test_password_123"
        hashed = hash_password(password)
        
        assert verify_password("wrong_password", hashed) is False

    def test_token_with_expires_delta(self):
        """测试带过期时间的令牌"""
        data = {"sub": "user1"}
        token = create_access_token(data, expires_delta=timedelta(minutes=30))
        
        payload = verify_token(token)
        assert payload is not None
        assert "exp" in payload

    def test_token_contains_user_info(self):
        """测试令牌包含用户信息"""
        data = {"sub": "user1", "role": "admin", "email": "test@example.com"}
        token = create_access_token(data)
        
        payload = verify_token(token)
        assert payload["sub"] == "user1"
        assert payload["role"] == "admin"
        assert payload["email"] == "test@example.com"
