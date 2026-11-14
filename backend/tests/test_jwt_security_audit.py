import pytest
import jwt

from backend.auth.jwt import create_access_token, decode_token
from backend.config.security import get_jwt_secret
from backend.api.routes.stream import _validate_ws_jwt
from backend.services.kite_stream import KiteStreamAdapter


def test_jwt_round_trip_and_websocket_validation():
    token = create_access_token("audit-user", "audit@example.test", "trader")
    assert decode_token(token)["sub"] == "audit-user"
    assert _validate_ws_jwt(token)["type"] == "access"


@pytest.mark.parametrize("payload", [
    {"sub": "audit", "type": "access"},
    {"exp": 4102444800, "type": "access"},
    {"sub": "audit", "exp": 4102444800},
    {"sub": "audit", "exp": 1, "type": "access"},
])
def test_required_claims_and_expiry(payload):
    token = jwt.encode(payload, get_jwt_secret(), algorithm="HS256")
    with pytest.raises(ValueError):
        decode_token(token)
    assert _validate_ws_jwt(token) is None


def test_algorithm_allowlist_and_signature_are_enforced():
    payload = {"sub": "audit", "exp": 4102444800, "type": "access"}
    for token in [jwt.encode(payload, get_jwt_secret(), algorithm="HS512"),
                  jwt.encode(payload, "wrong-secret-" * 8, algorithm="HS256"),
                  jwt.encode(payload, "", algorithm="none")]:
        with pytest.raises(ValueError):
            decode_token(token)
        assert _validate_ws_jwt(token) is None


def test_kite_sdk_manages_reactor_thread():
    class Ticker:
        def connect(self, **kwargs):
            self.options = kwargs
    ticker = Ticker()
    adapter = KiteStreamAdapter(None, lambda tick: None)
    adapter._ticker = ticker
    adapter._connect_ticker()
    assert ticker.options == {"threaded": True}
