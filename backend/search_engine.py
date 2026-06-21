"""
Legal Search Engine — TF-IDF + cosine similarity ranking.

This is the "AI-powered" part of the app, built without any external API
dependency so the project runs anywhere with zero API keys.

How it works (good to know for interviews):
1. Every LegalEntry in the DB is converted into a text "document"
   (situation + category + explanations + keywords).
2. scikit-learn's TfidfVectorizer turns all documents into weighted
   term-frequency vectors, down-weighting common words and boosting
   distinctive legal terms.
3. A user's natural-language query is vectorized with the SAME fitted
   vectorizer, then compared against every document using cosine
   similarity — a measure of how "directionally similar" two vectors are.
4. Results are ranked by similarity score and the top matches are returned.

This is a real, explainable information-retrieval technique (the same
family of idea behind early search engines) — not a black box.
"""
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# A small set of legal/civic stopwords on top of sklearn's English defaults,
# so common question phrasing doesn't dilute the match.
CUSTOM_STOPWORDS = [
    "can", "does", "is", "are", "my", "me", "the", "a", "an", "to", "in",
    "of", "for", "if", "what", "should", "do", "i", "without", "would",
]


class LegalSearchEngine:
    def __init__(self):
        self.vectorizer = None
        self.doc_matrix = None
        self.entry_ids = []  # parallel array: row i in doc_matrix -> entry_ids[i]

    def build_index(self, entries):
        """
        Fit the TF-IDF vectorizer on the current knowledge base.
        Call this at startup and after any admin edits to the DB.

        entries: list of LegalEntry ORM objects
        """
        if not entries:
            self.vectorizer = None
            self.doc_matrix = None
            self.entry_ids = []
            return

        documents = [e.searchable_text() for e in entries]
        self.entry_ids = [e.id for e in entries]

        # sklearn doesn't let you pass a custom list *and* 'english' together,
        # so we extend the built-in English stopword list manually.
        from sklearn.feature_extraction import text as sk_text
        combined_stopwords = list(
            sk_text.ENGLISH_STOP_WORDS.union(CUSTOM_STOPWORDS))

        self.vectorizer = TfidfVectorizer(
            stop_words=combined_stopwords,
            # unigrams + bigrams catch phrases like "no notice"
            ngram_range=(1, 2),
            max_features=5000,
            sublinear_tf=True,     # log-scaled term frequency, standard IR practice
        )
        self.doc_matrix = self.vectorizer.fit_transform(documents)

    def search(self, query: str, top_k: int = 5, min_score: float = 0.05):
        """
        Returns a list of (entry_id, score) tuples, ranked by relevance,
        filtered to a minimum similarity threshold so unrelated queries
        don't return noise.
        """
        if not query or not query.strip() or self.vectorizer is None:
            return []

        query_vector = self.vectorizer.transform([query])
        similarities = cosine_similarity(
            query_vector, self.doc_matrix).flatten()

        ranked_indices = similarities.argsort()[::-1][:top_k]
        results = [
            (self.entry_ids[i], float(similarities[i]))
            for i in ranked_indices
            if similarities[i] >= min_score
        ]
        return results


# Module-level singleton, rebuilt on app startup and after admin DB writes.
search_engine = LegalSearchEngine()
