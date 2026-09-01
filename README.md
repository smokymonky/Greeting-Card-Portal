# Eid Greeting Card Portal

Employee greeting-card generator with an admin panel and analytics dashboard.

## Pages

| Path | Access | Purpose |
|---|---|---|
| `/` | Public | Employees generate and save their card |
| `/admin.html` | Password | Upload template, position text, open/close portal, create events |
| `/dashboard.html` | Password | Stats and full employee list per event |

## Setup

### 1. Environment variables

In Netlify: **Site configuration → Environment variables**. Add all five:

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `SHEET_ID`
- `SA_EMAIL`
- `SA_PRIVATE_KEY`

`SA_PRIVATE_KEY` must be on a single line with `\n` separating each line of the key.
See `.env.example` for the shape. **Redeploy after adding them** — env vars are read at deploy time.

### 2. Google Sheet access

Share the spreadsheet with the service account email (`SA_EMAIL`) as **Editor**.

### 3. First run

Open `/admin.html`, sign in, press **Save Template & Position** once.
This creates the `Config`, `ConfigImage`, and `Events` tabs automatically.

## Changing the template later

Admin → upload image → drag the yellow box onto the pill → check the live preview → Save.
The card page updates immediately. No redeploy needed.

## How the data is stored

- `Config` — settings as key/value pairs
- `ConfigImage` — template image as base64, split across cells (~12 rows). Do not edit by hand.
- `Events` — event name to sheet-tab mapping
- One tab per event — the employee submissions

## Notes

- The Google key is never sent to the browser. All Sheets access goes through `netlify/functions/api.js`.
- Fonts (Luma, Karbon) are embedded in `index.html` and `fonts.js`.
- Card canvas is 1080×1350. Uploaded images are resized to fit.
