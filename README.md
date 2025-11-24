# Attendance System - Quick Start Guide

## What You Need to Install

1. **Node.js** - Download from https://nodejs.org/ (version 14 or higher)
2. **npm** - Comes with Node.js automatically

## How to Run the Web App

### Step 1: Install Dependencies
Open a terminal in the `backend` folder and run:
```
npm install
```

### Step 2: Generate SSL Certificates (First Time Only)
In the `backend` folder, run:
```
npm run generate-certs
```

### Step 3: Start the Backend Server
In the `backend` folder, run:
```
npm start
```
The server will start on `https://localhost:3000`

### Step 4: Open the Frontend
Open your web browser and go to:
```
https://localhost:3000
```

## What This App Does

- **Employees** can clock in/out using QR codes
- **Admin** can view attendance records and manage employee schedules
- **Database** automatically stores all attendance data

## Troubleshooting

- If port 3000 is already in use, the server will fail to start
- Make sure you're in the `backend` folder when running npm commands
- Clear your browser cache if you see old pages
