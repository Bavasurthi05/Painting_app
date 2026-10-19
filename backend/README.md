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

## Accounts and private data

Registration and sign-in use email/password accounts; sessions are random
server-side tokens stored hashed in SQLite and sent in HttpOnly cookies. Google
OAuth uses state, nonce, and PKCE. Password recovery links are one-use and
expire after one hour. Passwords are stored with Werkzeug's scrypt password
hashing. Authentication is required for chat, image analysis, house projects,
measurements, attendance, quotations, costs, and project exports. The browser's
legacy workspace ID in API paths is retained for compatibility and is never
treated as proof of identity.

New accounts start with no house projects. `GET /api/projects/<workspace_id>`
only returns houses that already exist; the signed-in user creates the first
house explicitly through `POST /api/projects/<workspace_id>`.

Authenticated users can view and update their own profile at `/api/profile`.
The API returns the account name, email, phone number, and creation date, and
only permits changing the name and phone number. Existing SQLite user tables
are migrated on startup to add missing phone or account-creation columns
without deleting account data. No profile-photo or role field exists in the
current account model.

Existing rows created before accounts have no verified owner. They remain
unowned and inaccessible to new accounts; signup deliberately does not claim or
copy them. Back up `backend/paintwise.sqlite3` before deployment. If records
need to be retained, migrate only after verifying the rightful account owner
for each legacy workspace.

The database defaults to `backend/paintwise.sqlite3`. On Render, mount a
persistent disk and set `DATABASE` to a SQLite file path on that disk (for
example, `/var/data/paintwise.sqlite3`) so profiles and existing app data
survive deploys and restarts. The backend creates the database's parent
directory when it starts.

Set `AUTH_ALLOWED_ORIGINS` to comma-separated exact frontend origins. For local
Vite development the defaults are `http://localhost:5173` and
`http://127.0.0.1:5173`. Keep the frontend and API on the same site where
possible. HTTPS deployments must set `AUTH_COOKIE_SECURE=true`; cross-site
frontend/API deployments additionally require `AUTH_COOKIE_SAMESITE=None`,
HTTPS, and credentialed CORS for the exact frontend origin.

Google sign-in is optional. In Google Cloud, configure an OAuth web client and
add the exact `GOOGLE_REDIRECT_URI` as an authorized redirect URI. With the
local Vite proxy this defaults to
`http://localhost:5173/api/auth/google/callback`. Set
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in
`backend/.env`; the Google button reports a configuration message until those
values are present.

Password recovery requires an SMTP account. Configure `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`, as well as `FRONTEND_URL`.
Without SMTP settings the recovery form reports that email delivery is not
configured rather than claiming a link was sent.

## Gemini chat assistant

The existing bottom-right floating assistant sends chat requests to
`POST /api/chat`. The Flask backend calls Google's official `google-genai` SDK;
the browser never receives the Gemini API key. Chat messages and history stay
in the browser's current in-memory chat and are not stored in SQLite. The
authenticated chat endpoint does not load private project records into the
model.

Set `GEMINI_API_KEY` in the local `backend/.env` file. The Flask app reads this
file directly from the backend directory. If that file does not
already exist, create it by copying the template, then replace the placeholder
with a key from Google AI Studio:

```powershell
Copy-Item .\backend\.env.example .\backend\.env
```

Do not commit `backend/.env` or put the key in a `VITE_` variable. The root
`.gitignore` excludes `.env` files. `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash` for chat.
Unpainted house design previews use `GEMINI_IMAGE_MODEL`, which defaults to
`gemini-2.5-flash-image`. This Gemini image-editing model supports image input
and image output through `generateContent`; see Google's
[image generation documentation](https://ai.google.dev/gemini-api/docs/image-generation).
Change the relevant setting in `backend/.env` only if you use another model
enabled for your key. An unavailable model or invalid key returns a safe
configuration error. The app does not repeat a rate-limited image request;
instead, the design page automatically switches to its local OpenCV preview.
Exhausted or unavailable image quota is also reported by Gemini so you can
check the model's Google AI Studio quota and billing.
`GEMINI_IMAGE_TIMEOUT_MS` defaults to 120000 milliseconds to allow image
editing requests time to finish; adjust it in `backend/.env` if needed.

Install backend dependencies (including `google-genai`) from the project root:

```powershell
.\backend\venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

Start the Flask API from the project root:

```powershell
.\backend\venv\Scripts\python.exe .\backend\app.py
```

In another terminal, start React:

```powershell
Set-Location .\frontend
npm run dev
```

The chat API accepts a current message and up to 20 recent user/assistant
messages (each limited to 4,000 characters; current messages are limited to
2,000). For example:

```powershell
$body = @{
  message = "Would that colour work in a small bedroom?"
  history = @(
    @{ role = "user"; text = "Suggest a calming bedroom paint colour." }
    @{ role = "assistant"; text = "A light warm neutral can feel calm." }
  )
} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri http://127.0.0.1:5000/api/chat `
  -Method Post -ContentType "application/json" -Body $body
```

Successful response:

```json
{ "reply": "Yes. A light warm neutral can help a small bedroom feel brighter..." }
```

Errors have a JSON `error` field and an appropriate HTTP status, for example
`400` for an empty message, `429` for provider rate limits, `503` for missing
credentials or an unavailable model, and `504` for a timeout. The assistant has
no live web search and will ask for missing details rather than inventing
project data or precise painting estimates.

If the browser shows `POST /api/chat` returning HTTP `404`, the request reached
a Flask server that does not have this route registered (often a backend
process that was started before the route was added). Stop that Flask process,
restart it with `.\backend\venv\Scripts\python.exe .\backend\app.py` from the
project root, and try again. A `503`, `429`, or `502` from `/api/chat` means the
route was found and the response instead describes configuration or Gemini
service trouble.

In **Painting Design**, first choose **Painted** or **Not Painted**, then upload
a JPG, PNG, or WebP house photo (under 10 MB) and choose a paint brand. For a
painted house, explicitly click **Detect Colours**. The browser segmentation
model isolates the house before OpenCV LAB colour clustering returns significant
distinct colour groups; network access is needed to load the segmentation model
on first use. Results show estimated detected colours and the closest available
shade matches, not guaranteed original paint colours. Windows, shadows, and
unusual viewpoints can still affect estimates.

For an unpainted house, upload a JPG, JPEG, PNG, or WebP house photo and choose
wall and border/trim colours, then select **Generate Preview**. Initial colours
are wall `#E8CFA7`
and trim `#FFFFFF`; **Regenerate** applies updated colours. **Compare Original**
toggles between the uploaded and generated image, and **Download** saves the
generated PNG. The existing five suggested AI designs remain available.

The colour editor offers Berger Paints, Asian Paints, and Nerolac. Official
shade names and codes are shown only when verified catalogue data is available;
otherwise choose custom HEX colours. The current verified catalogue is Berger
Paints only. No catalogue or shade metadata is invented for Asian Paints or
Nerolac. Gemini receives the uploaded image and selected colours with
instructions to preserve the original architecture and surroundings. The
image is processed in memory and is not retained by this endpoint.

If Gemini is missing, rate-limited, times out, or fails, the design page
automatically tries a local preview through `POST /api/home-design/local-preview`.
The browser uses the existing SegFormer image-segmentation model to prepare
wall and protected opening/roof masks, and Flask uses the installed OpenCV
dependency to recolour only those supplied masks while preserving luminance
(including shadows and texture). No whole-house or whole-image mask is used as
a substitute for a missing wall segmentation. If automatic wall detection is
unavailable, use the **Paint walls**, **Paint trim**, and **Erase** brush tools
to edit masks, then choose **Generate local preview**. Leave windows, doors,
roofs, and surroundings unmasked. The local endpoint does not require a Gemini
key and does not save the uploaded photo or masks.

The segmentation model is downloaded by the browser on first use and requires
network access. If it cannot be downloaded or cannot identify wall pixels, the
manual mask editor is available. The backend masks are bounded PNG uploads
(under 2 MB each); the endpoint rejects missing wall masks and masks covering
most of the image.

If the browser reports a non-JSON response from the local preview endpoint,
restart Flask from the project root with
`.\backend\venv\Scripts\python.exe .\backend\app.py`. The preview UI reports
the HTTP status and distinguishes a stale/unreachable endpoint from a JSON API
error.

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
quotations, expenses, payments, and project details. The final house can be
removed too; the account returns to the first-house setup screen.

New accounts begin without a house. Add a house from the first-house setup
screen or the **Houses** page; existing houses and their saved records are
preserved at sign-in. All saved records are owned by the authenticated account,
so the browser's workspace and active-house values are not authorization
credentials. Existing pre-authentication records remain quarantined until their
ownership can be verified and they are explicitly migrated.
