import json
from subprocess import CompletedProcess

from dotenv import dotenv_values
import pytest

from scripts.restore_salary_key import restore_key


def test_restore_only_changes_salary_key_without_printing_it(tmp_path, capsys):
    env_file = tmp_path / ".env"
    env_file.write_text("# keep this\nDATABASE_URL=unchanged\nJWT_SECRET_KEY=keep-jwt\n")
    key = "test-only-key-with-apostrophe-'" + "x" * 40

    def ssh(args, **kwargs):
        assert args[0] == "ssh"
        assert "StrictHostKeyChecking=yes" in args
        assert key not in str(args)
        return CompletedProcess(args, 0, json.dumps({"salary_key": key}))

    restore_key(env_file, "user@test.invalid", "/app", runner=ssh)
    values = dotenv_values(env_file)
    assert values["SALARY_ENCRYPTION_KEY"] == key
    assert values["JWT_SECRET_KEY"] == "keep-jwt"
    assert values["DATABASE_URL"] == "unchanged"
    assert "# keep this" in env_file.read_text()
    captured = capsys.readouterr()
    assert key not in captured.out + captured.err


def test_existing_key_is_never_overwritten(tmp_path):
    env_file = tmp_path / ".env"
    content = "SALARY_ENCRYPTION_KEY=keep-existing\n"
    env_file.write_text(content)

    def ssh(*args, **kwargs):
        pytest.fail("Must not contact SSH when a local key already exists")

    with pytest.raises(RuntimeError, match="not replaced"):
        restore_key(env_file, "user@test.invalid", "/app", runner=ssh)
    assert env_file.read_text() == content


@pytest.mark.parametrize("status,output", [(255, ""), (0, "not-json"), (0, '{"salary_key":"short"}')])
def test_failed_restore_does_not_change_local_file(tmp_path, status, output):
    env_file = tmp_path / ".env"
    content = "DATABASE_URL=unchanged\n"
    env_file.write_text(content)
    with pytest.raises(RuntimeError, match="not changed"):
        restore_key(env_file, "user@test.invalid", "/app",
                    runner=lambda args, **kwargs: CompletedProcess(args, status, output))
    assert env_file.read_text() == content
