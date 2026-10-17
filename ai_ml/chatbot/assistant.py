
import requests

BACKEND_URL = "http://127.0.0.1:5000"


def fetch_json(path):
    try:
        response = requests.get(
            f"{BACKEND_URL}{path}",
            timeout=5
        )
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return None


def money(value):
    return f"₹{float(value or 0):,.2f}"


def get_response(message, context=None):
    context = context or {}
    message = message.strip().lower()

    workspace_id = context.get("workspaceId", "")
    active_id = context.get("activeProjectId", "")
    projects = context.get("projects", [])
    history = context.get("history", [])

    if not workspace_id:
        return "I need your workspace information to find your saved projects."

    if not isinstance(projects, list):
        projects = []

    
    search_text = message + " " + " ".join(
    item.get("text", "")
    for item in history[-8:]
    if isinstance(item, dict)
    and item.get("role") == "user"
    )
    search_text = search_text.lower()

    selected = None
    for project in projects:
        name = str(project.get("name", "")).strip()
        if name and name.lower() in search_text:
            selected = project

    # Otherwise, use the currently selected house.
    if selected is None:
        selected = next(
            (p for p in projects if p.get("id") == active_id),
            None
        )

    if message in {"hi", "hello", "hey", "hello there"}:
        return (
            "Hello! I'm your Painting Assistant. "
            "Ask me about your projects, measurements, "
            "quotations, expenses, or labour attendance."
        )

    if not projects:
        return (
            "I couldn't find project details in the current app context. "
            "Please reopen the chat after your projects finish loading."
        )

    # List all projects or show an overview.
    if any(word in message for word in [
        "all projects", "my projects", "list projects",
        "show projects", "how many projects", "my houses"
    ]):
        summaries = fetch_json(
            f"/api/projects/{workspace_id}/summary"
        )

        if summaries is None:
            return "I couldn't connect to your project database. Please check that the main backend is running."

        rows = summaries.get("projects", [])
        if not rows:
            return "There are no saved projects in your workspace."

        lines = [f"You have {len(rows)} saved project(s):"]
        for p in rows:
            lines.append(
                f"- {p['name']} | Status: {p['status']} | "
                f"Quotation: {money(p.get('quotationAmount'))} | "
                f"Expenses: {money(p.get('expenses'))} | "
                f"Payments: {money(p.get('payments'))}"
            )
        return "\n".join(lines)

    # Find a particular house.
    if selected is None:
        return (
            "I couldn't identify that house. Please use one of these "
            "project names: " + ", ".join(
                str(p.get("name", "Unnamed")) for p in projects
            )
        )

    project_id = selected.get("id")
    project_name = selected.get("name", "Your project")

    project_info = (
        f"/api/projects/{workspace_id}/{project_id}/data"
    )
    measurements_path = f"/api/measurements/{project_id}"

    # Measurements
    if any(word in message for word in [
        "measurement", "measurements", "wall", "walls",
        "area", "length", "width", "height", "ceiling",
        "paintable", "coverage", "coats"
    ]):
        result = fetch_json(measurements_path)
        measurements = result.get("measurements") if result else None

        if not measurements:
            return f"No saved measurements were found for {project_name}."

        lines = [f"Saved measurements for {project_name}:"]

        for wall in measurements.get("walls", []):
            lines.append(
                f"- {wall.get('name', 'Wall')}: "
                f"Length {wall.get('length')}, "
                f"Height {wall.get('height')}"
            )

        for opening in measurements.get("openings", []):
            lines.append(
                f"- {opening.get('name', 'Opening')}: "
                f"{opening.get('width')} × {opening.get('height')}, "
                f"Quantity {opening.get('quantity')}"
            )

        lines.extend([
            f"- Paintable area: {measurements.get('paintableArea')}",
            f"- Area source: {measurements.get('areaSource')}",
            f"- Paint product: {measurements.get('selectedPaintProduct')}",
            f"- Coats: {measurements.get('coats')}",
            f"- Coverage: {measurements.get('coverage')} per litre"
        ])
        return "\n".join(lines)

    # Quotation, expenses, payments, outstanding balance
    if any(word in message for word in [
        "quotation", "quote", "cost", "expense", "expenses",
        "spent", "payment", "payments", "outstanding",
        "balance", "profit"
    ]):
        result = fetch_json(project_info)
        data = result.get("data") if result else None

        if data is None:
            return f"No saved quotation or financial records were found for {project_name}."

        quotation = float(data.get("quotationAmount", 0) or 0)
        expenses = sum(
            float(item.get("amount", 0) or 0)
            for item in data.get("expenses", [])
        )
        payments = sum(
            float(item.get("amount", 0) or 0)
            for item in data.get("payments", [])
        )

        if "expense" in message or "spent" in message:
            return f"Total recorded expenses for {project_name}: {money(expenses)}."

        if "payment" in message:
            return f"Total recorded payments for {project_name}: {money(payments)}."

        if "outstanding" in message or "balance" in message:
            return (
                f"{project_name}:\n"
                f"- Quotation: {money(quotation)}\n"
                f"- Payments received: {money(payments)}\n"
                f"- Outstanding quotation balance: {money(quotation - payments)}"
            )

        return (
            f"Financial summary for {project_name}:\n"
            f"- Quotation: {money(quotation)}\n"
            f"- Expenses: {money(expenses)}\n"
            f"- Payments received: {money(payments)}\n"
            f"- Outstanding quotation balance: {money(quotation - payments)}"
        )

    # General project details
    return (
        f"Current project: {project_name}\n"
        f"- Customer: {selected.get('customerName') or 'Not provided'}\n"
        f"- Location: {selected.get('location') or 'Not provided'}\n"
        f"- Status: {selected.get('status') or 'Not provided'}\n"
        f"- Deadline: {selected.get('deadline') or 'Not provided'}\n\n"
        "You can ask about this project's measurements, quotation, "
        "expenses, payments, or outstanding balance."
    )
