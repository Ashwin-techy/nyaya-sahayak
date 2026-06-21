"""
Database models for Nyaya Sahayak.

Three core entities:
- User: citizens, tourists, and admins (role-based)
- LegalEntry: the curated knowledge base the search engine queries
- SavedQuery: a citizen/tourist's bookmarked search results
"""
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)

    # RBAC: 'citizen' | 'tourist' | 'admin'
    role = db.Column(db.String(20), nullable=False, default="citizen")

    # Tourist-specific optional fields
    nationality = db.Column(db.String(80), nullable=True)

    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))

    saved_queries = db.relationship(
        "SavedQuery", backref="user", lazy=True, cascade="all, delete-orphan"
    )

    def set_password(self, raw_password: str) -> None:
        self.password_hash = generate_password_hash(raw_password)

    def check_password(self, raw_password: str) -> bool:
        return check_password_hash(self.password_hash, raw_password)

    def to_dict(self):
        return {
            "id": self.id,
            "full_name": self.full_name,
            "email": self.email,
            "role": self.role,
            "nationality": self.nationality,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class LegalEntry(db.Model):
    """
    A single unit of legal knowledge: a plain-language question/situation,
    mapped to explanations and the actual law. This table is what the
    TF-IDF search engine indexes and what Admins manage via the Admin panel.
    """
    __tablename__ = "legal_entries"

    id = db.Column(db.Integer, primary_key=True)

    # Searchable situation, e.g. "Can police check my phone without permission?"
    situation = db.Column(db.String(300), nullable=False)

    # Category for browsing: police, tenant, consumer, tourist, cybercrime, women_safety, traffic, property
    category = db.Column(db.String(40), nullable=False, index=True)

    # legal | illegal | conditional
    verdict = db.Column(db.String(20), nullable=False)

    simple_explanation = db.Column(db.Text, nullable=False)
    legal_explanation = db.Column(db.Text, nullable=False)

    # e.g. "Section 100, Bharatiya Nagarik Suraksha Sanhita (BNSS), 2023"
    law_reference = db.Column(db.String(300), nullable=False)

    your_rights = db.Column(db.Text, nullable=False)
    exceptions = db.Column(db.Text, nullable=True)
    what_to_do_next = db.Column(db.Text, nullable=False)

    # Extra free-text keywords to widen search recall beyond the situation text
    keywords = db.Column(db.String(400), nullable=True)

    tourist_relevant = db.Column(db.Boolean, default=False)

    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "situation": self.situation,
            "category": self.category,
            "verdict": self.verdict,
            "simple_explanation": self.simple_explanation,
            "legal_explanation": self.legal_explanation,
            "law_reference": self.law_reference,
            "your_rights": self.your_rights,
            "exceptions": self.exceptions,
            "what_to_do_next": self.what_to_do_next,
            "keywords": self.keywords,
            "tourist_relevant": self.tourist_relevant,
        }

    def searchable_text(self) -> str:
        """Concatenated text used as the document for TF-IDF vectorization."""
        parts = [
            self.situation,
            self.category,
            self.simple_explanation,
            self.legal_explanation,
            self.keywords or "",
        ]
        return " ".join(p for p in parts if p)


class SavedQuery(db.Model):
    """A user's bookmarked search: the question they asked + which entry answered it."""
    __tablename__ = "saved_queries"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    legal_entry_id = db.Column(db.Integer, db.ForeignKey(
        "legal_entries.id"), nullable=False)

    # what the user actually typed
    query_text = db.Column(db.String(300), nullable=False)
    # search relevance score at save time
    match_score = db.Column(db.Float, nullable=True)

    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc))

    legal_entry = db.relationship("LegalEntry", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "query_text": self.query_text,
            "match_score": self.match_score,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "entry": self.legal_entry.to_dict() if self.legal_entry else None,
        }
