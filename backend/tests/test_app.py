import json
import io
import math
import tempfile
import unittest
import uuid
from pathlib import Path

from app import create_app
from PIL import Image, ImageDraw


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

    def _house_image(self) -> bytes:
        image = Image.new("RGB", (400, 300), "#659DD0")
        draw = ImageDraw.Draw(image)
        draw.rectangle((35, 25, 365, 65), fill="#B5212A")
        draw.rectangle((35, 65, 365, 76), fill="#FFFDF5")
        draw.rectangle((35, 76, 130, 245), fill="#F4E4C7")
        draw.rectangle((130, 76, 230, 245), fill="#FFD21C")
        draw.rectangle((230, 76, 300, 245), fill="#F06AB2")
        draw.rectangle((300, 76, 365, 245), fill="#C2188B")
        draw.rectangle((124, 76, 134, 245), fill="#F06F2E")
        draw.rectangle((130, 160, 185, 235), fill="#68402C")
        draw.rectangle((0, 65, 40, 150), fill="#34843A")
        draw.rectangle((0, 245, 400, 300), fill="#888888")
        draw.rectangle((45, 110, 65, 145), fill="#101010")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def _house_mask(self) -> bytes:
        image = Image.new("L", (400, 300), 0)
        ImageDraw.Draw(image).rectangle((35, 25, 365, 245), fill=255)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def _analysis_upload(
        self, image: bytes, mask: bytes, brand: str = "berger"
    ) -> dict[str, object]:
        return {
            "image": (io.BytesIO(image), "house.png", "image/png"),
            "house_mask": (io.BytesIO(mask), "house-mask.png", "image/png"),
            "brand": brand,
        }

    def test_berger_catalogue_returns_existing_shade_data(self) -> None:
        response = self.client.get("/api/paint-shades/berger")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["available"])
        self.assertEqual(response.json["brand"], "berger")
        self.assertGreater(len(response.json["shades"]), 0)
        for shade in response.json["shades"]:
            self.assertTrue(shade["name"])
            self.assertTrue(shade["code"])
            self.assertRegex(shade["hex"], r"^#[0-9A-F]{6}$")

    def test_missing_berger_catalogue_is_reported_unavailable(self) -> None:
        self.app.config["BERGER_SHADE_DATASET"] = str(
            Path(self.temporary_directory.name) / "missing-shades.json"
        )

        response = self.client.get("/api/paint-shades/berger")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["available"])
        self.assertEqual(response.json["shades"], [])
        self.assertIn("verified", response.json["message"])

    def test_unverified_brand_catalogues_are_unavailable(self) -> None:
        for brand in ("asian", "nerolac", "dulux"):
            with self.subTest(brand=brand):
                response = self.client.get(f"/api/paint-shades/{brand}")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json["available"])
                self.assertEqual(response.json["shades"], [])
                self.assertIn("verified", response.json["message"])

    def test_painted_house_analysis_only_matches_the_selected_brand(self) -> None:
        response = self.client.post(
            "/api/paint-colour-analysis",
            data=self._analysis_upload(
                self._house_image(), self._house_mask(), brand="asian"
            ),
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["selected_brand"], "asian")
        self.assertFalse(response.json["brand_catalogue_available"])
        self.assertTrue(response.json["brand_match_message"])
        self.assertTrue(
            all(region["brand_match"] is None for region in response.json["regions"])
        )

    def test_painted_house_analysis_requires_a_supported_brand(self) -> None:
        upload = self._analysis_upload(self._house_image(), self._house_mask())
        upload["brand"] = "not-a-brand"
        response = self.client.post(
            "/api/paint-colour-analysis",
            data=upload,
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("supported paint brand", response.json["error"])

    def test_painted_house_analysis_returns_all_distinct_painted_colours(self) -> None:
        response = self.client.post(
            "/api/paint-colour-analysis",
            data=self._analysis_upload(self._house_image(), self._house_mask()),
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["analysis_version"], 2)
        colours = {
            region["colour_name"] for region in response.json["regions"]
        }
        self.assertTrue(
            {"red", "orange", "yellow", "pink", "magenta", "cream", "white"}
            .issubset(colours),
            colours,
        )
        self.assertGreater(len(response.json["regions"]), 3)
        self.assertEqual(
            len({region["hex"] for region in response.json["regions"]}),
            len(response.json["regions"]),
        )
        self.assertNotIn("green", colours)
        self.assertNotIn("blue", colours)
        self.assertNotIn("gray", colours)
        self.assertTrue(response.json["berger_dataset_available"])
        self.assertEqual(response.json["selected_brand"], "berger")
        self.assertTrue(response.json["brand_catalogue_available"])
        for region in response.json["regions"]:
            self.assertRegex(region["hex"], r"^#[0-9A-F]{6}$")
            self.assertIsNotNone(region["berger_match"])
            self.assertEqual(region["brand_match"], region["berger_match"])
            self.assertTrue(region["component"])

    def test_painted_house_analysis_requires_matching_house_segmentation(self) -> None:
        missing_mask_response = self.client.post(
            "/api/paint-colour-analysis",
            data={
                "image": (io.BytesIO(self._house_image()), "house.png", "image/png")
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(missing_mask_response.status_code, 400)

        response = self.client.post(
            "/api/paint-colour-analysis",
            data=self._analysis_upload(self._house_image(), self._house_mask()),
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)

        mismatched_mask = Image.new("L", (300, 300), 255)
        mask_buffer = io.BytesIO()
        mismatched_mask.save(mask_buffer, format="PNG")
        mask_buffer.seek(0)
        mismatch_response = self.client.post(
            "/api/paint-colour-analysis",
            data={
                **self._analysis_upload(self._house_image(), self._house_mask()),
                "house_mask": (mask_buffer, "mask.png", "image/png"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(mismatch_response.status_code, 400)
        self.assertIn("does not match", mismatch_response.json["error"])

    def test_painted_blue_and_green_areas_are_not_filtered_as_sky_or_foliage(self) -> None:
        image = Image.new("RGB", (400, 300), "#888888")
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 35, 360, 260), fill="#3A72D6")
        draw.rectangle((200, 90, 350, 250), fill="#45A34C")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        buffer.seek(0)
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).rectangle((40, 35, 360, 260), fill=255)
        mask_buffer = io.BytesIO()
        mask.save(mask_buffer, format="PNG")
        mask_buffer.seek(0)

        response = self.client.post(
            "/api/paint-colour-analysis",
            data={
                "image": (buffer, "house.png", "image/png"),
                "house_mask": (mask_buffer, "house-mask.png", "image/png"),
                "brand": "berger",
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        colours = {region["colour_name"] for region in response.json["regions"]}
        self.assertIn("blue", colours)
        self.assertIn("green", colours)

    def test_blue_house_with_gray_roof_is_not_reported_as_lawn_or_sky(self) -> None:
        image = Image.new("RGB", (400, 300), "#119FE5")
        draw = ImageDraw.Draw(image)
        draw.rectangle((85, 25, 315, 90), fill="#858585")
        draw.rectangle((100, 85, 300, 245), fill="#176FB0")
        draw.rectangle((95, 85, 305, 98), fill="#F8F6EF")
        draw.rectangle((0, 200, 80, 280), fill="#41943C")
        draw.rectangle((0, 280, 400, 300), fill="#888888")
        draw.rectangle((160, 140, 220, 240), fill="#171717")
        image_buffer = io.BytesIO()
        image.save(image_buffer, format="PNG")

        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).rectangle((85, 25, 315, 245), fill=255)
        mask_buffer = io.BytesIO()
        mask.save(mask_buffer, format="PNG")
        mask_buffer.seek(0)

        response = self.client.post(
            "/api/paint-colour-analysis",
            data={
                "image": (
                    io.BytesIO(image_buffer.getvalue()),
                    "blue-house.png",
                    "image/png",
                ),
                "house_mask": (mask_buffer, "house-mask.png", "image/png"),
                "brand": "berger",
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        colours = {region["colour_name"] for region in response.json["regions"]}
        self.assertIn("blue", colours)
        self.assertIn("gray", colours)
        self.assertIn("white", colours)
        self.assertNotIn("green", colours)
        self.assertNotIn("cyan", colours)

    def test_painted_house_analysis_matches_a_configured_shade_using_lab_distance(self) -> None:
        dataset_path = Path(self.temporary_directory.name) / "berger_shades.json"
        dataset_path.write_text(
            json.dumps(
                [
                    {"name": "Test Roof Shade", "code": "TEST-1", "hex": "#B5212A"},
                    {"name": "Test Alternate Shade", "code": "TEST-2", "hex": "#123456"},
                ]
            ),
            encoding="utf-8",
        )
        self.app.config["BERGER_SHADE_DATASET"] = str(dataset_path)
        response = self.client.post(
            "/api/paint-colour-analysis",
            data=self._analysis_upload(self._house_image(), self._house_mask()),
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["berger_dataset_available"])
        matching_colour = next(
            region for region in response.json["regions"]
            if region["colour_name"] == "red"
        )
        self.assertEqual(matching_colour["berger_match"]["name"], "Test Roof Shade")
        self.assertEqual(matching_colour["berger_match"]["code"], "TEST-1")
        self.assertLess(matching_colour["berger_match"]["delta_e"], 2)
        self.assertGreater(matching_colour["berger_match"]["similarity"], 98)

    def test_painted_house_analysis_rejects_invalid_files(self) -> None:
        response = self.client.post(
            "/api/paint-colour-analysis",
            data={
                "image": (io.BytesIO(b"not an image"), "house.png", "image/png"),
                "house_mask": (
                    io.BytesIO(self._house_mask()),
                    "house-mask.png",
                    "image/png",
                ),
                "brand": "berger",
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.json["error"].lower())

    def test_painted_house_analysis_rejects_unsupported_mime_type(self) -> None:
        response = self.client.post(
            "/api/paint-colour-analysis",
            data={"image": (io.BytesIO(self._house_image()), "house.gif", "image/gif")},
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("JPEG, PNG, or WebP", response.json["error"])

    def test_painted_house_analysis_rejects_files_over_ten_megabytes(self) -> None:
        response = self.client.post(
            "/api/paint-colour-analysis",
            data={
                "image": (
                    io.BytesIO(b"x" * (10 * 1024 * 1024 + 1)),
                    "house.png",
                    "image/png",
                )
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 413)
        self.assertIn("10 MB", response.json["error"])

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
