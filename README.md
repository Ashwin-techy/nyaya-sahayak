# Nyaya Sahayak (न्याय सहायक) — AI-Style Legal Rights Assistant

A full-stack web app that helps Indian citizens and tourists understand their legal rights in everyday situations — police interactions, tenant disputes, consumer rights, cybercrime, and more — using a TF-IDF-based semantic search engine and a curated legal knowledge base.

> ⚠️ **Disclaimer:** Built for educational/portfolio purposes. Legal content is curated from general, well-known Indian legal principles and is **not verified by a licensed advocate**. Not a substitute for professional legal advice.

## Live Demo

- Frontend: _[add Render link here after deployment]_
- Backend API: _[add Render link here after deployment]_
- Demo admin login: `admin@nyayasahayak.gov.in` / `Admin@123`

## What it does

- **Plain-language legal search** — type a real situation ("Can a police officer check my phone without permission?") and get a ranked answer with a clear verdict (Legal / Illegal / Conditional), the actual law section, your rights, exceptions, and next steps.
- **Three-tier role-based access (RBAC)** — Citizen, Tourist, and Admin roles, each with different permissions enforced via JWT on every protected backend route.
- **Tourist Mode** — emergency helpline numbers and common scam warnings shown automatically for tourist accounts.
- **Saved query history** — citizens/tourists can save useful answers and revisit them later.
- **Admin console** — full CRUD over the legal knowledge base, with the search index automatically rebuilt after every change, plus a live stats dashboard and user list.

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python, Flask, Flask-SQLAlchemy |
| Auth | JWT (PyJWT) + custom RBAC decorators |
| Database | SQLite |
| Search Engine | scikit-learn (TF-IDF + cosine similarity) |
| Frontend | HTML, CSS, vanilla JavaScript (SPA, no framework) |

## How the search engine works

No external AI API is used — search is powered by a from-scratch implementation of classic information retrieval:

1. Every legal entry (situation + explanation + keywords) is converted into a weighted vector using **TF-IDF** (Term Frequency–Inverse Document Frequency), which down-weights common words and boosts distinctive legal terms.
2. The user's query is vectorized the same way.
3. **Cosine similarity** ranks every entry by how closely it matches the query.
4. Top-ranked results above a relevance threshold are returned.

This makes the search fully explainable and runs entirely offline — no API key, no external dependency, no cost.

## Authorization design

- Stateless JWT auth — no server-side sessions.
- Role (`citizen` / `tourist` / `admin`) is embedded in the JWT but **re-verified against the database on every request**, so a role change takes effect immediately even with an old token.
- `@require_auth` and `@require_role(...)` are composable decorators — each route declares its own access policy directly above the function.
- Admin-only routes (creating/editing/deleting legal entries, viewing all users) are protected at the backend level, not just hidden in the UI.

## Running locally

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
python app.py
```
Runs on `http://localhost:5000`. Database and a default admin account are auto-created on first run.

### Frontend
```bash
cd frontend
python -m http.server 8080
```
Open `http://localhost:8080` in your browser.

## Project structure