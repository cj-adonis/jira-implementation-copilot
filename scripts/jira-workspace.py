"""Preserve task fields in managing-jira search output for this process only.

The installed CLI still owns authentication, requests, site checks, and pagination.
No installed files are changed.
"""
import json
from pathlib import Path
import runpy
import sys


def task_search_result(data):
    names = ("summary", "status", "priority", "duedate", "resolution", "assignee", "updated", "labels", "issuelinks")
    return {"total": data.get("total", 0), "issues": [
        {"key": issue.get("key"), "fields": {name: issue.get("fields", {}).get(name) for name in names}}
        for issue in data.get("issues", [])
    ]}


def main(argv):
    if len(argv) < 3 or argv[1] != "jira" or argv[2] not in ("search", "get-issue"):
        raise ValueError("This adapter only supports managing-jira task reads.")
    script = Path(argv[0]).resolve(strict=True)
    if "--site" not in argv[3:]:
        raise ValueError("An explicit Jira site is required.")
    sys.path.insert(0, str(script.parent))
    from engine.commands import jira_issues
    original_simplify = jira_issues.simplify_issue

    def simplify_with_category(issue):
        result = original_simplify(issue)
        result["statusCategory"] = ((issue.get("fields", {}).get("status") or {}).get("statusCategory") or {}).get("key")
        return result

    jira_issues.simplify_issue = simplify_with_category
    for command in jira_issues.COMMANDS:
        if command.name == "search":
            command.transform = task_search_result
    sys.argv = [str(script), *argv[1:]]
    runpy.run_path(str(script), run_name="__main__")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (ValueError, OSError) as error:
        print(json.dumps({"error": str(error), "hint": "Check the managing-jira installation."}), file=sys.stderr)
        sys.exit(1)
