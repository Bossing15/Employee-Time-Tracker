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
    
    console.log(`[Attendance Status] Employee: ${employee_id}, Date range: ${start_date} to ${end_date}`);
    
    // First, let's see ALL records for this employee to debug
    db.all(`SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in DESC LIMIT 5`, [employee_id], (err, allRecords) => {
      if (!err && allRecords) {
        console.log(`[Attendance Status] Last 5 records for ${employee_id}:`, allRecords.map(r => ({
          id: r.id,
          clock_in: r.clock_in,
          date_extracted: r.clock_in ? new Date(r.clock_in).toISOString().split('T')[0] : null
        })));
      }
    });
    
    db.all(`
      SELECT * FROM attendance 
      WHERE employee_id = ? 
        AND date(clock_in) >= date(?)
        AND date(clock_in) <= date(?)
      ORDER BY clock_in DESC
    `, [employee_id, start_date, end_date], (err, records) => {
      if (err) {
        console.error('[Attendance Status] Database error:', err);
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      console.log(`[Attendance Status] Found ${records.length} records for employee ${employee_id} on ${start_date}`);
      
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
        SET start_time = ?, end_time = ?, expected_hours = ?, 
            updated_at = CURRENT_TIMESTAMP
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

// ============================================
// MODULE 2: WORK HOURS MONITORING FUNCTIONS
// ============================================

// Daily Hours Calculation
app.get('/api/work-hours/daily/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { date } = req.query;
  
  if (!date) {
    return res.status(400).json({ error: 'date parameter is required (format: YYYY-MM-DD)' });
  }
  
  db.all(`
    SELECT 
      id,
      employee_id,
      clock_in,
      clock_out,
      hours_worked,
      notes,
      date(clock_in) as work_date
    FROM attendance
    WHERE employee_id = ? AND date(clock_in) = date(?)
    ORDER BY clock_in
  `, [employee_id, date], (err, records) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    const totalHours = records.reduce((sum, r) => sum + (r.hours_worked || 0), 0);
    const completedRecords = records.filter(r => r.clock_out !== null);
    const incompleteRecords = records.filter(r => r.clock_out === null);
    
    res.json({
      employee_id,
      date,
      total_hours: Math.round(totalHours * 100) / 100,
      total_records: records.length,
      completed_records: completedRecords.length,
      incomplete_records: incompleteRecords.length,
      records
    });
  });
});

// Weekly Hours Calculation
app.get('/api/work-hours/weekly/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { start_date, end_date } = req.query;
  
  if (!start_date) {
    return res.status(400).json({ error: 'start_date parameter is required (format: YYYY-MM-DD)' });
  }
  
  // Calculate end_date as 6 days after start_date if not provided
  let weekEndDate = end_date;
  if (!weekEndDate) {
    const startDateObj = new Date(start_date);
    startDateObj.setDate(startDateObj.getDate() + 6);
    weekEndDate = startDateObj.toISOString().split('T')[0];
  }
  
  db.all(`
    SELECT 
      date(clock_in) as work_date,
      COUNT(*) as records_count,
      ROUND(SUM(COALESCE(hours_worked, 0)), 2) as daily_hours,
      COUNT(CASE WHEN clock_out IS NULL THEN 1 END) as incomplete_count
    FROM attendance
    WHERE employee_id = ? 
      AND date(clock_in) >= date(?)
      AND date(clock_in) <= date(?)
    GROUP BY date(clock_in)
    ORDER BY work_date
  `, [employee_id, start_date, weekEndDate], (err, dailySummary) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    const totalHours = dailySummary.reduce((sum, day) => sum + (day.daily_hours || 0), 0);
    const totalDaysWorked = dailySummary.length;
    const averageHoursPerDay = totalDaysWorked > 0 ? totalHours / totalDaysWorked : 0;
    
    res.json({
      employee_id,
      week_start: start_date,
      week_end: weekEndDate,
      total_hours: Math.round(totalHours * 100) / 100,
      days_worked: totalDaysWorked,
      average_hours_per_day: Math.round(averageHoursPerDay * 100) / 100,
      daily_breakdown: dailySummary
    });
  });
});

// Monthly Hours Calculation
app.get('/api/work-hours/monthly/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { year, month } = req.query;
  
  if (!year || !month) {
    return res.status(400).json({ error: 'year and month parameters are required (e.g., year=2025&month=11)' });
  }
  
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
  const nextYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  
  db.all(`
    SELECT 
      date(clock_in) as work_date,
      COUNT(*) as records_count,
      ROUND(SUM(COALESCE(hours_worked, 0)), 2) as daily_hours,
      COUNT(CASE WHEN clock_out IS NULL THEN 1 END) as incomplete_count
    FROM attendance
    WHERE employee_id = ? 
      AND date(clock_in) >= date(?)
      AND date(clock_in) < date(?)
    GROUP BY date(clock_in)
    ORDER BY work_date
  `, [employee_id, startDate, endDate], (err, dailySummary) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    const totalHours = dailySummary.reduce((sum, day) => sum + (day.daily_hours || 0), 0);
    const totalDaysWorked = dailySummary.length;
    const averageHoursPerDay = totalDaysWorked > 0 ? totalHours / totalDaysWorked : 0;
    
    // Group by week
    const weeklyData = {};
    dailySummary.forEach(day => {
      const date = new Date(day.work_date);
      const weekNum = Math.ceil(date.getDate() / 7);
      const weekKey = `Week ${weekNum}`;
      
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = { days: 0, hours: 0 };
      }
      weeklyData[weekKey].days++;
      weeklyData[weekKey].hours += day.daily_hours;
    });
    
    res.json({
      employee_id,
      year: parseInt(year),
      month: parseInt(month),
      month_name: new Date(startDate).toLocaleString('default', { month: 'long' }),
      total_hours: Math.round(totalHours * 100) / 100,
      days_worked: totalDaysWorked,
      average_hours_per_day: Math.round(averageHoursPerDay * 100) / 100,
      weekly_summary: weeklyData,
      daily_breakdown: dailySummary
    });
  });
});

// Shift & Schedule Comparison
app.get('/api/schedule-comparison/:employee_id', (req, res) => {
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
    
    // Get attendance records
    db.all(`
      SELECT 
        id,
        employee_id,
        clock_in,
        clock_out,
        hours_worked,
        date(clock_in) as work_date
      FROM attendance
      WHERE employee_id = ? 
        AND date(clock_in) >= date(?)
        AND date(clock_in) <= date(?)
        AND clock_out IS NOT NULL
      ORDER BY clock_in
    `, [employee_id, start_date, end_date], (err, records) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      const comparisonData = records.map(record => {
        const clockInDate = new Date(record.clock_in);
        const clockOutDate = new Date(record.clock_out);
        
        const actualStart = `${String(clockInDate.getHours()).padStart(2, '0')}:${String(clockInDate.getMinutes()).padStart(2, '0')}`;
        const actualEnd = `${String(clockOutDate.getHours()).padStart(2, '0')}:${String(clockOutDate.getMinutes()).padStart(2, '0')}`;
        
        // Calculate variance
        const [expStartHour, expStartMin] = expectedStart.split(':').map(Number);
        const expectedStartDate = new Date(clockInDate);
        expectedStartDate.setHours(expStartHour, expStartMin, 0);
        
        const startVarianceMinutes = Math.round((clockInDate - expectedStartDate) / (1000 * 60));
        const hoursVariance = Math.round((record.hours_worked - expectedHours) * 100) / 100;
        
        const isOnTime = startVarianceMinutes <= 0;
        const meetsExpectedHours = record.hours_worked >= expectedHours;
        
        return {
          date: record.work_date,
          expected_schedule: {
            start: expectedStart,
            end: expectedEnd,
            hours: expectedHours
          },
          actual_schedule: {
            start: actualStart,
            end: actualEnd,
            hours: record.hours_worked
          },
          variance: {
            start_minutes: startVarianceMinutes,
            hours: hoursVariance
          },
          compliance: {
            on_time: isOnTime,
            meets_expected_hours: meetsExpectedHours,
            overall: isOnTime && meetsExpectedHours
          }
        };
      });
      
      // Calculate summary statistics
      const totalDays = comparisonData.length;
      const onTimeDays = comparisonData.filter(d => d.compliance.on_time).length;
      const meetsHoursDays = comparisonData.filter(d => d.compliance.meets_expected_hours).length;
      const fullComplianceDays = comparisonData.filter(d => d.compliance.overall).length;
      
      const avgStartVariance = totalDays > 0 
        ? Math.round(comparisonData.reduce((sum, d) => sum + d.variance.start_minutes, 0) / totalDays)
        : 0;
      
      const avgHoursVariance = totalDays > 0
        ? Math.round(comparisonData.reduce((sum, d) => sum + d.variance.hours, 0) * 100 / totalDays) / 100
        : 0;
      
      res.json({
        employee_id,
        period: { start_date, end_date },
        expected_schedule: {
          start_time: expectedStart,
          end_time: expectedEnd,
          expected_hours: expectedHours
        },
        summary: {
          total_days: totalDays,
          on_time_days: onTimeDays,
          meets_hours_days: meetsHoursDays,
          full_compliance_days: fullComplianceDays,
          on_time_percentage: totalDays > 0 ? Math.round((onTimeDays / totalDays) * 100) : 0,
          meets_hours_percentage: totalDays > 0 ? Math.round((meetsHoursDays / totalDays) * 100) : 0,
          full_compliance_percentage: totalDays > 0 ? Math.round((fullComplianceDays / totalDays) * 100) : 0,
          average_start_variance_minutes: avgStartVariance,
          average_hours_variance: avgHoursVariance
        },
        daily_comparison: comparisonData
      });
    });
  });
});

// All Employees Work Hours Summary (for admin dashboard)
app.get('/api/work-hours/summary', (req, res) => {
  const { start_date, end_date, period_type } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  db.all(`
    SELECT 
      e.employee_id,
      e.name,
      COUNT(DISTINCT date(a.clock_in)) as days_worked,
      ROUND(SUM(COALESCE(a.hours_worked, 0)), 2) as total_hours,
      ROUND(AVG(COALESCE(a.hours_worked, 0)), 2) as avg_hours_per_day,
      COUNT(CASE WHEN a.clock_out IS NULL THEN 1 END) as incomplete_records
    FROM employees e
    LEFT JOIN attendance a ON e.employee_id = a.employee_id
      AND date(a.clock_in) >= date(?)
      AND date(a.clock_in) <= date(?)
    WHERE e.active = 1
    GROUP BY e.employee_id, e.name
    ORDER BY e.name
  `, [start_date, end_date], (err, summary) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    // Get schedules for comparison
    db.all('SELECT * FROM employee_schedules', [], (err, schedules) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      const scheduleMap = {};
      schedules.forEach(s => {
        scheduleMap[s.employee_id] = s;
      });
      
      const enrichedSummary = summary.map(emp => {
        const schedule = scheduleMap[emp.employee_id];
        const expectedHours = schedule?.expected_hours || 8;
        const expectedTotalHours = emp.days_worked * expectedHours;
        const hoursVariance = emp.total_hours - expectedTotalHours;
        
        return {
          ...emp,
          expected_hours_per_day: expectedHours,
          expected_total_hours: Math.round(expectedTotalHours * 100) / 100,
          hours_variance: Math.round(hoursVariance * 100) / 100,
          compliance_percentage: expectedTotalHours > 0 
            ? Math.round((emp.total_hours / expectedTotalHours) * 100) 
            : 0
        };
      });
      
      res.json({
        period: { start_date, end_date, period_type: period_type || 'custom' },
        total_employees: enrichedSummary.length,
        employees: enrichedSummary
      });
    });
  });
});

// ============================================
// FULL CRUD OPERATIONS
// ============================================

// Error & Missing Log Notifications
app.get('/api/reports/errors-and-missing', (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  // Get incomplete records (missing clock-out)
  db.all(`
    SELECT 
      a.id,
      a.employee_id,
      e.name as employee_name,
      a.clock_in,
      date(a.clock_in) as work_date
    FROM attendance a
    JOIN employees e ON a.employee_id = e.employee_id
    WHERE a.clock_out IS NULL
      AND date(a.clock_in) >= date(?)
      AND date(a.clock_in) <= date(?)
    ORDER BY a.clock_in DESC
  `, [start_date, end_date], (err, incompleteRecords) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    // Get all employees and their attendance
    db.all('SELECT employee_id, name FROM employees WHERE active = 1', [], (err, employees) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      db.all(`
        SELECT 
          employee_id,
          date(clock_in) as work_date
        FROM attendance
        WHERE date(clock_in) >= date(?)
          AND date(clock_in) <= date(?)
        GROUP BY employee_id, date(clock_in)
      `, [start_date, end_date], (err, attendanceRecords) => {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        
        // Create a map of employee attendance
        const attendanceMap = {};
        attendanceRecords.forEach(record => {
          if (!attendanceMap[record.employee_id]) {
            attendanceMap[record.employee_id] = new Set();
          }
          attendanceMap[record.employee_id].add(record.work_date);
        });
        
        // Calculate expected work days
        const startDateObj = new Date(start_date);
        const endDateObj = new Date(end_date);
        const expectedDates = [];
        
        for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            expectedDates.push(d.toISOString().split('T')[0]);
          }
        }
        
        // Find missing days for each employee
        const missingDays = [];
        employees.forEach(emp => {
          const attendedDates = attendanceMap[emp.employee_id] || new Set();
          
          expectedDates.forEach(date => {
            if (!attendedDates.has(date)) {
              missingDays.push({
                employee_id: emp.employee_id,
                employee_name: emp.name,
                missing_date: date,
                day_of_week: new Date(date).toLocaleDateString('en-US', { weekday: 'long' })
              });
            }
          });
        });
        
        res.json({
          period: {
            start_date,
            end_date,
            expected_work_days: expectedDates.length
          },
          summary: {
            total_incomplete_records: incompleteRecords.length,
            total_missing_days: missingDays.length,
            employees_with_issues: new Set([
              ...incompleteRecords.map(r => r.employee_id),
              ...missingDays.map(r => r.employee_id)
            ]).size
          },
          incomplete_records: incompleteRecords.map(r => ({
            ...r,
            issue_type: 'missing_clock_out',
            severity: 'high',
            description: `Clock-in at ${r.clock_in} has no clock-out`
          })),
          missing_days: missingDays.map(r => ({
            ...r,
            issue_type: 'absent',
            severity: 'medium',
            description: `No attendance record for ${r.missing_date}`
          }))
        });
      });
    });
  });
});

// ============================================
// FULL CRUD OPERATIONS
// ============================================

// UPDATE Employee Details
app.put('/api/employees/:employee_id', async (req, res) => {
  const { employee_id } = req.params;
  const { name, username } = req.body;
  
  if (!name && !username) {
    return res.status(400).json({ error: 'At least one field (name or username) is required' });
  }
  
  try {
    // Check if employee exists
    db.get('SELECT * FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      if (!employee) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      
      // Check if new username is already taken
      if (username && username !== employee.username) {
        db.get('SELECT id FROM employees WHERE username = ? AND employee_id != ?', [username, employee_id], (err, existing) => {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          
          if (existing) {
            return res.status(400).json({ error: 'Username already taken' });
          }
          
          updateEmployee();
        });
      } else {
        updateEmployee();
      }
      
      function updateEmployee() {
        const updates = [];
        const params = [];
        
        if (name) {
          updates.push('name = ?');
          params.push(name);
        }
        if (username) {
          updates.push('username = ?');
          params.push(username);
        }
        
        params.push(employee_id);
        
        const query = `UPDATE employees SET ${updates.join(', ')} WHERE employee_id = ?`;
        
        db.run(query, params, function(err) {
          if (err) {
            console.error('Update employee database error:', err);
            return res.status(500).json({ error: 'Database error: ' + err.message });
          }
          
          db.get('SELECT id, employee_id, name, username, active, created_at FROM employees WHERE employee_id = ?', [employee_id], (err, updated) => {
            if (err) {
              console.error('Fetch updated employee error:', err);
              return res.status(500).json({ error: 'Database error: ' + err.message });
            }
            res.json({ success: true, employee: updated });
          });
        });
      }
    });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Server error occurred' });
  }
});

// Change Employee Password
app.post('/api/employees/:employee_id/change-password', async (req, res) => {
  const { employee_id } = req.params;
  const { old_password, new_password } = req.body;
  
  if (!old_password || !new_password) {
    return res.status(400).json({ error: 'Both old and new passwords are required' });
  }
  
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }
  
  try {
    db.get('SELECT * FROM employees WHERE employee_id = ?', [employee_id], async (err, employee) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      if (!employee) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      
      // Verify old password
      const isValid = await verifyPassword(old_password, employee.password);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      
      // Hash new password
      const hashedPassword = await hashPassword(new_password);
      
      db.run('UPDATE employees SET password = ? WHERE employee_id = ?', 
        [hashedPassword, employee_id], 
        function(err) {
          if (err) {
            console.error('Password update error:', err);
            return res.status(500).json({ error: 'Database error occurred: ' + err.message });
          }
          res.json({ success: true, message: 'Password changed successfully' });
        }
      );
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error occurred' });
  }
});

// Update Admin Profile
app.put('/api/admins/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  try {
    db.get('SELECT * FROM admins WHERE id = ?', [id], (err, admin) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      if (!admin) {
        return res.status(404).json({ error: 'Admin not found' });
      }
      
      db.run('UPDATE admins SET name = ? WHERE id = ?', 
        [name.trim(), id], 
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          
          db.get('SELECT id, username, name, created_at FROM admins WHERE id = ?', [id], (err, updated) => {
            if (err) {
              return res.status(500).json({ error: 'Database error occurred' });
            }
            res.json({ success: true, admin: updated });
          });
        }
      );
    });
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({ error: 'Server error occurred' });
  }
});

// Change Admin Password
app.post('/api/admins/:id/change-password', async (req, res) => {
  const { id } = req.params;
  const { old_password, new_password } = req.body;
  
  if (!old_password || !new_password) {
    return res.status(400).json({ error: 'Both old and new passwords are required' });
  }
  
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }
  
  try {
    db.get('SELECT * FROM admins WHERE id = ?', [id], async (err, admin) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      if (!admin) {
        return res.status(404).json({ error: 'Admin not found' });
      }
      
      // Verify old password
      const isValid = await verifyPassword(old_password, admin.password);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      
      // Hash new password
      const hashedPassword = await hashPassword(new_password);
      
      db.run('UPDATE admins SET password = ? WHERE id = ?', 
        [hashedPassword, id], 
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          res.json({ success: true, message: 'Password changed successfully' });
        }
      );
    });
  } catch (error) {
    console.error('Change admin password error:', error);
    res.status(500).json({ error: 'Server error occurred' });
  }
});

// DELETE Employee (Hard Delete)
app.delete('/api/employees/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  db.get('SELECT * FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Delete employee (this will also affect related records due to foreign keys)
    db.run('DELETE FROM employees WHERE employee_id = ?', [employee_id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred: ' + err.message });
      }
      
      res.json({ 
        success: true, 
        message: `Employee ${employee.name} has been permanently deleted`,
        employee_id: employee_id
      });
    });
  });
});

// GET Single Attendance Record
app.get('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  
  db.get(`
    SELECT a.*, e.name as employee_name
    FROM attendance a
    JOIN employees e ON a.employee_id = e.employee_id
    WHERE a.id = ?
  `, [id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
    
    res.json(record);
  });
});

// UPDATE Attendance Record
app.put('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  const { clock_in, clock_out, notes } = req.body;
  
  if (!clock_in) {
    return res.status(400).json({ error: 'Clock-in time is required' });
  }
  
  db.get('SELECT * FROM attendance WHERE id = ?', [id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
    
    // Calculate hours if clock_out is provided
    let hoursWorked = null;
    if (clock_out) {
      const clockInDate = new Date(clock_in);
      const clockOutDate = new Date(clock_out);
      hoursWorked = Math.round(((clockOutDate - clockInDate) / (1000 * 60 * 60)) * 100) / 100;
    }
    
    const sanitizedNotes = notes ? notes.trim().substring(0, 500) : null;
    
    db.run(`
      UPDATE attendance 
      SET clock_in = ?, 
          clock_out = ?, 
          hours_worked = ?,
          notes = ?
      WHERE id = ?
    `, [clock_in, clock_out, hoursWorked, sanitizedNotes, id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      db.get('SELECT * FROM attendance WHERE id = ?', [id], (err, updated) => {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        res.json({ success: true, record: updated });
      });
    });
  });
});

// CREATE Attendance Record Manually (Admin)
app.post('/api/attendance/manual', (req, res) => {
  const { employee_id, clock_in, clock_out, notes } = req.body;
  
  if (!employee_id || !clock_in) {
    return res.status(400).json({ error: 'Employee ID and clock-in time are required' });
  }
  
  // Verify employee exists
  db.get('SELECT * FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Calculate hours if clock_out is provided
    let hoursWorked = null;
    if (clock_out) {
      const clockInDate = new Date(clock_in);
      const clockOutDate = new Date(clock_out);
      hoursWorked = Math.round(((clockOutDate - clockInDate) / (1000 * 60 * 60)) * 100) / 100;
    }
    
    const sanitizedNotes = notes ? notes.trim().substring(0, 500) : null;
    
    db.run(`
      INSERT INTO attendance (employee_id, clock_in, clock_out, hours_worked, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [employee_id, clock_in, clock_out, hoursWorked, sanitizedNotes], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      db.get('SELECT * FROM attendance WHERE id = ?', [this.lastID], (err, record) => {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        res.json({ success: true, record });
      });
    });
  });
});

// DELETE Attendance Record
app.delete('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT * FROM attendance WHERE id = ?', [id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
    
    db.run('DELETE FROM attendance WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      res.json({ 
        success: true, 
        message: 'Attendance record deleted successfully',
        id: id
      });
    });
  });
});

// DELETE Schedule
app.delete('/api/schedules/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  
  db.get('SELECT * FROM employee_schedules WHERE employee_id = ?', [employee_id], (err, schedule) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    
    db.run('DELETE FROM employee_schedules WHERE employee_id = ?', [employee_id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      res.json({ 
        success: true, 
        message: 'Schedule deleted successfully',
        employee_id: employee_id
      });
    });
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
