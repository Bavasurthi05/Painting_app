import json
import math
import tempfile
import unittest
import uuid
from pathlib import Path

from app import create_app


class MeasurementApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temporary_directory.name) / "measurements.sqlite3"
        self.app = create_app(
            {
                "TESTING": True,
                "DATABASE": str(database_path),
            }
        )
        self.client = self.app.test_client()
        self.project_id = str(uuid.uuid4())
        self.week_start = "2026-10-12"
        self.measurements = {
            "walls": [
                {"id": 1, "name": "Front wall", "length": "20", "height": "10"}
            ],
            "openings": [
                {
                    "id": 2,
                    "name": "Door",
                    "width": "3",
                    "height": "7",
                    "quantity": 1,
                }
            ],
            "coats": 2,
            "coverage": 100,
            "paintableArea": "",
            "areaSource": "measurements",
            "selectedPaintProduct": "standard",
        }

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_measurements_round_trip_through_sqlite(self) -> None:
        save_response = self.client.put(
            f"/api/measurements/{self.project_id}",
            data=json.dumps(self.measurements),
            content_type="application/json",
        )
        self.assertEqual(save_response.status_code, 200)
        self.assertEqual(save_response.json, {"saved": True})

        load_response = self.client.get(f"/api/measurements/{self.project_id}")
        self.assertEqual(load_response.status_code, 200)
        self.assertEqual(load_response.json["measurements"], self.measurements)
        self.assertTrue(load_response.json["updatedAt"])

    def test_missing_project_returns_empty_measurements(self) -> None:
        response = self.client.get(f"/api/measurements/{self.project_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"measurements": None})

    def test_invalid_measurements_are_rejected(self) -> None:
        invalid_measurements = {**self.measurements, "walls": "not a list"}
        response = self.client.put(
            f"/api/measurements/{self.project_id}",
            data=json.dumps(invalid_measurements),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Walls", response.json["error"])

    def test_non_finite_dimensions_are_rejected(self) -> None:
        invalid_measurements = {
            **self.measurements,
            "walls": [
                {"id": 1, "name": "Wall 1", "length": math.inf, "height": "10"}
            ],
        }
        response = self.client.put(
            f"/api/measurements/{self.project_id}",
            data=json.dumps(invalid_measurements),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_invalid_project_id_is_rejected(self) -> None:
        response = self.client.get("/api/measurements/not-a-uuid")
        self.assertEqual(response.status_code, 400)

    def test_first_house_keeps_existing_workspace_measurements(self) -> None:
        self.client.put(
            f"/api/measurements/{self.project_id}",
            data=json.dumps(self.measurements),
            content_type="application/json",
        )
        attendance = {
            "weekStart": self.week_start,
            "labourers": [
                {
                    "id": "legacy-worker",
                    "name": "Ravi",
                    "dailyWage": "800",
                    "advance": "",
                    "attendance": {"2026-10-12": "present"},
                }
            ],
        }
        self.client.put(
            f"/api/attendance/{self.project_id}",
            data=json.dumps(attendance),
            content_type="application/json",
        )

        projects_response = self.client.get(f"/api/projects/{self.project_id}")
        self.assertEqual(projects_response.status_code, 200)
        first_project = projects_response.json["projects"][0]
        self.assertEqual(first_project["id"], self.project_id)
        self.assertEqual(first_project["name"], "My First House")

        load_response = self.client.get(f"/api/measurements/{first_project['id']}")
        self.assertEqual(load_response.json["measurements"], self.measurements)
        attendance_response = self.client.get(
            f"/api/attendance/{first_project['id']}",
            query_string={"week_start": self.week_start},
        )
        self.assertEqual(
            attendance_response.json["attendance"]["labourers"],
            attendance["labourers"],
        )

    def test_projects_and_project_data_are_isolated_by_house(self) -> None:
        self.client.put(
            f"/api/measurements/{self.project_id}",
            data=json.dumps(self.measurements),
            content_type="application/json",
        )
        self.client.get(f"/api/projects/{self.project_id}")
        payload = {
            "name": "House B",
            "customerName": "Asha",
            "location": "Tiruppur",
            "deadline": "2026-12-01",
            "status": "In progress",
        }
        create_response = self.client.post(
            f"/api/projects/{self.project_id}",
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(create_response.status_code, 201)
        second_project = create_response.json["project"]
        second_measurements = {
            **self.measurements,
            "walls": [
                {"id": 1, "name": "Side wall", "length": "50", "height": "10"}
            ],
        }
        self.client.put(
            f"/api/measurements/{second_project['id']}",
            data=json.dumps(second_measurements),
            content_type="application/json",
        )
        first_attendance = {
            "weekStart": self.week_start,
            "labourers": [
                {
                    "id": "house-a-worker",
                    "name": "Ravi",
                    "dailyWage": "800",
                    "advance": "",
                    "attendance": {},
                }
            ],
        }
        self.client.put(
            f"/api/attendance/{self.project_id}",
            data=json.dumps(first_attendance),
            content_type="application/json",
        )

        saved_data = {
            "paintPrice": 250,
            "materialCost": 500,
            "costEstimateMode": "area-rate",
            "manualPaintCost": "4500",
            "manualMaterialCost": "750",
            "houseCostAreaSource": "manual",
            "manualHouseArea": "1200",
            "costPerSquareFoot": "25",
            "quoteDetails": {
                "ownerName": "Asha",
                "ownerAddress": "Tiruppur",
                "painterName": "Ravi",
                "painterPhone": "0000000000",
                "quotationDate": "2026-10-12",
                "reportType": "quotation",
                "surfaceType": "Exterior",
            },
            "surfaceColours": {
                "walls": "#C8D5C0",
                "borders": "#F4EBDD",
                "windows": "#35483D",
                "doors": "#79543B",
                "gates": "#33463D",
            },
            "quotationAmount": 50000,
            "expenses": [
                {
                    "id": "expense-1",
                    "date": "2026-10-12",
                    "description": "Paint",
                    "amount": 1200,
                }
            ],
            "payments": [
                {
                    "id": "payment-1",
                    "date": "2026-10-13",
                    "description": "Advance",
                    "amount": 10000,
                }
            ],
        }
        save_response = self.client.put(
            f"/api/projects/{self.project_id}/{second_project['id']}/data",
            data=json.dumps(saved_data),
            content_type="application/json",
        )
        self.assertEqual(save_response.status_code, 200)

        first_project_id = self.project_id
        first_data = self.client.get(
            f"/api/projects/{self.project_id}/{first_project_id}/data"
        )
        second_data = self.client.get(
            f"/api/projects/{self.project_id}/{second_project['id']}/data"
        )
        self.assertEqual(first_data.json["data"], None)
        self.assertEqual(second_data.json["data"], saved_data)
        first_measurement_response = self.client.get(
            f"/api/measurements/{self.project_id}"
        )
        second_measurement_response = self.client.get(
            f"/api/measurements/{second_project['id']}"
        )
        self.assertEqual(
            first_measurement_response.json["measurements"],
            self.measurements,
        )
        self.assertEqual(
            second_measurement_response.json["measurements"],
            second_measurements,
        )
        second_attendance_response = self.client.get(
            f"/api/attendance/{second_project['id']}",
            query_string={"week_start": self.week_start},
        )
        self.assertIsNone(second_attendance_response.json["attendance"])
        summary = self.client.get(f"/api/projects/{self.project_id}/summary")
        self.assertEqual(summary.status_code, 200)
        second_summary = next(
            item for item in summary.json["projects"] if item["id"] == second_project["id"]
        )
        self.assertEqual(second_summary["quotationAmount"], 50000)
        self.assertEqual(second_summary["expenses"], 1200)
        self.assertEqual(second_summary["outstanding"], 40000)

        other_workspace = str(uuid.uuid4())
        unauthorized = self.client.get(
            f"/api/projects/{other_workspace}/{second_project['id']}/data"
        )
        self.assertEqual(unauthorized.status_code, 404)

    def test_project_status_validation_and_export(self) -> None:
        self.client.get(f"/api/projects/{self.project_id}")
        invalid_project = {
            "name": "House C",
            "customerName": "",
            "location": "",
            "deadline": "",
            "status": "Archived",
        }
        response = self.client.post(
            f"/api/projects/{self.project_id}",
            data=json.dumps(invalid_project),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        invalid_project["status"] = []
        response = self.client.post(
            f"/api/projects/{self.project_id}",
            data=json.dumps(invalid_project),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

        project_id = self.client.get(
            f"/api/projects/{self.project_id}"
        ).json["projects"][0]["id"]
        attendance = {
            "weekStart": self.week_start,
            "labourers": [
                {
                    "id": "worker-1",
                    "name": "Meena",
                    "dailyWage": "",
                    "advance": "",
                    "attendance": {},
                }
            ],
        }
        self.client.put(
            f"/api/attendance/{project_id}",
            data=json.dumps(attendance),
            content_type="application/json",
        )
        export_response = self.client.get(
            f"/api/projects/{self.project_id}/{project_id}/export"
        )
        self.assertEqual(export_response.status_code, 200)
        self.assertEqual(export_response.json["project"]["id"], project_id)
        self.assertEqual(len(export_response.json["attendance"]), 1)
        self.assertEqual(
            export_response.json["attendance"][0]["labourers"],
            attendance["labourers"],
        )

    def test_weekly_attendance_round_trip_through_sqlite(self) -> None:
        attendance = {
            "weekStart": self.week_start,
            "labourers": [
                {
                    "id": "labour-1",
                    "name": "Ravi",
                    "dailyWage": "800",
                    "advance": "500",
                    "attendance": {
                        "2026-10-12": "present",
                        "2026-10-13": "half-day",
                        "2026-10-14": "absent",
                    },
                }
            ],
        }
        save_response = self.client.put(
            f"/api/attendance/{self.project_id}",
            data=json.dumps(attendance),
            content_type="application/json",
        )
        self.assertEqual(save_response.status_code, 200)
        self.assertEqual(save_response.json, {"saved": True})

        load_response = self.client.get(
            f"/api/attendance/{self.project_id}",
            query_string={"week_start": self.week_start},
        )
        self.assertEqual(load_response.status_code, 200)
        self.assertEqual(load_response.json["attendance"], {"labourers": attendance["labourers"]})
        self.assertTrue(load_response.json["updatedAt"])

    def test_attendance_rejects_negative_advance(self) -> None:
        attendance = {
            "weekStart": self.week_start,
            "labourers": [
                {
                    "id": "labour-1",
                    "name": "Ravi",
                    "dailyWage": "800",
                    "advance": "-1",
                    "attendance": {},
                }
            ],
        }
        response = self.client.put(
            f"/api/attendance/{self.project_id}",
            data=json.dumps(attendance),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Advance", response.json["error"])

    def test_attendance_rejects_status_outside_requested_week(self) -> None:
        attendance = {
            "weekStart": self.week_start,
            "labourers": [
                {
                    "id": "labour-1",
                    "name": "Ravi",
                    "dailyWage": "",
                    "advance": "",
                    "attendance": {"2026-10-19": "present"},
                }
            ],
        }
        response = self.client.put(
            f"/api/attendance/{self.project_id}",
            data=json.dumps(attendance),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_attendance_rejects_unrecognized_status_shapes(self) -> None:
        attendance = {
            "weekStart": self.week_start,
            "labourers": [
                {
                    "id": "labour-1",
                    "name": "Ravi",
                    "dailyWage": "",
                    "advance": "",
                    "attendance": {"2026-10-12": ["present"]},
                }
            ],
        }
        response = self.client.put(
            f"/api/attendance/{self.project_id}",
            data=json.dumps(attendance),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_attendance_requires_a_real_week_start_date(self) -> None:
        response = self.client.get(
            f"/api/attendance/{self.project_id}",
            query_string={"week_start": "2026-99-99"},
        )
        self.assertEqual(response.status_code, 400)

    def test_deleting_house_removes_its_records_and_preserves_other_house(self) -> None:
        workspace_id = self.project_id
        default_project = self.client.get(
            f"/api/projects/{workspace_id}"
        ).json["projects"][0]
        create_response = self.client.post(
            f"/api/projects/{workspace_id}",
            data=json.dumps(
                {
                    "name": "House to remove",
                    "customerName": "",
                    "location": "",
                    "deadline": "",
                    "status": "Not started",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(create_response.status_code, 201)
        removed_project_id = create_response.json["project"]["id"]

        for project_id, length in (
            (default_project["id"], "20"),
            (removed_project_id, "45"),
        ):
            measurements = {
                **self.measurements,
                "walls": [
                    {"id": 1, "name": "Wall", "length": length, "height": "10"}
                ],
            }
            self.assertEqual(
                self.client.put(
                    f"/api/measurements/{project_id}",
                    data=json.dumps(measurements),
                    content_type="application/json",
                ).status_code,
                200,
            )
            self.assertEqual(
                self.client.put(
                    f"/api/attendance/{project_id}",
                    data=json.dumps(
                        {"weekStart": self.week_start, "labourers": []}
                    ),
                    content_type="application/json",
                ).status_code,
                200,
            )
            self.assertEqual(
                self.client.put(
                    f"/api/projects/{workspace_id}/{project_id}/data",
                    data=json.dumps({"quotationAmount": int(length)}),
                    content_type="application/json",
                ).status_code,
                200,
            )

        response = self.client.delete(
            f"/api/projects/{workspace_id}/{removed_project_id}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"deleted": True})
        self.assertEqual(
            len(self.client.get(f"/api/projects/{workspace_id}").json["projects"]),
            1,
        )
        summary_response = self.client.get(
            f"/api/projects/{workspace_id}/summary"
        )
        self.assertEqual(summary_response.status_code, 200)
        self.assertEqual(
            [project["id"] for project in summary_response.json["projects"]],
            [default_project["id"]],
        )
        self.assertEqual(
            self.client.get(f"/api/measurements/{removed_project_id}").json,
            {"measurements": None},
        )
        self.assertEqual(
            self.client.get(
                f"/api/attendance/{removed_project_id}",
                query_string={"week_start": self.week_start},
            ).json,
            {"attendance": None},
        )
        self.assertEqual(
            self.client.get(
                f"/api/projects/{workspace_id}/{removed_project_id}/data"
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(
                f"/api/measurements/{default_project['id']}"
            ).json["measurements"]["walls"][0]["length"],
            "20",
        )
        self.assertEqual(
            self.client.get(
                f"/api/projects/{workspace_id}/{default_project['id']}/data"
            ).json["data"]["quotationAmount"],
            20,
        )

    def test_deleting_last_house_and_invalid_project_are_rejected(self) -> None:
        workspace_id = self.project_id
        only_project_id = self.client.get(
            f"/api/projects/{workspace_id}"
        ).json["projects"][0]["id"]

        last_house_response = self.client.delete(
            f"/api/projects/{workspace_id}/{only_project_id}"
        )
        self.assertEqual(last_house_response.status_code, 409)
        self.assertEqual(
            len(self.client.get(f"/api/projects/{workspace_id}").json["projects"]),
            1,
        )

        invalid_id_response = self.client.delete(
            f"/api/projects/{workspace_id}/not-a-uuid"
        )
        self.assertEqual(invalid_id_response.status_code, 400)
        missing_project_response = self.client.delete(
            f"/api/projects/{str(uuid.uuid4())}/{only_project_id}"
        )
        self.assertEqual(missing_project_response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
