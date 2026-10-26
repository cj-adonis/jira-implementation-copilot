"""Local adapter tests; no live Jira requests or browser authentication."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("workspace", Path(__file__).with_name("jira-workspace.py"))
workspace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workspace)


class SearchFieldsTest(unittest.TestCase):
    def test_keeps_task_fields_and_total(self):
        fields = {"summary": "Task", "priority": {"name": "High"}, "duedate": "2026-10-26", "status": {"name": "Review", "statusCategory": {"key": "indeterminate"}}, "labels": ["blocked"]}
        result = workspace.task_search_result({"total": 51, "issues": [{"key": "TEST-1", "fields": fields}]})
        self.assertEqual(result["total"], 51)
        for name, value in fields.items():
            self.assertEqual(result["issues"][0]["fields"][name], value)

    def test_empty_results(self):
        self.assertEqual(workspace.task_search_result({"total": 0, "issues": []}), {"total": 0, "issues": []})


if __name__ == "__main__":
    unittest.main()
