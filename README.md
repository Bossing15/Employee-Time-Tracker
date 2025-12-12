# Employee Time Tracker

A simple web-based attendance tracking system with QR code support.

## Quick Start

```bash
cd backend
npm install
npm run generate-certs
npm start
```

Open `https://localhost:3001` in your browser.

## Creating Accounts

**Admin:** Register with username starting with "admin" and password containing `ADMIN2025`

**Employee:** Register with any username, employee ID, and password (6+ characters)

## Features

- Clock in/out with timestamps
- QR code attendance scanning
- Employee management (add, edit, delete, schedules)
- Attendance reports and history
- Break time tracking
- Payroll summary

## Tech Stack

- Node.js + Express
- SQLite3
- HTML/CSS/JavaScript

## License

MIT
