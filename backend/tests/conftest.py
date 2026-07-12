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
