from app.core import database


class FakePostgresConnection:
    def __init__(self):
        self.statements = []

    def execute(self, statement, parameters=None):
        self.statements.append((statement, parameters))
        return self


def test_postgres_auth_context_survives_repository_commits(monkeypatch):
    import psycopg

    connection = FakePostgresConnection()
    monkeypatch.setenv("DATABASE_URL", "postgresql://example.invalid/test")
    monkeypatch.setattr(database, "get_current_user_id", lambda: "d49d9514-0b21-4653-981f-c26f67a0be9d")
    monkeypatch.setattr(psycopg, "connect", lambda *args, **kwargs: connection)

    result = database._connect_postgres()

    assert result is connection
    assert connection.statements == [
        ("SET ROLE authenticated", None),
        (
            "SELECT set_config('request.jwt.claim.sub', %s, false)",
            ("d49d9514-0b21-4653-981f-c26f67a0be9d",),
        ),
        (
            "SELECT set_config('request.jwt.claims', %s, false)",
            ('{"role":"authenticated","sub":"d49d9514-0b21-4653-981f-c26f67a0be9d"}',),
        ),
    ]
