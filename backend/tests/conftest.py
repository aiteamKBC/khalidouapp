import os


# Tests must never use production Graph/SMTP credentials from backend-api/.env.
os.environ["APP_ENV"] = "testing"
os.environ["GRAPH_TENANT_ID"] = ""
os.environ["GRAPH_CLIENT_ID"] = ""
os.environ["GRAPH_CLIENT_SECRET"] = ""
os.environ["GRAPH_SENDER"] = ""
os.environ["SMTP_HOST"] = ""
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""

# A bounded PR run and a larger nightly exploration share the same tests.
from hypothesis import settings  # noqa: E402

settings.register_profile("quick", max_examples=25, stateful_step_count=30, deadline=None, print_blob=True)
settings.register_profile("nightly", max_examples=200, stateful_step_count=80, deadline=None, print_blob=True)
settings.load_profile(os.environ.get("KHALIDUO_TEST_PROFILE", "quick"))
