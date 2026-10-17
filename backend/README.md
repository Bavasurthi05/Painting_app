# PaintWise measurements API

The Flask API stores wall and door/window measurements, paint-calculator
inputs, weekly labour attendance, house projects, project costs, expenses, and
payments in `backend/paintwise.sqlite3`. Start it from the project root:

```powershell
python -m venv .\backend\venv
.\backend\venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
.\backend\venv\Scripts\python.exe .\backend\app.py
```

Then run the frontend with `npm run dev` from `frontend`. Vite proxies `/api`
requests to `http://127.0.0.1:5000`.

In **Painting Design**, first choose **Painted** or **Not Painted**, then upload
a JPG, PNG, or WebP house photo (under 10 MB) and choose a paint brand. For a
painted house, explicitly click **Detect Colours**. The browser segmentation
model isolates the house before OpenCV LAB colour clustering returns significant
distinct colour groups; network access is needed to load the segmentation model
on first use. Results show estimated detected colours and the closest available
shade matches, not guaranteed original paint colours. Windows, shadows, and
unusual viewpoints can still affect estimates.

For an unpainted house, choose a brand before viewing its catalogue. The
existing Berger palette is available for wall and accent selection; other
brands are marked unavailable until their verified shade catalogues are
provided. Custom wall and accent colours can still be applied to the uploaded
photo. The existing AI-generated design previews remain available separately.

The backend catalogue route is `GET /api/paint-shades/<brand>`. The analysis
route is `POST /api/paint-colour-analysis` and requires the image, a PNG house
segmentation mask, and the selected brand. The Berger catalogue at
`backend/data/berger_shades.json` preserves the existing app palette and uses
this shape:

```json
[
  { "name": "verified shade name", "code": "verified shade number", "hex": "#AABBCC" }
]
```

Each match uses CIELAB Delta E (CIE76) and returns its distance and a similarity
score. Do not add unverified shade names or codes. Asian Paints, Nerolac, and
Dulux are intentionally reported as unavailable until catalogues with verified
shade names, codes, and colour values are supplied.

Open **Labour Attendance** from the navigation or dashboard. Choose a week
(weeks are grouped Monday through Sunday), add labourers, and record each day
as Present, Half-day, or Absent. Attendance saves automatically. The report
supports CSV download and browser print / Save as PDF; half-days count as half
of the optional daily wage. Enter a weekly advance per labourer to see the
remaining balance (weekly wages minus advance); a negative balance means the
advance is greater than the week's calculated wages. Balance is shown only
when that labourer's daily wage is entered.

The current login and signup screens are not connected to account authentication.
Use **Houses** from the navigation or the home dashboard to create and switch
between house projects. Each house has a customer, location, deadline, status,
measurements, cost-estimation inputs, quotation details, weekly attendance,
expenses, and recorded payments. Home displays rotating sample photographs of
South Indian houses; these are bundled previews and are not customer uploads.
They are hidden on the Houses page. Completed projects remain in the list and
can be found through search and status filters. The overall business summary is
separate and only appears when explicitly opened. Export House Backup
downloads a JSON snapshot of one house, including measurements, all saved
attendance weeks, and project data. On the Houses page, each project can be
permanently removed along with its measurements, attendance, estimates,
quotations, expenses, payments, and project details. A workspace must keep at
least one house, so the final project cannot be deleted.

On the first visit after this update, the API creates **My First House** using
the existing browser workspace ID as its project ID. This preserves the
measurements and attendance already stored under that ID. New houses receive
their own IDs and therefore do not share those records.

The current login and signup screens are not connected to account authentication.
Projects and records are scoped to a random workspace ID saved in the browser's
local storage, not to a verified user account. Clearing that browser storage
creates a new workspace and will no longer identify the previous projects.
