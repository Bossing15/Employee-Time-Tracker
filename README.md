# Employee Time Tracker

A simple web-based employee attendance tracking system with QR code support.

## Features

- **Employee Clock In/Out** - Track attendance with timestamps
- **QR Code Scanning** - Quick attendance marking via QR codes
- **Admin Dashboard** - Manage employees and view attendance
- **Employee Management** - Add, edit, and delete employees
- **Schedule Management** - Set work schedules for employees
- **Attendance Reports** - View attendance history and statistics
- **Work Hours Tracking** - Monitor daily, weekly, and monthly hours

## Requirements

- **Node.js** (version 14 or higher)
- **npm** (comes with Node.js)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Bossing15/Employee-Time-Tracker.git
   cd Employee-Time-Tracker
   ```

2. **Install dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Generate SSL certificates** (first time only)
   ```bash
   npm run generate-certs
   ```

## Running the System

1. **Start the server**
   ```bash
   cd backend
   npm start
   ```

2. **Open in browser**
   ```
   https://localhost:3001
   ```

3. **Accept the security warning** (normal for self-signed certificates in development)

## Default Credentials

### Admin Account
- Create an admin account by registering with:
  - Username starting with "admin" (e.g., `admin123`)
  - Password containing `ADMIN2025`

### Employee Account
- Register with any username and employee ID
- Regular password (6+ characters)

## How to Use

### For Employees
1. Go to `https://localhost:3001`
2. Login or register
3. Click "Clock In" to start work
4. Click "Clock Out" when done
5. View your attendance history

### For Admins
1. Login with admin credentials
2. Access the admin dashboard
3. View all employees
4. Manage employee schedules
5. View attendance reports
6. Edit or delete employees

### QR Code Feature
1. Admin can generate QR codes for employees
2. Display QR code at workplace entrance
3. Employees scan to clock in/out quickly

## Project Structure

```
Employee-Time-Tracker/
├── backend/
│   ├── server.js          # Main server file
│   ├── package.json       # Dependencies
│   ├── attendance.db      # SQLite database (auto-created)
│   ├── cert.pem          # SSL certificate
│   └── key.pem           # SSL key
├── frontend/
│   ├── employee-login.html      # Login page
│   ├── employee-dashboard.html  # Employee dashboard
│   ├── admin.html              # Admin dashboard
│   ├── attendance-qr.html      # QR code display
│   ├── qr-scanner.html         # QR scanner
│   └── styles.css              # Styles
└── README.md
```

## Technologies Used

- **Backend:** Node.js, Express
- **Database:** SQLite3
- **Authentication:** bcrypt
- **QR Codes:** qrcode library
- **Frontend:** HTML, CSS, JavaScript

## API Endpoints

### Authentication
- `POST /api/register` - Register new user
- `POST /api/login` - Login user

### Employees
- `GET /api/employees` - Get all employees
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee

### Attendance
- `POST /api/clock-in` - Clock in
- `POST /api/clock-out` - Clock out
- `GET /api/attendance` - Get attendance records
- `GET /api/status/:employee_id` - Get clock status

### Schedules
- `GET /api/schedules/:employee_id` - Get schedule
- `POST /api/schedules/:employee_id` - Set schedule
- `DELETE /api/schedules/:employee_id` - Delete schedule

### Reports
- `GET /api/work-hours/daily/:employee_id` - Daily hours
- `GET /api/work-hours/weekly/:employee_id` - Weekly hours
- `GET /api/work-hours/monthly/:employee_id` - Monthly hours
- `GET /api/work-hours/summary` - All employees summary

## Configuration

Edit `backend/.env.example` and rename to `.env`:

```env
PORT=3001
ADMIN_SECRET_CODE=ADMIN2025
```

## Troubleshooting

### Port already in use
- Change the PORT in `.env` file
- Or stop the process using port 3001

### Can't access from mobile
- Make sure both devices are on the same network
- Use your computer's IP address instead of localhost
- Accept the SSL certificate warning on mobile

### Database errors
- Delete `attendance.db` and restart the server
- Database will be recreated automatically

## Development

### Install dependencies
```bash
cd backend
npm install
```

### Run in development mode
```bash
npm start
```

### Generate new SSL certificates
```bash
npm run generate-certs
```

## Security Notes

- SSL certificates are self-signed (for development only)
- For production, use proper SSL certificates
- Change `ADMIN_SECRET_CODE` in production
- Use environment variables for sensitive data

## License

MIT License - Feel free to use and modify

## Support

For issues or questions, please open an issue on GitHub:
https://github.com/Bossing15/Employee-Time-Tracker/issues

---

**Made with ❤️ for simple attendance tracking**
