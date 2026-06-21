"""
Authentication layer: JWT issuing/verification + role-based access control (RBAC).

Design notes for resume/interview talking points:
- Stateless JWT auth (no server-side session storage)
- Access tokens are short-lived; role is embedded as a claim and re-checked
  server-side on every protected request (never trust the client).
- `require_auth` and `require_role` are composable decorators, so routes
  declare their own access policy right above the function definition.
"""
import os
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import request, jsonify, current_app, g

from models import User

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRY_HOURS = 12


def _get_secret() -> str:
    return current_app.config["JWT_SECRET_KEY"]


def generate_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(hours=ACCESS_TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str):
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])
        return payload, None
    except jwt.ExpiredSignatureError:
        return None, "Token has expired"
    except jwt.InvalidTokenError:
        return None, "Invalid token"


def _extract_token_from_header():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    return auth_header.split(" ", 1)[1].strip()


def require_auth(f):
    """Validates the JWT and attaches the decoded claims to flask.g.current_user."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = _extract_token_from_header()
        if not token:
            return jsonify({"error": "Missing or malformed Authorization header"}), 401

        payload, error = decode_token(token)
        if error:
            return jsonify({"error": error}), 401

        # Confirm the user still exists (handles deleted/deactivated accounts)
        user = User.query.get(int(payload["sub"]))
        if not user:
            return jsonify({"error": "User no longer exists"}), 401

        g.current_user = user
        g.token_claims = payload
        return f(*args, **kwargs)

    return wrapper


def require_role(*allowed_roles):
    """
    Stack on top of @require_auth. Usage:

        @app.route("/admin/entries", methods=["POST"])
        @require_auth
        @require_role("admin")
        def create_entry(): ...

    Re-checks the role against the DATABASE record, not just the JWT claim,
    so a role downgrade takes effect even if an old token is still valid.
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            user = getattr(g, "current_user", None)
            if not user:
                return jsonify({"error": "Authentication required"}), 401
            if user.role not in allowed_roles:
                return jsonify({
                    "error": f"Forbidden: requires role {allowed_roles}, you have '{user.role}'"
                }), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator
