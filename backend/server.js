const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');
const https = require('https');
const fs = require('fs');

const db = new sqlite3.Database(path.join(__dirname, 'attendance.db'));

// Initialize database tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE NOT NULL,
      start_time TEXT DEFAULT '09:00',
      end_time TEXT DEFAULT '17:00',
      expected_hours REAL DEFAULT 8,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating employee_schedules table:', err);
    } else {
      console.log('employee_schedules table ready');
    }
  });
});

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_SECRET_CODE = process.env.ADMIN_SECRET_CODE || 'ADMIN2025';

app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function isAdmin(username, password) {
  return username.toLowerCase().startsWith('admin') && password.includes(ADMIN_SECRET_CODE);
}

function validateInput(fields) {
  const errors = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      errors.push(`${key} is required`);
    }
  }
  return errors;
}

app.post('/api/register', async (req, res) => {
  try {
    const { employee_id, name, username, password } = req.body;
    
    const errors = validateInput({ name, username, password });
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }
    
    if (isAdmin(username, password)) {
      const hashedPassword = await hashPassword(password);
      
      db.run(
        'INSERT INTO admins (username, password, name) VALUES (?, ?, ?)',
        [username, hashedPassword, name],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              return res.status(400).json({ error: 'Username already exists' });
            }
            return res.status(500).json({ error: 'Database error occurred' });
          }
          
          db.get('SELECT id, username, name, created_at FROM admins WHERE id = ?', [this.lastID], (err, admin) => {
            if (err) {
              return res.status(500).json({ error: 'Database error occurred' });
            }
            res.json({ success: true, user: { ...admin, role: 'admin' } });
          });
        }
      );
    } else {
      if (!employee_id) {
        return res.status(400).json({ error: 'Employee ID is required for employee accounts' });
      }
      
      const hashedPassword = await hashPassword(password);
      
      db.run(
        'INSERT INTO employees (employee_id, name, username, password) VALUES (?, ?, ?, ?)',
        [employee_id, name, username, hashedPassword],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              return res.status(400).json({ error: 'Employee ID or username already exists' });
            }
            return res.status(500).json({ error: 'Database error occurred' });
          }
          
          db.get('SELECT id, employee_id, name, username, created_at FROM employees WHERE id = ?', [this.lastID], (err, employee) => {
            if (err) {
              return res.status(500).json({ error: 'Database error occurred' });
            }
            res.json({ success: true, user: { ...employee, role: 'employee' } });
          });
        }
      );
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error occurred' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (username.toLowerCase().startsWith('admin')) {
      db.get(
        'SELECT id, username, name, password, created_at FROM admins WHERE username = ?',
        [username],
        async (err, admin) => {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          
          if (!admin || !(await verifyPassword(password, admin.password))) {
            return res.status(401).json({ error: 'Invalid username or password' });
          }
          
          delete admin.password;
          res.json({ success: true, user: { ...admin, role: 'admin' } });
        }
      );
    } else {
      db.get(
        'SELECT id, employee_id, name, username, password, active, created_at FROM employees WHERE username = ?',
        [username],
        async (err, employee) => {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          
          if (!employee || !(await verifyPassword(password, employee.password))) {
            return res.status(401).json({ error: 'Invalid username or password' });
          }
          
          if (employee.active === 0) {
            return res.status(403).json({ error: 'Account has been deactivated. Please contact your administrator.' });
          }
          
          delete employee.password;
          res.json({ success: true, user: { ...employee, role: 'employee' } });
        }
      );
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error occurred' });
  }
});

app.post('/api/employees', (req, res) => {
  const { employee_id, name } = req.body;
  
  db.get('SELECT id, employee_id, name, username, created_at FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (employee) {
      return res.json(employee);
    }
    
    res.status(404).json({ error: 'Employee not found. Please register first.' });
  });
});

app.get('/api/employees', (req, res) => {
  const includeInactive = req.query.include_inactive === 'true';
  const query = includeInactive 
    ? 'SELECT id, employee_id, name, username, active, created_at FROM employees ORDER BY name'
    : 'SELECT id, employee_id, name, username, active, created_at FROM employees WHERE active = 1 ORDER BY name';
  
  db.all(query, [], (err, employees) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    res.json(employees);
  });
});

app.post('/api/clock-in', (req, res) => {
  const { employee_id } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  db.get('SELECT employee_id, active FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    if (employee.active === 0) {
      return res.status(403).json({ error: 'Account has been deactivated' });
    }
    
    db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL', [employee_id], (err, existing) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      if (existing) {
        return res.status(400).json({ error: 'Already clocked in' });
      }
      
      db.run('INSERT INTO attendance (employee_id, clock_in) VALUES (?, datetime("now", "localtime"))', [employee_id], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        
        db.get('SELECT * FROM attendance WHERE id = ?', [this.lastID], (err, record) => {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          res.json(record);
        });
      });
    });
  });
});

app.post('/api/clock-out', (req, res) => {
  const { employee_id, notes } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [employee_id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!record) {
      return res.status(400).json({ error: 'No active clock-in found' });
    }
    
    const sanitizedNotes = notes ? notes.trim().substring(0, 500) : null;
    
    db.run(`
      UPDATE attendance 
      SET clock_out = datetime("now", "localtime"),
          hours_worked = ROUND((julianday(datetime("now", "localtime")) - julianday(clock_in)) * 24, 2),
          notes = ?
      WHERE id = ?
    `, [sanitizedNotes, record.id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      db.get('SELECT * FROM attendance WHERE id = ?', [record.id], (err, updated) => {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        res.json(updated);
      });
    });
  });
});

app.get('/api/status/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL', [employee_id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json({ 
      clocked_in: !!record,
      record: record || null
    });
  });
});

app.get('/api/attendance', (req, res) => {
  const { employee_id, start_date, end_date, limit = 100 } = req.query;
  
  const recordLimit = Math.min(parseInt(limit) || 100, 1000);
  
  let query = `
    SELECT a.*, e.name as employee_name
    FROM attendance a
    JOIN employees e ON a.employee_id = e.employee_id
    WHERE 1=1
  `;
  const params = [];
  
  if (employee_id) {
    query += ' AND a.employee_id = ?';
    params.push(employee_id);
  }
  
  if (start_date) {
    query += ' AND date(a.clock_in) >= date(?)';
    params.push(start_date);
  }
  
  if (end_date) {
    query += ' AND date(a.clock_in) <= date(?)';
    params.push(end_date);
  }
  
  query += ' ORDER BY a.clock_in DESC LIMIT ?';
  params.push(recordLimit);
  
  db.all(query, params, (err, records) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    res.json(records);
  });
});

app.get('/api/payroll-summary', (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  db.all(`
    SELECT 
      e.employee_id,
      e.name,
      COUNT(a.id) as total_days,
      ROUND(SUM(COALESCE(a.hours_worked, 0)), 2) as total_hours,
      COUNT(CASE WHEN a.clock_out IS NULL THEN 1 END) as incomplete_records
    FROM employees e
    LEFT JOIN attendance a ON e.employee_id = a.employee_id
      AND date(a.clock_in) >= date(?)
      AND date(a.clock_in) <= date(?)
    GROUP BY e.employee_id, e.name
    ORDER BY e.name
  `, [start_date, end_date], (err, summary) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(summary);
  });
});

// Detection functions for Late, Undertime, and Overtime
function detectAttendanceStatus(clockInTime, clockOutTime, expectedStartTime = '09:00', expectedEndTime = '17:00', expectedHours = 8) {
  const clockInDate = new Date(clockInTime);
  const clockOutDate = new Date(clockOutTime);
  
  const clockInHour = clockInDate.getHours();
  const clockInMinute = clockInDate.getMinutes();
  const clockInTimeStr = `${String(clockInHour).padStart(2, '0')}:${String(clockInMinute).padStart(2, '0')}`;
  
  const hoursWorked = (clockOutDate - clockInDate) / (1000 * 60 * 60);
  
  const status = {
    isLate: false,
    isUndertime: false,
    isOvertime: false,
    clockInTime: clockInTimeStr,
    hoursWorked: Math.round(hoursWorked * 100) / 100,
    expectedHours: expectedHours,
    lateMinutes: 0,
    undertimeHours: 0,
    overtimeHours: 0
  };
  
  // Check for late arrival
  const [expectedHour, expectedMinute] = expectedStartTime.split(':').map(Number);
  const expectedStartDate = new Date(clockInDate);
  expectedStartDate.setHours(expectedHour, expectedMinute, 0);
  
  if (clockInDate > expectedStartDate) {
    status.isLate = true;
    status.lateMinutes = Math.round((clockInDate - expectedStartDate) / (1000 * 60));
  }
  
  // Check for undertime
  if (hoursWorked < expectedHours) {
    status.isUndertime = true;
    status.undertimeHours = Math.round((expectedHours - hoursWorked) * 100) / 100;
  }
  
  // Check for overtime
  if (hoursWorked > expectedHours) {
    status.isOvertime = true;
    status.overtimeHours = Math.round((hoursWorked - expectedHours) * 100) / 100;
  }
  
  return status;
}

app.get('/api/attendance-status/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  // Get employee schedule
  db.get('SELECT * FROM employee_schedules WHERE employee_id = ?', [employee_id], (err, schedule) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    const expectedStart = schedule?.start_time || '09:00';
    const expectedEnd = schedule?.end_time || '17:00';
    const expectedHours = schedule?.expected_hours || 8;
    
    db.all(`
      SELECT * FROM attendance 
      WHERE employee_id = ? 
        AND date(clock_in) >= date(?)
        AND date(clock_in) <= date(?)
      ORDER BY clock_in DESC
    `, [employee_id, start_date, end_date], (err, records) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      const statusRecords = records.map(record => {
        // For incomplete records (no clock_out), only check if late
        if (!record.clock_out) {
          const clockInDate = new Date(record.clock_in);
          const clockInHour = clockInDate.getHours();
          const clockInMinute = clockInDate.getMinutes();
          const clockInTimeStr = `${String(clockInHour).padStart(2, '0')}:${String(clockInMinute).padStart(2, '0')}`;
          
          const [expectedHour, expectedMinute] = expectedStart.split(':').map(Number);
          const expectedStartDate = new Date(clockInDate);
          expectedStartDate.setHours(expectedHour, expectedMinute, 0);
          
          const isLate = clockInDate > expectedStartDate;
          const lateMinutes = isLate ? Math.round((clockInDate - expectedStartDate) / (1000 * 60)) : 0;
          
          return {
            ...record,
            isLate,
            lateMinutes,
            isUndertime: false,
            undertimeHours: 0,
            isOvertime: false,
            overtimeHours: 0,
            clockInTime: clockInTimeStr,
            hoursWorked: 0
          };
        }
        
        return {
          ...record,
          ...detectAttendanceStatus(record.clock_in, record.clock_out, expectedStart, expectedEnd, expectedHours)
        };
      });
      
      const summary = {
        total_records: statusRecords.length,
        late_count: statusRecords.filter(r => r.isLate).length,
        undertime_count: statusRecords.filter(r => r.isUndertime).length,
        overtime_count: statusRecords.filter(r => r.isOvertime).length,
        total_late_minutes: statusRecords.reduce((sum, r) => sum + r.lateMinutes, 0),
        total_undertime_hours: Math.round(statusRecords.reduce((sum, r) => sum + r.undertimeHours, 0) * 100) / 100,
        total_overtime_hours: Math.round(statusRecords.reduce((sum, r) => sum + r.overtimeHours, 0) * 100) / 100,
        schedule: { expectedStart, expectedEnd, expectedHours },
        records: statusRecords
      };
      
      res.json(summary);
    });
  });
});

app.get('/api/attendance-detection', (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  db.all(`
    SELECT 
      e.employee_id,
      e.name,
      a.id,
      a.clock_in,
      a.clock_out,
      a.hours_worked
    FROM attendance a
    JOIN employees e ON a.employee_id = e.employee_id
    WHERE date(a.clock_in) >= date(?)
      AND date(a.clock_in) <= date(?)
      AND a.clock_out IS NOT NULL
    ORDER BY a.clock_in DESC
  `, [start_date, end_date], (err, records) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    // Get all schedules
    db.all('SELECT * FROM employee_schedules', [], (err, schedules) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      const scheduleMap = {};
      schedules.forEach(s => {
        scheduleMap[s.employee_id] = s;
      });
      
      const statusRecords = records.map(record => {
        const schedule = scheduleMap[record.employee_id];
        const expectedStart = schedule?.start_time || '09:00';
        const expectedEnd = schedule?.end_time || '17:00';
        const expectedHours = schedule?.expected_hours || 8;
        
        return {
          ...record,
          ...detectAttendanceStatus(record.clock_in, record.clock_out, expectedStart, expectedEnd, expectedHours)
        };
      });
      
      const lateRecords = statusRecords.filter(r => r.isLate);
      const undertimeRecords = statusRecords.filter(r => r.isUndertime);
      const overtimeRecords = statusRecords.filter(r => r.isOvertime);
      
      res.json({
        summary: {
          total_records: statusRecords.length,
          late_count: lateRecords.length,
          undertime_count: undertimeRecords.length,
          overtime_count: overtimeRecords.length,
          total_late_minutes: lateRecords.reduce((sum, r) => sum + r.lateMinutes, 0),
          total_undertime_hours: Math.round(lateRecords.reduce((sum, r) => sum + r.undertimeHours, 0) * 100) / 100,
          total_overtime_hours: Math.round(overtimeRecords.reduce((sum, r) => sum + r.overtimeHours, 0) * 100) / 100
        },
        late: lateRecords,
        undertime: undertimeRecords,
        overtime: overtimeRecords
      });
    });
  });
});

// Employee Schedule Management
app.get('/api/schedules/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  
  db.get('SELECT * FROM employee_schedules WHERE employee_id = ?', [employee_id], (err, schedule) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!schedule) {
      return res.json({ 
        employee_id, 
        start_time: '09:00', 
        end_time: '17:00', 
        expected_hours: 8 
      });
    }
    
    res.json(schedule);
  });
});

app.post('/api/schedules/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { start_time, end_time, expected_hours } = req.body;
  
  if (!start_time || !end_time || expected_hours === undefined) {
    return res.status(400).json({ error: 'start_time, end_time, and expected_hours are required' });
  }
  
  db.get('SELECT id FROM employee_schedules WHERE employee_id = ?', [employee_id], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (existing) {
      db.run(`
        UPDATE employee_schedules 
        SET start_time = ?, end_time = ?, expected_hours = ?, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ?
      `, [start_time, end_time, expected_hours, employee_id], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        
        db.get('SELECT * FROM employee_schedules WHERE employee_id = ?', [employee_id], (err, schedule) => {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          res.json({ success: true, schedule });
        });
      });
    } else {
      db.run(`
        INSERT INTO employee_schedules (employee_id, start_time, end_time, expected_hours)
        VALUES (?, ?, ?, ?)
      `, [employee_id, start_time, end_time, expected_hours], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        
        db.get('SELECT * FROM employee_schedules WHERE id = ?', [this.lastID], (err, schedule) => {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          res.json({ success: true, schedule });
        });
      });
    }
  });
});

app.get('/api/all-schedules', (req, res) => {
  db.all(`
    SELECT es.*, e.name, e.employee_id
    FROM employee_schedules es
    JOIN employees e ON es.employee_id = e.employee_id
    ORDER BY e.name
  `, [], (err, schedules) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    res.json(schedules);
  });
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.get('/api/qr/:employee_id', async (req, res) => {
  const { employee_id } = req.params;
  const localIP = getLocalIP();
  const url = `http://${localIP}:${PORT}/employee-dashboard.html?id=${employee_id}`;
  
  try {
    const qrCode = await QRCode.toDataURL(url, { width: 300 });
    res.json({ qrCode, url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/qr-attendance', async (req, res) => {
  const localIP = getLocalIP();
  const url = `http://${localIP}:${PORT}/employee-login.html`;
  
  try {
    const qrCode = await QRCode.toDataURL(url, { width: 400 });
    res.json({ qrCode, url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/employees/:employee_id/deactivate', (req, res) => {
  const { employee_id } = req.params;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  db.get('SELECT id, employee_id, name, active FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      console.error('Deactivate error:', err);
      return res.status(500).json({ error: 'Database error: ' + err.message });
    }
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    if (employee.active === 0) {
      return res.status(400).json({ error: 'Employee is already deactivated' });
    }
    
    db.run(
      'UPDATE employees SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?',
      [employee_id],
      function(err) {
        if (err) {
          console.error('Deactivate update error:', err);
          return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        res.json({ 
          success: true, 
          message: `Employee ${employee.name} has been deactivated`,
          employee_id: employee_id
        });
      }
    );
  });
});

app.post('/api/employees/:employee_id/activate', (req, res) => {
  const { employee_id } = req.params;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  db.get('SELECT id, employee_id, name, active FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      console.error('Activate error:', err);
      return res.status(500).json({ error: 'Database error: ' + err.message });
    }
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    if (employee.active === 1) {
      return res.status(400).json({ error: 'Employee is already active' });
    }
    
    db.run(
      'UPDATE employees SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?',
      [employee_id],
      function(err) {
        if (err) {
          console.error('Activate update error:', err);
          return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        res.json({ 
          success: true, 
          message: `Employee ${employee.name} has been reactivated`,
          employee_id: employee_id
        });
      }
    );
  });
});

app.post('/api/attendance-scan', (req, res) => {
  const { employee_id } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID required' });
  }
  
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL', [employee_id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (record) {
      db.run(`
        UPDATE attendance 
        SET clock_out = datetime("now", "localtime"),
            hours_worked = ROUND((julianday(datetime("now", "localtime")) - julianday(clock_in)) * 24, 2)
        WHERE id = ?
      `, [record.id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ action: 'clock-out', success: true, message: 'Clocked out successfully' });
      });
    } else {
      db.run('INSERT INTO attendance (employee_id, clock_in) VALUES (?, datetime("now", "localtime"))', [employee_id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ action: 'clock-in', success: true, message: 'Clocked in successfully' });
      });
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString()
  });
});

app.post('/api/migrate', (req, res) => {
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE NOT NULL,
      start_time TEXT DEFAULT '09:00',
      end_time TEXT DEFAULT '17:00',
      expected_hours REAL DEFAULT 8,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
    )
  `, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Migration failed: ' + err.message });
    }
    res.json({ success: true, message: 'Database migrated successfully' });
  });
});

app.get('/', (req, res) => {
  res.sendFile('employee-login.html', { root: require('path').join(__dirname, '../frontend') });
});

app.use(express.static(require('path').join(__dirname, '../frontend')));

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: err.message 
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const options = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
  
  https.createServer(options, app).listen(PORT, () => {
    const localIP = getLocalIP();
    console.log(`\n🚀 Attendance System Started (HTTPS)`);
    console.log(`   Local:   https://localhost:${PORT}`);
    console.log(`   Network: https://${localIP}:${PORT}`);
    console.log(`\n📱 Mobile Access:`);
    console.log(`   1. On mobile, visit: https://${localIP}:${PORT}`);
    console.log(`   2. Accept certificate warning (normal for development)`);
    console.log(`   3. Click "📱 Scan QR Code" to use camera`);
    console.log(`\n💡 For setup help, see: MOBILE_SETUP.md\n`);
  });
} else {
  app.listen(PORT, () => {
    const localIP = getLocalIP();
    console.log(`\n🚀 Attendance System Started (HTTP)`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://${localIP}:${PORT}`);
    console.log(`\n⚠️  Camera access requires HTTPS for network access`);
    console.log(`   To enable HTTPS, run:`);
    console.log(`   cd backend && npm run generate-certs && npm start\n`);
  });
}
