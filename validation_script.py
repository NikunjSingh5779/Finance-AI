#!/usr/bin/env python3
"""
Validation script for Finance AI application.
This script checks the application structure, runs tests, and validates endpoints.
"""
import subprocess
import sys
import os
from pathlib import Path

def run_command(command, cwd=None, capture_output=True, text=True):
    """Run a command and return the result."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            capture_output=capture_output,
            text=text,
            timeout=60
        )
        return result
    except subprocess.TimeoutExpired:
        return None
    except Exception as e:
        print(f"Error running command '{command}': {e}")
        return None

def main():
    print("=" * 60)
    print("FINANCE AI FINAL VALIDATION")
    print("=" * 60)

    # Change to the project directory
    project_dir = Path(__file__).parent
    os.chdir(project_dir)

    # 1. Git status and diff
    print("\n1. GIT STATUS AND DIFF")
    print("-" * 30)
    result = run_command("git status")
    if result:
        print(result.stdout)

    result = run_command("git diff --stat")
    if result:
        print(result.stdout)

    result = run_command("git diff --name-status")
    if result:
        print(result.stdout)

    # 2. Package structure check
    print("\n2. PACKAGE STRUCTURE CHECK")
    print("-" * 30)
    # Add current directory to Python path
    sys.path.insert(0, str(project_dir))

    try:
        import app
        import app.main
        print("✓ Basic imports: OK")
    except Exception as e:
        print(f"✗ Basic imports failed: {e}")
        return 1

    # Check key modules
    modules_to_check = [
        "app.core.database",
        "app.core.rate_limiter",
        "app.utils.web_search",
        "app.services.transaction_service",
        "app.services.account_service",
        app.services.budget_service,
        app.services.analytics_service,
        app.services.forecast_service,
        app.services.ai_service,
        app.repositories.transaction_repository,
        app.repositories.account_repository,
        app.repositories.budget_repository,
        app.controllers.transaction_controller,
        app.controllers.account_controller,
        app.controllers.budget_controller,
        app.controllers.analysis_controller,
        app.controllers.general_controller,
        app.controllers.ai_controller,
        app.controllers.market_controller,
    ]

    for module in modules_to_check:
        try:
            __import__(module)
            print(f"✓ {module}")
        except Exception as e:
            print(f"✗ {module}: {e}")

    # 3. Run tests
    print("\n3. RUNNING TESTS")
    print("-" * 30)
    result = run_command("python -m pytest tests/ -v")
    if result:
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        if result.returncode != 0:
            print(f"✗ Tests failed with return code {result.returncode}")
        else:
            print("✓ All tests passed")
    else:
        print("✗ Failed to run tests")

    # 4. Run linting
    print("\n4. RUNNING LINTING (FLAKE8)")
    print("-" * 30)
    result = run_command("flake8 .")
    if result:
        if result.stdout:
            print("FLAKE8 OUTPUT:")
            print(result.stdout)
        if result.stderr:
            print("FLAKE8 STDERR:")
            print(result.stderr)
        if result.returncode == 0:
            print("✓ No flake8 errors")
        else:
            print(f"✗ Flake8 found issues (return code {result.returncode})")
    else:
        print("✗ Failed to run flake8")

    # 5. Test endpoints using TestClient
    print("\n5. TESTING ENDPOINTS WITH TESTCLIENT")
    print("-" * 30)
    try:
        from app.main import app
        from fastapi.testclient import TestClient

        client = TestClient(app)

        # Test health endpoint
        print("Testing /health...")
        response = client.get("/health")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            print(f"  Response: {response.json()}")
            health_ok = True
        else:
            print(f"  Error: {response.text}")
            health_ok = False

        # Test accounts endpoint
        print("Testing /accounts...")
        response = client.get("/accounts")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            print(f"  Response: {response.json()}")
            accounts_ok = True
        else:
            print(f"  Error: {response.text}")
            accounts_ok = False

        # Test transactions endpoint
        print("Testing /transactions...")
        response = client.get("/transactions")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            print(f"  Response: {response.json()}")
            transactions_ok = True
        else:
            print(f"  Error: {response.text}")
            transactions_ok = False

        # Test summary endpoint
        print("Testing /summary...")
        response = client.get("/summary")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            print(f"  Response: {response.json()}")
            summary_ok = True
        else:
            print(f"  Error: {response.text}")
            summary_ok = False

        # Test budgets endpoint
        print("Testing /budgets...")
        response = client.get("/budgets")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            print(f"  Response: {response.json()}")
            budgets_ok = True
        else:
            print(f"  Error: {response.text}")
            budgets_ok = False

        # Test predict-expense endpoint
        print("Testing /predict-expense...")
        response = client.get("/predict-expense")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            print(f"  Response: {response.json()}")
            predict_ok = True
        else:
            print(f"  Error: {response.text}")
            predict_ok = False

        # Overall endpoint test result
        endpoint_tests = [health_ok, accounts_ok, transactions_ok, summary_ok, budgets_ok, predict_ok]
        if all(endpoint_tests):
            print("\n✓ All endpoint tests passed")
        else:
            print(f"\n✗ Some endpoint tests failed: {endpoint_tests}")

    except Exception as e:
        print(f"✗ Endpoint testing failed: {e}")

    print("\n" + "=" * 60)
    print("VALIDATION COMPLETE")
    print("=" * 60)

    return 0

if __name__ == "__main__":
    sys.exit(main())