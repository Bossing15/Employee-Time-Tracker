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
- **Work Hours Monitoring** - Track daily, weekly, and monthly hours
- **Schedule Comparison** - Compare actual vs expected work schedules
- **Payroll Reports** - Generate comprehensive payroll summaries
- **Error Detection** - Identify incomplete records and missing attendance
- **Full CRUD Operations** - Complete Create, Read, Update, Delete for all entities

## Troubleshooting

- If port 3000 is already in use, the server will fail to start
- Make sure you're in the `backend` folder when running npm commands
- Clear your browser cache if you see old pages


## Module 2: Work Hours Monitoring API

### Daily Hours Calculation
**GET** `/api/work-hours/daily/:employee_id?date=YYYY-MM-DD`

Returns total hours worked by an employee on a specific date.

Example:
```
GET /api/work-hours/daily/EMP001?date=2025-11-27
```

Response:
```json
{
  "employee_id": "EMP001",
  "date": "2025-11-27",
  "total_hours": 8.5,
  "total_records": 1,
  "completed_records": 1,
  "incomplete_records": 0,
  "records": [...]
}
```

### Weekly Hours Calculation
**GET** `/api/work-hours/weekly/:employee_id?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Returns weekly hours summary with daily breakdown.

Example:
```
GET /api/work-hours/weekly/EMP001?start_date=2025-11-25&end_date=2025-12-01
```

Response:
```json
{
  "employee_id": "EMP001",
  "week_start": "2025-11-25",
  "week_end": "2025-12-01",
  "total_hours": 42.5,
  "days_worked": 5,
  "average_hours_per_day": 8.5,
  "daily_breakdown": [...]
}
```

### Monthly Hours Calculation
**GET** `/api/work-hours/monthly/:employee_id?year=2025&month=11`

Returns monthly hours summary with weekly and daily breakdown.

Example:
```
GET /api/work-hours/monthly/EMP001?year=2025&month=11
```

Response:
```json
{
  "employee_id": "EMP001",
  "year": 2025,
  "month": 11,
  "month_name": "November",
  "total_hours": 168.5,
  "days_worked": 21,
  "average_hours_per_day": 8.02,
  "weekly_summary": {...},
  "daily_breakdown": [...]
}
```

### Shift & Schedule Comparison
**GET** `/api/schedule-comparison/:employee_id?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Compares actual work hours against expected schedule.

Example:
```
GET /api/schedule-comparison/EMP001?start_date=2025-11-01&end_date=2025-11-30
```

Response:
```json
{
  "employee_id": "EMP001",
  "period": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-30"
  },
  "expected_schedule": {
    "start_time": "09:00",
    "end_time": "17:00",
    "expected_hours": 8
  },
  "summary": {
    "total_days": 21,
    "on_time_days": 18,
    "meets_hours_days": 19,
    "full_compliance_days": 17,
    "on_time_percentage": 86,
    "meets_hours_percentage": 90,
    "full_compliance_percentage": 81,
    "average_start_variance_minutes": 5,
    "average_hours_variance": 0.25
  },
  "daily_comparison": [...]
}
```

### All Employees Work Hours Summary
**GET** `/api/work-hours/summary?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Returns work hours summary for all active employees (admin view).

Example:
```
GET /api/work-hours/summary?start_date=2025-11-01&end_date=2025-11-30
```

Response:
```json
{
  "period": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-30",
    "period_type": "custom"
  },
  "total_employees": 10,
  "employees": [
    {
      "employee_id": "EMP001",
      "name": "John Doe",
      "days_worked": 21,
      "total_hours": 168.5,
      "avg_hours_per_day": 8.02,
      "expected_hours_per_day": 8,
      "expected_total_hours": 168,
      "hours_variance": 0.5,
      "compliance_percentage": 100,
      "incomplete_records": 0
    }
  ]
}
```

## Module 3: Payroll Summary / Reporting API

### Individual Employee Attendance Summary
**GET** `/api/reports/attendance-summary/:employee_id?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Returns comprehensive attendance summary for a single employee including late arrivals, undertime, overtime, and missing days.

Example:
```
GET /api/reports/attendance-summary/EMP001?start_date=2025-11-01&end_date=2025-11-30
```

Response:
```json
{
  "employee": {
    "employee_id": "EMP001",
    "name": "John Doe",
    "username": "johndoe"
  },
  "period": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-30",
    "days": 30
  },
  "schedule": {
    "start_time": "09:00",
    "end_time": "17:00",
    "expected_hours": 8
  },
  "summary": {
    "total_records": 21,
    "completed_records": 20,
    "incomplete_records": 1,
    "actual_work_days": 21,
    "expected_work_days": 22,
    "missing_days": 1,
    "total_hours_worked": 168.5,
    "expected_total_hours": 176,
    "hours_variance": -7.5,
    "late_count": 3,
    "undertime_count": 2,
    "overtime_count": 5,
    "total_late_minutes": 45,
    "total_undertime_hours": 3.5,
    "total_overtime_hours": 12.0,
    "attendance_rate": 95
  },
  "records": [...]
}
```

### Generate Payroll Summary for All Employees
**GET** `/api/reports/payroll-summary?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Generates a comprehensive payroll report for all active employees with attendance statistics, hours worked, and compliance metrics.

Example:
```
GET /api/reports/payroll-summary?start_date=2025-11-01&end_date=2025-11-30
```

Response:
```json
{
  "period": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-30",
    "expected_work_days": 22
  },
  "totals": {
    "total_employees": 10,
    "total_hours_worked": 1685.5,
    "total_expected_hours": 1760,
    "total_incomplete_records": 3,
    "total_missing_days": 8,
    "average_attendance_rate": 94
  },
  "employees": [
    {
      "employee_id": "EMP001",
      "name": "John Doe",
      "total_records": 21,
      "completed_records": 20,
      "incomplete_records": 1,
      "actual_work_days": 21,
      "expected_work_days": 22,
      "missing_days": 1,
      "total_hours_worked": 168.5,
      "expected_total_hours": 176,
      "hours_variance": -7.5,
      "late_count": 3,
      "undertime_count": 2,
      "overtime_count": 5,
      "attendance_rate": 95,
      "expected_hours_per_day": 8
    }
  ]
}
```

### Error & Missing Log Notifications
**GET** `/api/reports/errors-and-missing?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Identifies and reports incomplete attendance records (missing clock-out) and missing attendance days for all employees.

Example:
```
GET /api/reports/errors-and-missing?start_date=2025-11-01&end_date=2025-11-30
```

Response:
```json
{
  "period": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-30",
    "expected_work_days": 22
  },
  "summary": {
    "total_incomplete_records": 3,
    "total_missing_days": 8,
    "employees_with_issues": 5
  },
  "incomplete_records": [
    {
      "id": 123,
      "employee_id": "EMP001",
      "employee_name": "John Doe",
      "clock_in": "2025-11-27 09:15:00",
      "work_date": "2025-11-27",
      "issue_type": "missing_clock_out",
      "severity": "high",
      "description": "Clock-in at 2025-11-27 09:15:00 has no clock-out"
    }
  ],
  "missing_days": [
    {
      "employee_id": "EMP002",
      "employee_name": "Jane Smith",
      "missing_date": "2025-11-15",
      "day_of_week": "Friday",
      "issue_type": "absent",
      "severity": "medium",
      "description": "No attendance record for 2025-11-15"
    }
  ]
}
```

## Using the Payroll Reports Feature

1. **Access Admin Dashboard**: Login as admin and navigate to "Payroll Reports" in the sidebar
2. **Select Date Range**: Choose start and end dates for the reporting period
3. **Generate Report**: Click "Generate Report" to view comprehensive payroll summary
4. **Check Issues**: Click "Check Issues" to identify incomplete records and missing attendance
5. **Review Data**: Analyze attendance rates, hours worked, and compliance metrics for each employee

## Full CRUD Operations API

### Employee Management
```
POST   /api/register                          - Create employee
GET    /api/employees                         - List all employees
PUT    /api/employees/:employee_id            - Update employee details
DELETE /api/employees/:employee_id            - Delete employee (permanent)
POST   /api/employees/:id/change-password     - Change employee password
POST   /api/employees/:id/activate            - Activate employee
POST   /api/employees/:id/deactivate          - Deactivate employee (soft delete)
```

### Attendance Management
```
POST   /api/clock-in                          - Clock in
POST   /api/clock-out                         - Clock out
GET    /api/attendance                        - List attendance records
GET    /api/attendance/:id                    - Get single attendance record
PUT    /api/attendance/:id                    - Update attendance record
DELETE /api/attendance/:id                    - Delete attendance record
POST   /api/attendance/manual                 - Manually add attendance record (admin)
```

### Schedule Management
```
GET    /api/schedules/:employee_id            - Get employee schedule
POST   /api/schedules/:employee_id            - Create/update schedule
DELETE /api/schedules/:employee_id            - Delete schedule
GET    /api/all-schedules                     - List all schedules
```

For detailed CRUD operations guide, see `CRUD_OPERATIONS_GUIDE.md`
