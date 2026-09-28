# Spendikkoo

Spendikkoo is a private, browser-based expense tracker with a polished fintech dashboard. It is fast, responsive, accessible, and intentionally built without frameworks or runtime dependencies.

Your transactions stay in your browser. Nothing is sent to a server.

## Run it locally

Clone the repository, enter the project directory, and start any static file server:

```sh
git clone https://github.com/tilinkkr/expense-tracker-tilinbijoy.git
cd expense-tracker-tilinbijoy
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000).

## What is included

- Income and expense tracking with edit, delete, filtering, search, and pagination
- Cashflow charts, category allocation, CSV import/export, and light/dark themes
- Integer-cent calculations to avoid floating-point errors
- Resilient local storage with an in-memory fallback when browser storage is unavailable
- Keyboard-friendly modal controls, focus trapping, inline validation, and responsive layouts

## How it was built

The interface uses semantic HTML, modern CSS Grid and Flexbox, native ES modules, and HTML canvas charts. `app.js` coordinates state and rendering, `analytics.js` owns financial calculations and CSV handling, and `storage.js` isolates persistence concerns.

The result is a small static application that can be understood and deployed without a build step.

## Deploy

Import the repository into Vercel and deploy with the default settings. `vercel.json` already includes clean URLs and production security headers.
