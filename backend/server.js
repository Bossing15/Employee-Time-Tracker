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

// 📌 Import Attendance & Payroll Calculation Functions
// Removed external calculation helpers; unified calculations below using detectAttendanceStatus


// Initialize database tables
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating admins table:', err);
    } else {
      console.log('admins table ready');
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating employees table:', err);
    } else {
      console.log('employees table ready');
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      clock_in TIMESTAMP NOT NULL,
      clock_out TIMESTAMP,
      hours_worked REAL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating attendance table:', err);
    } else {
      console.log('attendance table ready');
    }
  });

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

  // 🍳 Break Time Tracking Table
  db.run(`
    CREATE TABLE IF NOT EXISTS breaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      attendance_id INTEGER NOT NULL,
      break_type TEXT DEFAULT 'Break',
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_minutes INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(employee_id),
      FOREIGN KEY (attendance_id) REFERENCES attendance(id)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating breaks table:', err);
    } else {
      console.log('breaks table ready ☕');
    }
  });

  // Add columns to attendance table for break tracking
  db.run(`ALTER TABLE attendance ADD COLUMN total_break_minutes INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding total_break_minutes column:', err);
    }
  });

  db.run(`ALTER TABLE attendance ADD COLUMN net_hours_worked REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding net_hours_worked column:', err);
    }
  });

  // System Settings Table
  db.run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating system_settings table:', err);
    } else {
      console.log('system_settings table ready');
      // Initialize default settings
      db.run(`INSERT OR IGNORE INTO system_settings (setting_key, setting_value) VALUES ('default_hourly_rate', '70')`, (err) => {
        if (err) console.error('Error setting default hourly rate:', err);
      });
      db.run(`INSERT OR IGNORE INTO system_settings (setting_key, setting_value) VALUES ('cutoff_day_1', '15')`, (err) => {
        if (err) console.error('Error setting cutoff day 1:', err);
      });
      db.run(`INSERT OR IGNORE INTO system_settings (setting_key, setting_value) VALUES ('cutoff_day_2', '30')`, (err) => {
        if (err) console.error('Error setting cutoff day 2:', err);
      });
    }
  });

  // Add hourly_rate column to employees table
  db.run(`ALTER TABLE employees ADD COLUMN hourly_rate REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding hourly_rate column:', err);
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

app.post('/api/admins/reset-password', async (req, res) => {
  const { username, secret_code, new_password } = req.body;
  if (!username || !secret_code || !new_password) {
    return res.status(400).json({ error: 'username, secret_code, and new_password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }
  if (secret_code !== ADMIN_SECRET_CODE) {
    return res.status(403).json({ error: 'Invalid secret code' });
  }
  db.get('SELECT id FROM admins WHERE username = ?', [username], async (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    const hashed = await hashPassword(new_password);
    db.run('UPDATE admins SET password = ? WHERE id = ?', [hashed, admin.id], function(updateErr) {
      if (updateErr) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      res.json({ success: true, message: 'Password reset successfully' });
    });
  });
});

// Update admin profile
app.put('/api/admins/:id', async (req, res) => {
  const { id } = req.params;
  const { name, current_password, new_password } = req.body;

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }

  db.get('SELECT id, password FROM admins WHERE id = ?', [id], async (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Update name and optionally password
    if (new_password && new_password.length >= 6) {
      // Verify current password first
      if (!current_password) {
        return res.status(400).json({ error: 'Current password is required to change password' });
      }
      const isValidPassword = await verifyPassword(current_password, admin.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const hashed = await hashPassword(new_password);
      db.run('UPDATE admins SET name = ?, password = ? WHERE id = ?', [name.trim(), hashed, id], function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        res.json({ success: true, message: 'Profile updated successfully' });
      });
    } else if (new_password && new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    } else {
      db.run('UPDATE admins SET name = ? WHERE id = ?', [name.trim(), id], function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        res.json({ success: true, message: 'Profile updated successfully' });
      });
    }
  });
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
    ? 'SELECT id, employee_id, name, username, active, created_at, hourly_rate FROM employees ORDER BY name'
    : 'SELECT id, employee_id, name, username, active, created_at, hourly_rate FROM employees WHERE active = 1 ORDER BY name';
  
  db.all(query, [], (err, employees) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    res.json(employees);
  });
});

// ================== SYSTEM SETTINGS API ================== //
app.get('/api/settings', (req, res) => {
  db.all('SELECT setting_key, setting_value FROM system_settings', [], (err, settings) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.setting_key] = s.setting_value;
    });
    res.json(settingsObj);
  });
});

app.put('/api/settings', (req, res) => {
  const { default_hourly_rate, cutoff_day_1, cutoff_day_2 } = req.body;
  
  const updates = [];
  if (default_hourly_rate !== undefined) {
    updates.push({ key: 'default_hourly_rate', value: default_hourly_rate.toString() });
  }
  if (cutoff_day_1 !== undefined) {
    updates.push({ key: 'cutoff_day_1', value: cutoff_day_1.toString() });
  }
  if (cutoff_day_2 !== undefined) {
    updates.push({ key: 'cutoff_day_2', value: cutoff_day_2.toString() });
  }
  
  let completed = 0;
  let hasError = false;
  
  updates.forEach(update => {
    db.run(
      'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
      [update.value, update.key],
      (err) => {
        if (err && !hasError) {
          hasError = true;
          return res.status(500).json({ error: 'Database error occurred' });
        }
        completed++;
        if (completed === updates.length && !hasError) {
          res.json({ message: 'Settings updated successfully' });
        }
      }
    );
  });
  
  if (updates.length === 0) {
    res.json({ message: 'No settings to update' });
  }
});

app.put('/api/employees/:employee_id/rate', (req, res) => {
  const { employee_id } = req.params;
  const { hourly_rate } = req.body;
  
  if (hourly_rate === undefined || hourly_rate === null) {
    return res.status(400).json({ error: 'Hourly rate is required' });
  }
  
  db.run(
    'UPDATE employees SET hourly_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?',
    [hourly_rate, employee_id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      res.json({ message: 'Hourly rate updated successfully' });
    }
  );
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

// 🍳 BREAK TIME TRACKING API ENDPOINTS

// Start a break
app.post('/api/breaks/start', (req, res) => {
  const { employee_id, break_type = 'Break', notes = '' } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'employee_id is required' });
  }
  
  // Check if employee is clocked in
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', 
    [employee_id], (err, attendance) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!attendance) {
      return res.status(400).json({ error: 'Must be clocked in to start a break' });
    }
    
    // Check if there's already an active break
    db.get('SELECT * FROM breaks WHERE employee_id = ? AND end_time IS NULL', [employee_id], (err, activeBreak) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (activeBreak) {
        return res.status(400).json({ error: 'Already on an active break' });
      }
      
      const now = new Date().toISOString();
      
      // Simple: Just create break record
      db.run(`INSERT INTO breaks (employee_id, attendance_id, break_type, start_time, notes) 
              VALUES (?, ?, ?, ?, ?)`,
        [employee_id, attendance.id, break_type, now, notes],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create break: ' + err.message });
          }
          
          res.json({
            success: true,
            message: 'Break started',
            break_id: this.lastID,
            break_start: now,
            break_type
          });
        }
      );
    });
  });
});

// End a break
app.post('/api/breaks/end', (req, res) => {
  const { employee_id, notes = '' } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'employee_id is required' });
  }
  
  // Get the active break
  db.get('SELECT * FROM breaks WHERE employee_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1', 
    [employee_id], (err, breakRecord) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!breakRecord) {
      return res.status(404).json({ error: 'No active break found' });
    }
    
    const now = new Date().toISOString();
    const start = new Date(breakRecord.start_time);
    const end = new Date(now);
    const duration_minutes = Math.round((end - start) / 1000 / 60);
    
    // Simple: Just end the break
    db.run(`UPDATE breaks SET end_time = ?, duration_minutes = ?, notes = ? WHERE id = ?`,
      [now, duration_minutes, notes || breakRecord.notes, breakRecord.id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to end break: ' + err.message });
        }
        
        res.json({
          success: true,
          message: 'Break ended',
          break: {
            id: breakRecord.id,
            break_start: breakRecord.start_time,
            break_end: now,
            duration_minutes,
            break_type: breakRecord.break_type
          }
        });
      }
    );
  });
});

// Get active break for employee
app.get('/api/breaks/active/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  
  db.get(`SELECT * FROM breaks WHERE employee_id = ? AND end_time IS NULL`, 
    [employee_id], (err, activeBreak) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (activeBreak) {
      const start = new Date(activeBreak.start_time);
      const now = new Date();
      const elapsed_minutes = Math.round((now - start) / 1000 / 60);
      
      res.json({
        active_break: {
          ...activeBreak,
          elapsed_minutes
        }
      });
    } else {
      res.json({ active_break: null });
    }
  });
});

// Get break history for employee
app.get('/api/breaks/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { start_date, end_date, break_type } = req.query;
  
  let query = 'SELECT * FROM breaks WHERE employee_id = ?';
  const params = [employee_id];
  
  if (start_date) {
    query += ' AND DATE(start_time) >= DATE(?)';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND DATE(start_time) <= DATE(?)';
    params.push(end_date);
  }
  if (break_type) {
    query += ' AND break_type = ?';
    params.push(break_type);
  }
  
  query += ' ORDER BY start_time DESC';
  
  db.all(query, params, (err, breaks) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Calculate summary
    const summary = {
      total_breaks: breaks.length,
      total_minutes: 0,
      by_type: {}
    };
    
    breaks.forEach(b => {
      if (b.duration_minutes) {
        summary.total_minutes += b.duration_minutes;
        summary.by_type[b.break_type] = (summary.by_type[b.break_type] || 0) + b.duration_minutes;
      }
    });
    
    res.json({ breaks, summary });
  });
});

// Get break summary for employee
app.get('/api/breaks/summary/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const today = new Date().toISOString().split('T')[0];
  
  // Today's breaks
  db.all(`SELECT * FROM breaks WHERE employee_id = ? AND DATE(start_time) = DATE(?) AND end_time IS NOT NULL`,
    [employee_id, today], (err, todayBreaks) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const todaySummary = {
      total_minutes: 0,
      break_count: todayBreaks.length,
      by_type: {}
    };
    
    todayBreaks.forEach(b => {
      todaySummary.total_minutes += b.duration_minutes || 0;
      todaySummary.by_type[b.break_type] = (todaySummary.by_type[b.break_type] || 0) + (b.duration_minutes || 0);
    });
    
    res.json({
      today: todaySummary
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

 

app.get('/api/reports/attendance-summary', (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  db.all(`
    SELECT 
      a.employee_id,
      date(a.clock_in) as work_date,
      a.clock_in,
      a.clock_out,
      COALESCE(a.hours_worked, 0) as hours_worked
    FROM attendance a
    WHERE date(a.clock_in) >= date(?)
      AND date(a.clock_in) <= date(?)
    ORDER BY a.clock_in
  `, [start_date, end_date], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    const totalRecords = rows.length;
    const completedRecords = rows.filter(r => r.clock_out !== null).length;
    const incompleteRecords = totalRecords - completedRecords;
    const totalHours = Math.round(rows.reduce((s, r) => s + (r.hours_worked || 0), 0) * 100) / 100;
    const employees = Array.from(new Set(rows.map(r => r.employee_id)));
    const days = Array.from(new Set(rows.map(r => r.work_date)));
    const byEmployeeMap = {};
    rows.forEach(r => {
      if (!byEmployeeMap[r.employee_id]) {
        byEmployeeMap[r.employee_id] = { employee_id: r.employee_id, days: new Set(), total_hours: 0, records: 0, incomplete: 0 };
      }
      const e = byEmployeeMap[r.employee_id];
      e.days.add(r.work_date);
      e.total_hours += r.hours_worked || 0;
      e.records += 1;
      if (r.clock_out === null) e.incomplete += 1;
    });
    const byEmployee = Object.values(byEmployeeMap).map(e => ({
      employee_id: e.employee_id,
      days_worked: e.days.size,
      total_hours: Math.round(e.total_hours * 100) / 100,
      total_records: e.records,
      incomplete_records: e.incomplete
    }));
    res.json({
      period: { start_date, end_date },
      summary: {
        total_records: totalRecords,
        completed_records: completedRecords,
        incomplete_records: incompleteRecords,
        total_hours: totalHours,
        distinct_employees: employees.length,
        distinct_days: days.length
      },
      by_employee: byEmployee
    });
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
        expected_hours: 8,
        break_hours: 1 // Default 1 hour break
      });
    }
    
    // Add break hours if not present (default 1 hour)
    const scheduleWithBreak = {
      ...schedule,
      break_hours: schedule.break_hours || 1
    };
    
    res.json(scheduleWithBreak);
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

// UPDATE Employee Details
app.put('/api/employees/:employee_id', async (req, res) => {
  const { employee_id } = req.params;
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  // Get employee info and schedule
  db.get('SELECT * FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    db.get('SELECT * FROM employee_schedules WHERE employee_id = ?', [employee_id], (err, schedule) => {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      
      const expectedStart = schedule?.start_time || '09:00';
      const expectedEnd = schedule?.end_time || '17:00';
      const expectedHours = schedule?.expected_hours || 8;
      
      // Get all attendance records for the period
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
        
        // Analyze records
        const completedRecords = records.filter(r => r.clock_out !== null);
        const incompleteRecords = records.filter(r => r.clock_out === null);
        
        let totalHours = 0;
        let lateCount = 0;
        let undertimeCount = 0;
        let overtimeCount = 0;
        let totalLateMinutes = 0;
        let totalUndertimeHours = 0;
        let totalOvertimeHours = 0;
        
        const detailedRecords = records.map(record => {
          if (!record.clock_out) {
            return {
              ...record,
              status: 'incomplete',
              isLate: false,
              isUndertime: false,
              isOvertime: false
            };
          }
          
          const status = detectAttendanceStatus(
            record.clock_in, 
            record.clock_out, 
            expectedStart, 
            expectedEnd, 
            expectedHours
          );
          
          totalHours += record.hours_worked || 0;
          
          if (status.isLate) {
            lateCount++;
            totalLateMinutes += status.lateMinutes;
          }
          if (status.isUndertime) {
            undertimeCount++;
            totalUndertimeHours += status.undertimeHours;
          }
          if (status.isOvertime) {
            overtimeCount++;
            totalOvertimeHours += status.overtimeHours;
          }
          
          return {
            ...record,
            ...status,
            status: 'completed'
          };
        });
        
        // Calculate expected work days (excluding weekends)
        const startDateObj = new Date(start_date);
        const endDateObj = new Date(end_date);
        let expectedWorkDays = 0;
        
        for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday or Saturday
            expectedWorkDays++;
          }
        }
        
        const actualWorkDays = new Set(records.map(r => r.clock_in.split(' ')[0])).size;
        const missingDays = expectedWorkDays - actualWorkDays;
        const expectedTotalHours = expectedWorkDays * expectedHours;
        
        res.json({
          employee: {
            employee_id: employee.employee_id,
            name: employee.name,
            username: employee.username
          },
          period: {
            start_date,
            end_date,
            days: Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24)) + 1
          },
          schedule: {
            start_time: expectedStart,
            end_time: expectedEnd,
            expected_hours: expectedHours
          },
          summary: {
            total_records: records.length,
            completed_records: completedRecords.length,
            incomplete_records: incompleteRecords.length,
            actual_work_days: actualWorkDays,
            expected_work_days: expectedWorkDays,
            missing_days: missingDays,
            total_hours_worked: Math.round(totalHours * 100) / 100,
            expected_total_hours: Math.round(expectedTotalHours * 100) / 100,
            hours_variance: Math.round((totalHours - expectedTotalHours) * 100) / 100,
            late_count: lateCount,
            undertime_count: undertimeCount,
            overtime_count: overtimeCount,
            total_late_minutes: totalLateMinutes,
            total_undertime_hours: Math.round(totalUndertimeHours * 100) / 100,
            total_overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
            attendance_rate: expectedWorkDays > 0 ? Math.round((actualWorkDays / expectedWorkDays) * 100) : 0
          },
          records: detailedRecords
        });
      });
    });
  });
});

// Generate Payroll Attendance Summary for All Employees
app.get('/api/reports/payroll-summary', (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  db.all('SELECT * FROM employees WHERE active = 1 ORDER BY name', [], (err, employees) => {
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
      
      // Get attendance for all employees
      db.all(`
        SELECT 
          employee_id,
          date(clock_in) as work_date,
          clock_in,
          clock_out,
          hours_worked
        FROM attendance
        WHERE date(clock_in) >= date(?)
          AND date(clock_in) <= date(?)
        ORDER BY employee_id, clock_in
      `, [start_date, end_date], (err, allRecords) => {
        if (err) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        
        // Group records by employee
        const recordsByEmployee = {};
        allRecords.forEach(record => {
          if (!recordsByEmployee[record.employee_id]) {
            recordsByEmployee[record.employee_id] = [];
          }
          recordsByEmployee[record.employee_id].push(record);
        });
        
        // Calculate expected work days
        const startDateObj = new Date(start_date);
        const endDateObj = new Date(end_date);
        let expectedWorkDays = 0;
        
        for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            expectedWorkDays++;
          }
        }
        
        // Process each employee
        const employeeSummaries = employees.map(emp => {
          const schedule = scheduleMap[emp.employee_id];
          const expectedHours = schedule?.expected_hours || 8;
          const expectedStart = schedule?.start_time || '09:00';
          const expectedEnd = schedule?.end_time || '17:00';
          
          const records = recordsByEmployee[emp.employee_id] || [];
          const completedRecords = records.filter(r => r.clock_out !== null);
          const incompleteRecords = records.filter(r => r.clock_out === null);
          
          let totalHours = 0;
          let lateCount = 0;
          let undertimeCount = 0;
          let overtimeCount = 0;
          
          completedRecords.forEach(record => {
            totalHours += record.hours_worked || 0;
            
            const status = detectAttendanceStatus(
              record.clock_in,
              record.clock_out,
              expectedStart,
              expectedEnd,
              expectedHours
            );
            
            if (status.isLate) lateCount++;
            if (status.isUndertime) undertimeCount++;
            if (status.isOvertime) overtimeCount++;
          });
          
          const actualWorkDays = new Set(records.map(r => r.work_date)).size;
          const missingDays = expectedWorkDays - actualWorkDays;
          const expectedTotalHours = expectedWorkDays * expectedHours;
          
          return {
            employee_id: emp.employee_id,
            name: emp.name,
            total_records: records.length,
            completed_records: completedRecords.length,
            incomplete_records: incompleteRecords.length,
            actual_work_days: actualWorkDays,
            expected_work_days: expectedWorkDays,
            missing_days: missingDays,
            total_hours_worked: Math.round(totalHours * 100) / 100,
            expected_total_hours: Math.round(expectedTotalHours * 100) / 100,
            hours_variance: Math.round((totalHours - expectedTotalHours) * 100) / 100,
            late_count: lateCount,
            undertime_count: undertimeCount,
            overtime_count: overtimeCount,
            attendance_rate: expectedWorkDays > 0 ? Math.round((actualWorkDays / expectedWorkDays) * 100) : 0,
            expected_hours_per_day: expectedHours
          };
        });
        
        // Calculate totals
        const totals = {
          total_employees: employees.length,
          total_hours_worked: employeeSummaries.reduce((sum, e) => sum + e.total_hours_worked, 0),
          total_expected_hours: employeeSummaries.reduce((sum, e) => sum + e.expected_total_hours, 0),
          total_incomplete_records: employeeSummaries.reduce((sum, e) => sum + e.incomplete_records, 0),
          total_missing_days: employeeSummaries.reduce((sum, e) => sum + e.missing_days, 0),
          average_attendance_rate: employees.length > 0 
            ? Math.round(employeeSummaries.reduce((sum, e) => sum + e.attendance_rate, 0) / employees.length)
            : 0
        };
        
        res.json({
          period: {
            start_date,
            end_date,
            expected_work_days: expectedWorkDays
          },
          totals,
          employees: employeeSummaries
        });
      });
    });
  });
});

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

app.get('/api/reports/errors-and-missing/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  db.get('SELECT employee_id, name FROM employees WHERE employee_id = ?', [employee_id], (errEmp, emp) => {
    if (errEmp) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    db.all(`
      SELECT 
        a.id,
        a.employee_id,
        e.name as employee_name,
        a.clock_in,
        date(a.clock_in) as work_date
      FROM attendance a
      JOIN employees e ON a.employee_id = e.employee_id
      WHERE a.employee_id = ?
        AND a.clock_out IS NULL
        AND date(a.clock_in) >= date(?)
        AND date(a.clock_in) <= date(?)
      ORDER BY a.clock_in DESC
    `, [employee_id, start_date, end_date], (errInc, incompleteRecords) => {
      if (errInc) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      db.all(`
        SELECT 
          date(clock_in) as work_date
        FROM attendance
        WHERE employee_id = ?
          AND date(clock_in) >= date(?)
          AND date(clock_in) <= date(?)
        GROUP BY date(clock_in)
      `, [employee_id, start_date, end_date], (errDays, attendanceDays) => {
        if (errDays) {
          return res.status(500).json({ error: 'Database error occurred' });
        }
        const startDateObj = new Date(start_date);
        const endDateObj = new Date(end_date);
        const expectedDates = [];
        for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
          const dow = d.getDay();
          if (dow !== 0 && dow !== 6) {
            expectedDates.push(d.toISOString().split('T')[0]);
          }
        }
        const attendedSet = new Set(attendanceDays.map(r => r.work_date));
        const missingDays = expectedDates.filter(dt => !attendedSet.has(dt)).map(dt => ({
          employee_id: emp.employee_id,
          employee_name: emp.name,
          missing_date: dt,
          day_of_week: new Date(dt).toLocaleDateString('en-US', { weekday: 'long' })
        }));
        res.json({
          period: { start_date, end_date, expected_work_days: expectedDates.length },
          summary: {
            total_incomplete_records: incompleteRecords.length,
            total_missing_days: missingDays.length,
            employees_with_issues: (incompleteRecords.length > 0 || missingDays.length > 0) ? 1 : 0
          },
          incomplete_records: incompleteRecords.map(r => ({
            id: r.id,
            employee_id: r.employee_id,
            employee_name: r.employee_name,
            clock_in: r.clock_in,
            work_date: r.work_date,
            issue_type: 'missing_clock_out',
            severity: 'high'
          })),
          missing_days: missingDays.map(r => ({
            employee_id: r.employee_id,
            employee_name: r.employee_name,
            missing_date: r.missing_date,
            day_of_week: r.day_of_week,
            issue_type: 'absent',
            severity: 'medium'
          }))
        });
      });
    });
  });
});

app.get('/api/reports/payroll-breakdown/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  const { start_date, end_date, rate } = req.query;
  const hourlyRate = rate ? Number(rate) : 70;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  db.get('SELECT * FROM employee_schedules WHERE employee_id = ?', [employee_id], (err, schedule) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred' });
    }
    const expectedStart = schedule?.start_time || '09:00';
    const expectedEnd = schedule?.end_time || '17:00';
    const expectedHours = schedule?.expected_hours || 8;
    db.all(`
      SELECT employee_id, clock_in, clock_out
      FROM attendance
      WHERE employee_id = ?
        AND date(clock_in) >= date(?)
        AND date(clock_in) <= date(?)
      ORDER BY clock_in
    `, [employee_id, start_date, end_date], (err2, records) => {
      if (err2) {
        return res.status(500).json({ error: 'Database error occurred' });
      }
      let totalHours = 0;
      const breakdown = records.map(r => {
        let hoursWorked = 0;
        let late = false, undertime = false, overtime = false;
        if (r.clock_out) {
          const status = detectAttendanceStatus(r.clock_in, r.clock_out, expectedStart, expectedEnd, expectedHours);
          hoursWorked = status.hoursWorked || 0;
          late = status.isLate;
          undertime = status.isUndertime;
          overtime = status.isOvertime;
        } else {
          const clockInDate = new Date(r.clock_in);
          const [h, m] = expectedStart.split(':').map(Number);
          const startDate = new Date(clockInDate);
          startDate.setHours(h, m, 0);
          late = clockInDate > startDate;
        }
        totalHours += hoursWorked;
        return {
          date: new Date(r.clock_in).toISOString().split('T')[0],
          hoursWorked: Math.round(hoursWorked * 100) / 100,
          status: { late, undertime, overtime }
        };
      });
      res.json({
        employee_id,
        totalHours: Math.round(totalHours * 100) / 100,
        payrollAmount: Math.round(totalHours * hourlyRate * 100) / 100,
        breakdown
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
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(employee_id);
        
        const query = `UPDATE employees SET ${updates.join(', ')} WHERE employee_id = ?`;
        
        db.run(query, params, function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
          }
          
          db.get('SELECT id, employee_id, name, username, active, created_at FROM employees WHERE employee_id = ?', [employee_id], (err, updated) => {
            if (err) {
              return res.status(500).json({ error: 'Database error occurred' });
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
      
      db.run('UPDATE employees SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?', 
        [hashedPassword, employee_id], 
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error occurred' });
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
    
    db.run('DELETE FROM attendance WHERE employee_id = ?', [employee_id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error occurred: ' + err.message });
      }
      db.run('DELETE FROM employee_schedules WHERE employee_id = ?', [employee_id], function(err2) {
        if (err2) {
          return res.status(500).json({ error: 'Database error occurred: ' + err2.message });
        }
        db.run('DELETE FROM employees WHERE employee_id = ?', [employee_id], function(err3) {
          if (err3) {
            return res.status(500).json({ error: 'Database error occurred: ' + err3.message });
          }
          res.json({ 
            success: true, 
            message: `Employee ${employee.name} has been permanently deleted`,
            employee_id: employee_id
          });
        });
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

// Serve backend payroll tool page
// Removed external payroll page serving to keep calculations inside admin dashboard

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
  
  https.createServer(options, app).listen(PORT, '0.0.0.0', () => {
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
// ================== ATTENDANCE SUMMARY VIEW ================== //
app.get("/api/summary/:id", (req, res) => {
  const empID = req.params.id;
  db.get(`SELECT * FROM employee_schedules WHERE employee_id = ?`, [empID], (errS, schedule) => {
    if (errS) return res.status(500).json({ error: errS.message });
    const expectedStart = schedule?.start_time || '09:00';
    const expectedEnd = schedule?.end_time || '17:00';
    const expectedHours = schedule?.expected_hours || 8;
    db.all(`SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in`, [empID], (err, records) => {
      if (err) return res.status(500).json({ error: err.message });
      const summary = records.map(r => {
        let hoursWorked = 0;
        let late = false, undertime = false, overtime = false;
        if (r.clock_out) {
          const s = detectAttendanceStatus(r.clock_in, r.clock_out, expectedStart, expectedEnd, expectedHours);
          hoursWorked = s.hoursWorked || 0;
          late = s.isLate;
          undertime = s.isUndertime;
          overtime = s.isOvertime;
        } else if (r.clock_in) {
          const clockInDate = new Date(r.clock_in);
          const [h, m] = expectedStart.split(':').map(Number);
          const startDate = new Date(clockInDate);
          startDate.setHours(h, m, 0);
          late = clockInDate > startDate;
        }
        return {
          date: new Date(r.clock_in).toISOString().split('T')[0],
          clock_in: r.clock_in,
          clock_out: r.clock_out,
          hoursWorked: Math.round(hoursWorked * 100) / 100,
          status: { late, undertime, overtime }
        };
      });
      res.json({ summary, schedule });
    });
  });
});


// ================== PAYROLL SUMMARY VIEW ================== //
app.get("/api/payroll-summary/:id", (req, res) => {
  const empID = req.params.id;
  const rate = req.query.rate ? Number(req.query.rate) : 70;
  const { start_date, end_date } = req.query;

  db.get('SELECT * FROM employee_schedules WHERE employee_id = ?', [empID], (errS, schedule) => {
    if (errS) return res.status(500).json({ error: errS.message });
    const expectedStart = schedule?.start_time || '09:00';
    const expectedEnd = schedule?.end_time || '17:00';
    const expectedHours = schedule?.expected_hours || 8;

    let query = `SELECT employee_id, clock_in, clock_out FROM attendance WHERE employee_id = ?`;
    const params = [empID];
    if (start_date) { query += ` AND date(clock_in) >= date(?)`; params.push(start_date); }
    if (end_date) { query += ` AND date(clock_in) <= date(?)`; params.push(end_date); }
    query += ` ORDER BY clock_in`;

    db.all(query, params, (err, records) => {
      if (err) return res.status(500).json({ error: err.message });
      let totalHours = 0;
      const breakdown = records.map(r => {
        let hoursWorked = 0;
        let late = false, undertime = false, overtime = false;
        if (r.clock_out) {
          const s = detectAttendanceStatus(r.clock_in, r.clock_out, expectedStart, expectedEnd, expectedHours);
          hoursWorked = s.hoursWorked || 0;
          late = s.isLate;
          undertime = s.isUndertime;
          overtime = s.isOvertime;
        } else if (r.clock_in) {
          const clockInDate = new Date(r.clock_in);
          const [h, m] = expectedStart.split(':').map(Number);
          const startDate = new Date(clockInDate);
          startDate.setHours(h, m, 0);
          late = clockInDate > startDate;
        }
        totalHours += hoursWorked;
        return {
          date: new Date(r.clock_in).toISOString().split('T')[0],
          hoursWorked: Math.round(hoursWorked * 100) / 100,
          status: { late, undertime, overtime }
        };
      });
      res.json({
        totalDaysWorked: breakdown.length,
        totalHours: Math.round(totalHours * 100) / 100,
        hourlyRate: rate,
        payrollAmount: Math.round(totalHours * rate * 100) / 100,
        breakdown
      });
    });
  });
});
