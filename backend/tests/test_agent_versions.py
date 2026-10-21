from app.services.agent_versions import (
    agent_version_counters_trusted,
    published_agent_version,
    update_required_minimum,
)


def _publish(directory, version):
    (directory / "latest.yml").write_text(
        f"version: {version}\nfiles:\n  - url: KhaliduoSetup.exe\n", encoding="utf-8"
    )


def test_published_version_is_read_from_the_manifest(tmp_path):
    assert published_agent_version(tmp_path) is None
    _publish(tmp_path, "1.1.102")
    assert published_agent_version(tmp_path) == "1.1.102"


def test_forcing_raises_the_floor_to_the_published_release(tmp_path):
    _publish(tmp_path, "1.1.102")
    assert (
        update_required_minimum("1.1.96", force_latest=True, update_directory=tmp_path)
        == "1.1.102"
    )
    assert (
        update_required_minimum("1.1.96", force_latest=False, update_directory=tmp_path)
        == "1.1.96"
    )


def test_a_configured_floor_above_the_release_still_wins(tmp_path):
    _publish(tmp_path, "1.1.102")
    assert (
        update_required_minimum("1.2.0", force_latest=True, update_directory=tmp_path)
        == "1.2.0"
    )


def test_no_manifest_keeps_the_configured_floor(tmp_path):
    assert (
        update_required_minimum("1.1.96", force_latest=True, update_directory=tmp_path)
        == "1.1.96"
    )


def test_publishing_a_release_does_not_change_counter_trust():
    # Counter trust only uses the configured floor, so 1.1.101 stays trusted
    # even after 1.1.102 is published and forced.
    assert agent_version_counters_trusted("1.1.101", "1.1.96") is True
