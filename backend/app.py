"""
Nyaya Sahayak — AI-Style Legal Rights Assistant for Indian Citizens & Tourists.

Main Flask application: route definitions, app factory, and startup logic.

Run with:
    python app.py
Server starts on http://localhost:5000
"""
import os
from flask import Flask, request, jsonify, g
from flask_cors import CORS

from models import db, User, LegalEntry, SavedQuery
from auth import generate_token, require_auth, require_role
from search_engine import search_engine
from seed_data import SEED_ENTRIES

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def create_app():
    app = Flask(__name__)
    CORS(app)  # allow the frontend (served separately) to call this API

    instance_path = os.path.join(BASE_DIR, "instance")
    os.makedirs(instance_path, exist_ok=True)

    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(instance_path, 'nyaya_sahayak.db')}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["JWT_SECRET_KEY"] = os.environ.get(
        "JWT_SECRET_KEY", "dev-secret-key-change-this-in-production-9f8a7d6c"
    )

    db.init_app(app)

    with app.app_context():
        db.create_all()
        _seed_if_empty()
        _rebuild_search_index()

    register_routes(app)
    return app


def _seed_if_empty():
    """Populate the DB with curated legal entries + a default admin on first run."""
    if LegalEntry.query.count() == 0:
        for entry_data in SEED_ENTRIES:
            db.session.add(LegalEntry(**entry_data))
        db.session.commit()
        print(f"[seed] Inserted {len(SEED_ENTRIES)} legal entries.")

    if User.query.filter_by(role="admin").count() == 0:
        admin = User(
            full_name="System Admin",
            email="admin@nyayasahayak.gov.in",
            role="admin",
        )
        admin.set_password("Admin@123")
        db.session.add(admin)
        db.session.commit()
        print("[seed] Created default admin: admin@nyayasahayak.gov.in / Admin@123")


def _rebuild_search_index():
    """(Re)fit the TF-IDF index over the current legal_entries table."""
    entries = LegalEntry.query.all()
    search_engine.build_index(entries)
    print(f"[search] Index built over {len(entries)} entries.")


def register_routes(app: Flask):

    # ---------------------------------------------------------------------
    # Health check
    # ---------------------------------------------------------------------
    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "service": "Nyaya Sahayak API"})

    # ---------------------------------------------------------------------
    # AUTH
    # ---------------------------------------------------------------------
    @app.route("/api/auth/register", methods=["POST"])
    def register():
        data = request.get_json(silent=True) or {}
        full_name = (data.get("full_name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        role = (data.get("role") or "citizen").strip().lower()
        nationality = (data.get("nationality") or "").strip() or None

        if not full_name or not email or not password:
            return jsonify({"error": "full_name, email, and password are required"}), 400

        if role not in ("citizen", "tourist"):
            # Admin accounts are never created via public self-registration.
            return jsonify({"error": "role must be 'citizen' or 'tourist'"}), 400

        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        if User.query.filter_by(email=email).first():
            return jsonify({"error": "An account with this email already exists"}), 409

        user = User(full_name=full_name, email=email,
                    role=role, nationality=nationality)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        token = generate_token(user)
        return jsonify({"token": token, "user": user.to_dict()}), 201

    @app.route("/api/auth/login", methods=["POST"])
    def login():
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not email or not password:
            return jsonify({"error": "email and password are required"}), 400

        user = User.query.filter_by(email=email).first()
        if not user or not user.check_password(password):
            return jsonify({"error": "Invalid email or password"}), 401

        token = generate_token(user)
        return jsonify({"token": token, "user": user.to_dict()})

    @app.route("/api/auth/me", methods=["GET"])
    @require_auth
    def me():
        return jsonify({"user": g.current_user.to_dict()})

    # ---------------------------------------------------------------------
    # LEGAL SEARCH (the core AI-style feature)
    # ---------------------------------------------------------------------
    @app.route("/api/search", methods=["POST"])
    @require_auth
    def search_legal():
        data = request.get_json(silent=True) or {}
        query = (data.get("query") or "").strip()

        if not query:
            return jsonify({"error": "query is required"}), 400
        if len(query) > 500:
            return jsonify({"error": "query is too long (max 500 characters)"}), 400

        results = search_engine.search(query, top_k=5, min_score=0.05)

        if not results:
            return jsonify({
                "query": query,
                "results": [],
                "message": "No close matches found in the knowledge base. Try rephrasing, "
                "or describe the situation differently (e.g. who's involved, what happened).",
            })

        entries_by_id = {
            e.id: e for e in LegalEntry.query.filter(
                LegalEntry.id.in_([eid for eid, _ in results])
            ).all()
        }

        enriched = [
            {**entries_by_id[eid].to_dict(), "match_score": round(score, 3)}
            for eid, score in results
            if eid in entries_by_id
        ]

        return jsonify({"query": query, "results": enriched})

    # ---------------------------------------------------------------------
    # RIGHTS EXPLAINER (browse by category)
    # ---------------------------------------------------------------------
    @app.route("/api/categories", methods=["GET"])
    def list_categories():
        categories = db.session.query(LegalEntry.category).distinct().all()
        return jsonify({"categories": sorted(c[0] for c in categories)})

    @app.route("/api/entries", methods=["GET"])
    def list_entries():
        category = request.args.get("category")
        tourist_only = request.args.get("tourist_only") == "true"

        q = LegalEntry.query
        if category:
            q = q.filter_by(category=category)
        if tourist_only:
            q = q.filter_by(tourist_relevant=True)

        entries = q.order_by(LegalEntry.category, LegalEntry.id).all()
        return jsonify({"entries": [e.to_dict() for e in entries]})

    @app.route("/api/entries/<int:entry_id>", methods=["GET"])
    def get_entry(entry_id):
        entry = LegalEntry.query.get_or_404(entry_id)
        return jsonify({"entry": entry.to_dict()})

    # ---------------------------------------------------------------------
    # SAVED QUERY HISTORY (citizen + tourist)
    # ---------------------------------------------------------------------
    @app.route("/api/saved-queries", methods=["GET"])
    @require_auth
    def list_saved_queries():
        items = (
            SavedQuery.query.filter_by(user_id=g.current_user.id)
            .order_by(SavedQuery.created_at.desc())
            .all()
        )
        return jsonify({"saved_queries": [s.to_dict() for s in items]})

    @app.route("/api/saved-queries", methods=["POST"])
    @require_auth
    def create_saved_query():
        data = request.get_json(silent=True) or {}
        legal_entry_id = data.get("legal_entry_id")
        query_text = (data.get("query_text") or "").strip()
        match_score = data.get("match_score")

        if not legal_entry_id or not query_text:
            return jsonify({"error": "legal_entry_id and query_text are required"}), 400

        entry = LegalEntry.query.get(legal_entry_id)
        if not entry:
            return jsonify({"error": "legal_entry_id does not exist"}), 404

        saved = SavedQuery(
            user_id=g.current_user.id,
            legal_entry_id=legal_entry_id,
            query_text=query_text,
            match_score=match_score,
        )
        db.session.add(saved)
        db.session.commit()
        return jsonify({"saved_query": saved.to_dict()}), 201

    @app.route("/api/saved-queries/<int:saved_id>", methods=["DELETE"])
    @require_auth
    def delete_saved_query(saved_id):
        saved = SavedQuery.query.get_or_404(saved_id)
        if saved.user_id != g.current_user.id:
            return jsonify({"error": "Forbidden: not your saved query"}), 403

        db.session.delete(saved)
        db.session.commit()
        return jsonify({"message": "Deleted"})

    # ---------------------------------------------------------------------
    # ADMIN: manage the legal knowledge base
    # ---------------------------------------------------------------------
    @app.route("/api/admin/entries", methods=["POST"])
    @require_auth
    @require_role("admin")
    def admin_create_entry():
        data = request.get_json(silent=True) or {}
        required = ["situation", "category", "verdict", "simple_explanation",
                    "legal_explanation", "law_reference", "your_rights", "what_to_do_next"]
        missing = [f for f in required if not (data.get(f) or "").strip()]
        if missing:
            return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

        entry = LegalEntry(
            situation=data["situation"].strip(),
            category=data["category"].strip().lower(),
            verdict=data["verdict"].strip().lower(),
            simple_explanation=data["simple_explanation"].strip(),
            legal_explanation=data["legal_explanation"].strip(),
            law_reference=data["law_reference"].strip(),
            your_rights=data["your_rights"].strip(),
            exceptions=(data.get("exceptions") or "").strip() or None,
            what_to_do_next=data["what_to_do_next"].strip(),
            keywords=(data.get("keywords") or "").strip() or None,
            tourist_relevant=bool(data.get("tourist_relevant", False)),
        )
        db.session.add(entry)
        db.session.commit()
        _rebuild_search_index()  # keep search index in sync with new knowledge

        return jsonify({"entry": entry.to_dict()}), 201

    @app.route("/api/admin/entries/<int:entry_id>", methods=["PUT"])
    @require_auth
    @require_role("admin")
    def admin_update_entry(entry_id):
        entry = LegalEntry.query.get_or_404(entry_id)
        data = request.get_json(silent=True) or {}

        editable_fields = [
            "situation", "category", "verdict", "simple_explanation",
            "legal_explanation", "law_reference", "your_rights",
            "exceptions", "what_to_do_next", "keywords",
        ]
        for field in editable_fields:
            if field in data:
                value = data[field]
                setattr(entry, field, value.strip()
                        if isinstance(value, str) else value)

        if "tourist_relevant" in data:
            entry.tourist_relevant = bool(data["tourist_relevant"])

        db.session.commit()
        _rebuild_search_index()

        return jsonify({"entry": entry.to_dict()})

    @app.route("/api/admin/entries/<int:entry_id>", methods=["DELETE"])
    @require_auth
    @require_role("admin")
    def admin_delete_entry(entry_id):
        entry = LegalEntry.query.get_or_404(entry_id)
        db.session.delete(entry)
        db.session.commit()
        _rebuild_search_index()
        return jsonify({"message": "Entry deleted"})

    @app.route("/api/admin/users", methods=["GET"])
    @require_auth
    @require_role("admin")
    def admin_list_users():
        users = User.query.order_by(User.created_at.desc()).all()
        return jsonify({"users": [u.to_dict() for u in users]})

    @app.route("/api/admin/stats", methods=["GET"])
    @require_auth
    @require_role("admin")
    def admin_stats():
        return jsonify({
            "total_users": User.query.count(),
            "total_citizens": User.query.filter_by(role="citizen").count(),
            "total_tourists": User.query.filter_by(role="tourist").count(),
            "total_entries": LegalEntry.query.count(),
            "total_saved_queries": SavedQuery.query.count(),
        })


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)
