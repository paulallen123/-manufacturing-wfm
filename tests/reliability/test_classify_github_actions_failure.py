from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "reliability" / "classify_github_actions_failure.py"
spec = spec_from_file_location("actions_failure_classifier", MODULE_PATH)
module = module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_empty_failed_job_is_control_plane_failure():
    run = {"status": "completed", "conclusion": "failure"}
    jobs = {"jobs": [{"conclusion": "failure", "steps": [], "logs_url": None}]}
    assert module.classify(run, jobs) == module.CONTROL_PLANE


def test_failed_step_is_product_or_test_failure():
    run = {"status": "completed", "conclusion": "failure"}
    jobs = {"jobs": [{"conclusion": "failure", "steps": [{"name": "test", "conclusion": "failure"}], "logs_url": "present"}]}
    assert module.classify(run, jobs) == module.PRODUCT_OR_TEST


def test_success_is_not_failed():
    run = {"status": "completed", "conclusion": "success"}
    jobs = {"jobs": [{"conclusion": "success", "steps": [{"name": "test", "conclusion": "success"}]}]}
    assert module.classify(run, jobs) == module.NOT_FAILED


def test_no_jobs_is_unknown_not_product_failure():
    run = {"status": "completed", "conclusion": "failure"}
    jobs = {"jobs": []}
    assert module.classify(run, jobs) == module.UNKNOWN
